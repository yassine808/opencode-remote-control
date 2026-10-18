/**
 * Motion kit — the shared animated building blocks.
 *
 * Everything here is plain `Animated` (no new native dependencies) and keeps
 * to the native driver wherever the property allows it, so the effects stay
 * smooth while the JS thread is busy streaming a transcript. Every piece
 * honours the system "reduce motion" setting by settling to a calm static
 * state instead of looping.
 */

import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useState, type ReactNode } from 'react';
import {
  Animated,
  Easing,
  Platform,
  StyleSheet,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { ThemedText, type ThemedTextType } from '@/components/themed-text';
import { useReduceMotion } from '@/components/ui';
import { Motion } from '@/constants/theme';
import { fmtInt } from '@/lib/format';

/** The native driver isn't available on web. */
export const ND = Platform.OS !== 'web';

/** The app's one curve (easeOutQuart). */
export const curve = Easing.bezier(...Motion.curve);

const EASE_IN_OUT = Easing.inOut(Easing.quad);
const EASE_OUT = Easing.out(Easing.quad);
const LINEAR = Easing.linear;

/** `#RRGGBB` + alpha → `rgba(...)`. Anything else passes through untouched. */
export function withAlpha(color: string, alpha: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(color);
  if (!m) return color;
  const n = Number.parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

// ---------- loops ----------

/** A 0→1 value that repeats forever while `enabled`. */
export function useLoop(duration: number, enabled = true): Animated.Value {
  const [value] = useState(() => new Animated.Value(0));
  useEffect(() => {
    value.setValue(0);
    if (!enabled) return;
    const loop = Animated.loop(
      Animated.timing(value, { toValue: 1, duration, easing: LINEAR, useNativeDriver: ND }),
    );
    loop.start();
    return () => loop.stop();
  }, [value, duration, enabled]);
  return value;
}

// ---------- entrances ----------

/** Fade + rise into place. Pass `enabled={false}` for content that was already there. */
export function FadeRise({
  children,
  delay = 0,
  distance = 12,
  duration = 360,
  enabled = true,
  style,
}: Readonly<{
  children?: ReactNode;
  delay?: number;
  distance?: number;
  duration?: number;
  enabled?: boolean;
  style?: StyleProp<ViewStyle>;
}>) {
  const reduce = useReduceMotion();
  const animate = enabled && !reduce;
  const [p] = useState(() => new Animated.Value(enabled ? 0 : 1));

  useEffect(() => {
    if (!animate) {
      p.setValue(1);
      return;
    }
    const anim = Animated.timing(p, {
      toValue: 1,
      duration,
      delay,
      easing: curve,
      useNativeDriver: ND,
    });
    anim.start();
    return () => anim.stop();
    // the entrance plays once per mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Animated.View
      style={[
        style,
        {
          opacity: p,
          transform: [{ translateY: p.interpolate({ inputRange: [0, 1], outputRange: [distance, 0] }) }],
        },
      ]}>
      {children}
    </Animated.View>
  );
}

/** Springs in from a smaller scale — a state change that wants a little "pop". */
export function PopIn({
  children,
  from = 0.4,
  style,
}: Readonly<{
  children?: ReactNode;
  from?: number;
  style?: StyleProp<ViewStyle>;
}>) {
  const reduce = useReduceMotion();
  const [p] = useState(() => new Animated.Value(reduce ? 1 : 0));

  useEffect(() => {
    if (reduce) {
      p.setValue(1);
      return;
    }
    const anim = Animated.spring(p, {
      toValue: 1,
      friction: 5,
      tension: 160,
      useNativeDriver: ND,
    });
    anim.start();
    return () => anim.stop();
  }, [p, reduce]);

  return (
    <Animated.View
      style={[
        style,
        {
          opacity: p.interpolate({ inputRange: [0, 0.6, 1], outputRange: [0, 1, 1] }),
          transform: [{ scale: p.interpolate({ inputRange: [0, 1], outputRange: [from, 1] }) }],
        },
      ]}>
      {children}
    </Animated.View>
  );
}

// ---------- "alive" indicators ----------

function RippleRing({
  color,
  size,
  delay,
  duration,
  maxScale,
}: Readonly<{
  color: string;
  size: number;
  delay: number;
  duration: number;
  maxScale: number;
}>) {
  const [p] = useState(() => new Animated.Value(0));
  useEffect(() => {
    p.setValue(0);
    const anim = Animated.sequence([
      Animated.delay(delay),
      Animated.loop(
        Animated.timing(p, { toValue: 1, duration, easing: EASE_OUT, useNativeDriver: ND }),
      ),
    ]);
    anim.start();
    return () => anim.stop();
  }, [p, delay, duration]);

  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        width: size,
        height: size,
        borderRadius: size / 2,
        borderWidth: 1.5,
        borderColor: color,
        opacity: p.interpolate({ inputRange: [0, 1], outputRange: [0.6, 0] }),
        transform: [{ scale: p.interpolate({ inputRange: [0, 1], outputRange: [1, maxScale] }) }],
      }}
    />
  );
}

