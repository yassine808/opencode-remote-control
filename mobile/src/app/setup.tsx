/**
 * Pairing, drawn as their PairingPhaseView draws it: one centered column,
 * airy 14pt rhythm, one prominent action at a time, and a phase for every
 * honest state (looking, pairing, paired, failed).
 *
 * The mechanics stay ours — the PC prints a QR code (or a link), the phone
 * reads it — so the middle of the screen is a camera here where theirs is
 * a spinner.
 */

import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Clipboard from 'expo-clipboard';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { router, useLocalSearchParams } from 'expo-router';
import { type ReactNode, type RefObject, useCallback, useEffect, useRef, useState } from 'react';
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
import * as jpeg from 'jpeg-js';
import jsQR from 'jsqr';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Button, Glyph, PressableScale, useReduceMotion } from '@/components/ui';
import { Fonts, Radius } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { HttpError, UnreachableError, exchangePairingCode } from '@/lib/api';
import { b64decode } from '@/lib/b64';
import { useConnection } from '@/lib/connection';

const PAIR_COMMAND = 'opencode pair --remote --yes';
const NATIVE = Platform.OS !== 'web';
/** `https://host/…/auth/connect/<code>` — the shape the PC prints next to the QR. */
const PAIRING_LINK_RE =
  /^(https?:\/\/[^/\s]+)(?:(?:\/|[^\S\n\r\u2028\u2029])[^\n\r\u2028\u2029]*)?\/auth\/connect\/([^/?#\s]+)/;

type Phase = 'idle' | 'connecting' | 'paired' | 'failed';

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
        let urls: string[] = [];
        if (obj.urls && obj.urls.length > 0) urls = obj.urls;
        else if (obj.url) urls = [obj.url];
        return { code: obj.code, urls };
      }
    } catch {
      // fall through to link parsing
    }
  }

  const match = PAIRING_LINK_RE.exec(text);
  if (match) return { code: match[2], urls: [match[1]] };

  return null;
}

/** Prefer the server's own rejection message — e.g. "Pairing link expired or already used". */
function pairingFailureReason(err: HttpError): string {
  const message = (err.body as { message?: unknown } | undefined)?.message;
  if (err.status === 401 && typeof message === 'string' && message) return message;
  return `HTTP ${err.status === 0 ? 'error' : err.status}`;
}

