/**
 * The app's primitive set, matched to the design's control language:
 * buttons are 48pt tall with radius 8, primary action is a solid fill
 * (clay for permission, violet accent for confirmations), secondary is a
 * hairline stroke. Feedback never exceeds 200ms.
 */

import Ionicons from '@expo/vector-icons/Ionicons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useEffect, useState, type ReactNode } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  Easing,
  Platform,
  Pressable,
  type StyleProp,
  type TextStyle,
  View,
  type ViewStyle,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Motion, Radius } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

// ---------- motion ----------

export function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false);

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => {
        if (mounted) setReduce(v);
      })
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', (v) => setReduce(v));
    return () => {
      mounted = false;
      sub?.remove?.();
    };
  }, []);

  return reduce;
}

/**
 * The same preference, plus whether the initial value is known. Launch motion
 * must not start on the default `false` and then discover `true` a frame later:
 * that reads as a twitch rather than a skipped animation.
 */
export function useReduceMotionState(): { reduce: boolean; ready: boolean } {
  const [reduce, setReduce] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let mounted = true;
    let settled = false;

    const settle = (value: boolean) => {
      if (!mounted) return;
      settled = true;
      setReduce(value);
      setReady(true);
    };

    // A platform that never answers must not hold the launch surface forever.
    const fallback = setTimeout(() => {
      if (mounted && !settled) setReady(true);
    }, 500);

    AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => {
        settled = true;
        clearTimeout(fallback);
        settle(v);
      })
      .catch(() => {
        settled = true;
        clearTimeout(fallback);
        settle(false);
      });

    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', (v) => {
      settled = true;
      clearTimeout(fallback);
      settle(v);
    });

    return () => {
      mounted = false;
      clearTimeout(fallback);
      sub?.remove?.();
    };
  }, []);

  return { reduce, ready };
}

// ---------- press feedback ----------

export function PressableScale({
  onPress,
  onLongPress,
  disabled,
  style,
  children,
  scaleTo = 0.96,
  accessibilityLabel,
  accessibilityRole,
  accessibilityState,
  accessibilityHint,
  hitSlop,
  testID,
}: Readonly<{
  onPress?: () => void;
  onLongPress?: () => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
  scaleTo?: number;
  accessibilityLabel?: string;
  accessibilityRole?: 'button' | 'link' | 'imagebutton';
  accessibilityState?: { disabled?: boolean; selected?: boolean; busy?: boolean; expanded?: boolean };
  accessibilityHint?: string;
  hitSlop?: number;
  testID?: string;
}>) {
  const [scale] = useState(() => new Animated.Value(1));

  const to = (value: number) =>
    Animated.timing(scale, {
      toValue: value,
      duration: 120,
      easing: Easing.bezier(...Motion.curve),
      useNativeDriver: Platform.OS !== 'web',
    }).start();

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      onPressIn={() => to(scaleTo)}
      onPressOut={() => to(1)}
      disabled={disabled}
      hitSlop={hitSlop}
      testID={testID}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole={accessibilityRole ?? 'button'}
      accessibilityHint={accessibilityHint}
      accessibilityState={accessibilityState}>
      <Animated.View
        style={[
          style,
          {
            transform: [{ scale }],
            opacity: disabled ? 0.4 : 1,
          },
        ]}>
        {children}
      </Animated.View>
    </Pressable>
  );
}

// ---------- button ----------

export type ButtonVariant = 'primary' | 'accent' | 'secondary';

export function Button({
  children,
  onPress,
  variant = 'primary',
  disabled,
  style,
  accessibilityLabel,
  busy,
}: Readonly<{
  children: string;
  onPress?: () => void;
  /** primary = clay fill · accent = violet fill · secondary = hairline stroke */
  variant?: ButtonVariant;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  busy?: boolean;
}>) {
  const theme = useTheme();

  const fills = { primary: theme.clay, accent: theme.accent, secondary: 'transparent' };
  const bg = fills[variant];
  const fg = variant === 'secondary' ? theme.ink : theme.onAccent;

  return (
    <PressableScale
      onPress={disabled || busy ? undefined : onPress}
      disabled={disabled}
      accessibilityLabel={accessibilityLabel ?? children}
      accessibilityState={{ disabled: !!disabled, busy: !!busy }}
      style={[
        {
          height: 48,
          borderRadius: Radius.control,
          alignItems: 'center',
          justifyContent: 'center',
          paddingHorizontal: 18,
          backgroundColor: bg,
          borderWidth: variant === 'secondary' ? 1 : 0,
          borderColor: theme.hairline,
        },
        style,
      ]}>
      {busy ? (
        <ActivityIndicator color={fg} />
      ) : (
        <ThemedText
          type="body"
          weight="semibold"
          style={{ color: fg }}
          numberOfLines={1}>
          {children}
        </ThemedText>
      )}
    </PressableScale>
  );
}

// ---------- dot ----------

export function StatusDot({
  color,
  size = 10,
  style,
}: Readonly<{
  color: string;
  size?: number;
  style?: StyleProp<ViewStyle>;
}>) {
  return (
    <View
      style={[
        { width: size, height: size, borderRadius: size / 2, backgroundColor: color },
        style,
      ]}
    />
  );
}

// ---------- icon ----------

/**
 * SF Symbols don't exist outside Apple platforms; these are the closest
 * cross-platform glyphs (Ionicons for UI verbs, MaterialCommunityIcons for
 * the few shapes Ionicons lacks — brain, wrench, clock).
 */
export function Glyph({
  set = 'ionicons',
  name,
  size = 17,
  color,
  style,
}: Readonly<{
  set?: 'ionicons' | 'mci';
  name: string;
  size?: number;
  color?: string;
  style?: StyleProp<TextStyle>;
}>) {
  const theme = useTheme();
  const Cmp: any = set === 'mci' ? MaterialCommunityIcons : Ionicons;
  return <Cmp name={name} size={size} color={color ?? theme.ink} style={style} />;
}
