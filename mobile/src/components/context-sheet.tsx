/**
 * Context — how full the model's window is, and what the session has spent.
 *
 * Opened from the progress ring in the chat header. A bottom sheet that
 * springs up, can be dragged away, and plays its numbers in: the ring sweeps
 * to the usage, the counters run up, the token mix grows left to right and
 * the stat cells rise in one after another.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  Easing,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  AnimatedNumber,
  FadeRise,
  ND,
  ProgressRing,
  SpinnerRing,
  curve,
  withAlpha,
} from '@/components/motion';
import { ThemedText } from '@/components/themed-text';
import { Glyph, PressableScale, useReduceMotion } from '@/components/ui';
import { type Palette } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { fmtCost, fmtDateTime, fmtInt } from '@/lib/format';

export interface ContextStats {
  title: string;
  provider: string | null;
  modelName: string | null;
  contextLimit: number | null;
  tokens: {
    input: number;
    output: number;
    reasoning: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  } | null;
  /** 0–1, or null when the limit or the token counts are unknown */
  usage: number | null;
  messages: number;
  /** the transcript is paged — the count is a floor */
  messagesCapped: boolean;
  userMessages: number;
  assistantMessages: number;
  cost: number | undefined;
  created: number | undefined;
  lastActivity: number | undefined;
  running: boolean;
}

/** The ring's colour tells the story before the number does. */
export function usageColor(theme: Palette, usage: number | null): string {
  if (usage == null) return theme.inkFaint;
  if (usage >= 0.9) return theme.negative;
  if (usage >= 0.7) return theme.caution;
  return theme.accent;
}

function usageNote(usage: number | null, hasLimit: boolean): string {
  if (!hasLimit) return 'Context limit unavailable for this model';
  if (usage == null) return 'No token data yet';
  if (usage < 0.5) return 'Plenty of room';
  if (usage < 0.7) return 'Filling up';
  if (usage < 0.9) return 'Getting full';
  return 'Nearly full — a fresh session may help';
}

const dash = '—';

function Cell({ label, value, index, lines = 1 }: { label: string; value: string; index: number; lines?: number }) {
  const theme = useTheme();
  return (
    <FadeRise delay={260 + index * 32} distance={8} duration={300} style={{ flex: 1, gap: 2 }}>
      <ThemedText type="caption" style={{ color: theme.inkFaint }}>
        {label}
      </ThemedText>
      <ThemedText
        type="subheadline"
        weight="semibold"
        numberOfLines={lines}
        style={{ color: theme.ink, fontVariant: ['tabular-nums'] }}>
        {value}
      </ThemedText>
    </FadeRise>
  );
}

