/**
 * Settings — the deck's own controls, grouped by what they touch: how it
 * looks, who can open it, which PC it trusts, and what this phone remembers.
 *
 * Rows are seams on the canvas, not cards. One column, one reading per group;
 * the only colored surfaces are the caution note for a missing screen lock and
 * the coral banner when a write fails.
 */

import * as LocalAuthentication from 'expo-local-authentication';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Linking, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Glyph, PressableScale } from '@/components/ui';
import { Radius } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { confirmAction } from '@/lib/confirm';
import { useConnection } from '@/lib/connection';
import { useNotificationPermission } from '@/lib/notifications';
import { usePreferences } from '@/lib/preferences';
import {
  clearPinnedSessions,
  clearRecentSessions,
  loadPinnedSessions,
  loadRecentSessions,
  type AppPreferences,
  type AppearancePreference,
} from '@/lib/storage';
import { installedVersion, installedVersionCode } from '@/lib/updater';

const REPO_URL = 'https://github.com/yassine808/opencode-remote-control';
const LICENSE_URL = `${REPO_URL}/blob/main/LICENSE`;

const THEMES: { value: AppearancePreference; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

type GateLevel = 'unknown' | 'ready' | 'none';

function displayHost(baseUrl: string | null | undefined): string {
  if (!baseUrl) return 'Not paired';
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl.replace(/^https?:\/\//, '');
  }
}

// ---------- rows ----------

function Section({ title, children }: Readonly<{ title: string; children: ReactNode }>) {
  const theme = useTheme();
  return (
    <View style={styles.section}>
      <ThemedText type="caption" weight="medium" themeColor="inkMuted" style={styles.sectionTitle}>
        {title}
      </ThemedText>
      <View style={{ borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.hairline }}>
        {children}
      </View>
    </View>
  );
}

function NavRow({
  label,
  hint,
  value,
  onPress,
  destructive,
  disabled,
}: Readonly<{
  label: string;
  hint?: string;
  value?: string;
  onPress: () => void;
  destructive?: boolean;
  disabled?: boolean;
}>) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={value ? `${label}, ${value}` : label}
      accessibilityHint={hint}
      style={({ pressed }) => [
        styles.row,
        { borderBottomColor: theme.hairline },
        pressed && !disabled && { backgroundColor: theme.inkWell },
        disabled && styles.disabled,
      ]}>
      <View style={styles.rowBody}>
        <ThemedText type="body" style={destructive ? { color: theme.negative } : undefined}>
          {label}
        </ThemedText>
        {hint ? (
          <ThemedText type="caption" themeColor="inkFaint" style={styles.rowHint}>
            {hint}
          </ThemedText>
        ) : null}
      </View>
      {value ? (
        <ThemedText
          type="caption"
          themeColor="inkMuted"
          numberOfLines={1}
          style={styles.rowValue}>
          {value}
        </ThemedText>
      ) : null}
      <Glyph name="chevron-forward" size={14} color={theme.inkFaint} />
    </Pressable>
  );
}

function InfoRow({ label, value }: Readonly<{ label: string; value: string }>) {
  const theme = useTheme();
  return (
    <View style={[styles.row, { borderBottomColor: theme.hairline }]}>
      <ThemedText type="body">{label}</ThemedText>
      <ThemedText
        type="code"
        themeColor="inkMuted"
        numberOfLines={1}
        style={styles.infoValue}>
        {value}
      </ThemedText>
    </View>
  );
}

function SwitchRow({
  label,
  hint,
  value,
  onValueChange,
  disabled,
}: Readonly<{
  label: string;
  hint?: string;
  value: boolean;
  onValueChange: (next: boolean) => void;
  disabled?: boolean;
}>) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={() => onValueChange(!value)}
      disabled={disabled}
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ checked: value, disabled: !!disabled }}
      style={({ pressed }) => [
        styles.row,
        { borderBottomColor: theme.hairline },
        pressed && !disabled && { backgroundColor: theme.inkWell },
        disabled && styles.disabled,
      ]}>
      <View style={styles.rowBody}>
        <ThemedText type="body">{label}</ThemedText>
        {hint ? (
          <ThemedText type="caption" themeColor="inkFaint" style={styles.rowHint}>
            {hint}
          </ThemedText>
        ) : null}
      </View>
      <View
        style={[
          styles.track,
          { backgroundColor: value ? theme.accent : theme.inkSelected },
        ]}>
        <View
          style={[
            styles.knob,
            {
              left: value ? 21 : 3,
              backgroundColor: value ? theme.onAccent : theme.inkFaint,
            },
          ]}
        />
      </View>
    </Pressable>
  );
}

