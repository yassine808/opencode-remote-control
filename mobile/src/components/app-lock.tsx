/**
 * App lock — the phone is the key to a machine that runs code. The gate
 * covers everything until device authentication succeeds: biometrics when
 * enrolled, the device PIN/passcode otherwise. It locks on cold start and
 * whenever the app leaves the foreground.
 *
 * The screens keep running underneath — the connection stays warm — so
 * unlocking lands on live state rather than a cold reload.
 */

import * as LocalAuthentication from 'expo-local-authentication';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { AppState, Platform, StyleSheet, View } from 'react-native';

import { BrandWordmark, WORDMARK_FULL } from '@/components/brand';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui';
import { useTheme } from '@/hooks/use-theme';

export function AppLock({ children }: Readonly<{ children: ReactNode }>) {
  const theme = useTheme();
  // Browsers have no device-auth prompt to show; the web preview opens ungated.
  const [locked, setLocked] = useState(Platform.OS !== 'web');
  const [busy, setBusy] = useState(false);
  /** The device has nothing to authenticate with at all. */
  const [ungated, setUngated] = useState(false);
  const lockedRef = useRef(true);
  const prompting = useRef(false);

  const unlock = useCallback(async () => {
    if (prompting.current) return;
    prompting.current = true;
    setBusy(true);
    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Unlock OpenCode Remote',
      });
      if (result.success) {
        lockedRef.current = false;
        setLocked(false);
      } else if (
        result.error === 'not_enrolled' ||
        result.error === 'passcode_not_set' ||
        result.error === 'not_available'
      ) {
        // Nothing to authenticate with. Without a way through the app would
        // be unopenable, so say so plainly and offer the hatch.
        setUngated(true);
      }
    } catch {
      // A broken prompt never wedges the gate — the button stays for a retry.
    } finally {
      prompting.current = false;
      setBusy(false);
    }
  }, []);

  // Prompt as soon as the cover is up — scheduled so the cover paints first;
  // the system dialog would otherwise open over the splash.
  useEffect(() => {
    if (!locked) return;
    const t = setTimeout(() => void unlock(), 350);
    return () => clearTimeout(t);
  }, [locked, unlock]);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background') {
        lockedRef.current = true;
        setLocked(true);
      } else if (state === 'active' && lockedRef.current) {
        // Returning to a locked app: prompt straight away. Guarded by
        // `prompting`, so the mount-time timer can never double-fire it.
        void unlock();
      }
    });
    return () => sub.remove();
  }, [unlock]);

  return (
    <View style={styles.fill}>
      <View
        style={styles.fill}
        importantForAccessibility={locked ? 'no-hide-descendants' : 'auto'}>
        {children}
      </View>
      {locked ? (
        <View
          accessibilityViewIsModal
          style={[StyleSheet.absoluteFill, styles.cover, { backgroundColor: theme.canvas }]}>
          <BrandWordmark height={14} text={WORDMARK_FULL} />
          <ThemedText type="callout" themeColor="inkMuted" style={styles.hint}>
            {ungated
              ? 'No screen lock is set up on this device, so there is nothing to unlock with.'
              : 'Authenticate to open your sessions.'}
          </ThemedText>
          <Button variant="primary" busy={busy} onPress={() => void unlock()} style={styles.button}>
            Unlock
          </Button>
          {ungated ? (
            <Button
              variant="secondary"
              onPress={() => {
                lockedRef.current = false;
                setLocked(false);
              }}
              style={styles.button}>
              Continue without a lock
            </Button>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  cover: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 20,
    paddingHorizontal: 32,
  },
  hint: { textAlign: 'center', maxWidth: 280 },
  button: { minWidth: 200 },
});
