/**
 * Updates: the sideloaded APK's own lifecycle. Ask GitHub Releases for a
 * build newer than the installed versionCode, download the .apk, and hand it
 * to the Android package installer. Browsers skip the installer and download
 * the file instead.
 */

import { router } from 'expo-router';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Button, Glyph, PressableScale } from '@/components/ui';
import { useTheme } from '@/hooks/use-theme';
import {
  checkForUpdate,
  downloadUpdate,
  installUpdate,
  installedVersion,
  installedVersionCode,
  type UpdateInfo,
} from '@/lib/updater';

type Phase = 'checking' | 'uptodate' | 'available' | 'downloading' | 'ready' | 'error';

const ANDROID = Platform.OS === 'android';

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return 'an unknown size';
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

// ---------- phase views ----------

function CheckingView() {
  const theme = useTheme();
  return (
    <>
      <ActivityIndicator size="small" color={theme.inkMuted} />
      <ThemedText type="callout" style={{ color: theme.inkMuted }}>
        Checking GitHub for a newer build…
      </ThemedText>
    </>
  );
}

function UpToDateView({ onRecheck }: Readonly<{ onRecheck: () => void }>) {
  const theme = useTheme();
  const quiet = { color: theme.inkMuted } as const;
  return (
    <>
      <Glyph set="mci" name="check-decagram" size={44} color={theme.positive} />
      <ThemedText type="headline" style={styles.centerText}>
        You are on the latest build
      </ThemedText>
      <ThemedText type="callout" style={[quiet, styles.centerText]}>
        {`OpenCode Remote ${installedVersion()} (${installedVersionCode()})`}
      </ThemedText>
      <Button variant="secondary" onPress={onRecheck}>
        Check Again
      </Button>
    </>
  );
}

function AvailableView({
  info,
  onDownload,
  onOpenBrowser,
  onRecheck,
}: Readonly<{
  info: UpdateInfo;
  onDownload: () => void;
  onOpenBrowser: () => void;
  onRecheck: () => void;
}>) {
  const theme = useTheme();
  const quiet = { color: theme.inkMuted } as const;
  return (
    <>
      <Glyph set="mci" name="cellphone-arrow-down" size={44} color={theme.accent} />
      <ThemedText type="headline" style={styles.centerText}>
        {`Version ${info.version} is available`}
      </ThemedText>
      <ThemedText type="callout" style={[quiet, styles.centerText]}>
        {installedVersionCode() > 0
          ? `You have ${installedVersion()} (${installedVersionCode()}). The download is ${formatBytes(info.sizeBytes)}.`
          : `Download the latest Android build (${formatBytes(info.sizeBytes)}).`}
      </ThemedText>
      {info.notes ? (
        <ThemedText type="caption" numberOfLines={6} style={[quiet, styles.centerText]}>
          {info.notes}
        </ThemedText>
      ) : null}
      <Button variant="accent" onPress={ANDROID ? onDownload : onOpenBrowser}>
        {ANDROID ? 'Download Update' : 'Download APK'}
      </Button>
      {!ANDROID ? (
        <ThemedText type="caption" style={[quiet, styles.centerText]}>
          The browser has no installer — open the downloaded APK on your Android device.
        </ThemedText>
      ) : null}
      <Button variant="secondary" onPress={onRecheck}>
        Check Again
      </Button>
    </>
  );
}

function DownloadingView({ progress }: Readonly<{ progress: number }>) {
  const theme = useTheme();
  return (
    <>
      <ActivityIndicator size="small" color={theme.inkMuted} />
      <ThemedText type="callout" style={{ color: theme.inkMuted }}>
        {`Downloading… ${Math.round(progress * 100)}%`}
      </ThemedText>
    </>
  );
}

function ReadyView({
  message,
  onInstall,
}: Readonly<{ message: string | null; onInstall: () => void }>) {
  const theme = useTheme();
  const quiet = { color: theme.inkMuted } as const;
  return (
    <>
      <Glyph set="mci" name="package-down" size={44} color={theme.positive} />
      <ThemedText type="headline" style={styles.centerText}>
        Downloaded
      </ThemedText>
      <ThemedText type="callout" style={[quiet, styles.centerText]}>
        Android will ask you to confirm the install. If it refuses, allow “Install unknown
        apps” for OpenCode Remote.
      </ThemedText>
      <Button variant="accent" onPress={onInstall}>
        Install Update
      </Button>
      {message ? (
        <ThemedText type="callout" style={[styles.centerText, { color: theme.caution }]}>
          {message}
        </ThemedText>
      ) : null}
    </>
  );
}

