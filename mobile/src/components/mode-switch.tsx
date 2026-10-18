/** Build / Plan — a two-way switch with a sliding thumb. */

import { useEffect, useState } from 'react';
import { Animated, Easing, View } from 'react-native';

import { ND, curve } from '@/components/motion';
import { ThemedText } from '@/components/themed-text';
import { Glyph, PressableScale, useReduceMotion } from '@/components/ui';
import { type Palette } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type Mode = 'build' | 'plan';

const SEG_W = 84;
const H = 32;
const PAD = 3;

const ITEMS: { mode: Mode; label: string; icon: string }[] = [
  { mode: 'build', label: 'Build', icon: 'hammer-outline' },
  { mode: 'plan', label: 'Plan', icon: 'map-outline' },
];

/** Active items are tinted by side: plan takes the accent, build the clay. */
function itemColor(active: boolean, plan: boolean, theme: Palette): string {
  if (!active) return theme.inkFaint;
  return plan ? theme.accent : theme.clay;
}

export function ModeSwitch({
  mode,
  onChange,
  disabled,
}: Readonly<{
  mode: Mode;
  onChange: (mode: Mode) => void;
  disabled?: boolean;
}>) {
  const theme = useTheme();
  const reduce = useReduceMotion();
  const [x] = useState(() => new Animated.Value(mode === 'plan' ? 1 : 0));

  useEffect(() => {
    const target = mode === 'plan' ? 1 : 0;
    if (reduce) {
      x.setValue(target);
      return;
    }
    const anim = Animated.timing(x, {
      toValue: target,
      duration: 240,
      easing: Easing.out(Easing.cubic) ?? curve,
      useNativeDriver: ND,
    });
    anim.start();
    return () => anim.stop();
  }, [mode, reduce, x]);

  return (
    <View
      accessibilityRole="radiogroup"
      style={{
        flexDirection: 'row',
        padding: PAD,
        height: H + PAD * 2,
        borderRadius: (H + PAD * 2) / 2,
        backgroundColor: theme.inkWell,
        borderWidth: 1,
        borderColor: theme.inkControl,
        opacity: disabled ? 0.6 : 1,
      }}>
      <Animated.View
        style={{
          position: 'absolute',
          top: PAD,
          left: PAD,
          width: SEG_W,
          height: H,
          borderRadius: H / 2,
          backgroundColor: theme.surfaceRaised,
          borderWidth: 1,
          borderColor: theme.inkControl,
          transform: [{ translateX: x.interpolate({ inputRange: [0, 1], outputRange: [0, SEG_W] }) }],
        }}
      />
      {ITEMS.map((it) => {
        const active = it.mode === mode;
        return (
          <PressableScale
            key={it.mode}
            onPress={() => {
              if (!active) onChange(it.mode);
            }}
            disabled={disabled}
            scaleTo={0.96}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            accessibilityLabel={`${it.label} mode`}
            style={{
              width: SEG_W,
              height: H,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
            }}>
            <Glyph
              name={it.icon}
              size={14}
              color={itemColor(active, it.mode === 'plan', theme)}
            />
            <ThemedText
              type="footnote"
              weight="semibold"
              style={{ color: active ? theme.ink : theme.inkMuted }}>
              {it.label}
            </ThemedText>
          </PressableScale>
        );
      })}
    </View>
  );
}
