import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Platform,
  Pressable,
  StyleSheet,
  View,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing, Touch, type ThemeColor } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

const NATIVE = Platform.OS !== 'web';

// ---------- motion ----------

/** True when the OS asks for reduced motion. Ambient loops are skipped when set. */
export function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => alive && setReduce(v))
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduce);
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);
  return reduce;
}

/** Runs a looping animation while `active`, stopped on unmount or when reduced motion is on. */
function useLoop(active: boolean, make: (v: Animated.Value) => Animated.CompositeAnimation) {
  const value = useRef(new Animated.Value(0)).current;
  const reduce = useReduceMotion();
  const makeRef = useRef(make);
  makeRef.current = make;
  useEffect(() => {
    if (!active || reduce) {
      value.setValue(0);
      return;
    }
    const loop = Animated.loop(makeRef.current(value));
    loop.start();
    return () => loop.stop();
  }, [active, reduce, value]);
  return value;
}

/** One-shot entrance: fade + small rise. Used once per screen load, not on every item. */
export function Entrance({
  children,
  delay = 0,
  enabled = true,
  style,
}: {
  children: ReactNode;
  delay?: number;
  enabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const reduce = useReduceMotion();
  const skip = !enabled || reduce;
  const v = useRef(new Animated.Value(skip ? 1 : 0)).current;
  useEffect(() => {
    if (skip) return;
    Animated.timing(v, {
      toValue: 1,
      duration: 380,
      delay,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: NATIVE,
    }).start();
  }, [skip, delay, v]);
  return (
    <Animated.View
      style={[
        style,
        {
          opacity: v,
          transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }],
        },
      ]}>
      {children}
    </Animated.View>
  );
}

// ---------- press ----------

type PressableScaleProps = Omit<PressableProps, 'style' | 'children'> & {
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Layout styles for the outer touch target (flex, margins). */
  containerStyle?: StyleProp<ViewStyle>;
  scaleTo?: number;
};

/** Pressable that gives tactile feedback: a small spring-down while held. */
export function PressableScale({
  children,
  style,
  containerStyle,
  scaleTo = 0.97,
  onPressIn,
  onPressOut,
  ...rest
}: PressableScaleProps) {
  const scale = useRef(new Animated.Value(1)).current;
  const to = (value: number) =>
    Animated.spring(scale, { toValue: value, useNativeDriver: NATIVE, speed: 50, bounciness: 0 }).start();
  return (
    <Pressable
      accessibilityRole="button"
      style={containerStyle}
      onPressIn={(e) => {
        to(scaleTo);
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        to(1);
        onPressOut?.(e);
      }}
      {...rest}>
      <Animated.View style={[style, { transform: [{ scale }] }]}>{children}</Animated.View>
    </Pressable>
  );
}

// ---------- status ----------

/** Solid dot; with `pulse` a ring radiates from it (the "heartbeat" of a running session). */
export function StatusDot({ color, pulse = false, size = 8 }: { color: string; pulse?: boolean; size?: number }) {
  const v = useLoop(pulse, (value) =>
    Animated.timing(value, {
      toValue: 1,
      duration: 1500,
      easing: Easing.out(Easing.quad),
      useNativeDriver: NATIVE,
    }),
  );
  return (
    <View style={{ width: size, height: size }}>
      {pulse && (
        <Animated.View
          style={{
            position: 'absolute',
            width: size,
            height: size,
            borderRadius: size,
            backgroundColor: color,
            opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.6, 0] }),
            transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [1, 3] }) }],
          }}
        />
      )}
      <View style={{ width: size, height: size, borderRadius: size, backgroundColor: color }} />
    </View>
  );
}

/** Three bouncing dots — "the agent is composing". */
export function TypingDots({ color }: { color: string }) {
  return (
    <View style={styles.typing} accessibilityLabel="Working" accessible>
      {[0, 1, 2].map((i) => (
        <TypingDot key={i} index={i} color={color} />
      ))}
    </View>
  );
}

function TypingDot({ index, color }: { index: number; color: string }) {
  const v = useLoop(true, (value) =>
    Animated.sequence([
      Animated.delay(index * 140),
      Animated.timing(value, { toValue: 1, duration: 360, easing: Easing.out(Easing.quad), useNativeDriver: NATIVE }),
      Animated.timing(value, { toValue: 0, duration: 360, easing: Easing.in(Easing.quad), useNativeDriver: NATIVE }),
      Animated.delay((2 - index) * 140 + 200),
    ]),
  );
  return (
    <Animated.View
      style={{
        width: 6,
        height: 6,
        borderRadius: 3,
        backgroundColor: color,
        opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] }),
        transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [0, -4] }) }],
      }}
    />
  );
}

