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
