import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { HttpError, UnreachableError, exchangePairingCode } from '@/lib/api';
import { useConnection } from '@/lib/connection';

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

export default function SetupScreen() {
  const theme = useTheme();
  const { connect } = useConnection();
  const [permission, requestPermission] = useCameraPermissions();
  const [mode, setMode] = useState<'scan' | 'manual'>('scan');
  const [manualText, setManualText] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const scannedRef = useRef(false);

  const pair = useCallback(
    async (parsed: ParsedPairing) => {
      if (busy) return;
      const candidates = [...parsed.urls].sort(
        (a, b) => Number(b.startsWith('https://')) - Number(a.startsWith('https://')),
      );
      if (candidates.length === 0) {
        setError('No server URL in that code. On the PC run `opencode pair --remote --yes` and scan its QR.');
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

  return (
    <ThemedView style={styles.screen}>
      {mode === 'scan' ? (
        permission?.granted ? (
          <CameraView
            style={StyleSheet.absoluteFill}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={busy ? undefined : ({ data }) => handleScan(data)}
          />
        ) : (
          <View style={styles.permissionWrap}>
            <ThemedText type="small" themeColor="textSecondary" style={styles.centerText}>
              Camera access is needed to scan the pairing QR.
            </ThemedText>
            <Pressable
              style={[styles.button, { backgroundColor: theme.backgroundElement }]}
              onPress={() => void requestPermission()}>
              <ThemedText type="smallBold">Allow camera</ThemedText>
            </Pressable>
          </View>
        )
      ) : (
        <ScrollView contentContainerStyle={styles.manualWrap} keyboardShouldPersistTaps="handled">
          <ThemedText type="smallBold">Paste pairing link</ThemedText>
          <TextInput
            style={[styles.input, { backgroundColor: theme.backgroundElement, color: theme.text }]}
            multiline
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="https://…/auth/connect/… or the JSON from the QR"
            placeholderTextColor={theme.textSecondary}
            value={manualText}
            onChangeText={setManualText}
          />
          <View style={styles.row}>
            <Pressable
              style={[styles.button, { backgroundColor: theme.backgroundElement }]}
              onPress={() => void pasteFromClipboard()}>
              <ThemedText type="smallBold">Paste</ThemedText>
            </Pressable>
            <Pressable
              style={[styles.button, { backgroundColor: theme.backgroundSelected }]}
              onPress={handleManual}>
              <ThemedText type="smallBold">Connect</ThemedText>
            </Pressable>
          </View>
        </ScrollView>
      )}

      <View style={[styles.overlay, { backgroundColor: theme.background }]}>
        <ThemedText type="small" themeColor="textSecondary">
          On the PC run:
        </ThemedText>
        <ThemedText type="code">opencode pair --remote --yes</ThemedText>
        {busy ? (
          <View style={styles.row}>
            <ActivityIndicator color={theme.text} />
            <ThemedText type="small">{busy}</ThemedText>
          </View>
        ) : error ? (
          <ThemedText type="small" style={styles.errorText}>
            {error}
          </ThemedText>
        ) : (
          <ThemedText type="small" themeColor="textSecondary">
            Then scan the QR code it prints.
          </ThemedText>
        )}
        <Pressable
          onPress={() => {
            setMode(mode === 'scan' ? 'manual' : 'scan');
            setError(null);
            scannedRef.current = false;
          }}>
          <ThemedText type="smallBold" style={styles.linkText}>
            {mode === 'scan' ? 'Enter link manually instead' : 'Scan QR instead'}
          </ThemedText>
        </Pressable>
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  permissionWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.three,
    padding: Spacing.four,
  },
  centerText: { textAlign: 'center' },
  manualWrap: { flexGrow: 1, padding: Spacing.four, gap: Spacing.three, paddingBottom: 280 },
  input: {
    minHeight: 120,
    borderRadius: Spacing.three,
    padding: Spacing.three,
    fontSize: 14,
    textAlignVertical: 'top',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  button: {
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
    borderRadius: Spacing.three,
  },
  overlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    padding: Spacing.four,
    gap: Spacing.two,
    paddingBottom: Spacing.five,
  },
  errorText: { color: '#F85149' },
  linkText: { color: '#4C9EEB' },
});