/** Thin sweeping bar that sits under a header while work is in progress. */
export function ProgressSweep({ active, color }: { active: boolean; color: string }) {
  const [width, setWidth] = useState(0);
  const v = useLoop(active && width > 0, (value) =>
    Animated.timing(value, {
      toValue: 1,
      duration: 1400,
      easing: Easing.inOut(Easing.cubic),
      useNativeDriver: NATIVE,
    }),
  );
  return (
    <View style={styles.sweepTrack} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      {active && width > 0 && (
        <Animated.View
          style={{
            width: width * 0.35,
            height: 2,
            backgroundColor: color,
            borderRadius: 1,
            transform: [{ translateX: v.interpolate({ inputRange: [0, 1], outputRange: [-width * 0.35, width] }) }],
          }}
        />
      )}
    </View>
  );
}

export function Pill({
  label,
  color,
  soft,
  dot,
  pulse,
}: {
  label: string;
  color: string;
  soft: string;
  dot?: boolean;
  pulse?: boolean;
}) {
  return (
    <View style={[styles.pill, { backgroundColor: soft }]}>
      {dot ? <StatusDot color={color} pulse={pulse} size={6} /> : null}
      <ThemedText type="caption" style={{ color, fontWeight: '600' }}>
        {label}
      </ThemedText>
    </View>
  );
}

// ---------- icons (drawn with views — no icon font dependency) ----------

export function Chevron({ open, color, size = 8 }: { open: boolean; color: string; size?: number }) {
  const v = useRef(new Animated.Value(open ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(v, { toValue: open ? 1 : 0, duration: 180, easing: Easing.out(Easing.quad), useNativeDriver: NATIVE }).start();
  }, [open, v]);
  return (
    <Animated.View
      style={{
        width: size,
        height: size,
        borderRightWidth: 2,
        borderBottomWidth: 2,
        borderColor: color,
        borderRadius: 1,
        transform: [{ rotate: v.interpolate({ inputRange: [0, 1], outputRange: ['-45deg', '45deg'] }) }],
      }}
    />
  );
}

/** Left-pointing back chevron. */
export function BackGlyph({ color }: { color: string }) {
  return (
    <View
      style={{
        width: 11,
        height: 11,
        borderLeftWidth: 2.5,
        borderBottomWidth: 2.5,
        borderColor: color,
        borderRadius: 1.5,
        transform: [{ rotate: '45deg' }, { translateX: 2 }, { translateY: -2 }],
      }}
    />
  );
}

/** Up arrow used on the send button. */
export function ArrowUp({ color }: { color: string }) {
  return (
    <View style={{ alignItems: 'center', justifyContent: 'center', width: 16, height: 18 }}>
      <View
        style={{
          width: 9,
          height: 9,
          borderLeftWidth: 2.5,
          borderTopWidth: 2.5,
          borderColor: color,
          borderRadius: 1.5,
          transform: [{ rotate: '45deg' }],
          position: 'absolute',
          top: 4,
        }}
      />
      <View style={{ width: 2.5, height: 13, backgroundColor: color, borderRadius: 1, position: 'absolute', top: 5 }} />
    </View>
  );
}

export function Check({ color, size = 10 }: { color: string; size?: number }) {
  return (
    <View
      style={{
        width: size * 0.55,
        height: size,
        borderRightWidth: 2,
        borderBottomWidth: 2,
        borderColor: color,
        transform: [{ rotate: '45deg' }, { translateY: -1 }],
      }}
    />
  );
}

export function Cross({ color, size = 10 }: { color: string; size?: number }) {
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View style={{ position: 'absolute', width: size + 2, height: 2, backgroundColor: color, transform: [{ rotate: '45deg' }] }} />
      <View style={{ position: 'absolute', width: size + 2, height: 2, backgroundColor: color, transform: [{ rotate: '-45deg' }] }} />
    </View>
  );
}

export function FolderGlyph({ color }: { color: string }) {
  return (
    <View style={{ width: 13, height: 10 }}>
      <View style={{ width: 6, height: 3, borderTopLeftRadius: 2, borderTopRightRadius: 2, backgroundColor: color }} />
      <View style={{ flex: 1, borderRadius: 2, borderTopLeftRadius: 0, backgroundColor: color, opacity: 0.9 }} />
    </View>
  );
}

// ---------- buttons & banners ----------

