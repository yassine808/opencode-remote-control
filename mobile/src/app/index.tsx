/**
 * The launcher: every project, with its conversations nested underneath.
 * Tap a project to expand it; the freshest one arrives already open, so
 * continuing the last conversation stays one tap.
 *
 * The invisible parts are load-bearing too: an SSE stream keeps the list
 * fresh while you are not looking, a 15s poll as a safety net, and a
 * debounced reload for bursts of events. Errors render inline where the
 * list would be — on a phone, away from home, "PC unreachable" IS the
 * content.
 */

import { Redirect, router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  AppState,
  Easing,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BrandWordmark } from '@/components/brand';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Glyph, PressableScale, StatusDot, useReduceMotion } from '@/components/ui';
import { Fonts, Motion } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { describeError } from '@/lib/api';
import { confirmAction } from '@/lib/confirm';
import { useConnection } from '@/lib/connection';
import { runEventStream, type StreamStatus } from '@/lib/events';
import { basename } from '@/lib/paths';
import {
  loadPinnedSessions,
  loadRecentSessions,
  togglePinnedSession,
  type PinnedSession,
  type RecentSession,
} from '@/lib/storage';
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

// ---------- grouping ----------

interface ProjectGroup {
  id: string;
  name: string;
  sessions: SessionInfo[];
  /** Newest update in the group — the freshest group opens by default. */
  freshest: number;
}

/**
 * Sessions grouped by their project directory; the group's name is the
 * folder's, so "search covers both" falls out of matching the directory
 * path as well as the title.
 */
function buildGroups(sessions: SessionInfo[], query: string): ProjectGroup[] {
  const q = query.trim().toLowerCase();
  const map = new Map<string, ProjectGroup>();
  for (const s of sessions) {
    const directory = s.location?.directory || 'Other';
    const name = basename(directory) || directory;
    const title = (s.title ?? '').toLowerCase();
    if (q && !title.includes(q) && !directory.toLowerCase().includes(q)) continue;
    let group = map.get(directory);
    if (!group) {
      group = { id: directory, name, sessions: [], freshest: 0 };
      map.set(directory, group);
    }
    group.sessions.push(s);
    group.freshest = Math.max(group.freshest, s.time?.updated ?? 0);
  }
  const groups = [...map.values()];
  for (const g of groups) {
    g.sessions.sort((a, b) => (b.time?.updated ?? 0) - (a.time?.updated ?? 0));
  }
  groups.sort((a, b) => b.freshest - a.freshest);
  return groups;
}

type Row =
  | { kind: 'section'; key: string; title: string }
  | { kind: 'project'; key: string; group: ProjectGroup; expanded: boolean; last: boolean }
  | {
      kind: 'session';
      key: string;
      id: string;
      title: string;
      /** Project-name caption; Recent rows come from different projects. */
      hint?: string;
      /** Nested rows indent under their project; top-level rows don't. */
      indent?: boolean;
      last: boolean;
    };

// ---------- rows ----------

/**
 * Disclosure row: chevron turns a quarter clockwise when the group opens —
 * the same gesture their List performs, ported.
 */
function ProjectRow({
  group,
  expanded,
  last,
  onToggle,
}: {
  group: ProjectGroup;
  expanded: boolean;
  last: boolean;
  onToggle: () => void;
}) {
  const theme = useTheme();
  const reduce = useReduceMotion();
  const rotation = useRef(new Animated.Value(expanded ? 1 : 0)).current;

  useEffect(() => {
    if (reduce) {
      rotation.setValue(expanded ? 1 : 0);
      return;
    }
    Animated.timing(rotation, {
      toValue: expanded ? 1 : 0,
      duration: Motion.settle * 1000,
      easing: Easing.bezier(...Motion.curve),
      useNativeDriver: Platform.OS !== 'web',
    }).start();
  }, [expanded, reduce, rotation]);

  return (
    <View>
      <Pressable
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityLabel={`${group.name}, ${expanded ? 'expanded' : 'collapsed'}, ${group.sessions.length} sessions`}
        style={({ pressed }) => [styles.row, pressed && { backgroundColor: theme.inkControl }]}>
        <Animated.View
          style={{
            transform: [
              {
                rotate: rotation.interpolate({
                  inputRange: [0, 1],
                  outputRange: ['0deg', '90deg'],
                }),
              },
            ],
          }}>
          <Glyph name="chevron-forward" size={13} color={theme.inkMuted} />
        </Animated.View>
        <ThemedText type="body" numberOfLines={1} style={styles.rowText}>
          {group.name}
        </ThemedText>
        {!expanded && group.sessions.length > 0 ? (
          <ThemedText type="caption" style={{ color: theme.inkFaint }}>
            {group.sessions.length}
          </ThemedText>
        ) : null}
      </Pressable>
      {!last ? <View style={[styles.separator, { backgroundColor: theme.hairline }]} /> : null}
    </View>
  );
}

