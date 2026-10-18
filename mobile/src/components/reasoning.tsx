/**
 * The agent's thinking — folded away unless the reader opens it.
 *
 * 1. Collapsed (the default, always): a single quiet header. While the model
 *    is thinking the header is alive — the label ripples, the brain breathes
 *    and a faint light sweeps the card — so the wait never looks stuck, but
 *    none of the reasoning text takes space until asked for.
 * 2. Settled: the header reads "Thought for 12s".
 * 3. Opened by a tap: the text unfolds (live window while thinking, a taller
 *    window once settled) and stays open until the reader taps again. A
 *    reader's choice is never undone by the app.
 */

import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useRef, useState, type ComponentRef } from 'react';
import { Animated, Easing, ScrollView, View } from 'react-native';

import { ND, Sweep, WaveText, curve, useLoop, withAlpha } from '@/components/motion';
import { ThemedText } from '@/components/themed-text';
import { Glyph, PressableScale, useReduceMotion } from '@/components/ui';
import { Fonts, Motion } from '@/constants/theme';
import { fmtElapsed } from '@/lib/format';
import { useTheme } from '@/hooks/use-theme';

const LIVE_HEIGHT = 132;
const EXPANDED_HEIGHT = 280;

export function ReasoningBlock({
  text,
  isActive,
  knownMs,
}: {
  text: string;
  isActive: boolean;
  /** duration from history (when this wasn't watched live) */
  knownMs?: number;
}) {
  const theme = useTheme();
  const reduce = useReduceMotion();
  const [expanded, setExpanded] = useState(false);
  /** The body stays mounted while it folds shut, then drops out. */
  const [bodyMounted, setBodyMounted] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  const scrollRef = useRef<ComponentRef<typeof ScrollView>>(null);
  const [rotation] = useState(() => new Animated.Value(0));
  const [height] = useState(() => new Animated.Value(0));

  // The thinking clock. `now` ticks while live, which dates the settle; a
  // fresh start is taken by the first tick after the model thinks again.
  // (Timestamps are state, not refs, so the React Compiler can optimise the
  // block — Date.now() itself is not allowed during render.)
  const [now, setNow] = useState(() => Date.now());
  const [startedAt, setStartedAt] = useState<number | null>(() => Date.now());
  const [endedAt, setEndedAt] = useState<number | null>(null);
  const [wasActive, setWasActive] = useState(isActive);

  if (wasActive !== isActive) {
    setWasActive(isActive);
    if (isActive) {
      // A second thought — re-clock in.
      setStartedAt(null);
      setEndedAt(null);
    } else {
      setEndedAt(now);
    }
  }

  // Keep the clock honest while live.
  useEffect(() => {
    if (!isActive) return;
    const t = setInterval(() => {
      const n = Date.now();
      setNow(n);
      setStartedAt((s) => s ?? n);
    }, 500);
    return () => clearInterval(t);
  }, [isActive]);

  // While live and open, always show the newest line, never animate there.
  useEffect(() => {
    if (isActive && expanded) scrollRef.current?.scrollToEnd({ animated: false });
  }, [text, isActive, expanded]);

  // Chevron.
  useEffect(() => {
    Animated.timing(rotation, {
      toValue: expanded ? 1 : 0,
      duration: Motion.settle * 1000,
      easing: curve,
      useNativeDriver: ND,
    }).start();
  }, [expanded, rotation]);

  // Unfold / fold. Height can't use the native driver; the body is small.
  const targetHeight = expanded ? (isActive ? LIVE_HEIGHT : EXPANDED_HEIGHT) : 0;
  useEffect(() => {
    if (expanded) setBodyMounted(true);
    if (reduce) {
      height.setValue(targetHeight);
      if (!expanded) setBodyMounted(false);
      return;
    }
    const anim = Animated.timing(height, {
      toValue: targetHeight,
      duration: expanded ? 320 : 240,
      easing: expanded ? curve : Easing.out(Easing.cubic),
      useNativeDriver: false,
    });
    anim.start(({ finished }) => {
      if (finished && !expanded) setBodyMounted(false);
    });
    return () => anim.stop();
  }, [targetHeight, expanded, reduce, height]);

  // The brain breathes while the model thinks.
  const breathe = useLoop(1500, isActive && !reduce);
  const brainScale = breathe.interpolate({ inputRange: [0, 0.5, 1], outputRange: [1, 1.2, 1] });
  const brainGlow = breathe.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.5, 1, 0.5] });

  const seconds =
    startedAt == null || endedAt == null ? 0 : Math.max(0, Math.round((endedAt - startedAt) / 1000));
  // Watched live → the live clock; opened from history → the recorded/estimated time.
  const shownMs = seconds >= 1 ? seconds * 1000 : (knownMs ?? 0);
  const settledLabel = `Thought for ${fmtElapsed(Math.max(1000, shownMs))}`;

  const bodyHeight = expanded ? (isActive ? LIVE_HEIGHT : EXPANDED_HEIGHT) : EXPANDED_HEIGHT;

  return (
    <View
      style={{
        backgroundColor: theme.surface,
        borderRadius: 12,
        padding: 12,
        gap: 8,
        overflow: 'hidden',
      }}>
      {isActive ? <Sweep color={withAlpha(theme.clay, 0.16)} duration={2600} /> : null}

      <PressableScale
        onPress={() => setExpanded((e) => !e)}
        scaleTo={0.99}
        accessibilityLabel={expanded ? 'Collapse reasoning' : 'Expand reasoning'}
        accessibilityState={{ selected: expanded }}
        hitSlop={8}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Animated.View
            style={{
              opacity: isActive && !reduce ? brainGlow : 1,
              transform: [{ scale: isActive && !reduce ? brainScale : 1 }],
            }}>
            <Glyph set="mci" name="brain" size={13} color={isActive ? theme.clay : theme.inkMuted} />
          </Animated.View>
          {isActive ? (
            <WaveText text="Thinking…" type="footnote" style={{ color: theme.inkMuted, fontFamily: Fonts.semibold }} />
          ) : (
            <ThemedText type="footnote" weight="semibold" style={{ color: theme.inkMuted }}>
              {settledLabel}
            </ThemedText>
          )}
          <View style={{ flex: 1 }} />
          <Animated.View
            style={{
              transform: [
                {
                  rotate: rotation.interpolate({
                    inputRange: [0, 1],
                    outputRange: ['0deg', '180deg'],
                  }),
                },
              ],
            }}>
            <Glyph name="chevron-down" size={12} color={theme.inkMuted} />
          </Animated.View>
        </View>
      </PressableScale>

      {bodyMounted ? (
        <Animated.View style={{ height, overflow: 'hidden' }}>
          <View style={{ height: bodyHeight }}>
            <ScrollView
              ref={scrollRef}
              scrollEnabled={!isActive}
              showsVerticalScrollIndicator={false}
              nestedScrollEnabled
              onContentSizeChange={(_, h) => setOverflowing(h > bodyHeight)}>
              <ThemedText
                type="footnote"
                style={{
                  color: theme.inkMuted,
                  lineHeight: 21,
                  fontFamily: Fonts.regular,
                }}>
                {text}
              </ThemedText>
            </ScrollView>

            {overflowing && isActive ? (
              <LinearGradient
                pointerEvents="none"
                colors={[theme.surface, `${theme.surface}00`]}
                style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 14 }}
              />
            ) : null}
            {overflowing && !isActive ? (
              <LinearGradient
                pointerEvents="none"
                colors={[`${theme.surface}00`, theme.surface]}
                style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 14 }}
              />
            ) : null}
          </View>
        </Animated.View>
      ) : null}
    </View>
  );
}
