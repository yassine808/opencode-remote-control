import { Redirect, router, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { describeError } from '@/lib/api';
import { useConnection } from '@/lib/connection';
import { runEventStream, type StreamStatus } from '@/lib/events';
import type { SessionInfo } from '@/lib/types';

const LIST_REFRESH_EVENTS = new Set([
  'session.renamed',
  'session.execution.started',
  'session.execution.succeeded',
  'session.execution.failed',
  'session.inbox.enqueued',
  'session.inbox.delivered',
  'session.step.ended',
  'session.usage.updated',
]);

function basename(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

function relativeTime(ms: number): string {
  const delta = Date.now() - ms;
  if (delta < 60_000) return 'now';
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h`;
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default function SessionsScreen() {
  const theme = useTheme();
  const { ready, api, disconnect } = useConnection();
  const [sessions, setSessions] = useState<SessionInfo[] | null>(null);
  const [active, setActive] = useState<Record<string, { type: string }>>({});
  const [approvals, setApprovals] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [streamStatus, setStreamStatus] = useState<StreamStatus>('disconnected');
  const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(
    async (opts: { silent?: boolean } = {}) => {
      if (!api) return;
      if (!opts.silent) setRefreshing(true);
      try {
        const [list, act] = await Promise.all([api.sessions(50), api.activeSessions()]);
        // Approvals are location-scoped on the server, so gather per project directory.
        const directories = Array.from(
          new Set(
            list.data
              .map((s) => s.location?.directory)
              .filter((d): d is string => typeof d === 'string' && d.length > 0),
          ),
        );
        const perms = await Promise.all(directories.map((dir) => api.permissionRequestsAt(dir)));
        const sorted = [...list.data].sort((a, b) => {
          const aRun = act.data[a.id] ? 1 : 0;
          const bRun = act.data[b.id] ? 1 : 0;
          if (aRun !== bRun) return bRun - aRun;
          return (b.time?.updated ?? 0) - (a.time?.updated ?? 0);
        });
        setSessions(sorted);
        setActive(act.data);
        const counts: Record<string, number> = {};
        for (const res of perms) {
          for (const p of res.data) counts[p.sessionID] = (counts[p.sessionID] ?? 0) + 1;
        }
        setApprovals(counts);
        setError(null);
      } catch (err) {
        setError(describeError(err));
      } finally {
        if (!opts.silent) setRefreshing(false);
      }
    },
    [api],
  );

  useFocusEffect(
    useCallback(() => {
      if (!api) return;
      let alive = true;
      const ctrl = new AbortController();

      void load();

      const scheduleReload = () => {
        if (reloadTimer.current) return;
        reloadTimer.current = setTimeout(() => {
          reloadTimer.current = null;
          if (alive) void load({ silent: true });
        }, 500);
      };

      void runEventStream({
        baseUrl: api.baseUrl,
        token: api.token,
        signal: ctrl.signal,
        onStatus: (status) => {
          if (!alive) return;
          setStreamStatus(status);
          if (status === 'connected') scheduleReload();
        },
        onEvent: (event) => {
          if (alive && LIST_REFRESH_EVENTS.has(event.type)) scheduleReload();
        },
      });

      const poll = setInterval(() => {
        if (alive) void load({ silent: true });
      }, 15_000);

      return () => {
        alive = false;
        ctrl.abort();
        clearInterval(poll);
        if (reloadTimer.current) {
          clearTimeout(reloadTimer.current);
          reloadTimer.current = null;
        }
      };
    }, [api, load]),
  );

  if (!ready) return <ThemedView style={styles.screen} />;
  if (!api) return <Redirect href="/setup" />;

  const renderItem = ({ item }: { item: SessionInfo }) => {
    const running = Boolean(active[item.id]);
    const pending = approvals[item.id] ?? 0;
    return (
      <Pressable
        style={[styles.card, { backgroundColor: theme.backgroundElement }]}
        onPress={() => router.push({ pathname: '/session/[id]', params: { id: item.id } })}>
        <View style={styles.cardHeader}>
          <View style={[styles.dot, { backgroundColor: running ? '#3FB950' : theme.backgroundSelected }]} />
          <ThemedText type="smallBold" style={styles.cardTitle} numberOfLines={1}>
            {item.title?.trim() || 'Untitled session'}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {relativeTime(item.time?.updated ?? item.time?.created ?? Date.now())}
          </ThemedText>
        </View>
        <View style={styles.cardMeta}>
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={1} style={styles.cardMetaText}>
            {basename(item.location?.directory ?? '')}
            {item.model?.id ? ` · ${item.model.id}` : ''}
          </ThemedText>
          {running && (
            <ThemedText type="small" style={styles.runningText}>
              running
            </ThemedText>
          )}
        </View>
        {pending > 0 && (
          <View style={styles.badge}>
            <ThemedText type="small" style={styles.warnText}>
              ⚠ awaiting approval{pending > 1 ? ` (${pending})` : ''}
            </ThemedText>
          </View>
        )}
      </Pressable>
    );
  };

  return (
    <ThemedView style={styles.screen}>
      {streamStatus !== 'connected' && (
        <View style={[styles.statusStrip, { backgroundColor: theme.backgroundElement }]}>
          <ThemedText type="small" themeColor="textSecondary">
            {streamStatus === 'connecting' ? 'Connecting to PC…' : 'Live updates paused — reconnecting…'}
          </ThemedText>
        </View>
      )}
      {error && (
        <View style={[styles.statusStrip, styles.errorStrip]}>
          <ThemedText type="small" style={styles.errorText}>
            {error}
          </ThemedText>
        </View>
      )}
      {sessions === null ? (
        <View style={styles.center}>
          <ActivityIndicator color={theme.text} />
        </View>
      ) : (
        <FlatList
          data={sessions}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => void load()} tintColor={theme.text} />
          }
          ListEmptyComponent={
            <View style={styles.center}>
              <ThemedText type="small" themeColor="textSecondary" style={styles.centerText}>
                No sessions yet. Start OpenCode on the PC and open a session, then pull to refresh.
              </ThemedText>
            </View>
          }
          ListFooterComponent={
            <Pressable style={styles.footer} onPress={() => void disconnect()}>
              <ThemedText type="small" themeColor="textSecondary">
                Unpair this device
              </ThemedText>
            </Pressable>
          }
        />
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  statusStrip: { paddingHorizontal: Spacing.three, paddingVertical: Spacing.two },
  errorStrip: { backgroundColor: '#F8514922' },
  errorText: { color: '#F85149' },
  listContent: { padding: Spacing.three, gap: Spacing.three, flexGrow: 1 },
  card: { borderRadius: Spacing.three, padding: Spacing.three, gap: Spacing.two },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  cardTitle: { flex: 1 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  cardMeta: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  cardMetaText: { flex: 1 },
  runningText: { color: '#3FB950' },
  badge: {
    alignSelf: 'flex-start',
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.two,
    paddingVertical: 2,
    backgroundColor: '#E8A13C22',
  },
  warnText: { color: '#E8A13C' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.five },
  centerText: { textAlign: 'center' },
  footer: { alignItems: 'center', paddingVertical: Spacing.four },
});
