import { fetch as streamingFetch } from 'expo/fetch';

import { basicAuthHeader, normalizeBaseUrl } from './api';
import type { ServerEvent } from './types';

export type StreamStatus = 'connecting' | 'connected' | 'disconnected';

export interface EventStreamOptions {
  baseUrl: string;
  token: string;
  signal: AbortSignal;
  onEvent: (event: ServerEvent) => void;
  onStatus?: (status: StreamStatus) => void;
}

/**
 * Connect to `GET /api/event` and deliver parsed events until the signal aborts.
 * Reconnects with exponential backoff on failure. The stream is volatile by
 * contract — events during a disconnect are lost, so consumers should treat
 * `onStatus('connected')` as a signal to refetch current state.
 */
export async function runEventStream(opts: EventStreamOptions): Promise<void> {
  const base = normalizeBaseUrl(opts.baseUrl);
  let attempt = 0;
  while (!opts.signal.aborted) {
    try {
      await streamOnce(base, opts);
      attempt = 0;
    } catch {
      // connection failed or ended — fall through to backoff
    }
    if (opts.signal.aborted) break;
    opts.onStatus?.('disconnected');
    attempt += 1;
    const backoff = Math.min(30_000, 1000 * 2 ** Math.min(attempt - 1, 5));
    await delay(backoff + Math.random() * 400, opts.signal); // NOSONAR — jitter needs no CSPRNG; retry loop is sequential by design
  }
  opts.onStatus?.('disconnected');
}

async function streamOnce(base: string, opts: EventStreamOptions): Promise<void> {
  opts.onStatus?.('connecting');
  const res = await streamingFetch(`${base}/api/event`, {
    method: 'GET',
    headers: {
      Authorization: basicAuthHeader(opts.token),
      Accept: 'text/event-stream',
      'Cache-Control': 'no-store',
    },
    signal: opts.signal,
  });
  if (!res.ok || !res.body) {
    throw new Error(`event stream failed: ${res.status}`);
  }
  opts.onStatus?.('connected');
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let sep: number;
    while ((sep = buffer.indexOf('\n\n')) !== -1) {
      const block = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      const payload = parseSseBlock(block);
      if (!payload) continue;
      try {
        opts.onEvent(JSON.parse(payload) as ServerEvent);
      } catch {
        // ignore malformed payloads
      }
    }
  }
  throw new Error('event stream ended');
}

/** Extract `data:` payload from one SSE block; returns null for comments/heartbeats. */
function parseSseBlock(block: string): string | null {
  const dataLines: string[] = [];
  for (const rawLine of block.split('\n')) {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    if (!line.startsWith('data:')) continue;
    dataLines.push(line.slice(5).trimStart());
  }
  return dataLines.length > 0 ? dataLines.join('\n') : null;
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}
