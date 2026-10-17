/**
 * "The agent is working" — and, more importantly, what on.
 *
 * The pulse is a heartbeat, not a spinner: measured off claude.ai's shipping
 * keyframes, a 1.8s cycle that rises fast, holds bright briefly, then decays
 * slowly and rests dim. The asymmetry is the entire effect — a sine wave
 * reads mechanical.
 *
 * The words matter more than the motion: the label names the activity, and
 * escalates as the wait grows rather than sitting still and looking stuck.
 */

import { useEffect, useRef, useState } from 'react';
import { Animated, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useReduceMotion } from '@/components/ui';
import { useTheme } from '@/hooks/use-theme';

const CYCLE = 1800;

function easeOutQuart(x: number): number {
  return 1 - Math.pow(1 - x, 4);
}

/** t in [0,1) → opacity. Rise 0–10%, hold 10–25%, decay 25–65%, rest dim. */
function pulse(t: number): number {
  if (t < 0.1) return 0.3 + 0.7 * easeOutQuart(t / 0.1);
  if (t < 0.25) return 1;
  if (t < 0.65) return 1 - 0.7 * easeOutQuart((t - 0.25) / 0.4);
  return 0.3;
}

export function escalationLabel(activity: string, elapsedMs: number): string {
  const what = activity || 'Working';
  if (elapsedMs < 10_000) return what;
  if (elapsedMs < 20_000) return `${what} — still going`;
  if (elapsedMs < 45_000) return `${what} — this one's taking a while`;
  return `${what} — still working, Stop is available`;
}

export function WorkingIndicator({ activity, since }: { activity: string; since: number }) {
  const theme = useTheme();
  const reduce = useReduceMotion();
  const opacity = useRef(new Animated.Value(0.3)).current;
  const [label, setLabel] = useState(() => escalationLabel(activity, Date.now() - since));

  // The heartbeat. requestAnimationFrame keeps it smooth on web; on native
  // it's a 7pt dot, so JS-thread ticks are plenty.
  useEffect(() => {
    if (reduce) {
      opacity.setValue(0.85);
      return;
    }
    let raf = 0;
    const start = Date.now();
    const tick = () => {
      const t = ((Date.now() - start) % CYCLE) / CYCLE;
      opacity.setValue(pulse(t));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [reduce, opacity]);

  // Escalating copy — re-evaluated every second so the sentence keeps up.
  useEffect(() => {
    setLabel(escalationLabel(activity, Date.now() - since));
    const timer = setInterval(() => {
      setLabel(escalationLabel(activity, Date.now() - since));
    }, 1000);
    return () => clearInterval(timer);
  }, [activity, since]);

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <Animated.View
        style={{
          width: 7,
          height: 7,
          borderRadius: 3.5,
          backgroundColor: theme.clay,
          opacity,
        }}
      />
      <ThemedText type="callout" style={{ color: theme.inkMuted, flexShrink: 1 }}>
        {label}
      </ThemedText>
    </View>
  );
}