export function ContextSheet({
  visible,
  stats,
  onClose,
}: {
  visible: boolean;
  stats: ContextStats;
  onClose: () => void;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const reduce = useReduceMotion();
  const screenH = Dimensions.get('window').height;

  const [mounted, setMounted] = useState(visible);
  const [shown] = useState(() => new Animated.Value(0));
  const [drag] = useState(() => new Animated.Value(0));
  const [grow] = useState(() => new Animated.Value(0));
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      drag.setValue(0);
      grow.setValue(0);
      const open = Animated.timing(shown, {
        toValue: 1,
        duration: reduce ? 0 : 360,
        easing: curve,
        useNativeDriver: ND,
      });
      const bar = Animated.timing(grow, {
        toValue: 1,
        duration: reduce ? 0 : 900,
        delay: reduce ? 0 : 220,
        easing: curve,
        useNativeDriver: false,
      });
      open.start();
      bar.start();
      return () => {
        open.stop();
        bar.stop();
      };
    }
    const close = Animated.timing(shown, {
      toValue: 0,
      duration: reduce ? 0 : 230,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: ND,
    });
    close.start(({ finished }) => {
      if (finished) setMounted(false);
    });
    return () => close.stop();
  }, [visible, reduce, shown, drag, grow]);

  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 4,
        onPanResponderMove: (_, g) => drag.setValue(Math.max(0, g.dy)),
        onPanResponderRelease: (_, g) => {
          if (g.dy > 90 || g.vy > 0.9) {
            onCloseRef.current();
          } else {
            Animated.spring(drag, { toValue: 0, bounciness: 6, useNativeDriver: ND }).start();
          }
        },
        onPanResponderTerminate: () => {
          Animated.spring(drag, { toValue: 0, useNativeDriver: ND }).start();
        },
      }),
    [drag],
  );

  const tone = usageColor(theme, stats.usage);
  const pct = stats.usage == null ? null : Math.round(stats.usage * 100);
  const t = stats.tokens;

  const mix = useMemo(() => {
    if (!t) return [];
    return [
      { key: 'Input', value: t.input, color: theme.accent },
      { key: 'Cache', value: t.cacheRead + t.cacheWrite, color: theme.positive },
      { key: 'Output', value: t.output, color: theme.caution },
      { key: 'Reasoning', value: t.reasoning, color: theme.clay },
    ].filter((s) => s.value > 0);
  }, [t, theme]);

  const translateY = useMemo(
    () =>
      Animated.add(shown.interpolate({ inputRange: [0, 1], outputRange: [screenH, 0] }), drag),
    [shown, drag, screenH],
  );

  const cells: { label: string; value: string; lines?: number }[] = [
    { label: 'Session', value: stats.title, lines: 2 },
    {
      label: 'Messages',
      value: `${fmtInt(stats.messages)}${stats.messagesCapped ? '+' : ''}`,
    },
    { label: 'Provider', value: stats.provider ?? dash },
    { label: 'Model', value: stats.modelName ?? dash, lines: 2 },
    { label: 'Context limit', value: stats.contextLimit ? fmtInt(stats.contextLimit) : dash },
    { label: 'Total tokens', value: t ? fmtInt(t.total) : dash },
    { label: 'Usage', value: pct == null ? dash : `${pct}%` },
    { label: 'Input tokens', value: t ? fmtInt(t.input) : dash },
    { label: 'Output tokens', value: t ? fmtInt(t.output) : dash },
    { label: 'Reasoning tokens', value: t ? fmtInt(t.reasoning) : dash },
    { label: 'Cache (read / write)', value: t ? `${fmtInt(t.cacheRead)} / ${fmtInt(t.cacheWrite)}` : dash },
    { label: 'User messages', value: fmtInt(stats.userMessages) },
    { label: 'Assistant messages', value: fmtInt(stats.assistantMessages) },
    { label: 'Total cost', value: fmtCost(stats.cost) },
    { label: 'Session created', value: fmtDateTime(stats.created), lines: 2 },
    { label: 'Last activity', value: fmtDateTime(stats.lastActivity), lines: 2 },
  ];
  const pairs: (typeof cells)[] = [];
  for (let i = 0; i < cells.length; i += 2) pairs.push(cells.slice(i, i + 2));

  return (
    <Modal visible={mounted} transparent animationType="none" statusBarTranslucent onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Animated.View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0, 0, 0, 0.5)', opacity: shown }]}
        />
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close context" />

        <Animated.View
          style={{
            transform: [{ translateY }],
            backgroundColor: theme.surface,
            borderTopLeftRadius: 22,
            borderTopRightRadius: 22,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: theme.hairline,
            maxHeight: '88%',
            width: '100%',
            maxWidth: 560,
            alignSelf: 'center',
            paddingBottom: 12 + insets.bottom,
            overflow: 'hidden',
          }}>
          {/* grab area — drag down to dismiss */}
          <View {...pan.panHandlers}>
            <View style={{ alignItems: 'center', paddingTop: 8, paddingBottom: 4 }}>
              <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: theme.inkSelected }} />
            </View>
            <View
              style={{
                paddingHorizontal: 20,
                paddingTop: 6,
                paddingBottom: 10,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 10,
              }}>
              <ThemedText type="headline" style={{ flex: 1 }}>
                Context
              </ThemedText>
              <PressableScale
                onPress={onClose}
                hitSlop={10}
                scaleTo={0.88}
                accessibilityLabel="Close"
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 14,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: theme.inkControl,
                }}>
                <Glyph name="close" size={16} color={theme.inkMuted} />
              </PressableScale>
            </View>
          </View>

          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 8, gap: 22 }}>
            {/* hero — the ring, the count, the verdict */}
            <FadeRise delay={80} distance={14} style={{ flexDirection: 'row', alignItems: 'center', gap: 18 }}>
              <View style={{ width: 96, height: 96, alignItems: 'center', justifyContent: 'center' }}>
                <ProgressRing
                  progress={stats.usage ?? 0}
                  size={92}
                  stroke={8}
                  color={tone}
                  trackColor={theme.inkControl}
                  duration={1100}>
                  <View style={{ position: 'absolute', alignItems: 'center' }}>
                    {pct == null ? (
                      <ThemedText type="title3" style={{ color: theme.inkFaint }}>
                        {dash}
                      </ThemedText>
                    ) : (
                      <AnimatedNumber
                        value={pct}
                        duration={1100}
                        format={(n) => `${Math.round(n)}%`}
                        type="title3"
                        style={{ color: theme.ink }}
                      />
                    )}
                    <ThemedText type="caption2" style={{ color: theme.inkFaint }}>
                      used
                    </ThemedText>
                  </View>
                </ProgressRing>
                {stats.running ? (
                  <SpinnerRing size={100} stroke={2} color={theme.clay} duration={1600} />
                ) : null}
              </View>

              <View style={{ flex: 1, gap: 3 }}>
                <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
                  {t ? (
                    <AnimatedNumber value={t.total} type="title2" duration={1100} style={{ color: theme.ink }} />
                  ) : (
                    <ThemedText type="title2" style={{ color: theme.inkFaint }}>
                      {dash}
                    </ThemedText>
                  )}
                  <ThemedText type="footnote" style={{ color: theme.inkMuted }}>
                    tokens
                  </ThemedText>
                </View>
                <ThemedText type="footnote" style={{ color: theme.inkFaint, fontVariant: ['tabular-nums'] }}>
                  {stats.contextLimit ? `of ${fmtInt(stats.contextLimit)} in the window` : 'window size unknown'}
                </ThemedText>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingTop: 4 }}>
                  <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: tone }} />
                  <ThemedText type="footnote" weight="medium" style={{ color: tone, flexShrink: 1 }}>
                    {usageNote(stats.usage, !!stats.contextLimit)}
                  </ThemedText>
                </View>
              </View>
            </FadeRise>

            {/* token mix — grows in left to right */}
            {mix.length > 0 && t ? (
              <FadeRise delay={180} distance={10} style={{ gap: 10 }}>
                <Animated.View
                  style={{
                    height: 8,
                    borderRadius: 4,
                    overflow: 'hidden',
                    backgroundColor: theme.inkWell,
                    width: '100%',
                  }}>
                  <Animated.View
                    style={{
                      height: 8,
                      width: grow.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
                      flexDirection: 'row',
                      gap: 2,
                    }}>
                    {mix.map((s) => (
                      <View
                        key={s.key}
                        style={{ flex: s.value, height: 8, backgroundColor: s.color, borderRadius: 2 }}
                      />
                    ))}
                  </Animated.View>
                </Animated.View>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: 14, rowGap: 4 }}>
                  {mix.map((s) => (
                    <View key={s.key} style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                      <View style={{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: s.color }} />
                      <ThemedText type="caption" style={{ color: theme.inkMuted }}>
                        {s.key}
                      </ThemedText>
                      <ThemedText
                        type="caption"
                        style={{ color: theme.inkFaint, fontVariant: ['tabular-nums'] }}>
                        {Math.max(1, Math.round((s.value / t.total) * 100))}%
                      </ThemedText>
                    </View>
                  ))}
                </View>
              </FadeRise>
            ) : null}

            <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: theme.hairline }} />

            {/* the full ledger */}
            <View style={{ gap: 16 }}>
              {pairs.map((pair, r) => (
                <View key={r} style={{ flexDirection: 'row', gap: 20 }}>
                  {pair.map((c, i) => (
                    <Cell key={c.label} label={c.label} value={c.value} lines={c.lines} index={r * 2 + i} />
                  ))}
                </View>
              ))}
            </View>
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

/** The header button: a live ring showing how full the context window is. */
export function ContextButton({
  usage,
  running,
  onPress,
}: {
  usage: number | null;
  running: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  // Plain white progress, no motion.
  const color = theme.scheme === 'dark' ? '#FFFFFF' : theme.ink;
  const pct = usage == null ? null : Math.round(usage * 100);

  return (
    <PressableScale
      onPress={onPress}
      scaleTo={0.9}
      hitSlop={8}
      accessibilityLabel={pct == null ? 'Context' : `Context, ${pct}% used`}
      accessibilityHint="Shows token usage and session details"
      style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}>
      <ProgressRing
        progress={usage ?? 0}
        size={28}
        stroke={3}
        color={color}
        animated={false}
        trackColor={withAlpha(theme.scheme === 'dark' ? '#F4F0EC' : '#141413', 0.14)}>
        {pct != null ? (
          <ThemedText
            type="caption2"
            weight="semibold"
            style={{
              position: 'absolute',
              fontSize: 9,
              lineHeight: 11,
              color: theme.inkMuted,
              fontVariant: ['tabular-nums'],
            }}>
            {pct}
          </ThemedText>
        ) : null}
      </ProgressRing>
    </PressableScale>
  );
}
