import * as SecureStore from 'expo-secure-store';

export interface StoredConnection {
  /** Server base URL, e.g. an OpenTunnel https URL or http://127.0.0.1:49374 on-LAN. */
  baseUrl: string;
  /** OpenCode pairing token (`<expiryUnixSeconds>.<signature>`). */
  token: string;
  savedAt: number;
}

const KEY = 'ocrc.connection.v1';

export async function loadConnection(): Promise<StoredConnection | null> {
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredConnection;
    if (!parsed?.baseUrl || !parsed?.token) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function saveConnection(conn: StoredConnection): Promise<void> {
  await SecureStore.setItemAsync(KEY, JSON.stringify(conn));
}

export async function clearConnection(): Promise<void> {
  await SecureStore.deleteItemAsync(KEY);
}