/** A dot with sonar rings radiating out of it — "something is happening here". */
export function PulseDot({
  color,
  size = 8,
  rings = 2,
  maxScale = 3.2,
  period = 1900,
  active = true,
}: Readonly<{
  color: string;
  size?: number;
  rings?: number;
  maxScale?: number;
  period?: number;
  active?: boolean;
}>) {
  const reduce = useReduceMotion();
  const live = active && !reduce;
  const breathe = useLoop(1400, live);
  const scale = breathe.interpolate({ inputRange: [0, 0.5, 1], outputRange: [1, 1.22, 1] });

  const ripples = Array.from({ length: rings }, (_, i) => ({
    key: `ring-${i}`,
    delay: (period / rings) * i,
  }));

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      {live
        ? ripples.map((ripple) => (
            <RippleRing
              key={ripple.key}
              color={color}
              size={size}
              delay={ripple.delay}
              duration={period}
              maxScale={maxScale}
            />
          ))
        : null}
      <Animated.View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: color,
          transform: [{ scale: live ? scale : 1 }],
        }}
      />
    </View>
  );
}

/** Audio-meter bars bouncing out of phase — the "working" heartbeat of a row. */
export function Equalizer({
  color,
  bars = 4,
  height = 14,
  barWidth = 3,
  gap = 2,
  active = true,
}: Readonly<{
  color: string;
  bars?: number;
  height?: number;
  barWidth?: number;
  gap?: number;
  active?: boolean;
}>) {
  const reduce = useReduceMotion();
  // Each bar carries a stable key alongside its value for the life of the mount.
  const [meters] = useState(() =>
    Array.from({ length: bars }, (_, i) => ({
      key: `bar-${i}`,
      value: new Animated.Value(0.4),
    })),
  );

  useEffect(() => {
    if (!active || reduce) {
      meters.forEach(({ value }) => value.setValue(0.6));
      return;
    }
    const running = meters.map(({ value: v }, i) => {
      const d = 340 + ((i * 97) % 240);
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(v, { toValue: 1, duration: d, easing: EASE_IN_OUT, useNativeDriver: ND }),
          Animated.timing(v, {
            toValue: 0.22,
            duration: d * 1.2,
            easing: EASE_IN_OUT,
            useNativeDriver: ND,
          }),
        ]),
      );
      const t = setTimeout(() => loop.start(), i * 120);
      return { loop, t };
    });
    return () =>
      running.forEach(({ loop, t }) => {
        clearTimeout(t);
        loop.stop();
      });
  }, [active, reduce, meters]);

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap, height }}>
      {meters.map((meter) => (
        <Animated.View
          key={meter.key}
          style={{
            width: barWidth,
            height,
            borderRadius: barWidth / 2,
            backgroundColor: color,
            transform: [{ scaleY: meter.value }],
          }}
        />
      ))}
    </View>
  );
}