function AppearanceRow({
  value,
  onChange,
}: Readonly<{ value: AppearancePreference; onChange: (next: AppearancePreference) => void }>) {
  const theme = useTheme();
  const hint = {
    system: 'Following your phone.',
    light: 'Always the morning deck.',
    dark: 'Always the night deck.',
  }[value];

  return (
    <View style={[styles.columnRow, { borderBottomColor: theme.hairline }]}>
      <ThemedText type="body">Theme</ThemedText>
      <ThemedText type="caption" themeColor="inkFaint" style={styles.themeHint}>
        {hint}
      </ThemedText>
      <View style={[styles.segmented, { backgroundColor: theme.inkWell }]}>
        {THEMES.map((option) => {
          const selected = value === option.value;
          return (
            <Pressable
              key={option.value}
              onPress={() => onChange(option.value)}
              accessibilityRole="radio"
              accessibilityLabel={option.label}
              accessibilityState={{ selected }}
              hitSlop={{ top: 4, bottom: 4 }}
              style={({ pressed }) => [
                styles.segment,
                selected && { backgroundColor: theme.surfaceRaised },
                pressed && !selected && { backgroundColor: theme.inkControl },
              ]}>
              {selected ? <Glyph name="checkmark" size={13} color={theme.ink} /> : null}
              <ThemedText
                type="callout"
                weight={selected ? 'semibold' : 'regular'}
                style={{ color: selected ? theme.ink : theme.inkMuted }}>
                {option.label}
              </ThemedText>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

// ---------- screen ----------

export default function SettingsScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { preferences, update } = usePreferences();
  const { connection, disconnect } = useConnection();
  const notificationPermission = useNotificationPermission();

  const [saveError, setSaveError] = useState<string | null>(null);
  const [history, setHistory] = useState({ recent: 0, pinned: 0 });
  const [gateLevel, setGateLevel] = useState<GateLevel>('unknown');

  const save = useCallback(
    async (patch: Partial<AppPreferences>) => {
      setSaveError(null);
      try {
        await update(patch);
      } catch {
        setSaveError('That setting could not be saved on this device.');
      }
    },
    [update],
  );

  const loadHistory = useCallback(async () => {
    const [recent, pinned] = await Promise.all([loadRecentSessions(), loadPinnedSessions()]);
    setHistory({ recent: recent.length, pinned: pinned.length });
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadHistory();
    }, [loadHistory]),
  );

  // The gate can only ask for something the phone actually has enrolled.
  useEffect(() => {
    if (Platform.OS === 'web') return;
    let alive = true;
    LocalAuthentication.getEnrolledLevelAsync()
      .then((level) => {
        if (alive) {
          setGateLevel(level === LocalAuthentication.SecurityLevel.NONE ? 'none' : 'ready');
        }
      })
      .catch(() => {
        if (alive) setGateLevel('unknown');
      });
    return () => {
      alive = false;
    };
  }, []);

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }, []);

  const repair = useCallback(() => {
    router.push({ pathname: '/setup', params: { back: '1' } });
  }, []);

  const unpair = useCallback(async () => {
    const ok = await confirmAction({
      title: 'Unpair this device?',
      message:
        'You will need a fresh pairing code from your PC to see sessions again. Nothing on the PC is deleted.',
      confirmLabel: 'Unpair',
      destructive: true,
    });
    if (!ok) return;
    try {
      await disconnect();
      router.replace('/setup');
    } catch {
      setSaveError('This device could not be unpaired.');
    }
  }, [disconnect]);

  const totalHistory = history.recent + history.pinned;

  const clearHistory = useCallback(async () => {
    const ok = await confirmAction({
      title: 'Clear local history?',
      message:
        'Pins and recent sessions on this phone will be removed. Your sessions on the PC are untouched.',
      confirmLabel: 'Clear',
      destructive: true,
    });
    if (!ok) return;
    try {
      await Promise.all([clearRecentSessions(), clearPinnedSessions()]);
      await loadHistory();
    } catch {
      setSaveError('The local history could not be cleared.');
    }
  }, [loadHistory]);

  const openLink = useCallback((url: string) => {
    void Linking.openURL(url).catch(() => {});
  }, []);

  const version = `${installedVersion()} (${installedVersionCode()})`;
  const native = Platform.OS !== 'web';
  const alertsBlocked =
    native && preferences.notifications && notificationPermission.permission === 'denied';

  return (
    <ThemedView style={styles.screen}>
      <View style={{ paddingTop: insets.top }}>
        <View style={styles.navBar}>
          <PressableScale
            onPress={goBack}
            hitSlop={12}
            accessibilityLabel="Back to sessions"
            style={styles.navButton}>
            <Glyph name="chevron-back" size={26} color={theme.accent} />
          </PressableScale>
          <ThemedText type="headline" accessibilityRole="header" style={styles.navTitle}>
            Settings
          </ThemedText>
          <View style={styles.navButton} />
        </View>
        <View style={[styles.seam, { backgroundColor: theme.hairline }]} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}>
        {saveError ? (
          <View style={[styles.errorBanner, { backgroundColor: theme.dangerSoft }]}>
            <Glyph name="warning-outline" size={16} color={theme.negative} />
            <ThemedText type="caption" style={[styles.errorText, { color: theme.negative }]}>
              {saveError}
            </ThemedText>
          </View>
        ) : null}

        <Section title="Appearance">
          <AppearanceRow
            value={preferences.appearance}
            onChange={(appearance) => void save({ appearance })}
          />
        </Section>

        <Section title="Security">
          <SwitchRow
            label="Require unlock"
            hint={
              native
                ? 'Ask for biometrics or your screen lock when the app opens.'
                : 'Available in the Android app.'
            }
            value={preferences.requireUnlock}
            disabled={!native}
            onValueChange={(requireUnlock) => void save({ requireUnlock })}
          />
          {native && preferences.requireUnlock && gateLevel === 'none' ? (
            <View style={[styles.note, { borderBottomColor: theme.hairline }]}>
              <Glyph name="warning-outline" size={15} color={theme.caution} />
              <ThemedText type="caption" style={[styles.noteText, { color: theme.caution }]}>
                No screen lock is set up on this device, so the gate has nothing to ask for.
              </ThemedText>
            </View>
          ) : null}
        </Section>

        <Section title="Alerts">
          <SwitchRow
            label="Session alerts"
            hint={
              native
                ? 'Notify when a prompt finishes or the agent needs an answer.'
                : 'Available in the Android app.'
            }
            value={preferences.notifications}
            disabled={!native}
            onValueChange={(notifications) => {
              void save({ notifications });
              if (notifications) void notificationPermission.request();
            }}
          />
          {alertsBlocked ? (
            <NavRow
              label="Open notification settings"
              hint="Android is blocking alerts for this app."
              onPress={() => void Linking.openSettings().catch(() => {})}
            />
          ) : null}
        </Section>

        <Section title="Connection">
          <InfoRow label="Paired with" value={displayHost(connection?.baseUrl)} />
          <NavRow
            label="Re-pair this device"
            hint="Scan a fresh QR code from your PC."
            onPress={repair}
          />
          <NavRow label="Unpair this device" destructive onPress={() => void unpair()} />
        </Section>

        <Section title="Updates">
          <NavRow label="App version" value={version} onPress={() => router.push('/update')} />
          <SwitchRow
            label="Check on launch"
            hint="Look for a newer build whenever the launcher opens."
            value={preferences.autoCheckUpdates}
            onValueChange={(autoCheckUpdates) => void save({ autoCheckUpdates })}
          />
        </Section>

        <Section title="Local data">
          <NavRow
            label="Clear pinned and recent sessions"
            hint={
              totalHistory === 0
                ? 'Nothing saved on this phone.'
                : `${history.recent} recent · ${history.pinned} pinned`
            }
            onPress={() => void clearHistory()}
            destructive={totalHistory > 0}
            disabled={totalHistory === 0}
          />
        </Section>

        <Section title="About">
          <NavRow label="Source code" value="GitHub" onPress={() => openLink(REPO_URL)} />
          <NavRow label="License" value="MIT" onPress={() => openLink(LICENSE_URL)} />
        </Section>

        <View style={styles.footer}>
          <ThemedText type="caption" themeColor="inkFaint">
            Remote for OpenCode · MIT
          </ThemedText>
        </View>
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  navBar: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
  },
  navButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navTitle: { flex: 1, textAlign: 'center' },
  seam: { height: StyleSheet.hairlineWidth },
  content: {
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
    paddingHorizontal: 16,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: Radius.control,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 16,
  },
  errorText: { flex: 1 },
  section: { paddingTop: 24 },
  sectionTitle: { paddingBottom: 8, letterSpacing: 0.3 },
  row: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 4,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowBody: { flex: 1, gap: 2 },
  rowHint: { paddingRight: 4 },
  rowValue: { maxWidth: 160 },
  infoValue: { flex: 1, textAlign: 'right' },
  columnRow: {
    paddingHorizontal: 4,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  themeHint: { marginTop: 2 },
  segmented: {
    flexDirection: 'row',
    height: 44,
    borderRadius: Radius.control,
    padding: 4,
    gap: 2,
    marginTop: 12,
  },
  segment: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    height: 36,
    borderRadius: 6,
  },
  track: {
    width: 44,
    height: 26,
    borderRadius: 13,
  },
  knob: {
    position: 'absolute',
    top: 3,
    width: 20,
    height: 20,
    borderRadius: 10,
  },
  note: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    paddingHorizontal: 4,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  noteText: { flex: 1 },
  disabled: { opacity: 0.45 },
  footer: { alignItems: 'center', paddingTop: 32 },
});
