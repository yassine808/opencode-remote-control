import { b64encode } from './b64';
import type {
  ActiveSessionsResponse,
  ListResponse,
  MessageInfo,
  PairingCode,
  PermissionDecision,
  PermissionRequest,
  PromptAccepted,
  PromptBody,
  ServerInfo,
  SessionInfo,
} from './types';

// ---------- typed errors ----------

export class UnreachableError extends Error {
  readonly originalError?: unknown;
  constructor(url: string, originalError?: unknown) {
    super(`Cannot reach ${url}`);
    this.name = 'UnreachableError';
    this.originalError = originalError;
  }
}

export class UnauthorizedError extends Error {
  constructor() {
    super('Unauthorized — pairing token invalid or expired');
    this.name = 'UnauthorizedError';
  }
}

export class HttpError extends Error {
  readonly status: number;
  readonly body: unknown;
  constructor(status: number, body: unknown) {
    super(status > 0 ? `HTTP ${status}` : String(body));
    this.name = 'HttpError';
    this.status = status;
    this.body = body;
  }
}

export function describeError(err: unknown): string {
  if (err instanceof UnreachableError) return 'PC unreachable — check your connection';
  if (err instanceof UnauthorizedError) return 'Not paired anymore — re-pair from Setup';
  if (err instanceof HttpError) return `Server error (HTTP ${err.status})`;
  if (err instanceof Error) return err.message;
  return String(err);
}

// ---------- auth helpers ----------

export function basicAuthHeader(token: string): string {
  return `Basic ${b64encode(`opencode:${token}`)}`;
}

/** Tokens are `"<expiryUnixSeconds>.<signature>"` — read local expiry without a round-trip. */
export function tokenExpiresAt(token: string): number | null {
  const dot = token.indexOf('.');
  if (dot <= 0) return null;
  const seconds = Number(token.slice(0, dot));
  if (!Number.isFinite(seconds) || seconds < 1_000_000_000) return null;
  return seconds * 1000;
}

export function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

// ---------- client ----------

export class OpenCodeApi {
  readonly baseUrl: string;
  readonly token: string;

  constructor(baseUrl: string, token: string) {
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.token = token;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<T> {
    const url = this.baseUrl + path;
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: {
          Authorization: basicAuthHeader(this.token),
          Accept: 'application/json',
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal,
      });
    } catch (err) {
      if (signal?.aborted) throw err;
      throw new UnreachableError(this.baseUrl, err);
    }
    if (res.status === 401) throw new UnauthorizedError();
    const text = await res.text().catch(() => '');
    let parsed: unknown;
    try {
      parsed = text ? JSON.parse(text) : undefined;
    } catch {
      parsed = text;
    }
    if (!res.ok) throw new HttpError(res.status, parsed);
    return parsed as T;
  }

  info(signal?: AbortSignal) {
    return this.request<ServerInfo>('GET', '/api/info', undefined, signal);
  }

  sessions(limit = 50, signal?: AbortSignal) {
    return this.request<ListResponse<SessionInfo>>(
      'GET',
      `/api/session?limit=${limit}`,
      undefined,
      signal,
    );
  }

  session(id: string, signal?: AbortSignal) {
    return this.request<{ data: SessionInfo }>('GET', `/api/session/${id}`, undefined, signal);
  }

  activeSessions(signal?: AbortSignal) {
    return this.request<ActiveSessionsResponse>('GET', '/api/session/active', undefined, signal);
  }

  messages(
    sessionID: string,
    opts: { limit?: number; order?: 'asc' | 'desc'; cursor?: string; signal?: AbortSignal } = {},
  ) {
    const { limit = 60, order = 'desc', cursor, signal } = opts;
    let path = `/api/session/${sessionID}/message?limit=${limit}&order=${order}`;
    if (cursor) path += `&cursor=${encodeURIComponent(cursor)}`;
    return this.request<ListResponse<MessageInfo>>('GET', path, undefined, signal);
  }

  prompt(sessionID: string, body: PromptBody, signal?: AbortSignal) {
    return this.request<PromptAccepted>('POST', `/api/session/${sessionID}/prompt`, body, signal);
  }

  interrupt(sessionID: string, signal?: AbortSignal) {
    return this.request<{ interrupted: boolean }>(
      'POST',
      `/api/session/${sessionID}/interrupt`,
      undefined,
      signal,
    );
  }

  permissionRequests(signal?: AbortSignal) {
    return this.request<{ data: PermissionRequest[] }>(
      'GET',
      '/api/permission/request',
      undefined,
      signal,
    );
  }

  replyPermission(
    sessionID: string,
    requestID: string,
    decision: PermissionDecision,
    signal?: AbortSignal,
  ) {
    return this.request<unknown>(
      'POST',
      `/api/session/${sessionID}/permission/${requestID}/reply`,
      { decision },
      signal,
    );
  }

  /** Mint a fresh one-time pairing code using the current (still valid) token — silent renewal. */
  pair(signal?: AbortSignal) {
    return this.request<PairingCode>('POST', '/api/pair', undefined, signal);
  }
}

/** Exchange a one-time pairing code for a long-lived token. No auth required. */
export async function exchangePairingCode(baseUrl: string, code: string): Promise<string> {
  const url = `${normalizeBaseUrl(baseUrl)}/auth/connect/${encodeURIComponent(code)}`;
  let res: Response;
  try {
    res = await fetch(url, { headers: { Accept: 'application/json' } });
  } catch (err) {
    throw new UnreachableError(baseUrl, err);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new HttpError(res.status, body);
  }
  const json = (await res.json()) as { token?: string };
  if (!json?.token) throw new HttpError(0, 'Pairing response missing token');
  return json.token;
}