/**
 * Text whose letters light up in a travelling wave. Each letter is its own
 * opacity-only (native-driven) view, so it costs nothing on the JS thread.
 */
export function WaveText({
  text,
  type = 'callout',
  style,
  active = true,
  low = 0.38,
  duration = 1800,
}: Readonly<{
  text: string;
  type?: ThemedTextType;
  style?: StyleProp<TextStyle>;
  active?: boolean;
  low?: number;
  duration?: number;
}>) {
  const reduce = useReduceMotion();
  const live = active && !reduce;
  const p = useLoop(duration, live);
  const chars = Array.from(text);
  const n = Math.max(1, chars.length - 1);

  if (!live) {
    return (
      <ThemedText type={type} style={style}>
        {text}
      </ThemedText>
    );
  }

  return (
    <View style={{ flexDirection: 'row', flexShrink: 1 }}>
      {chars.map((ch, i) => {
        const o = (i / n) * 0.5;
        const opacity = p.interpolate({
          inputRange: [0, o, o + 0.2, o + 0.4, 1],
          outputRange: [low, low, 1, low, low],
          extrapolate: 'clamp',
        });
        return (
          <Animated.View key={`${i}-${ch}`} style={{ opacity }}>
            <ThemedText type={type} style={style}>
              {ch === ' ' ? ' ' : ch}
            </ThemedText>
          </Animated.View>
        );
      })}
    </View>
  );
}

/** A soft band of light that travels across its parent, over and over. */
export function Sweep({
  color,
  duration = 2400,
  bandWidth = 0.55,
  active = true,
  style,
}: Readonly<{
  /** `#RRGGBB` — the band's peak colour (alpha is applied here). */
  color: string;
  duration?: number;
  /** fraction of the parent's width */
  bandWidth?: number;
  active?: boolean;
  style?: StyleProp<ViewStyle>;
}>) {
  const reduce = useReduceMotion();
  const live = active && !reduce;
  const [w, setW] = useState(0);
  const p = useLoop(duration, live && w > 0);
  const band = w * bandWidth;
  const translateX = p.interpolate({ inputRange: [0, 1], outputRange: [-band, w] });

  if (!live) return null;

  return (
    <View
      pointerEvents="none"
      onLayout={(e) => setW(e.nativeEvent.layout.width)}
      style={[StyleSheet.absoluteFill, { overflow: 'hidden' }, style]}>
      {w > 0 ? (
        <Animated.View
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            width: band,
            transform: [{ translateX }],
          }}>
          <LinearGradient
            colors={[withAlpha(color, 0), color, withAlpha(color, 0)]}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={{ flex: 1 }}
          />
        </Animated.View>
      ) : null}
    </View>
  );
}

/** A border that breathes — drawn as an opacity-animated overlay (native-driven). */
export function BreathingBorder({
  color,
  radius = 12,
  width = 1,
  active = true,
}: Readonly<{
  color: string;
  radius?: number;
  width?: number;
  active?: boolean;
}>) {
  const reduce = useReduceMotion();
  const live = active && !reduce;
  const p = useLoop(2600, live);
  const opacity = p.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.25, 0.85, 0.25] });
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        borderRadius: radius,
        borderWidth: width,
        borderColor: color,
        opacity: live ? opacity : 0.5,
      }}
    />
  );
}

// ---------- rings ----------

/**
 * A determinate progress ring built from two clipped half-rings, so it needs
 * no SVG dependency. `progress` is 0–1; changes sweep smoothly.
 */
