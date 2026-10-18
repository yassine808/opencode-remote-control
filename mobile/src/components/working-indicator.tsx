/**
 * "The agent is working" — and, more importantly, what on.
 *
 * A sonar-pulsing dot, the activity name as a travelling wave of light, a
 * live stopwatch, and a hairline track with a light running along it. The
 * motion says "alive"; the words say what it is doing, and escalate as the
 * wait grows rather than sitting still and looking stuck.
 */

import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { FadeRise, PulseDot, Sweep, WaveText, withAlpha } from '@/components/motion';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { fmtElapsed } from '@/lib/format';

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
      style={{ gap: 6 }}
      accessible
      accessibilityLabel={escalationLabel(activity || 'Working', elapsed)}
      accessibilityLiveRegion="polite">
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{ width: 14, alignItems: 'center' }}>
          <PulseDot color={theme.clay} size={8} rings={2} />
        </View>
        <WaveText text={activity || 'Working'} type="callout" style={{ color: theme.inkMuted }} />
        <ThemedText
          type="caption"
          style={{ color: theme.inkFaint, fontVariant: ['tabular-nums'] }}>
          {fmtElapsed(elapsed)}
        </ThemedText>
      </View>

      <View
        style={{
          marginLeft: 24,
          width: 132,
          height: 2,
          borderRadius: 1,
          overflow: 'hidden',
          backgroundColor: theme.inkWell,
        }}>
        <Sweep color={withAlpha(theme.clay, 0.9)} duration={1700} bandWidth={0.45} />
      </View>

      {note ? (
        <FadeRise key={note} distance={4} duration={260} style={{ marginLeft: 24 }}>
          <ThemedText type="caption" style={{ color: theme.inkMuted }}>
            {note}
          </ThemedText>
        </FadeRise>
      ) : null}
    </View>
  );
}
