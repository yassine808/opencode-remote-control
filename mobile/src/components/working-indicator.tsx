/**
 * "The agent is working" — and what on.
 *
 * A card with an icon badge that matches the activity (brain for thinking,
 * terminal for a shell, pencil for writing, page for reading, magnifier for
 * searching…). The badge has a soft halo that breathes and the icon has its
 * own small motion. Next to it: the activity as a travelling wave of light,
 * the stopwatch, and a hairline with a light running along it. The wording
 * escalates as the wait grows, so a long wait never looks stuck.
 */

import { useEffect, useState } from 'react';
import { Animated, View } from 'react-native';

import { FadeRise, Sweep, WaveText, useLoop, withAlpha } from '@/components/motion';
import { ThemedText } from '@/components/themed-text';
import { Glyph, useReduceMotion } from '@/components/ui';
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

function ActivityBadge({ activity }: { activity: string }) {
  const theme = useTheme();
  const reduce = useReduceMotion();
  const look = lookFor(activity);
  const loop = useLoop(look.motion === 'spin' ? 2400 : 1400, !reduce);
  const halo = useLoop(1800, !reduce);

  const haloScale = halo.interpolate({ inputRange: [0, 1], outputRange: [1, 1.7] });
  const haloOpacity = halo.interpolate({ inputRange: [0, 0.2, 1], outputRange: [0, 0.35, 0] });

  const motion: Record<Motion, object> = {
    breathe: {
      transform: [
        { scale: loop.interpolate({ inputRange: [0, 0.5, 1], outputRange: [1, 1.18, 1] }) },
      ],
    },
    blink: {
      opacity: loop.interpolate({ inputRange: [0, 0.5, 0.51, 1], outputRange: [1, 1, 0.35, 0.35] }),
    },
    wiggle: {
      transform: [
        {
          rotate: loop.interpolate({
            inputRange: [0, 0.25, 0.5, 0.75, 1],
            outputRange: ['0deg', '-14deg', '0deg', '14deg', '0deg'],
          }),
        },
      ],
    },
    bob: {
      transform: [
        { translateY: loop.interpolate({ inputRange: [0, 0.5, 1], outputRange: [1.5, -1.5, 1.5] }) },
      ],
    },
    spin: {
      transform: [
        { rotate: loop.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) },
      ],
    },
  };

  return (
    <View style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center' }}>
      {!reduce ? (
        <Animated.View
          style={{
            position: 'absolute',
            width: 36,
            height: 36,
            borderRadius: 18,
            backgroundColor: theme.clay,
            opacity: haloOpacity,
            transform: [{ scale: haloScale }],
          }}
        />
      ) : null}
      <View
        style={{
          width: 36,
          height: 36,
          borderRadius: 18,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: withAlpha(theme.clay, 0.16),
          borderWidth: 1,
          borderColor: withAlpha(theme.clay, 0.35),
        }}>
        <Animated.View style={reduce ? undefined : motion[look.motion]}>
          <Glyph set={look.set} name={look.icon} size={17} color={theme.clay} />
        </Animated.View>
      </View>
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

function escalationNote(elapsedMs: number): string | null {
  if (elapsedMs < 10_000) return null;
  if (elapsedMs < 20_000) return 'Still going';
  if (elapsedMs < 45_000) return "This one's taking a while";
  return 'Still working — Stop is available';
}

export function WorkingIndicator({ activity, since }: { activity: string; since: number }) {
  const theme = useTheme();
  // A ticking clock; the label is derived from it, so a change in activity
  // lands on the very next render instead of waiting for a timer.
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const elapsed = now - since;
  const note = escalationNote(elapsed);

  return (
    <View
      accessible
      accessibilityLabel={escalationLabel(activity || 'Working', elapsed)}
      accessibilityLiveRegion="polite"
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        alignSelf: 'flex-start',
        maxWidth: '100%',
        paddingVertical: 10,
        paddingLeft: 10,
        paddingRight: 16,
        borderRadius: 18,
        backgroundColor: theme.surface,
        borderWidth: 1,
        borderColor: theme.hairline,
      }}>
      <ActivityBadge activity={activity || 'Working'} />

      <View style={{ gap: 5, flexShrink: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
          <WaveText
            text={activity || 'Working'}
            type="callout"
            style={{ color: theme.ink }}
          />
          <ThemedText
            type="caption"
            style={{ color: theme.inkFaint, fontVariant: ['tabular-nums'] }}>
            {fmtElapsed(elapsed)}
          </ThemedText>
        </View>

        <View
          style={{
            width: 132,
            height: 2,
            borderRadius: 1,
            overflow: 'hidden',
            backgroundColor: theme.inkWell,
          }}>
          <Sweep color={withAlpha(theme.clay, 0.9)} duration={1700} bandWidth={0.45} />
        </View>

        {note ? (
          <FadeRise key={note} distance={4} duration={260}>
            <ThemedText type="caption" style={{ color: theme.inkMuted }}>
              {note}
            </ThemedText>
          </FadeRise>
        ) : null}
      </View>
    </View>
  );
}