export function ProgressRing({
  progress,
  size = 28,
  stroke = 3,
  color,
  trackColor,
  duration = 900,
  animated = true,
  children,
}: Readonly<{
  progress: number;
  size?: number;
  stroke?: number;
  color: string;
  trackColor: string;
  duration?: number;
  /** false → no sweep: the ring just shows the value */
  animated?: boolean;
  children?: ReactNode;
}>) {
  const reduce = useReduceMotion();
  const clamp = (v: number) => Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));
  const [p] = useState(() => new Animated.Value(animated ? 0 : clamp(progress)));

  useEffect(() => {
    const target = clamp(progress);
    if (reduce || !animated) {
      p.setValue(target);
      return;
    }
    const anim = Animated.timing(p, {
      toValue: target,
      duration,
      easing: curve,
      useNativeDriver: ND,
    });
    anim.start();
    return () => anim.stop();
  }, [progress, reduce, animated, duration, p]);

  const half = size / 2;
  // A half-ring's coloured arc spans −45°…135°; turning it by r shows the arc
  // up to (r + 135°). The right half owns 0–50%, the left half 50–100%.
  const rightRot = p.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: ['-135deg', '45deg', '45deg'],
  });
  const leftRot = p.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: ['45deg', '45deg', '225deg'],
  });

  const arc = {
    position: 'absolute' as const,
    width: size,
    height: size,
    borderRadius: half,
    borderWidth: stroke,
    borderColor: 'transparent',
    borderTopColor: color,
    borderRightColor: color,
  };

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View
        style={{
          position: 'absolute',
          width: size,
          height: size,
          borderRadius: half,
          borderWidth: stroke,
          borderColor: trackColor,
        }}
      />
      <View
        style={{ position: 'absolute', left: half, top: 0, width: half, height: size, overflow: 'hidden' }}>
        <Animated.View style={[arc, { left: -half, top: 0, transform: [{ rotate: rightRot }] }]} />
      </View>
      <View
        style={{ position: 'absolute', left: 0, top: 0, width: half, height: size, overflow: 'hidden' }}>
        <Animated.View style={[arc, { left: 0, top: 0, transform: [{ rotate: leftRot }] }]} />
      </View>
      {children}
    </View>
  );
}

/** An indeterminate comet orbiting a circle — drawn around a button while work runs. */
export function SpinnerRing({
  size = 36,
  stroke = 2,
  color,
  duration = 1100,
  active = true,
}: Readonly<{
  size?: number;
  stroke?: number;
  /** `#RRGGBB` */
  color: string;
  duration?: number;
  active?: boolean;
}>) {
  const reduce = useReduceMotion();
  const live = active && !reduce;
  const p = useLoop(duration, live);
  if (!active) return null;
  const rotate = p.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        width: size,
        height: size,
        borderRadius: size / 2,
        borderWidth: stroke,
        borderColor: 'transparent',
        borderTopColor: color,
        borderRightColor: withAlpha(color, 0.35),
        transform: [{ rotate: live ? rotate : '0deg' }],
      }}
    />
  );
}

// ---------- numbers ----------

/** A number that counts up (or down) to its value. */
export function AnimatedNumber({
  value,
  format = fmtInt,
  duration = 900,
  type = 'body',
  weight,
  style,
}: Readonly<{
  value: number;
  format?: (n: number) => string;
  duration?: number;
  type?: ThemedTextType;
  weight?: 'regular' | 'medium' | 'semibold' | 'bold';
  style?: StyleProp<TextStyle>;
}>) {
  const reduce = useReduceMotion();
  const [anim] = useState(() => new Animated.Value(0));
  const [shown, setShown] = useState(() => (reduce ? value : 0));

  useEffect(() => {
    const id = anim.addListener(({ value: v }) => setShown(v));
    return () => anim.removeListener(id);
  }, [anim]);

  useEffect(() => {
    if (reduce) {
      anim.setValue(value);
      setShown(value);
      return;
    }
    const run = Animated.timing(anim, {
      toValue: value,
      duration,
      easing: curve,
      useNativeDriver: false,
    });
    run.start();
    return () => run.stop();
  }, [value, duration, reduce, anim]);

  return (
    <ThemedText type={type} weight={weight} style={[{ fontVariant: ['tabular-nums'] }, style]}>
      {format(shown)}
    </ThemedText>
  );
}
