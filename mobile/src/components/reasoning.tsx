/**
 * The agent's thinking — three states, in the order they occur:
 *
 * 1. Live — a height-capped window (132pt) that scrolls itself to the bottom
 *    as new text arrives, with a fade under the top edge. Capped because
 *    reasoning routinely runs longer than the answer; scrolling because
 *    watching it think is the point of showing it at all.
 * 2. Settled — collapses on its own to a single line ("Thought for 12s").
 * 3. Expanded — tap to read it in full (280pt), tap again to put it away.
 */

import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useRef, useState, type ComponentRef } from 'react';
import { Animated, Easing, ScrollView, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Glyph, PressableScale } from '@/components/ui';
import { Fonts, Motion } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

const LIVE_HEIGHT = 132;
const EXPANDED_HEIGHT = 280;

export function ReasoningBlock({ text, isActive }: { text: string; isActive: boolean }) {
  const theme = useTheme();
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  const [, forceTick] = useState(0);

  const startedAt = useRef(Date.now());
  const endedAt = useRef<number | null>(null);
  const scrollRef = useRef<ComponentRef<typeof ScrollView>>(null);
  const rotation = useRef(new Animated.Value(0)).current;

  // Clock in when the model starts thinking, out when it stops, once.
  useEffect(() => {
    if (isActive) {
      if (endedAt.current != null) startedAt.current = Date.now();
      endedAt.current = null;
    } else if (endedAt.current == null) {
      endedAt.current = Date.now();
    }
  }, [isActive]);

  // Keep the elapsed label honest while live.
  useEffect(() => {
    if (!isActive) return;
    const t = setInterval(() => forceTick((n) => n + 1), 500);
    return () => clearInterval(t);
  }, [isActive]);

  // While live, always show the newest line, never animate there.
  useEffect(() => {
    if (isActive) scrollRef.current?.scrollToEnd({ animated: false });
  }, [text, isActive]);

  useEffect(() => {
    Animated.timing(rotation, {
      toValue: expanded ? 1 : 0,
      duration: Motion.settle * 1000,
      easing: Easing.bezier(...Motion.curve),
      useNativeDriver: true,
    }).start();
  }, [expanded, rotation]);

  const seconds = Math.max(
    0,
    Math.round(((endedAt.current ?? Date.now()) - startedAt.current) / 1000),
  );
  const label = isActive
    ? 'Thinking…'
    : seconds >= 1
      ? `Thought for ${seconds}s`
      : 'Thought about it';

  const showBody = isActive || expanded;

  return (
    <View
      style={{
        backgroundColor: theme.surface,
        borderRadius: 12,
        padding: 12,
        gap: 8,
      }}>
      <PressableScale
        onPress={isActive ? undefined : () => setExpanded((e) => !e)}
        disabled={isActive}
        scaleTo={0.99}
        accessibilityLabel={expanded ? 'Collapse reasoning' : 'Expand reasoning'}
        hitSlop={8}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Glyph set="mci" name="brain" size={13} color={theme.inkMuted} />
          <ThemedText type="footnote" weight="semibold" style={{ color: theme.inkMuted }}>
            {label}
          </ThemedText>
          <View style={{ flex: 1 }} />
          {!isActive ? (
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
          ) : null}
        </View>
      </PressableScale>

      {showBody ? (
        <View
          style={{
            height: expanded ? EXPANDED_HEIGHT : LIVE_HEIGHT,
            overflow: 'hidden',
          }}>
          <ScrollView
            ref={scrollRef}
            scrollEnabled={expanded}
            showsVerticalScrollIndicator={false}
            onContentSizeChange={(_, height) =>
              setOverflowing(height > (expanded ? EXPANDED_HEIGHT : LIVE_HEIGHT))
            }>
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

          {overflowing && !expanded ? (
            <LinearGradient
              pointerEvents="none"
              colors={[theme.surface, `${theme.surface}00`]}
              style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 14 }}
            />
          ) : null}
          {overflowing && expanded ? (
            <LinearGradient
              pointerEvents="none"
              colors={[`${theme.surface}00`, theme.surface]}
              style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 14 }}
            />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
