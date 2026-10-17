import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Banner, Button, Entrance, PressableScale, useReduceMotion } from '@/components/ui';
import { MaxContentWidth, Radius, Spacing, Touch } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { HttpError, UnreachableError, exchangePairingCode } from '@/lib/api';
import { useConnection } from '@/lib/connection';

const PAIR_COMMAND = 'opencode pair --remote --yes';
const NATIVE = Platform.OS !== 'web';

interface ParsedPairing {
  code: string;
  urls: string[];
}

/**
 * Accepts the JSON payload from the pairing QR, a full
 * `https://host/auth/connect/<code>` link, or similar variants.
 */
function parsePairingInput(raw: string): ParsedPairing | null {
  const text = raw.trim();
  if (!text) return null;

  if (text.startsWith('{')) {
    try {
      const obj = JSON.parse(text) as { code?: string; urls?: string[]; url?: string };
      if (obj.code) {
        const urls = obj.urls && obj.urls.length > 0 ? obj.urls : obj.url ? [obj.url] : [];
        return { code: obj.code, urls };
      }
    } catch {
      // fall through to link parsing
    }
  }

  const match = text.match(/^(https?:\/\/[^/\s]+).*\/auth\/connect\/([^/?#\s]+)/);
  if (match) return { code: match[2], urls: [match[1]] };

  return null;
}

// ---------- pieces ----------

function StepHeading({ n, title, done }: { n: number; title: string; done?: boolean }) {
  const theme = useTheme();
  return (
    <View style={styles.stepHead}>
      <View style={[styles.stepNum, { backgroundColor: done ? theme.success : theme.accentSoft }]}>
        <ThemedText type="caption" style={{ color: done ? theme.onAccent : theme.accent, fontWeight: '700' }}>
          {n}
        </ThemedText>
      </View>
      <ThemedText type="smallBold">{title}</ThemedText>
    </View>
  );
}

function CommandChip() {
  const theme = useTheme();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  const copy = async () => {
    await Clipboard.setStringAsync(PAIR_COMMAND);
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1500);
  };
  return (
    <View style={[styles.command, { backgroundColor: theme.code, borderColor: theme.border }]}>
      <ThemedText type="code" selectable style={styles.commandText} numberOfLines={1}>
        {PAIR_COMMAND}
      </ThemedText>
      <PressableScale
        onPress={() => void copy()}
        hitSlop={8}
        scaleTo={0.92}
        accessibilityLabel="Copy command"
        style={[styles.copy, { backgroundColor: copied ? theme.successSoft : theme.backgroundSelected }]}>
        <ThemedText type="caption" themeColor={copied ? 'success' : 'text'} style={{ fontWeight: '600' }}>
          {copied ? 'Copied' : 'Copy'}
        </ThemedText>
      </PressableScale>
    </View>
  );
}

function Segmented({
  value,
  onChange,
}: {
  value: 'scan' | 'manual';
  onChange: (v: 'scan' | 'manual') => void;
}) {
  const theme = useTheme();
  const options: { key: 'scan' | 'manual'; label: string }[] = [
    { key: 'scan', label: 'Scan QR' },
    { key: 'manual', label: 'Paste link' },
  ];
  return (
    <View style={[styles.segment, { backgroundColor: theme.backgroundSelected }]} accessibilityRole="tablist">
      {options.map((o) => {
        const on = o.key === value;
        return (
          <PressableScale
            key={o.key}
            onPress={() => onChange(o.key)}
            scaleTo={0.97}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            containerStyle={styles.flex}
            style={[styles.segmentItem, on && { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
            <ThemedText type="smallBold" themeColor={on ? 'text' : 'textSecondary'}>
              {o.label}
            </ThemedText>
          </PressableScale>
        );
      })}
    </View>
  );
}

/** Corner brackets + a sweeping line over the camera feed. */
function ScanFrame({ busy }: { busy: boolean }) {
  const reduce = useReduceMotion();
  const [h, setH] = useState(0);
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduce || busy || h === 0) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(v, { toValue: 1, duration: 1800, easing: Easing.inOut(Easing.quad), useNativeDriver: NATIVE }),
        Animated.timing(v, { toValue: 0, duration: 1800, easing: Easing.inOut(Easing.quad), useNativeDriver: NATIVE }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [reduce, busy, h, v]);
  const c = '#FFFFFF';
  return (
    <View pointerEvents="none" style={styles.frameWrap} onLayout={(e) => setH(e.nativeEvent.layout.height)}>
      <View style={styles.frame}>
        <View style={[styles.corner, styles.tl, { borderColor: c }]} />
        <View style={[styles.corner, styles.tr, { borderColor: c }]} />
        <View style={[styles.corner, styles.bl, { borderColor: c }]} />
        <View style={[styles.corner, styles.br, { borderColor: c }]} />
        {!busy && !reduce && h > 0 && (
          <Animated.View
            style={[
              styles.scanLine,
              { transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [8, Math.max(h * 0.62 - 12, 40)] }) }] },
            ]}
          />
        )}
      </View>
    </View>
  );
}