export function IconButton({
  children,
  onPress,
  label,
  style,
}: {
  children: ReactNode;
  onPress: () => void;
  label: string;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  return (
    <PressableScale
      onPress={onPress}
      accessibilityLabel={label}
      hitSlop={6}
      scaleTo={0.9}
      style={[styles.iconButton, { backgroundColor: theme.backgroundElement, borderColor: theme.border }, style]}>
      {children}
    </PressableScale>
  );
}

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

export function Button({
  label,
  onPress,
  variant = 'secondary',
  disabled,
  busy,
  style,
  compact,
}: {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  busy?: boolean;
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const palette: Record<ButtonVariant, { bg: string; fg: ThemeColor | 'onAccent'; border: string }> = {
    primary: { bg: theme.accent, fg: 'onAccent', border: 'transparent' },
    secondary: { bg: theme.backgroundElement, fg: 'text', border: theme.border },
    danger: { bg: theme.dangerSoft, fg: 'danger', border: 'transparent' },
    ghost: { bg: 'transparent', fg: 'accent', border: 'transparent' },
  };
  const p = palette[variant];
  const off = disabled || busy;
  return (
    <PressableScale
      onPress={onPress}
      disabled={off}
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!off, busy: !!busy }}
      containerStyle={style}
      style={[
        styles.button,
        compact && styles.buttonCompact,
        { backgroundColor: p.bg, borderColor: p.border, opacity: off ? 0.5 : 1 },
      ]}>
      <ThemedText type="smallBold" style={{ color: theme[p.fg] }}>
        {label}
      </ThemedText>
    </PressableScale>
  );
}

/** Inline message strip that slides in. Tone decides colour; `action` adds a trailing button. */
export function Banner({
  tone,
  children,
  actionLabel,
  onAction,
}: {
  tone: 'info' | 'danger' | 'warn';
  children: ReactNode;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const theme = useTheme();
  const reduce = useReduceMotion();
  const v = useRef(new Animated.Value(reduce ? 1 : 0)).current;
  useEffect(() => {
    if (reduce) return;
    Animated.timing(v, { toValue: 1, duration: 240, easing: Easing.out(Easing.cubic), useNativeDriver: NATIVE }).start();
  }, [reduce, v]);
  const color = tone === 'danger' ? theme.danger : tone === 'warn' ? theme.warn : theme.textSecondary;
  const bg = tone === 'danger' ? theme.dangerSoft : tone === 'warn' ? theme.warnSoft : theme.backgroundElement;
  return (
    <Animated.View
      accessibilityLiveRegion="polite"
      style={[
        styles.banner,
        {
          backgroundColor: bg,
          borderColor: tone === 'info' ? theme.border : 'transparent',
          opacity: v,
          transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [-8, 0] }) }],
        },
      ]}>
      {tone === 'info' ? <StatusDot color={theme.textTertiary} pulse size={6} /> : null}
      <ThemedText type="small" style={[styles.bannerText, { color }]}>
        {children}
      </ThemedText>
      {actionLabel && onAction ? (
        <PressableScale onPress={onAction} hitSlop={8} scaleTo={0.94}>
          <ThemedText type="smallBold" style={{ color }}>
            {actionLabel}
          </ThemedText>
        </PressableScale>
      ) : null}
    </Animated.View>
  );
}

/** Placeholder block with a gentle breathing opacity. */
export function Skeleton({ style }: { style?: StyleProp<ViewStyle> }) {
  const theme = useTheme();
  const v = useLoop(true, (value) =>
    Animated.sequence([
      Animated.timing(value, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: NATIVE }),
      Animated.timing(value, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: NATIVE }),
    ]),
  );
  return (
    <Animated.View
      style={[
        { backgroundColor: theme.backgroundSelected, borderRadius: Radius.small },
        style,
        { opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0.9] }) },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  typing: { flexDirection: 'row', alignItems: 'center', gap: 5, height: 24, paddingHorizontal: 2 },
  sweepTrack: { height: 2, overflow: 'hidden' },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: Radius.pill,
    alignSelf: 'flex-start',
  },
  iconButton: {
    width: Touch,
    height: Touch,
    borderRadius: Touch / 2,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  button: {
    minHeight: Touch,
    paddingHorizontal: Spacing.four,
    borderRadius: Radius.medium,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonCompact: { minHeight: 36, paddingHorizontal: Spacing.three, borderRadius: Radius.small + 2 },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    marginHorizontal: Spacing.three,
    marginTop: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: 10,
    borderRadius: Radius.medium,
    borderWidth: StyleSheet.hairlineWidth,
  },
  bannerText: { flex: 1 },
});