function ErrorView({
  message,
  onRetry,
}: Readonly<{ message: string | null; onRetry: () => void }>) {
  const theme = useTheme();
  const quiet = { color: theme.inkMuted } as const;
  return (
    <>
      <Glyph name="warning-outline" size={44} color={theme.caution} />
      <ThemedText type="callout" style={[quiet, styles.centerText]}>
        {message ?? 'The update check failed.'}
      </ThemedText>
      <Button variant="accent" onPress={onRetry}>
        Try Again
      </Button>
    </>
  );
}

export default function UpdateScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [phase, setPhase] = useState<Phase>('checking');
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [apkUri, setApkUri] = useState<string | null>(null);
  const aliveRef = useRef(true);

  /** Apply a check result: null means the installed build is current. */
  const applyCheck = useCallback((found: UpdateInfo | null) => {
    setInfo(found);
    setPhase(found ? 'available' : 'uptodate');
  }, []);

  const failCheck = useCallback((err: unknown) => {
    setMessage(err instanceof Error ? err.message : String(err));
    setPhase('error');
  }, []);

  const runCheck = useCallback(async () => {
    try {
      const found = await checkForUpdate();
      if (aliveRef.current) applyCheck(found);
    } catch (err) {
      if (aliveRef.current) failCheck(err);
    }
  }, [applyCheck, failCheck]);

  const recheck = useCallback(() => {
    setPhase('checking');
    setMessage(null);
    setApkUri(null);
    setProgress(0);
    void runCheck();
  }, [runCheck]);

  // Kick the first check off after the "checking" state has committed.
  useEffect(() => {
    aliveRef.current = true;
    checkForUpdate()
      .then((found) => {
        if (aliveRef.current) applyCheck(found);
      })
      .catch((err) => {
        if (aliveRef.current) failCheck(err);
      });
    return () => {
      aliveRef.current = false;
    };
  }, [applyCheck, failCheck]);

  const startDownload = useCallback(async () => {
    if (!info) return;
    setPhase('downloading');
    setProgress(0);
    setMessage(null);
    try {
      const uri = await downloadUpdate(info, (fraction) => {
        if (aliveRef.current) setProgress(fraction);
      });
      if (!aliveRef.current) return;
      setApkUri(uri);
      setPhase('ready');
    } catch (err) {
      if (!aliveRef.current) return;
      setMessage(err instanceof Error ? err.message : String(err));
      setPhase('error');
    }
  }, [info]);

  const openInBrowser = useCallback(() => {
    if (info) void Linking.openURL(info.apkUrl);
  }, [info]);

  const startInstall = useCallback(async () => {
    if (!apkUri) return;
    setMessage(null);
    try {
      await installUpdate(apkUri);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    }
  }, [apkUri]);

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }, []);

  let content: ReactNode;
  if (phase === 'checking') {
    content = <CheckingView />;
  } else if (phase === 'uptodate') {
    content = <UpToDateView onRecheck={recheck} />;
  } else if (phase === 'available' && info) {
    content = (
      <AvailableView
        info={info}
        onDownload={() => void startDownload()}
        onOpenBrowser={openInBrowser}
        onRecheck={recheck}
      />
    );
  } else if (phase === 'downloading') {
    content = <DownloadingView progress={progress} />;
  } else if (phase === 'ready') {
    content = <ReadyView message={message} onInstall={() => void startInstall()} />;
  } else {
    content = <ErrorView message={message} onRetry={recheck} />;
  }

  return (
    <ThemedView style={styles.screen}>
      <PressableScale
        onPress={goBack}
        hitSlop={8}
        scaleTo={0.9}
        style={[styles.close, { top: insets.top + 4 }]}
        accessibilityLabel="Close">
        <Glyph name="close" size={24} color={theme.inkMuted} />
      </PressableScale>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 16 },
        ]}
        showsVerticalScrollIndicator={false}>
        <View style={styles.column}>{content}</View>
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  close: {
    position: 'absolute',
    left: 12,
    zIndex: 2,
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 16 },
  column: {
    width: '100%',
    maxWidth: 420,
    alignSelf: 'center',
    alignItems: 'center',
    gap: 14,
  },
  centerText: { textAlign: 'center' },
});