// ---------- screen ----------

export default function SetupScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { connect } = useConnection();
  const isWeb = Platform.OS === 'web';
  const [permission, requestPermission] = useCameraPermissions();
  const [mode, setMode] = useState<'scan' | 'manual'>(isWeb ? 'manual' : 'scan');
  const [manualText, setManualText] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [inputFocused, setInputFocused] = useState(false);
  const scannedRef = useRef(false);

  const pair = useCallback(
    async (parsed: ParsedPairing) => {
      if (busy) return;
      const candidates = [...parsed.urls].sort(
        (a, b) => Number(b.startsWith('https://')) - Number(a.startsWith('https://')),
      );
      if (candidates.length === 0) {
        setError('No server URL in that code. On the PC run `opencode pair --remote --yes` and scan its QR.');
        scannedRef.current = false;
        return;
      }
      setBusy('Connecting…');
      setError(null);
      const failures: string[] = [];
      for (const baseUrl of candidates) {
        try {
          const token = await exchangePairingCode(baseUrl, parsed.code);
          await connect(baseUrl, token);
          if (router.canGoBack()) router.back();
          else router.replace('/');
          return;
        } catch (err) {
          const reason =
            err instanceof UnreachableError
              ? 'unreachable'
              : err instanceof HttpError
                ? `HTTP ${err.status === 0 ? 'error' : err.status}`
                : 'failed';
          failures.push(`${baseUrl.replace(/^https?:\/\//, '')} (${reason})`);
        }
      }
      setError(`Pairing failed: ${failures.join(' · ')}. Codes expire after 5 minutes — mint a fresh one.`);
      setBusy(null);
      // Allow another scan, after a pause so the same stale QR isn't retried in a tight loop.
      setTimeout(() => {
        scannedRef.current = false;
      }, 2000);
    },
    [busy, connect],
  );

  const handleScan = useCallback(
    (data: string) => {
      if (scannedRef.current || busy) return;
      const parsed = parsePairingInput(data);
      if (!parsed) {
        setError('That QR does not look like an OpenCode pairing code.');
        return;
      }
      scannedRef.current = true;
      void pair(parsed);
    },
    [busy, pair],
  );

  const handleManual = useCallback(() => {
    if (busy) return;
    const parsed = parsePairingInput(manualText);
    if (!parsed) {
      setError('Paste the pairing link (or the JSON contents of the QR).');
      return;
    }
    void pair(parsed);
  }, [busy, manualText, pair]);

  const pasteFromClipboard = useCallback(async () => {
    const text = await Clipboard.getStringAsync();
    if (text) {
      setManualText(text.trim());
      setError(null);
    }
  }, []);

  const changeMode = (next: 'scan' | 'manual') => {
    setMode(next);
    setError(null);
    scannedRef.current = false;
  };

  const canClose = router.canGoBack();

  return (
    <ThemedView style={styles.screen}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={[
            styles.content,
            { paddingTop: Math.max(insets.top, Spacing.three) + Spacing.two, paddingBottom: insets.bottom + Spacing.four },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          <View style={styles.column}>
            <View style={styles.topRow}>
              <View style={[styles.grabber, { backgroundColor: theme.border }]} />
              {canClose ? (
                <Button label="Close" variant="ghost" compact onPress={() => router.back()} style={styles.close} />
              ) : null}
            </View>

            <Entrance>
              <ThemedText type="heading" accessibilityRole="header">
                Pair with your PC
              </ThemedText>
              <ThemedText themeColor="textSecondary" style={styles.lede}>
                Control OpenCode sessions from this device. Pairing takes about 20 seconds.
              </ThemedText>
            </Entrance>

            <Entrance delay={120} style={styles.step}>
              <StepHeading n={1} title="Run this on your PC" />
              <CommandChip />
            </Entrance>

            <Entrance delay={220} style={styles.step}>
              <StepHeading n={2} title={mode === 'scan' ? 'Scan the QR it prints' : 'Paste the link it prints'} />

              {!isWeb && <Segmented value={mode} onChange={changeMode} />}

              {mode === 'scan' ? (
                <View style={[styles.viewport, { backgroundColor: theme.code, borderColor: theme.border }]}>
                  {permission?.granted ? (
                    <>
                      <CameraView
                        style={StyleSheet.absoluteFill}
                        facing="back"
                        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                        onBarcodeScanned={busy ? undefined : ({ data }) => handleScan(data)}
                      />
                      <ScanFrame busy={Boolean(busy)} />
                    </>
                  ) : (
                    <View style={styles.permission}>
                      <ThemedText type="smallBold" style={styles.centerText}>
                        Camera access needed
                      </ThemedText>
                      <ThemedText type="small" themeColor="textSecondary" style={styles.centerText}>
                        The camera is only used to read the pairing QR code.
                      </ThemedText>
                      <Button label="Allow camera" variant="primary" onPress={() => void requestPermission()} />
                    </View>
                  )}
                  {busy ? (
                    <View style={[styles.busy, { backgroundColor: theme.scrim }]}>
                      <ActivityIndicator color="#FFFFFF" />
                      <ThemedText type="smallBold" style={styles.white}>
                        {busy}
                      </ThemedText>
                    </View>
                  ) : null}
                </View>
              ) : (
                <View style={styles.manual}>
                  <TextInput
                    style={[
                      styles.input,
                      {
                        backgroundColor: theme.backgroundElement,
                        borderColor: inputFocused ? theme.accent : theme.border,
                        color: theme.text,
                      },
                    ]}
                    onFocus={() => setInputFocused(true)}
                    onBlur={() => setInputFocused(false)}
                    multiline
                    autoCapitalize="none"
                    autoCorrect={false}
                    accessibilityLabel="Pairing link"
                    placeholder="https://…/auth/connect/…  or the JSON from the QR"
                    placeholderTextColor={theme.textTertiary}
                    value={manualText}
                    onChangeText={(t) => {
                      setManualText(t);
                      if (error) setError(null);
                    }}
                  />
                  <View style={styles.row}>
                    <Button label="Paste" onPress={() => void pasteFromClipboard()} style={styles.flex} disabled={Boolean(busy)} />
                    <Button
                      label={busy ? 'Connecting…' : 'Connect'}
                      variant="primary"
                      onPress={handleManual}
                      busy={Boolean(busy)}
                      disabled={!manualText.trim()}
                      style={styles.flexWide}
                    />
                  </View>
                </View>
              )}
            </Entrance>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      {error ? (
        <View style={[styles.errorDock, { bottom: insets.bottom + Spacing.two }]}>
          <Banner tone="danger" actionLabel="Dismiss" onAction={() => setError(null)}>
            {error}
          </Banner>
        </View>
      ) : null}
    </ThemedView>
  );
}

const FRAME = 28;

const styles = StyleSheet.create({
  screen: { flex: 1 },
  flex: { flex: 1 },
  flexWide: { flex: 1.6 },
  content: { flexGrow: 1, paddingHorizontal: Spacing.three },
  column: { width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center', gap: Spacing.four },
  topRow: { alignItems: 'center', justifyContent: 'center', minHeight: Touch - 8 },
  grabber: { width: 36, height: 4, borderRadius: 2 },
  close: { position: 'absolute', right: -Spacing.two, top: -2 },
  lede: { marginTop: Spacing.two, maxWidth: 420 },
  step: { gap: Spacing.three - 4 },
  stepHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two + 2 },
  stepNum: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  command: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderRadius: Radius.medium,
    borderWidth: StyleSheet.hairlineWidth,
    paddingLeft: Spacing.three,
    paddingRight: Spacing.two,
    paddingVertical: Spacing.two,
  },
  commandText: { flex: 1, fontSize: 13.5 },
  copy: { borderRadius: Radius.small + 2, paddingHorizontal: 12, paddingVertical: 8, minWidth: 64, alignItems: 'center' },
  segment: { flexDirection: 'row', padding: 3, borderRadius: Radius.medium },
  segmentItem: {
    minHeight: 38,
    borderRadius: Radius.medium - 3,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'transparent',
  },
  viewport: {
    height: 340,
    borderRadius: Radius.large + 4,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  permission: { gap: Spacing.two + 2, padding: Spacing.four, alignItems: 'center' },
  centerText: { textAlign: 'center' },
  busy: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', gap: Spacing.two },
  white: { color: '#FFFFFF' },
  frameWrap: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  frame: { width: '62%', aspectRatio: 1 },
  corner: { position: 'absolute', width: FRAME, height: FRAME, borderRadius: 6 },
  tl: { top: 0, left: 0, borderTopWidth: 3, borderLeftWidth: 3 },
  tr: { top: 0, right: 0, borderTopWidth: 3, borderRightWidth: 3 },
  bl: { bottom: 0, left: 0, borderBottomWidth: 3, borderLeftWidth: 3 },
  br: { bottom: 0, right: 0, borderBottomWidth: 3, borderRightWidth: 3 },
  scanLine: { position: 'absolute', left: 6, right: 6, height: 2, borderRadius: 1, backgroundColor: '#FFFFFF', opacity: 0.85 },
  manual: { gap: Spacing.three - 4 },
  input: {
    minHeight: 132,
    borderRadius: Radius.medium,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.three,
    fontSize: 15,
    lineHeight: 21,
    textAlignVertical: 'top',
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null),
  },
  row: { flexDirection: 'row', gap: Spacing.two + 2 },
  errorDock: { position: 'absolute', left: 0, right: 0 },
});