/** Corner brackets + a sweeping line over the camera feed. */
function ScanFrame() {
  const reduce = useReduceMotion();
  const [h, setH] = useState(0);
  const [v] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (reduce || h === 0) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(v, {
          toValue: 1,
          duration: 1800,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: NATIVE,
        }),
        Animated.timing(v, {
          toValue: 0,
          duration: 1800,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: NATIVE,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [reduce, h, v]);

  const c = '#FFFFFF';
  return (
    <View
      pointerEvents="none"
      style={styles.frameWrap}
      onLayout={(e) => setH(e.nativeEvent.layout.height)}>
      <View style={styles.frame}>
        <View style={[styles.corner, styles.tl, { borderColor: c }]} />
        <View style={[styles.corner, styles.tr, { borderColor: c }]} />
        <View style={[styles.corner, styles.bl, { borderColor: c }]} />
        <View style={[styles.corner, styles.br, { borderColor: c }]} />
        {!reduce && h > 0 ? (
          <Animated.View
            style={[
              styles.scanLine,
              {
                transform: [
                  {
                    translateY: v.interpolate({
                      inputRange: [0, 1],
                      outputRange: [8, Math.max(h * 0.62 - 12, 40)],
                    }),
                  },
                ],
              },
            ]}
          />
        ) : null}
      </View>
    </View>
  );
}

/** The pairing command — selectable, so a long-press copies it on any platform. */
function PairCommand() {
  const theme = useTheme();
  return (
    <ThemedText type="code" selectable style={[styles.command, { color: theme.inkMuted }]}>
      {PAIR_COMMAND}
    </ThemedText>
  );
}

/** The camera viewport — live preview once permitted, a request card otherwise. */
function ScanContent({
  granted,
  cameraRef,
  onScan,
  onRequestPermission,
}: Readonly<{
  granted: boolean;
  cameraRef: RefObject<CameraView | null>;
  onScan: (data: string) => void;
  onRequestPermission: () => void;
}>) {
  const theme = useTheme();
  const quiet = { color: theme.inkMuted } as const;
  return (
    <View style={[styles.viewport, { backgroundColor: theme.inkWell, borderColor: theme.hairline }]}>
      {granted ? (
        <>
          <CameraView
            ref={cameraRef}
            style={StyleSheet.absoluteFill}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={({ data }) => onScan(data)}
          />
          <ScanFrame />
        </>
      ) : (
        <View style={styles.permission}>
          <Glyph set="mci" name="camera-off" size={44} color={theme.inkFaint} />
          <ThemedText type="callout" style={[quiet, styles.centerText]}>
            Camera access is needed to read the pairing QR code. It is only ever used for that.
          </ThemedText>
          <Button variant="accent" onPress={onRequestPermission}>
            Allow camera
          </Button>
        </View>
      )}
    </View>
  );
}

/** The manual-entry block — paste field, actions, and the way back to scanning. */
function ManualContent({
  value,
  focused,
  onChangeText,
  onFocus,
  onBlur,
  onPaste,
  onConnect,
  onSwitchToScan,
}: Readonly<{
  value: string;
  focused: boolean;
  onChangeText: (text: string) => void;
  onFocus: () => void;
  onBlur: () => void;
  onPaste: () => void;
  onConnect: () => void;
  onSwitchToScan: () => void;
}>) {
  const theme = useTheme();
  return (
    <>
      <TextInput
        style={[
          styles.input,
          {
            backgroundColor: theme.inkWell,
            borderColor: focused ? theme.accent : 'transparent',
            color: theme.ink,
          },
        ]}
        onFocus={onFocus}
        onBlur={onBlur}
        multiline
        autoCapitalize="none"
        autoCorrect={false}
        accessibilityLabel="Pairing link"
        placeholder="https://…/auth/connect/…"
        placeholderTextColor={theme.inkFaint}
        value={value}
        onChangeText={onChangeText}
      />

      <View style={styles.buttonRow}>
        <Button variant="secondary" onPress={onPaste} style={styles.flex}>
          Paste
        </Button>
        <Button variant="accent" onPress={onConnect} disabled={!value.trim()} style={styles.flexWide}>
          Connect
        </Button>
      </View>

      {NATIVE ? (
        <PressableScale onPress={onSwitchToScan} hitSlop={8}>
          <ThemedText type="callout" style={{ color: theme.accent }}>
            Scan a QR code instead
          </ThemedText>
        </PressableScale>
      ) : null}
    </>
  );
}

// ---------- screen ----------

export default function SetupScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { connect } = useConnection();
  /** Opened from home (rather than the first-run redirect)? Then offer a way out. */
  const { back } = useLocalSearchParams<{ back?: string }>();
  const dismissable = back === '1';
  const [permission, requestPermission] = useCameraPermissions();
  const [mode, setMode] = useState<'scan' | 'manual'>(NATIVE ? 'scan' : 'manual');
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [manualText, setManualText] = useState('');
  const [inputFocused, setInputFocused] = useState(false);
  const scannedRef = useRef(false);
  const navTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cameraRef = useRef<CameraView>(null);
  const deepBusy = useRef(false);

  useEffect(
    () => () => {
      if (navTimer.current) clearTimeout(navTimer.current);
    },
    [],
  );

  const pair = useCallback(
    async (parsed: ParsedPairing) => {
      const candidates = [...parsed.urls].sort(
        (a, b) => Number(b.startsWith('https://')) - Number(a.startsWith('https://')),
      );
      if (candidates.length === 0) {
        setPhase('failed');
        setError('No server URL in that code. On the PC run `opencode pair --remote --yes` and scan its QR.');
        return;
      }
      setPhase('connecting');
      setError(null);
      const failures: string[] = [];
      for (const baseUrl of candidates) {
        try {
          const token = await exchangePairingCode(baseUrl, parsed.code);
          await connect(baseUrl, token);
          setPhase('paired');
          navTimer.current = setTimeout(() => {
            if (router.canGoBack()) router.back();
            else router.replace('/');
          }, 900);
          return;
        } catch (err) {
          let reason: string;
          if (err instanceof UnreachableError) {
            reason = 'unreachable';
          } else if (err instanceof HttpError) {
            reason = pairingFailureReason(err);
          } else {
            reason = 'failed';
          }
          failures.push(`${baseUrl.replace(/^https?:\/\//, '')} (${reason})`);
        }
      }
      setPhase('failed');
      setError(`Pairing failed: ${failures.join(' · ')}. Codes expire after 5 minutes — mint a fresh one.`);
      // Allow another scan, after a pause so the same stale QR isn't retried in a tight loop.
      setTimeout(() => {
        scannedRef.current = false;
      }, 2000);
    },
    [connect],
  );

  const handleScan = useCallback(
    (data: string) => {
      if (scannedRef.current) return;
      const parsed = parsePairingInput(data);
      if (!parsed) return; // a stray QR — keep looking rather than interrupting
      scannedRef.current = true;
      void pair(parsed);
    },
    [pair],
  );

  const handleManual = useCallback(() => {
    const parsed = parsePairingInput(manualText);
    if (!parsed) {
      setPhase('failed');
      setError('That does not look like a pairing link. Paste the link (or the JSON contents of the QR).');
      return;
    }
    void pair(parsed);
  }, [manualText, pair]);

  const pasteFromClipboard = useCallback(async () => {
    const text = await Clipboard.getStringAsync();
    if (text) {
      setManualText(text.trim());
      if (phase === 'failed') setPhase('idle');
      setError(null);
    }
  }, [phase]);

  const tryAgain = useCallback(() => {
    setPhase('idle');
    setError(null);
    scannedRef.current = false;
  }, []);

  const changeMode = (next: 'scan' | 'manual') => {
    setMode(next);
    setPhase('idle');
    setError(null);
    scannedRef.current = false;
  };

  // The native scanner (MLKit) cannot read inverted QR codes, and the QR the PC
  // prints comes out inverted whenever the terminal is light-themed — so while
  // scanning we also grab stills and decode them in JS, where both polarities
  // work. Photos are downscaled first, since a full-res JPEG is far too big to
  // decode in JS on a phone.
  useEffect(() => {
    if (!NATIVE || mode !== 'scan' || phase !== 'idle' || !permission?.granted) return;
    let cancelled = false;
    const timer = setInterval(() => {
      void (async () => {
        if (cancelled || deepBusy.current || scannedRef.current) return;
        deepBusy.current = true;
        try {
          const shot = await cameraRef.current?.takePictureAsync({
            skipProcessing: true,
            shutterSound: false,
          });
          if (!shot?.uri || cancelled || scannedRef.current) return;
          const small = await manipulateAsync(shot.uri, [{ resize: { width: 800 } }], {
            base64: true,
            compress: 0.6,
            format: SaveFormat.JPEG,
          });
          if (!small.base64 || cancelled || scannedRef.current) return;
          const decoded = jpeg.decode(b64decode(small.base64), { useTArray: true });
          if (cancelled || scannedRef.current) return;
          const found = jsQR(
            decoded.data as unknown as Uint8ClampedArray,
            decoded.width,
            decoded.height,
            { inversionAttempts: 'attemptBoth' },
          );
          if (found?.data) handleScan(found.data);
        } catch {
          // Camera or decoder hiccup — simply try again on the next tick.
        } finally {
          deepBusy.current = false;
        }
      })();
    }, 1800);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [mode, phase, permission?.granted, handleScan]);

  const quiet = { color: theme.inkMuted } as const;

  let content: ReactNode;
  if (phase === 'connecting') {
    content = (
      <>
        <ActivityIndicator size="small" color={theme.inkMuted} />
        <ThemedText type="callout" style={quiet}>
          Pairing with your PC…
        </ThemedText>
      </>
    );
  } else if (phase === 'paired') {
    content = (
      <>
        <Glyph set="mci" name="check-decagram" size={44} color={theme.positive} />
        <ThemedText type="headline" style={styles.centerText}>
          Paired with your PC
        </ThemedText>
      </>
    );
  } else if (phase === 'failed') {
    content = (
      <>
        <Glyph name="warning-outline" size={44} color={theme.caution} />
        <ThemedText type="callout" style={[quiet, styles.centerText]}>
          {error}
        </ThemedText>
        <Button variant="accent" onPress={tryAgain}>
          Try Again
        </Button>
      </>
    );
  } else if (mode === 'scan') {
    content = (
      <>
        <ActivityIndicator size="small" color={theme.inkMuted} />
        <ThemedText type="headline" style={styles.centerText}>
          Looking for your PC…
        </ThemedText>
        <ThemedText type="callout" style={[quiet, styles.centerText]}>
          Run this on your PC, then point the camera at the QR code it prints. Codes expire after 5
          minutes.
        </ThemedText>
        <PairCommand />

        <ScanContent
          granted={permission?.granted === true}
          cameraRef={cameraRef}
          onScan={handleScan}
          onRequestPermission={() => void requestPermission()}
        />

        <PressableScale onPress={() => changeMode('manual')} hitSlop={8}>
          <ThemedText type="callout" style={{ color: theme.accent }}>
            Enter the link manually instead
          </ThemedText>
        </PressableScale>
      </>
    );
  } else {
    content = (
      <>
        <ThemedText type="headline" style={styles.centerText}>
          Paste the pairing link
        </ThemedText>
        <ThemedText type="callout" style={[quiet, styles.centerText]}>
          It is printed next to the QR code on your PC. Codes expire after 5 minutes.
        </ThemedText>
        <PairCommand />

        <ManualContent
          value={manualText}
          focused={inputFocused}
          onChangeText={(t) => {
            setManualText(t);
            if (error) setError(null);
          }}
          onFocus={() => setInputFocused(true)}
          onBlur={() => setInputFocused(false)}
          onPaste={() => void pasteFromClipboard()}
          onConnect={handleManual}
          onSwitchToScan={() => changeMode('scan')}
        />
      </>
    );
  }

  return (
    <ThemedView style={styles.screen}>
      {dismissable ? (
        <PressableScale
          onPress={() => router.back()}
          hitSlop={8}
          scaleTo={0.9}
          style={[styles.close, { top: insets.top + 4 }]}
          accessibilityLabel="Close pairing">
          <Glyph name="close" size={24} color={theme.inkMuted} />
        </PressableScale>
      ) : null}
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={[
            styles.content,
            {
              paddingTop: insets.top + 16,
              paddingBottom: insets.bottom + 16,
            },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          <View style={styles.column}>{content}</View>
        </ScrollView>
      </KeyboardAvoidingView>
    </ThemedView>
  );
}

const FRAME = 28;

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
  flex: { flex: 1 },
  flexWide: { flex: 1.6 },
  content: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 16 },
  column: {
    width: '100%',
    maxWidth: 420,
    alignSelf: 'center',
    alignItems: 'center',
    gap: 14,
  },
  centerText: { textAlign: 'center' },
  command: { textAlign: 'center' },
  commandRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  viewport: {
    width: '100%',
    height: 300,
    borderRadius: Radius.block,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  permission: { gap: 14, padding: 24, alignItems: 'center' },
  input: {
    width: '100%',
    minHeight: 96,
    borderRadius: Radius.block,
    borderWidth: 1,
    padding: 14,
    fontFamily: Fonts.regular,
    fontSize: 17,
    lineHeight: 22,
    textAlignVertical: 'top',
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null),
  },
  buttonRow: { flexDirection: 'row', gap: 12, width: '100%' },
  frameWrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  frame: { width: '62%', aspectRatio: 1 },
  corner: { position: 'absolute', width: FRAME, height: FRAME, borderRadius: 6 },
  tl: { top: 0, left: 0, borderTopWidth: 3, borderLeftWidth: 3 },
  tr: { top: 0, right: 0, borderTopWidth: 3, borderRightWidth: 3 },
  bl: { bottom: 0, left: 0, borderBottomWidth: 3, borderLeftWidth: 3 },
  br: { bottom: 0, right: 0, borderBottomWidth: 3, borderRightWidth: 3 },
  scanLine: {
    position: 'absolute',
    left: 6,
    right: 6,
    height: 2,
    borderRadius: 1,
    backgroundColor: '#FFFFFF',
    opacity: 0.85,
  },
});
