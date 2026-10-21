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
import { HttpError, exchangePairingCode } from '@/lib/api';
import { b64decode } from '@/lib/b64';
import { useConnection } from '@/lib/connection';

const PAIR_COMMAND = 'opencode pair --remote --yes';
const NATIVE = Platform.OS !== 'web';

/**
 * The head of a pairing link — `scheme://host` — in a block of text.
 *
 * The pairing command prints a localhost link *and* the tunnel link on
 * separate lines, so the parser must consider all of them — taking the first
 * would hand the phone `http://127.0.0.1:…`, which it can never reach.
 *
 * Finding the links takes two linear passes (this pattern, then a plain
 * string scan for the `…/auth/connect/<code>` tail) instead of one
 * `[^\s]*?` wildcard: a lazy wildcard that hunts for a suffix retries every
 * prefix, which is quadratic on the QR art the command also prints.
 */
const LINK_HEAD_RE = /https?:\/\/[^\s/?#]+/g;
const CONNECT_PATH = '/auth/connect/';
/** The code alphabet, matched forward from a known offset via `lastIndex`. */
const CODE_RUN_RE = /[A-Za-z0-9_-]+/y;

type Phase = 'idle' | 'connecting' | 'paired' | 'failed';

interface ParsedPairing {
  code: string;
  urls: string[];
}

function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.startsWith('127.') ||
    host === '[::1]' ||
    host === '0.0.0.0'
  );
}

/** Keep only usable http(s) origins; everything else is dropped. */
function cleanUrls(urls: readonly unknown[]): string[] {
  const seen = new Set<string>();
  for (const raw of urls) {
    if (typeof raw !== 'string') continue;
    try {
      const url = new URL(raw.trim());
      if (url.protocol !== 'http:' && url.protocol !== 'https:') continue;
      seen.add(url.origin);
    } catch {
      // Not a URL — skip it.
    }
  }
  return [...seen];
}

/**
 * The first `/auth/connect/<code>` at or after `from`, inside the same
 * unbroken run of non-space characters — plus where that code ends.
 */
function connectLinkAfter(text: string, from: number): { code: string; end: number } | null {
  const space = text.slice(from).search(/\s/);
  const runEnd = space === -1 ? text.length : from + space;
  let at = text.indexOf(CONNECT_PATH, from);
  while (at !== -1 && at < runEnd) {
    CODE_RUN_RE.lastIndex = at + CONNECT_PATH.length;
    const match = CODE_RUN_RE.exec(text);
    if (match) return { code: match[0], end: at + CONNECT_PATH.length + match[0].length };
    at = text.indexOf(CONNECT_PATH, at + 1);
  }
  return null;
}

/** All pairing links embedded in arbitrary text (QR, terminal block, chat message). */
function linksInText(text: string): { code: string; urls: string[] } | null {
  const urls: string[] = [];
  let code = '';
  LINK_HEAD_RE.lastIndex = 0;
  for (let head = LINK_HEAD_RE.exec(text); head; head = LINK_HEAD_RE.exec(text)) {
    const link = connectLinkAfter(text, head.index + head[0].length);
    if (!link) continue;
    if (!code) code = link.code;
    urls.push(head[0]);
    // Resume after this code, so a link nested in another link's tail is not
    // reported twice.
    LINK_HEAD_RE.lastIndex = link.end;
  }
  if (!code) return null;
  return { code, urls: cleanUrls(urls) };
}

/** The URLs a JSON pairing payload carries, else whatever the text links gave us. */
function jsonPairingUrls(
  payload: { urls?: unknown; url?: unknown },
  fallback: readonly string[],
): string[] {
  if (Array.isArray(payload.urls) && payload.urls.length > 0) return cleanUrls(payload.urls);
  if (payload.url) return cleanUrls([payload.url]);
  return cleanUrls(fallback);
}

