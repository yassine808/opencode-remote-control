import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

export interface StoredConnection {
  /** Server base URL, e.g. an OpenTunnel https URL or http://127.0.0.1:49374 on-LAN. */
  baseUrl: string;
  /** OpenCode pairing token (`<expiryUnixSeconds>.<signature>`). */
  token: string;
  savedAt: number;
}

const KEY = 'ocrc.connection.v1';

// expo-secure-store is a native-only module (its web build is an empty stub),
// so browser previews fall back to localStorage.
const webStorage =
  Platform.OS === 'web' && typeof localStorage !== 'undefined' ? localStorage : null;

export async function loadConnection(): Promise<StoredConnection | null> {
  try {
    const raw = webStorage ? webStorage.getItem(KEY) : await SecureStore.getItemAsync(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredConnection;
    if (!parsed?.baseUrl || !parsed?.token) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function saveConnection(conn: StoredConnection): Promise<void> {
  const raw = JSON.stringify(conn);
  if (webStorage) {
    webStorage.setItem(KEY, raw);
    return;
  }
  await SecureStore.setItemAsync(KEY, raw);
}

export async function clearConnection(): Promise<void> {
  if (webStorage) {
    webStorage.removeItem(KEY);
    return;
  }
  await SecureStore.deleteItemAsync(KEY);
}

// ---------- recently opened conversations ----------

export interface RecentSession {
  id: string;
  /** Title when it was opened; the launcher prefers the live title when it has one. */
  title?: string | null;
  /** Project directory at open time, for the launcher's caption. */
  directory?: string | null;
  openedAt: number;
}

const RECENTS_KEY = 'ocrc.recents.v1';
const RECENTS_MAX = 5;

export async function loadRecentSessions(): Promise<RecentSession[]> {
  try {
    const raw = webStorage
      ? webStorage.getItem(RECENTS_KEY)
      : await SecureStore.getItemAsync(RECENTS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is RecentSession =>
        !!entry && typeof entry === 'object' && typeof (entry as RecentSession).id === 'string',
    );
  } catch {
    return [];
  }
}

/** Move a conversation to the front of the recents — recorded when it opens. */
export async function rememberRecentSession(entry: {
  id: string;
  title?: string | null;
  directory?: string | null;
}): Promise<void> {
  try {
    const previous = await loadRecentSessions();
    const next: RecentSession[] = [
      {
        id: entry.id,
        title: entry.title ?? null,
        directory: entry.directory ?? null,
        openedAt: Date.now(),
      },
      ...previous.filter((r) => r.id !== entry.id),
    ].slice(0, RECENTS_MAX);
    const raw = JSON.stringify(next);
    if (webStorage) {
      webStorage.setItem(RECENTS_KEY, raw);
      return;
    }
    await SecureStore.setItemAsync(RECENTS_KEY, raw);
  } catch {
    // History is a convenience — never let it break opening a conversation.
  }
}

// ---------- pinned conversations ----------

export interface PinnedSession {
  id: string;
  /** Title when it was pinned; the launcher prefers the live title when it has one. */
  title?: string | null;
  /** Project directory at pin time, for the launcher's caption. */
  directory?: string | null;
  pinnedAt: number;
}

const PINNED_KEY = 'ocrc.pinned.v1';

export async function loadPinnedSessions(): Promise<PinnedSession[]> {
  try {
    const raw = webStorage
      ? webStorage.getItem(PINNED_KEY)
      : await SecureStore.getItemAsync(PINNED_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is PinnedSession =>
        !!entry && typeof entry === 'object' && typeof (entry as PinnedSession).id === 'string',
    );
  } catch {
    return [];
  }
}

/** Flip a conversation's pin — pinned ones lead the launcher, newest first. */
export async function togglePinnedSession(entry: {
  id: string;
  title?: string | null;
  directory?: string | null;
}): Promise<void> {
  try {
    const previous = await loadPinnedSessions();
    const next: PinnedSession[] = previous.some((p) => p.id === entry.id)
      ? previous.filter((p) => p.id !== entry.id)
      : [
          {
            id: entry.id,
            title: entry.title ?? null,
            directory: entry.directory ?? null,
            pinnedAt: Date.now(),
          },
          ...previous,
        ];
    const raw = JSON.stringify(next);
    if (webStorage) {
      webStorage.setItem(PINNED_KEY, raw);
      return;
    }
    await SecureStore.setItemAsync(PINNED_KEY, raw);
  } catch {
    // Pinning is a convenience — never let it break the launcher.
  }
}