/** Section label — "Recent", "Projects". A list row so it scrolls with them. */
function SectionHead({ title }: { title: string }) {
  const theme = useTheme();
  return (
    <ThemedText type="footnote" style={[styles.sectionHead, { color: theme.inkMuted }]}>
      {title}
    </ThemedText>
  );
}

/**
 * One conversation row. Nested rows lean on the project row above for
 * context; Recent rows carry the project as a quiet caption because their
 * neighbours come from different projects.
 */
function SessionRow({
  title,
  hint,
  indent,
  pinned,
  last,
  onPress,
  onTogglePin,
}: {
  title: string;
  hint?: string;
  indent?: boolean;
  /** Pinned rows carry a filled pin; tapping the glyph flips the state. */
  pinned?: boolean;
  last: boolean;
  onPress: () => void;
  onTogglePin?: () => void;
}) {
  const theme = useTheme();
  return (
    <View>
      {/* The pin is a sibling of the row press, never a button inside one —
          nested buttons are invalid on web, and the two press areas fight. */}
      <View style={styles.sessionContainer}>
        <Pressable
          onPress={onPress}
          accessibilityRole="button"
          accessibilityLabel={hint ? `${title}, ${hint}` : title}
          style={({ pressed }) => [
            styles.sessionPress,
            indent && styles.sessionRow,
            pressed && { backgroundColor: theme.inkControl },
          ]}>
          <ThemedText type="body" numberOfLines={1} style={styles.rowText}>
            {title}
          </ThemedText>
          {hint ? (
            <ThemedText type="caption" numberOfLines={1} style={[styles.rowHint, { color: theme.inkFaint }]}>
              {hint}
            </ThemedText>
          ) : null}
          <Glyph name="chevron-forward" size={12} color={theme.inkFaint} />
        </Pressable>
        {onTogglePin ? (
          <PressableScale
            onPress={onTogglePin}
            hitSlop={8}
            scaleTo={0.85}
            style={styles.pinButton}
            accessibilityLabel={pinned ? 'Unpin conversation' : 'Pin conversation'}
            accessibilityState={{ selected: !!pinned }}>
            <Glyph
              set="mci"
              name={pinned ? 'pin' : 'pin-outline'}
              size={14}
              color={pinned ? theme.accent : theme.inkFaint}
            />
          </PressableScale>
        ) : null}
      </View>
      {!last ? <View style={[styles.separator, { backgroundColor: theme.hairline }]} /> : null}
    </View>
  );
}

// ---------- screen ----------

