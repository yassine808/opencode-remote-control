import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { FolderGlyph, PressableScale, StatusDot } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { SessionInfo } from '@/lib/types';

export function basename(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

export function relativeTime(ms: number): string {
  const delta = Date.now() - ms;
  if (delta < 60_000) return 'now';
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h ago`;
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function SessionCard({
  session,
  running,
  pending,
  onPress,
}: {
  session: SessionInfo;
  running: boolean;
  pending: number;
  onPress: () => void;
}) {
  const theme = useTheme();
  const title = session.title?.trim() || 'Untitled session';
  const project = basename(session.location?.directory ?? '');
  const updated = session.time?.updated ?? session.time?.created ?? Date.now();

  // State drives the left rail: amber = needs you, cyan = working, none = idle.
  const rail = pending > 0 ? theme.warnSolid : running ? theme.running : 'transparent';

  let status: { text: string; color: string; dot?: boolean; pulse?: boolean } | null = null;
  if (pending > 0) {
    status = {
      text: pending > 1 ? `${pending} approvals waiting` : 'Waiting for your approval',
      color: theme.warn,
      dot: true,
      pulse: true,
    };
  } else if (running) {
    status = { text: 'Working…', color: theme.running, dot: true, pulse: true };
  } else if (session.outcome === 'failed') {
    status = { text: 'Last turn failed', color: theme.danger };
  }

  return (
    <PressableScale
      onPress={onPress}
      scaleTo={0.985}
      accessibilityLabel={`${title}. ${project}. ${status?.text ?? 'Idle'}. Updated ${relativeTime(updated)}`}
      style={[styles.card, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
      <View style={[styles.rail, { backgroundColor: rail }]} />
      <View style={styles.body}>
        <View style={styles.top}>
          <ThemedText type="smallBold" style={styles.title} numberOfLines={1}>
            {title}
          </ThemedText>
          <ThemedText type="caption" themeColor="textTertiary">
            {relativeTime(updated)}
          </ThemedText>
        </View>

        <View style={styles.meta}>
          <FolderGlyph color={theme.textTertiary} />
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={1} style={styles.project}>
            {project || 'No folder'}
          </ThemedText>
          {session.model?.id ? (
            <View style={[styles.model, { backgroundColor: theme.backgroundSelected }]}>
              <ThemedText type="caption" themeColor="textSecondary" numberOfLines={1}>
                {session.model.id}
              </ThemedText>
            </View>
          ) : null}
        </View>

        {status ? (
          <View style={styles.status}>
            {status.dot ? <StatusDot color={status.color} pulse={status.pulse} size={7} /> : null}
            <ThemedText type="small" style={{ color: status.color, fontWeight: '600' }}>
              {status.text}
            </ThemedText>
          </View>
        ) : null}
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    borderRadius: Radius.large,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  rail: { width: 4 },
  body: { flex: 1, padding: Spacing.three, gap: Spacing.two },
  top: { flexDirection: 'row', alignItems: 'baseline', gap: Spacing.two },
  title: { flex: 1, fontSize: 16, lineHeight: 22 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  project: { flexShrink: 1 },
  model: { borderRadius: Radius.pill, paddingHorizontal: 8, paddingVertical: 2, flexShrink: 1, marginLeft: 4 },
  status: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, marginTop: 2 },
});
