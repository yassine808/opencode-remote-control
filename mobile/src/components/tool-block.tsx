import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Platform, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Check, Chevron, Cross, PressableScale, StatusDot } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { ToolPart } from '@/lib/types';

const NATIVE = Platform.OS !== 'web';

/** Pick the single most informative field of a tool's input for the collapsed summary. */
function summarize(input: Record<string, unknown> | undefined): string {
  if (!input) return '';
  const keys = ['command', 'filePath', 'file_path', 'path', 'pattern', 'url', 'query', 'description', 'prompt'];
  for (const key of keys) {
    const v = input[key];
    if (typeof v === 'string' && v.trim()) return v.replace(/\s+/g, ' ').trim();
  }
  const first = Object.values(input).find((v) => typeof v === 'string' && v.trim()) as string | undefined;
  return first ? first.replace(/\s+/g, ' ').trim() : JSON.stringify(input);
}

function prettyName(name: string): string {
  const spaced = name.replace(/[_-]+/g, ' ').trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function Section({ label, text, color }: { label: string; text: string; color?: string }) {
  const theme = useTheme();
  return (
    <View style={styles.section}>
      <ThemedText type="caption" themeColor="textTertiary">
        {label}
      </ThemedText>
      <View style={[styles.codeBox, { backgroundColor: theme.code, borderColor: theme.border }]}>
        <ThemedText type="code" selectable style={color ? { color } : undefined}>
          {text}
        </ThemedText>
      </View>
    </View>
  );
}

export function ToolBlock({ part }: { part: ToolPart }) {
  const theme = useTheme();
  const [expanded, setExpanded] = useState(false);
  const status = part.state?.status ?? 'unknown';
  const input = part.state?.input;
  const summary = summarize(input);
  const outputText = (part.state?.content ?? [])
    .map((c) => c.text ?? '')
    .filter(Boolean)
    .join('\n');
  const errorText = part.state?.error?.message;

  const body = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(body, {
      toValue: expanded ? 1 : 0,
      duration: 200,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: NATIVE,
    }).start();
  }, [expanded, body]);

  const tone =
    status === 'running'
      ? theme.running
      : status === 'completed'
        ? theme.success
        : status === 'error'
          ? theme.danger
          : theme.textTertiary;
  const toneSoft =
    status === 'running'
      ? theme.runningSoft
      : status === 'completed'
        ? theme.successSoft
        : status === 'error'
          ? theme.dangerSoft
          : theme.backgroundSelected;

  return (
    <View style={[styles.card, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
      <PressableScale
        onPress={() => setExpanded((v) => !v)}
        scaleTo={0.99}
        accessibilityLabel={`${prettyName(part.name)}, ${status}. ${expanded ? 'Collapse' : 'Expand'} details`}
        accessibilityState={{ expanded }}
        style={styles.header}>
        <View style={[styles.badge, { backgroundColor: toneSoft }]}>
          {status === 'running' ? (
            <StatusDot color={tone} pulse size={7} />
          ) : status === 'completed' ? (
            <Check color={tone} size={10} />
          ) : status === 'error' ? (
            <Cross color={tone} size={8} />
          ) : (
            <StatusDot color={tone} size={6} />
          )}
        </View>
        <View style={styles.headerText}>
          <ThemedText type="smallBold" numberOfLines={1}>
            {prettyName(part.name)}
          </ThemedText>
          {summary ? (
            <ThemedText type="code" themeColor="textSecondary" numberOfLines={expanded ? 3 : 1}>
              {summary}
            </ThemedText>
          ) : null}
        </View>
        <Chevron open={expanded} color={theme.textTertiary} />
      </PressableScale>

      {expanded && (
        <Animated.View
          style={[
            styles.body,
            {
              borderTopColor: theme.border,
              opacity: body,
              transform: [{ translateY: body.interpolate({ inputRange: [0, 1], outputRange: [-6, 0] }) }],
            },
          ]}>
          {input && Object.keys(input).length > 0 ? <Section label="Input" text={JSON.stringify(input, null, 2)} /> : null}
          {errorText ? <Section label="Error" text={errorText} color={theme.danger} /> : null}
          {outputText ? (
            <Section label="Output" text={outputText.length > 4000 ? `${outputText.slice(0, 4000)}…` : outputText} />
          ) : null}
          {!input && !errorText && !outputText ? (
            <ThemedText type="small" themeColor="textSecondary">
              No details yet.
            </ThemedText>
          ) : null}
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: Radius.medium, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three - 4, padding: Spacing.three - 2 },
  headerText: { flex: 1, gap: 1 },
  badge: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  body: { borderTopWidth: StyleSheet.hairlineWidth, padding: Spacing.three - 2, gap: Spacing.three - 4 },
  section: { gap: 4 },
  codeBox: { borderRadius: Radius.small, borderWidth: StyleSheet.hairlineWidth, padding: Spacing.two + 2 },
});
