/**
 * "The agent is working" — and what on.
 *
 * An icon that matches the activity (brain for thinking,
 * terminal for a shell, pencil for writing, page for reading, magnifier for
 * searching…) with its own small motion — no circle, no box. Next to it: the activity as a travelling wave of light,
 * the stopwatch, and a hairline with a light running along it. The wording
 * escalates as the wait grows, so a long wait never looks stuck.
 */

import { useEffect, useState } from 'react';
import { Animated, View } from 'react-native';

import { WaveText, useLoop } from '@/components/motion';
import { ThemedText } from '@/components/themed-text';
import { Glyph, useReduceMotion } from '@/components/ui';
import { Fonts } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { fmtElapsed } from '@/lib/format';

type Motion = 'breathe' | 'blink' | 'wiggle' | 'bob' | 'spin';

interface Look {
  set: 'ionicons' | 'mci';
  icon: string;
  motion: Motion;
}

/** The icon + motion for an activity label. */
function lookFor(activity: string): Look {
  const a = activity.toLowerCase();
  if (a.includes('think')) return { set: 'mci', icon: 'brain', motion: 'breathe' };
  if (a.includes('command') || a.includes('shell') || a.includes('bash'))
    return { set: 'ionicons', icon: 'terminal', motion: 'blink' };
  if (a.includes('writ') || a.includes('edit'))
    return { set: 'ionicons', icon: 'create', motion: 'wiggle' };
  if (a.includes('read')) return { set: 'ionicons', icon: 'document-text', motion: 'bob' };
  if (a.includes('web')) return { set: 'ionicons', icon: 'globe', motion: 'spin' };
  if (a.includes('search')) return { set: 'ionicons', icon: 'search', motion: 'wiggle' };
  if (a.includes('subagent')) return { set: 'ionicons', icon: 'git-branch', motion: 'breathe' };
  if (a.includes('plan')) return { set: 'ionicons', icon: 'checkbox', motion: 'breathe' };
  if (a.includes('answer') || a.includes('question'))
    return { set: 'ionicons', icon: 'help-circle', motion: 'bob' };
  return { set: 'ionicons', icon: 'sparkles', motion: 'breathe' };
}

/** Just the icon — no circle, no halo — with a motion that says what it is doing. */
function ActivityIcon({ activity }: Readonly<{ activity: string }>) {
  const theme = useTheme();
  const reduce = useReduceMotion();
  const look = lookFor(activity);
  const loop = useLoop(look.motion === 'spin' ? 2400 : 1300, !reduce);

  const motion: Record<Motion, object> = {
    breathe: {
      opacity: loop.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.45, 1, 0.45] }),
    },
    blink: {
      opacity: loop.interpolate({ inputRange: [0, 0.45, 0.5, 0.95, 1], outputRange: [1, 1, 0.25, 0.25, 1] }),
    },
    wiggle: {
      transform: [
        {
          rotate: loop.interpolate({
            inputRange: [0, 0.25, 0.5, 0.75, 1],
            outputRange: ['0deg', '-16deg', '0deg', '16deg', '0deg'],
          }),
        },
      ],
    },
    bob: {
      transform: [
        { translateY: loop.interpolate({ inputRange: [0, 0.5, 1], outputRange: [2.5, -2.5, 2.5] }) },
      ],
    },
    spin: {
      transform: [
        { rotate: loop.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) },
      ],
    },
  };

  return (
    <View style={{ width: 24, height: 24, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View style={reduce ? undefined : motion[look.motion]}>
        <Glyph set={look.set} name={look.icon} size={21} color={theme.clay} />
      </Animated.View>
    </View>
  );
}

export function escalationLabel(activity: string, elapsedMs: number): string {
  const what = activity || 'Working';
  if (elapsedMs < 10_000) return what;
  if (elapsedMs < 20_000) return `${what} — still going`;
  if (elapsedMs < 45_000) return `${what} — this one's taking a while`;
  return `${what} — still working, Stop is available`;
}

export function WorkingIndicator({ activity, since }: Readonly<{ activity: string; since: number }>) {
  const theme = useTheme();
  // A ticking clock; the label is derived from it, so a change in activity
  // lands on the very next render instead of waiting for a timer.
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const elapsed = now - since;

  return (
    <View
      accessible
      accessibilityLabel={escalationLabel(activity || 'Working', elapsed)}
      accessibilityLiveRegion="polite"
      style={{ flexDirection: 'row', alignItems: 'center', gap: 12, alignSelf: 'flex-start' }}>
      <ActivityIcon activity={activity || 'Working'} />

      <View>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
          <WaveText
            text={activity || 'Working'}
            type="callout"
            style={{ color: theme.ink, fontFamily: Fonts.semibold }}
          />
          <ThemedText
            type="caption"
            style={{ color: theme.inkFaint, fontVariant: ['tabular-nums'] }}>
            {fmtElapsed(elapsed)}
          </ThemedText>
        </View>
      </View>
    </View>
  );
}
