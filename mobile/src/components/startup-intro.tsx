/**
 * Startup intro — the launcher mark opens into a terminal window.
 *
 * The native splash paints the `>_` prompt on OpenCode blue. This overlay
 * starts at exactly that prompt's size and colour, grows the glass terminal
 * frame around it, blinks the cursor, then fades into the app. It is a launch
 * surface, not a screen: no text, no controls, and it never loops.
 */

import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useState } from 'react';
import {
  Animated,
  StatusBar,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';

import { ND, curve, withAlpha } from '@/components/motion';
import { useReduceMotionState } from '@/components/ui';
import { Brand } from '@/constants/theme';

/**
 * The splash plugin renders `splash-icon.png` at 140dp. The prompt's opaque
 * bounds are 588×428 in a 1024 square, so it lands at ~80.4×58.5dp. Starting
 * the in-app mark at that width makes the hand-off from the native splash
 * invisible.
 */
const SPLASH_PROMPT_WIDTH = 80.4;

/** The prompt group's aspect ratio: 372 / 510 from the icon geometry. */
const PROMPT_RATIO = 372 / 510;

const pct = (value: number): `${number}%` => `${value}%`;

export function StartupIntro({ onFinish }: Readonly<{ onFinish: () => void }>) {
  const { reduce, ready: motionReady } = useReduceMotionState();
  const { width } = useWindowDimensions();

  const frameSize = Math.min(width * 0.72, 320);
  const markWidth = frameSize * 0.66;
  const markHeight = markWidth * PROMPT_RATIO;
  const initialScale = SPLASH_PROMPT_WIDTH / markWidth;

  const [overlayOpacity] = useState(() => new Animated.Value(1));
  const [gradientOpacity] = useState(() => new Animated.Value(0));
  const [gridOpacity] = useState(() => new Animated.Value(0));
  const [frameOpacity] = useState(() => new Animated.Value(0));
  const [frameScale] = useState(() => new Animated.Value(0.62));
  const [promptScale] = useState(() => new Animated.Value(initialScale));
  const [cursorOpacity] = useState(() => new Animated.Value(1));

  useEffect(() => {
    // Hold the splash-coloured prompt until the platform answers. Starting on
    // the default `false` would animate for a frame under reduced motion.
    if (!motionReady) return;
    if (reduce) {
      onFinish();
      return;
    }

    let done = false;
    let fallback: ReturnType<typeof setTimeout> | undefined;
    const finish = () => {
      if (done) return;
      done = true;
      if (fallback) clearTimeout(fallback);
      onFinish();
    };

    const animation = Animated.parallel([
      Animated.timing(gradientOpacity, {
        toValue: 1,
        duration: 600,
        easing: curve,
        useNativeDriver: ND,
      }),
      Animated.timing(gridOpacity, {
        toValue: 1,
        duration: 650,
        easing: curve,
        useNativeDriver: ND,
      }),
      Animated.timing(frameOpacity, {
        toValue: 1,
        duration: 320,
        delay: 80,
        easing: curve,
        useNativeDriver: ND,
      }),
      Animated.timing(frameScale, {
        toValue: 1,
        duration: 560,
        easing: curve,
        useNativeDriver: ND,
      }),
      Animated.timing(promptScale, {
        toValue: 1,
        duration: 560,
        easing: curve,
        useNativeDriver: ND,
      }),
      Animated.sequence([
        Animated.delay(520),
        Animated.timing(cursorOpacity, {
          toValue: 0,
          duration: 90,
          useNativeDriver: ND,
        }),
        Animated.timing(cursorOpacity, {
          toValue: 1,
          duration: 120,
          useNativeDriver: ND,
        }),
        Animated.timing(cursorOpacity, {
          toValue: 0,
          duration: 90,
          useNativeDriver: ND,
        }),
        Animated.timing(cursorOpacity, {
          toValue: 1,
          duration: 120,
          useNativeDriver: ND,
        }),
      ]),
      Animated.sequence([
        Animated.delay(1040),
        Animated.timing(overlayOpacity, {
          toValue: 0,
          duration: 280,
          easing: curve,
          useNativeDriver: ND,
        }),
      ]),
    ]);

    animation.start(({ finished }) => {
      if (finished) finish();
    });

    // A paused native animation must never leave the launch surface covering
    // the app lock. The fallback is well past the 1.32s choreography.
    fallback = setTimeout(finish, 2200);

    return () => {
      if (fallback) clearTimeout(fallback);
      animation.stop();
    };
  }, [
    cursorOpacity,
    frameOpacity,
    frameScale,
    gradientOpacity,
    gridOpacity,
    motionReady,
    onFinish,
    overlayOpacity,
    promptScale,
    reduce,
  ]);

  if (motionReady && reduce) return null;

  const dotSize = Math.max(3, frameSize * 0.016);
  const dotGap = Math.max(4, dotSize * 1.6);
  const liveDotSize = Math.max(4, frameSize * 0.024);
  const dotTop = frameSize * 0.09;

  return (
    <Animated.View
      accessibilityViewIsModal
      style={[styles.overlay, { opacity: overlayOpacity }]}>
      <StatusBar barStyle="light-content" />

      <Animated.View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, { opacity: gradientOpacity }]}>
        <LinearGradient
          colors={[Brand.blueLight, Brand.blue, Brand.blueDeep]}
          locations={[0, 0.48, 1]}
          start={{ x: 0, y: 0 }}
          end={{ x: 0.85, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        <Animated.View
          style={[StyleSheet.absoluteFill, { opacity: gridOpacity }]}>
          <BlueprintGrid />
        </Animated.View>
      </Animated.View>

      <View style={styles.center}>
        <View
          style={{
            width: frameSize,
            height: frameSize,
            alignItems: 'center',
            justifyContent: 'center',
          }}>
          <Animated.View
            pointerEvents="none"
            style={[
              StyleSheet.absoluteFill,
              styles.frame,
              {
                borderRadius: frameSize * 0.22,
                opacity: frameOpacity,
                transform: [{ scale: frameScale }],
              },
            ]}>
            <View
              style={[
                styles.dots,
                {
                  top: dotTop,
                  left: dotTop,
                  gap: dotGap,
                },
              ]}>
              {[0, 1, 2].map((i) => (
                <View
                  key={i}
                  style={{
                    width: dotSize,
                    height: dotSize,
                    borderRadius: dotSize / 2,
                    backgroundColor: withAlpha(Brand.white, 0.45),
                  }}
                />
              ))}
            </View>
            <View
              style={{
                position: 'absolute',
                top: dotTop + (dotSize - liveDotSize) / 2,
                right: dotTop,
                width: liveDotSize,
                height: liveDotSize,
                borderRadius: liveDotSize / 2,
                backgroundColor: Brand.cyan,
              }}
            />
          </Animated.View>

          <Animated.View
            pointerEvents="none"
            style={{
              width: markWidth,
              height: markHeight,
              transform: [{ scale: promptScale }],
            }}>
            <PromptMark markWidth={markWidth} cursorOpacity={cursorOpacity} />
          </Animated.View>
        </View>
      </View>
    </Animated.View>
  );
}

function PromptMark({
  markWidth,
  cursorOpacity,
}: Readonly<{
  markWidth: number;
  cursorOpacity: Animated.Value;
}>) {
  // Coordinates are the icon's prompt group normalised to a 510×372 box:
  // chevron path (50,50) → (270,186) → (50,322), stroke 100; cursor from
  // (332,338) to (488,338), stroke 44.
  const s = markWidth / 510;
  const armWidth = Math.hypot(220, 136) * s;
  const armHeight = 100 * s;
  const armAngle = (Math.atan2(136, 220) * 180) / Math.PI;
  const armLeft = 160 * s - armWidth / 2;
  const topArmTop = 118 * s - armHeight / 2;
  const bottomArmTop = 254 * s - armHeight / 2;
  const cursorLeft = 332 * s;
  const cursorTop = 316 * s;
  const cursorWidth = 156 * s;
  const cursorHeight = 44 * s;

  return (
    <View style={StyleSheet.absoluteFill}>
      <LinearGradient
        colors={[Brand.white, Brand.blueMist]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[
          styles.arm,
          {
            left: armLeft,
            top: topArmTop,
            width: armWidth,
            height: armHeight,
            borderRadius: armHeight / 2,
            transform: [{ rotate: `${armAngle}deg` }],
          },
        ]}
      />
      <LinearGradient
        colors={[Brand.white, Brand.blueMist]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[
          styles.arm,
          {
            left: armLeft,
            top: bottomArmTop,
            width: armWidth,
            height: armHeight,
            borderRadius: armHeight / 2,
            transform: [{ rotate: `${-armAngle}deg` }],
          },
        ]}
      />
      <Animated.View
        style={{
          position: 'absolute',
          left: cursorLeft,
          top: cursorTop,
          width: cursorWidth,
          height: cursorHeight,
          borderRadius: cursorHeight / 2,
          backgroundColor: Brand.cyan,
          opacity: cursorOpacity,
        }}
      />
    </View>
  );
}

function BlueprintGrid() {
  const lines = Array.from({ length: 11 }, (_, i) => (i + 1) / 12);
  const cross = 12;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {lines.map((p) => (
        <View
          key={`v-${p}`}
          style={[
            styles.gridLine,
            {
              left: pct(p * 100),
              top: 0,
              bottom: 0,
              width: StyleSheet.hairlineWidth,
            },
          ]}
        />
      ))}
      {lines.map((p) => (
        <View
          key={`h-${p}`}
          style={[
            styles.gridLine,
            {
              top: pct(p * 100),
              left: 0,
              right: 0,
              height: StyleSheet.hairlineWidth,
            },
          ]}
        />
      ))}
      {[0.25, 0.75].map((x) =>
        [0.25, 0.75].map((y) => (
          <View
            key={`c-${x}-${y}`}
            style={{
              position: 'absolute',
              left: pct(x * 100),
              top: pct(y * 100),
              width: cross,
              height: cross,
              transform: [
                { translateX: -cross / 2 },
                { translateY: -cross / 2 },
              ],
            }}>
            <View
              style={[
                styles.gridLine,
                {
                  left: cross / 2,
                  top: 0,
                  width: StyleSheet.hairlineWidth,
                  height: cross,
                },
              ]}
            />
            <View
              style={[
                styles.gridLine,
                {
                  top: cross / 2,
                  left: 0,
                  width: cross,
                  height: StyleSheet.hairlineWidth,
                },
              ]}
            />
          </View>
        )),
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 100,
    backgroundColor: Brand.blue,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  frame: {
    borderWidth: 1,
    borderColor: withAlpha(Brand.white, 0.3),
    backgroundColor: withAlpha(Brand.glass, 0.13),
  },
  dots: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
  },
  arm: {
    position: 'absolute',
  },
  gridLine: {
    position: 'absolute',
    backgroundColor: withAlpha(Brand.white, 0.13),
  },
});
