/**
 * App preferences, loaded once before the deck paints.
 *
 * The provider owns the resolved color scheme so every `useTheme()` in the
 * tree follows the in-app choice rather than the phone. Writes are optimistic
 * (the switch answers immediately) but roll back if the device refuses to
 * persist them.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useColorScheme as useSystemColorScheme } from 'react-native';

import {
  DEFAULT_PREFERENCES,
  loadPreferences,
  savePreferences,
  type AppPreferences,
} from './storage';

export type ColorScheme = 'light' | 'dark';

interface PreferencesContextValue {
  /** False until the stored preferences have been read. */
  ready: boolean;
  preferences: AppPreferences;
  /** The scheme the app should paint: the preference, or the phone's when set to system. */
  scheme: ColorScheme;
  update: (patch: Partial<AppPreferences>) => Promise<void>;
}

const PreferencesContext = createContext<PreferencesContextValue | null>(null);

export function PreferencesProvider({ children }: Readonly<{ children: ReactNode }>) {
  const system = useSystemColorScheme();
  const [preferences, setPreferences] = useState<AppPreferences>(DEFAULT_PREFERENCES);
  const [ready, setReady] = useState(false);
  const latest = useRef<AppPreferences>(DEFAULT_PREFERENCES);

  // Read once; the splash stays up until `ready`, so there is no flash of the
  // wrong scheme on a phone whose choice differs from the system.
  useEffect(() => {
    let alive = true;
    void loadPreferences().then((stored) => {
      if (!alive) return;
      latest.current = stored;
      setPreferences(stored);
      setReady(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  const update = useCallback(async (patch: Partial<AppPreferences>) => {
    const previous = latest.current;
    const next = { ...previous, ...patch };
    latest.current = next;
    setPreferences(next);
    try {
      await savePreferences(next);
    } catch (err) {
      // A later write may have superseded this one already; only the newest
      // value is allowed to roll back.
      if (latest.current === next) {
        latest.current = previous;
        setPreferences(previous);
      }
      throw err;
    }
  }, []);

  const systemScheme: ColorScheme = system === 'dark' ? 'dark' : 'light';
  const scheme: ColorScheme =
    preferences.appearance === 'system' ? systemScheme : preferences.appearance;

  const value = useMemo<PreferencesContextValue>(
    () => ({ ready, preferences, scheme, update }),
    [ready, preferences, scheme, update],
  );

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function usePreferences(): PreferencesContextValue {
  const ctx = useContext(PreferencesContext);
  if (!ctx) throw new Error('usePreferences must be used within PreferencesProvider');
  return ctx;
}

/** Null outside the provider, so the theme hook can fall back to the system. */
export function usePreferredScheme(): ColorScheme | null {
  return useContext(PreferencesContext)?.scheme ?? null;
}