/** The pairing QR's JSON payload, when the input carries one. */
function jsonPairing(text: string, fallback: readonly string[]): ParsedPairing | null {
  if (!text.startsWith('{') && !text.includes('"urls"')) return null;
  try {
    const payload = JSON.parse(text.slice(text.indexOf('{'))) as {
      code?: unknown;
      urls?: unknown;
      url?: unknown;
    };
    if (typeof payload?.code === 'string' && payload.code) {
      return { code: payload.code, urls: jsonPairingUrls(payload, fallback) };
    }
  } catch {
    // Not JSON — the caller falls back to link parsing.
  }
  return null;
}

/**
 * Accepts the JSON payload from the pairing QR, a full
 * `https://host/auth/connect/<code>` link, or the whole terminal block the
 * command prints (local link + tunnel link + QR art).
 */
function parsePairingInput(raw: string): ParsedPairing | null {
  const text = raw.trim();
  if (!text) return null;

  const fromText = linksInText(text);
  const fromJson = jsonPairing(text, fromText?.urls ?? []);
  if (fromJson) return fromJson;

  if (!fromText) return null;
  return { code: fromText.code, urls: fromText.urls };
}

/**
 * Pairing candidates in the order worth trying: public HTTPS first (works on
 * mobile data), then other public URLs, and loopback last — and only when the
 * input offers nothing else, since a phone cannot reach the PC's 127.0.0.1.
 */
function pairingCandidates(urls: readonly string[]): string[] {
  const parsed = cleanUrls(urls)
    .map((url) => new URL(url))
    .sort((a, b) => {
      const score = (u: URL) => (isLoopbackHost(u.hostname) ? 0 : 2) + (u.protocol === 'https:' ? 1 : 0);
      return score(b) - score(a);
    });
  const reachable = parsed.filter((u) => !isLoopbackHost(u.hostname));
  const list = reachable.length > 0 ? reachable : parsed;
  return list.map((u) => u.origin);
}

/** A failure the user can act on — server text when present, never a bare "failed". */
function pairingFailureReason(err: unknown): string {
  if (err instanceof HttpError) {
    const body = err.body as { message?: unknown } | string | undefined;
    const message = typeof body === 'string' ? body : body?.message;
    if (typeof message === 'string' && message.trim()) return message.trim().slice(0, 140);
    return `HTTP ${err.status === 0 ? 'error' : err.status}`;
  }
  if (err instanceof Error && err.message) return err.message.slice(0, 140);
  return 'unknown error';
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
      const candidates = pairingCandidates(parsed.urls);
      if (candidates.length === 0) {
        setPhase('failed');
        setError('No server URL in that code. On the PC run `opencode pair --remote --yes` and scan its QR.');
        return;
      }
      setPhase('connecting');
      setError(null);
      const failures: string[] = [];
      for (const baseUrl of candidates) {
        let token: string;
        try {
          token = await exchangePairingCode(baseUrl, parsed.code);
        } catch (err) {
          failures.push(`${baseUrl.replace(/^https?:\/\//, '')} (${pairingFailureReason(err)})`);
          continue;
        }
        // The code is now spent. Never fall through to another URL after this
        // point — a second exchange cannot succeed and would only hide the
        // real problem.
        try {
          await connect(baseUrl, token);
        } catch {
          setPhase('failed');
          setError(
            `Paired with ${baseUrl.replace(/^https?:\/\//, '')}, but the token could not be saved on this device.`,
          );
          return;
        }
        setPhase('paired');
        navTimer.current = setTimeout(() => {
          if (router.canGoBack()) router.back();
          else router.replace('/');
        }, 900);
        return;
      }
      setPhase('failed');
      setError(
        `Pairing failed: ${failures.join(' · ')}.\n\nEvery code works once and expires in 5 minutes — run \`${PAIR_COMMAND}\` again. Don't open the link on the PC first; that spends the code.`,
      );
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
      setError(
        'That is not a pairing link. Paste the full link (or the JSON contents of the QR) — it ends in /auth/connect/<code>. A bare server address has no one-time code.',
      );
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