export default function HomeScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { ready, api, disconnect } = useConnection();

  const [sessions, setSessions] = useState<SessionInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [streamStatus, setStreamStatus] = useState<StreamStatus>('connecting');
  const [search, setSearch] = useState('');
  /** Disclosure the user has set by hand; anything absent falls back to the
   *  default: only the freshest project open. */
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  /** Conversations opened from this device, newest first (local history). */
  const [recents, setRecents] = useState<RecentSession[]>([]);
  /** Conversations the user pinned to the top of the launcher. */
  const [pinned, setPinned] = useState<PinnedSession[]>([]);

  const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(
    async (opts: { silent?: boolean } = {}) => {
      if (!api) return;
      if (!opts.silent) setRefreshing(true);
      try {
        const list = await api.sessions(50);
        setSessions(
          [...list.data].sort((a, b) => (b.time?.updated ?? 0) - (a.time?.updated ?? 0)),
        );
        setError(null);
      } catch (err) {
        setError(describeError(err));
      } finally {
        if (!opts.silent) setRefreshing(false);
      }
    },
    [api],
  );

  const loadRecents = useCallback(async () => {
    setRecents(await loadRecentSessions());
  }, []);

  const loadPinned = useCallback(async () => {
    setPinned(await loadPinnedSessions());
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (!api) return;
      let alive = true;
      const ctrl = new AbortController();

      void load();
      void loadRecents();
      void loadPinned();

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
    }, [api, load, loadRecents, loadPinned]),
  );

  // Returning to the app is the moment a session started elsewhere (the
  // CLI on the PC) should already be in the list, without a pull.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (phase) => {
      if (phase === 'active') {
        void load({ silent: true });
        void loadRecents();
        void loadPinned();
      }
    });
    return () => sub.remove();
  }, [load, loadRecents, loadPinned]);

  const togglePin = useCallback(
    async (entry: { id: string; title?: string | null; directory?: string | null }) => {
      await togglePinnedSession(entry);
      void loadPinned();
    },
    [loadPinned],
  );

  const groups = useMemo(() => buildGroups(sessions ?? [], search), [sessions, search]);

  const defaultExpandedID = groups[0]?.id ?? null;
  const isExpanded = useCallback(
    (group: ProjectGroup) => {
      // A search result that stayed folded would be a result withheld.
      if (search.trim()) return true;
      return toggled[group.id] ?? group.id === defaultExpandedID;
    },
    [search, toggled, defaultExpandedID],
  );

  const searching = search.trim().length > 0;

  const sessionByID = useMemo(() => {
    const map = new Map<string, SessionInfo>();
    for (const s of sessions ?? []) map.set(s.id, s);
    return map;
  }, [sessions]);

  const pinnedIDs = useMemo(() => new Set(pinned.map((p) => p.id)), [pinned]);

  const rows = useMemo(() => {
    const out: Row[] = [];

    // Pinned conversations lead — a deliberate choice outranks recency; a
    // search narrows the list to matches only.
    if (!searching && pinned.length > 0) {
      out.push({ kind: 'section', key: 'sec:pinned', title: 'Pinned' });
      pinned.forEach((entry, i) => {
        const fresh = sessionByID.get(entry.id);
        const directory = fresh?.location?.directory ?? entry.directory ?? '';
        out.push({
          kind: 'session',
          key: `pinned:${entry.id}`,
          id: entry.id,
          title: fresh?.title?.trim() || entry.title?.trim() || 'Untitled session',
          hint: basename(directory) || undefined,
          last: i === pinned.length - 1,
        });
      });
    }

    // Recents sit above the fold — continuing the last conversation stays
    // the fastest path. Anything already pinned above would read as a double.
    const unpinnedRecents = recents.filter((entry) => !pinnedIDs.has(entry.id));
    if (!searching && unpinnedRecents.length > 0) {
      out.push({ kind: 'section', key: 'sec:recent', title: 'Recent' });
      unpinnedRecents.forEach((entry, i) => {
        const fresh = sessionByID.get(entry.id);
        const directory = fresh?.location?.directory ?? entry.directory ?? '';
        out.push({
          kind: 'session',
          key: `recent:${entry.id}`,
          id: entry.id,
          title: fresh?.title?.trim() || entry.title?.trim() || 'Untitled session',
          hint: basename(directory) || undefined,
          last: i === unpinnedRecents.length - 1,
        });
      });
    }

    if (groups.length > 0) {
      out.push({ kind: 'section', key: 'sec:projects', title: searching ? 'Results' : 'Projects' });
      for (const group of groups) {
        const expanded = isExpanded(group);
        const members = expanded ? group.sessions.length : 0;
        out.push({ kind: 'project', key: `p:${group.id}`, group, expanded, last: members === 0 });
        if (expanded) {
          group.sessions.forEach((session, i) => {
            out.push({
              kind: 'session',
              key: session.id,
              id: session.id,
              title: session.title?.trim() || 'Untitled session',
              indent: true,
              last: i === group.sessions.length - 1,
            });
          });
        }
      }
    }
    return out;
  }, [groups, isExpanded, pinned, pinnedIDs, recents, searching, sessionByID]);

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

  const dotColor =
    streamStatus === 'connected'
      ? theme.positive
      : streamStatus === 'connecting'
        ? theme.inkFaint
        : theme.negative;

  const dotLabel =
    streamStatus === 'connected'
      ? 'PC connected'
      : streamStatus === 'connecting'
        ? 'Checking'
        : 'PC unreachable';

  return (
    <ThemedView style={styles.screen}>
      {/* nav — the wordmark, a status dot, nothing else */}
      <View style={{ paddingTop: insets.top }}>
        <View style={styles.navBar}>
          <BrandWordmark height={15} color={theme.ink} />
        </View>
        <View style={[styles.dot, { top: insets.top }]}>
          <PressableScale
            onPress={() => void load({ silent: true })}
            onLongPress={() => void unpair()}
            accessibilityLabel={dotLabel}
            accessibilityHint="Long press to unpair">
            <StatusDot color={dotColor} size={10} />
          </PressableScale>
        </View>
      </View>

      {/* searchable — one field, debounced upstream by local filtering */}
      <View style={styles.searchWrap}>
        <View style={[styles.search, { backgroundColor: theme.inkControl }]}>
          <Glyph name="search" size={16} color={theme.inkFaint} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search projects and sessions"
            placeholderTextColor={theme.inkFaint}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            accessibilityLabel="Search projects and sessions"
            style={[styles.searchInput, { color: theme.ink }]}
          />
          {search.length > 0 ? (
            <PressableScale
              onPress={() => setSearch('')}
              hitSlop={8}
              accessibilityLabel="Clear search"
              scaleTo={0.9}>
              <Glyph name="close-circle-outline" size={16} color={theme.inkFaint} />
            </PressableScale>
          ) : null}
        </View>
      </View>

      {sessions === null && !error ? (
        <View style={styles.center}>
          <View style={styles.centerRow}>
            <ActivityIndicator size="small" color={theme.inkMuted} />
            <ThemedText type="callout" style={{ color: theme.inkMuted }}>
              Reaching your PC…
            </ThemedText>
          </View>
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(row) => row.key}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[
            styles.listContent,
            { paddingBottom: insets.bottom + 24 },
          ]}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void load()}
              tintColor={theme.inkMuted}
              colors={[theme.accent]}
            />
          }
          ListHeaderComponent={
            error ? (
              <View style={styles.errorRow}>
                <Glyph set="mci" name="wifi-alert" size={17} color={theme.inkMuted} />
                <ThemedText type="body" style={[styles.errorText, { color: theme.inkMuted }]}>
                  {error}
                </ThemedText>
              </View>
            ) : undefined
          }
          renderItem={({ item }) =>
            item.kind === 'section' ? (
              <SectionHead title={item.title} />
            ) : item.kind === 'project' ? (
              <ProjectRow
                group={item.group}
                expanded={item.expanded}
                last={item.last}
                onToggle={() =>
                  setToggled((t) => ({ ...t, [item.group.id]: !isExpanded(item.group) }))
                }
              />
            ) : (
              <SessionRow
                title={item.title}
                hint={item.hint}
                indent={item.indent}
                pinned={pinnedIDs.has(item.id)}
                last={item.last}
                onPress={() =>
                  router.push({ pathname: '/session/[id]', params: { id: item.id } })
                }
                onTogglePin={() =>
                  void togglePin({
                    id: item.id,
                    title: item.title,
                    directory: sessionByID.get(item.id)?.location?.directory,
                  })
                }
              />
            )
          }
          ListEmptyComponent={
            !error ? (
              searching ? (
                <ThemedText type="body" style={[styles.emptyText, { color: theme.inkMuted }]}>
                  No matching projects or sessions
                </ThemedText>
              ) : (
                <View style={styles.empty}>
                  <ThemedText type="body" style={{ color: theme.inkMuted }}>
                    No sessions yet
                  </ThemedText>
                  <ThemedText type="caption" style={{ color: theme.inkFaint }}>
                    Start one in OpenCode on your PC — it shows up here.
                  </ThemedText>
                </View>
              )
            ) : undefined
          }
        />
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  navBar: { height: 44, alignItems: 'center', justifyContent: 'center' },
  dot: { position: 'absolute', right: 10, width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  searchWrap: { paddingHorizontal: 16, paddingBottom: 8 },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 36,
    borderRadius: 10,
    paddingHorizontal: 8,
  },
  searchInput: {
    flex: 1,
    fontFamily: Fonts.regular,
    fontSize: 17,
    lineHeight: 22,
    padding: 0,
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null),
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  centerRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  listContent: { flexGrow: 1, width: '100%', maxWidth: 560, alignSelf: 'center' },
  errorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  errorText: { flex: 1 },
  sectionHead: { paddingHorizontal: 16, paddingTop: 24, paddingBottom: 6 },
  row: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
  },
  sessionContainer: { minHeight: 44, flexDirection: 'row', alignItems: 'center' },
  sessionPress: {
    flex: 1,
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
  },
  pinButton: { justifyContent: 'center', paddingHorizontal: 16, paddingVertical: 12 },
  sessionRow: { paddingLeft: 16 + 22 },
  rowText: { flex: 1 },
  rowHint: { maxWidth: 160 },
  separator: { height: StyleSheet.hairlineWidth, marginLeft: 16 },
  empty: { paddingHorizontal: 16, paddingTop: 2, gap: 4 },
  emptyText: { paddingHorizontal: 16, paddingTop: 2 },
});
