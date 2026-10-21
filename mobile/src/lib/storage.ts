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

// One read/write path for every key, so native and web keep identical behavior.
async function readRaw(key: string): Promise<string | null> {
  return webStorage ? webStorage.getItem(key) : await SecureStore.getItemAsync(key);
}

async function writeRaw(key: string, raw: string): Promise<void> {
  if (webStorage) {
    webStorage.setItem(key, raw);
    return;
  }
  await SecureStore.setItemAsync(key, raw);
}

async function removeRaw(key: string): Promise<void> {
  if (webStorage) {
    webStorage.removeItem(key);
    return;
  }
  await SecureStore.deleteItemAsync(key);
}

export async function loadConnection(): Promise<StoredConnection | null> {
  try {
    const raw = await readRaw(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredConnection;
    if (!parsed?.baseUrl || !parsed?.token) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function saveConnection(conn: StoredConnection): Promise<void> {
  await writeRaw(KEY, JSON.stringify(conn));
}

export async function clearConnection(): Promise<void> {
  await removeRaw(KEY);
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
    const raw = await readRaw(RECENTS_KEY);
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
    await writeRaw(RECENTS_KEY, JSON.stringify(next));
  } catch {
    // History is a convenience — never let it break opening a conversation.
  }
}

export async function clearRecentSessions(): Promise<void> {
  try {
    await removeRaw(RECENTS_KEY);
  } catch {
    // History is a convenience — clearing it is best-effort.
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
    const raw = await readRaw(PINNED_KEY);
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
    await writeRaw(PINNED_KEY, JSON.stringify(next));
  } catch {
    // Pinning is a convenience — never let it break the launcher.
  }
}

export async function clearPinnedSessions(): Promise<void> {
  try {
    await removeRaw(PINNED_KEY);
  } catch {
    // Pinning is a convenience — clearing it is best-effort.
  }
}

// ---------- app preferences ----------

export type AppearancePreference = 'system' | 'light' | 'dark';

export interface AppPreferences {
  /** Follow the phone, or pin the deck to one scheme. */
  appearance: AppearancePreference;
  /** Native only: ask for biometrics / device passcode before showing sessions. */
  requireUnlock: boolean;
  /** Check GitHub Releases once when the launcher opens. */
  autoCheckUpdates: boolean;
}

export const DEFAULT_PREFERENCES: AppPreferences = {
  appearance: 'system',
  requireUnlock: true,
  autoCheckUpdates: true,
};

const PREFERENCES_KEY = 'ocrc.preferences.v1';

/** Unknown or corrupt values fall back one field at a time — never all or nothing. */
export async function loadPreferences(): Promise<AppPreferences> {
  try {
    const raw = await readRaw(PREFERENCES_KEY);
    if (!raw) return DEFAULT_PREFERENCES;
    const parsed = JSON.parse(raw) as Partial<AppPreferences>;
    const appearance =
      parsed.appearance === 'light' || parsed.appearance === 'dark' || parsed.appearance === 'system'
        ? parsed.appearance
        : DEFAULT_PREFERENCES.appearance;
    return {
      appearance,
      requireUnlock:
        typeof parsed.requireUnlock === 'boolean'
          ? parsed.requireUnlock
          : DEFAULT_PREFERENCES.requireUnlock,
      autoCheckUpdates:
        typeof parsed.autoCheckUpdates === 'boolean'
          ? parsed.autoCheckUpdates
          : DEFAULT_PREFERENCES.autoCheckUpdates,
    };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

export async function savePreferences(preferences: AppPreferences): Promise<void> {
  await writeRaw(PREFERENCES_KEY, JSON.stringify(preferences));
}
