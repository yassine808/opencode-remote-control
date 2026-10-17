import { Redirect, router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { RefreshControl, SectionList, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SessionCard } from '@/components/session-card';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Banner, Button, Entrance, Pill, Skeleton } from '@/components/ui';
import { CodeBlock } from '@/components/rich-text';
import { MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { describeError } from '@/lib/api';
import { confirmAction } from '@/lib/confirm';
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

type Group = 'needs' | 'running' | 'recent';

export default function SessionsScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { ready, api, disconnect } = useConnection();
  const [sessions, setSessions] = useState<SessionInfo[] | null>(null);
  const [active, setActive] = useState<Record<string, { type: string }>>({});
  const [approvals, setApprovals] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [streamStatus, setStreamStatus] = useState<StreamStatus>('disconnected');
  const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The staggered entrance plays once, on the first list that appears.
  const introPlayed = useRef(false);

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

  const sections = useMemo(() => {
    const buckets: Record<Group, SessionInfo[]> = { needs: [], running: [], recent: [] };
    for (const s of sessions ?? []) {
      const group: Group = (approvals[s.id] ?? 0) > 0 ? 'needs' : active[s.id] ? 'running' : 'recent';
      buckets[group].push(s);
    }
    const defs: { key: Group; title: string }[] = [
      { key: 'needs', title: 'Needs your approval' },
      { key: 'running', title: 'Running' },
      { key: 'recent', title: 'Recent' },
    ];
    return defs
      .filter((d) => buckets[d.key].length > 0)
      .map((d) => ({ key: d.key, title: d.title, data: buckets[d.key] }));
  }, [sessions, active, approvals]);

  const order = useMemo(() => {
    const map = new Map<string, number>();
    for (const sec of sections) for (const item of sec.data) map.set(item.id, map.size);
    return map;
  }, [sections]);

  const needsCount = sections.find((s) => s.key === 'needs')?.data.length ?? 0;
  const runningCount = sections.find((s) => s.key === 'running')?.data.length ?? 0;

  const unpair = useCallback(async () => {
    const ok = await confirmAction({
      title: 'Unpair this device?',
      message: 'You will need to pair with your PC again to see your sessions.',
      confirmLabel: 'Unpair',
      destructive: true,
    });
    if (ok) await disconnect();
  }, [disconnect]);

  if (!ready) return <ThemedView style={styles.screen} />;
  if (!api) return <Redirect href="/setup" />;

  const summary =
    needsCount > 0
      ? `${needsCount} ${needsCount === 1 ? 'session needs' : 'sessions need'} you`
      : runningCount > 0
        ? `${runningCount} running`
        : sessions && sessions.length > 0
          ? 'All quiet'
          : ' ';

  const live =
    streamStatus === 'connected'
      ? { label: 'Live', color: theme.success, soft: theme.successSoft, pulse: true }
      : streamStatus === 'connecting'
        ? { label: 'Connecting', color: theme.textSecondary, soft: theme.backgroundSelected, pulse: true }
        : { label: 'Offline', color: theme.warn, soft: theme.warnSoft, pulse: false };

  return (
    <ThemedView style={styles.screen}>
      <View style={[styles.column, { paddingTop: insets.top + Spacing.three }]}>
        <View style={styles.headerRow}>
          <Pill label={live.label} color={live.color} soft={live.soft} dot pulse={live.pulse} />
          <Button label="Unpair" variant="ghost" compact onPress={() => void unpair()} />
        </View>
        <ThemedText type="heading" accessibilityRole="header" style={styles.title}>
          Sessions
        </ThemedText>
        <ThemedText type="default" themeColor={needsCount > 0 ? 'warn' : 'textSecondary'} style={styles.summary}>
          {summary}
        </ThemedText>
      </View>

      {streamStatus === 'disconnected' && sessions !== null && <Banner tone="warn">Live updates paused. Reconnecting…</Banner>}
      {error && (
        <Banner tone="danger" actionLabel="Retry" onAction={() => void load()}>
          {error}
        </Banner>
      )}

      {sessions === null ? (
        <View style={[styles.column, styles.skeletons]}>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} style={styles.skeletonCard} />
          ))}
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.id}
          stickySectionHeadersEnabled={false}
          contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + Spacing.five }]}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => void load()} tintColor={theme.text} />
          }
          renderSectionHeader={({ section }) => (
            <View style={styles.sectionHead}>
              <ThemedText
                type="smallBold"
                themeColor={section.key === 'needs' ? 'warn' : 'textSecondary'}>
                {section.title}
              </ThemedText>
              <ThemedText type="caption" themeColor="textTertiary">
                {section.data.length}
              </ThemedText>
            </View>
          )}
          renderItem={({ item }) => {
            const i = order.get(item.id) ?? 0;
            return (
              <Entrance enabled={!introPlayed.current && i < 8} delay={i * 55} style={styles.item}>
                <SessionCard
                  session={item}
                  running={Boolean(active[item.id])}
                  pending={approvals[item.id] ?? 0}
                  onPress={() => router.push({ pathname: '/session/[id]', params: { id: item.id } })}
                />
              </Entrance>
            );
          }}
          onLayout={() => {
            // First paint done: later refreshes and scrolling won't replay the intro.
            setTimeout(() => {
              introPlayed.current = true;
            }, 900);
          }}
          ListEmptyComponent={
            <View style={styles.empty}>
              <ThemedText type="subtitle">No sessions yet</ThemedText>
              <ThemedText type="small" themeColor="textSecondary" style={styles.emptyText}>
                Open a session in OpenCode on your PC. It will show up here. Pull down to refresh.
              </ThemedText>
              <View style={styles.emptyCode}>
                <CodeBlock text="opencode" lang="PC terminal" />
              </View>
            </View>
          }
        />
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  column: { width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center', paddingHorizontal: Spacing.three },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.two },
  title: { marginTop: Spacing.one },
  summary: { marginTop: 2, marginBottom: Spacing.two },
  listContent: {
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
    flexGrow: 1,
  },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.two,
  },
  item: { marginBottom: Spacing.two + 2 },
  skeletons: { gap: Spacing.two + 2, paddingTop: Spacing.four },
  skeletonCard: { height: 98, borderRadius: Radius.large },
  empty: { paddingTop: Spacing.six, gap: Spacing.two, alignItems: 'flex-start' },
  emptyText: { maxWidth: 360 },
  emptyCode: { alignSelf: 'stretch', marginTop: Spacing.three },
});
