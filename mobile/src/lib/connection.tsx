import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { AppState } from 'react-native';

import { OpenCodeApi, exchangePairingCode, tokenExpiresAt } from './api';
import { clearConnection, loadConnection, saveConnection, type StoredConnection } from './storage';

/** Renew proactively when the token has less than this much life left. */
const RENEW_WHEN_REMAINING_MS = 5 * 24 * 60 * 60 * 1000;

interface ConnectionContextValue {
  ready: boolean;
  connection: StoredConnection | null;
  api: OpenCodeApi | null;
  /** Persist a fresh pairing (base URL + already-exchanged token). */
  connect: (baseUrl: string, token: string) => Promise<void>;
  disconnect: () => Promise<void>;
}

const ConnectionContext = createContext<ConnectionContextValue | null>(null);

let renewing = false;

export function ConnectionProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [ready, setReady] = useState(false);
  const [connection, setConnection] = useState<StoredConnection | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const stored = await loadConnection();
      if (cancelled) return;
      setConnection(stored);
      setReady(true);
      if (stored) void tryRenew(stored, setConnection);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Silent renewal when the app returns to the foreground.
  useEffect(() => {
    if (!connection) return;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void tryRenew(connection, setConnection);
    });
    return () => sub.remove();
  }, [connection]);

  const connect = useCallback(async (baseUrl: string, token: string) => {
    const conn: StoredConnection = { baseUrl, token, savedAt: Date.now() };
    await saveConnection(conn);
    setConnection(conn);
  }, []);

  const disconnect = useCallback(async () => {
    await clearConnection();
    setConnection(null);
  }, []);

  const value = useMemo<ConnectionContextValue>(
    () => ({
      ready,
      connection,
      api: connection ? new OpenCodeApi(connection.baseUrl, connection.token) : null,
      connect,
      disconnect,
    }),
    [ready, connection, connect, disconnect],
  );

  return <ConnectionContext.Provider value={value}>{children}</ConnectionContext.Provider>;
}

export function useConnection(): ConnectionContextValue {
  const ctx = useContext(ConnectionContext);
  if (!ctx) throw new Error('useConnection must be used within ConnectionProvider');
  return ctx;
}

/**
 * Renew the pairing token without touching the PC: mint a one-time code with
 * the current token (`POST /api/pair`), then exchange it for a fresh token.
 */
async function tryRenew(
  stored: StoredConnection,
  onRenewed: (conn: StoredConnection) => void,
): Promise<void> {
  const expires = tokenExpiresAt(stored.token);
  if (!expires || expires - Date.now() > RENEW_WHEN_REMAINING_MS) return;
  if (renewing) return;
  renewing = true;
  try {
    const api = new OpenCodeApi(stored.baseUrl, stored.token);
    const freshCode = await api.pair();
    const token = await exchangePairingCode(stored.baseUrl, freshCode.code);
    const renewed: StoredConnection = { ...stored, token, savedAt: Date.now() };
    await saveConnection(renewed);
    onRenewed(renewed);
  } catch {
    // Non-fatal: keep using the old token until it actually expires.
  } finally {
    renewing = false;
  }
}
