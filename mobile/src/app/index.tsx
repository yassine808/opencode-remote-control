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
import { type ReactElement, useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BrandWordmark, WORDMARK_COMPACT } from '@/components/brand';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Button, Glyph, PressableScale, StatusDot, useReduceMotion } from '@/components/ui';
import { Fonts, Motion, Radius } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { describeError } from '@/lib/api';
import { useConnection } from '@/lib/connection';
import { runEventStream, type StreamStatus } from '@/lib/events';
import { basename } from '@/lib/paths';
import { usePreferences } from '@/lib/preferences';
import {
  loadPinnedSessions,
  loadRecentSessions,
  togglePinnedSession,
  type PinnedSession,
  type RecentSession,
} from '@/lib/storage';
import type { PermissionRequest, SessionInfo } from '@/lib/types';
import {
  checkForUpdate,
  installedVersion,
  installedVersionCode,
  type UpdateInfo,
} from '@/lib/updater';

const LIST_REFRESH_EVENTS = new Set([
  'session.renamed',
  'session.execution.started',
  'session.execution.succeeded',
  'session.execution.failed',
  'session.inbox.enqueued',
  'session.inbox.delivered',
  'session.step.ended',
  'session.usage.updated',
  'permission.asked',
  'permission.replied',
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

type SessionState = 'attention' | 'working';

type Row =
  | { kind: 'section'; key: string; title: string }
  | {
      kind: 'project';
      key: string;
      group: ProjectGroup;
      expanded: boolean;
      last: boolean;
      attentionCount: number;
      runningCount: number;
    }
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
      /** Live state, surfaced as a word + dot rather than only a color. */
      state?: SessionState;
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
  attentionCount,
  runningCount,
  onToggle,
}: Readonly<{
  group: ProjectGroup;
  expanded: boolean;
  last: boolean;
  attentionCount: number;
  runningCount: number;
  onToggle: () => void;
}>) {
  const theme = useTheme();
  const reduce = useReduceMotion();
  const [rotation] = useState(() => new Animated.Value(expanded ? 1 : 0));

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

  const stateColor = attentionCount > 0 ? theme.caution : theme.running;
  const stateLabel =
    attentionCount > 0
      ? `${attentionCount} waiting`
      : runningCount > 0
        ? 'Working'
        : null;

  return (
    <View>
      <Pressable
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityLabel={`${group.name}, ${expanded ? 'expanded' : 'collapsed'}, ${group.sessions.length} sessions${
          attentionCount > 0
            ? `, ${attentionCount} waiting for approval`
            : runningCount > 0
              ? ', working'
              : ''
        }`}
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
        {stateLabel ? (
          <View style={styles.state}>
            <StatusDot color={stateColor} size={7} />
            <ThemedText type="caption" weight="medium" style={{ color: stateColor }}>
              {stateLabel}
            </ThemedText>
          </View>
        ) : !expanded && group.sessions.length > 0 ? (
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
function SectionHead({ title }: Readonly<{ title: string }>) {
  const theme = useTheme();
  return (
    <ThemedText type="footnote" style={[styles.sectionHead, { color: theme.inkMuted }]}>
      {title}
    </ThemedText>
  );
}

/**
 * One conversation row. The title stays still; live state is a word plus a
 * dot, so "needs you" survives a glance, a screen reader, and color blindness.
 * Recent rows carry the project as a quiet second line because their
 * neighbours come from different projects.
 */
function SessionRow({
  title,
  hint,
  indent,
  pinned,
  last,
  state,
  onPress,
  onTogglePin,
}: Readonly<{
  title: string;
  hint?: string;
  indent?: boolean;
  /** Pinned rows carry a filled pin; tapping the glyph flips the state. */
  pinned?: boolean;
  last: boolean;
  state?: SessionState;
  onPress: () => void;
  onTogglePin?: () => void;
}>) {
  const theme = useTheme();
  const stateColor = state === 'attention' ? theme.caution : theme.running;

  return (
    <View>
      {/* The pin is a sibling of the row press, never a button inside one —
          nested buttons are invalid on web, and the two press areas fight. */}
      <View style={styles.sessionContainer}>
        <Pressable
          onPress={onPress}
          accessibilityRole="button"
          accessibilityLabel={`${title}${hint ? `, ${hint}` : ''}${
            state === 'attention' ? ', needs you' : state === 'working' ? ', working' : ''
          }`}
          style={({ pressed }) => [
            styles.sessionPress,
            indent && styles.sessionRow,
            pressed && { backgroundColor: theme.inkControl },
          ]}>
          <View style={styles.sessionText}>
            <ThemedText type="body" numberOfLines={1}>
              {title}
            </ThemedText>
            {hint ? (
              <ThemedText type="caption" numberOfLines={1} themeColor="inkFaint">
                {hint}
              </ThemedText>
            ) : null}
          </View>
          {state ? (
            <View style={styles.state}>
              <StatusDot color={stateColor} size={7} />
              <ThemedText type="caption" weight="medium" style={{ color: stateColor }}>
                {state === 'attention' ? 'Needs you' : 'Working'}
              </ThemedText>
            </View>
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

/** The bottom link — the version stamp, and the way into the updates screen. */
function FooterLink() {
  return (
    <PressableScale
      onPress={() => router.push('/update')}
      scaleTo={0.98}
      accessibilityLabel="App version and updates"
      style={styles.footer}>
      <ThemedText type="caption" themeColor="inkFaint">
        {installedVersionCode() > 0
          ? `OpenCode Remote ${installedVersion()} (${installedVersionCode()})`
          : 'OpenCode Remote — web preview'}
      </ThemedText>
    </PressableScale>
  );
}

// ---------- live surfaces ----------

/** The screen's one ambient motion: an approval is waiting on a human. */
function PulseDot({ color }: Readonly<{ color: string }>) {
  const reduce = useReduceMotion();
  const [opacity] = useState(() => new Animated.Value(1));

  useEffect(() => {
    if (reduce) {
      opacity.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0.35,
          duration: 750,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: Platform.OS !== 'web',
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: 750,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: Platform.OS !== 'web',
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity, reduce]);

  return (
    <Animated.View
      style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color, opacity }}
    />
  );
}

function AttentionBanner({
  title,
  more,
  onPress,
}: Readonly<{ title: string; more: number; onPress: () => void }>) {
  const theme = useTheme();
  return (
    <PressableScale
      onPress={onPress}
      scaleTo={0.99}
      accessibilityLabel={`${title} needs approval${more > 0 ? `, ${more} more waiting` : ''}. Open session.`}
      style={[styles.banner, { backgroundColor: theme.cautionSoft }]}>
      <PulseDot color={theme.caution} />
      <View style={styles.bannerBody}>
        <ThemedText type="body" weight="semibold" numberOfLines={1}>
          {title}
        </ThemedText>
        <ThemedText type="caption" style={{ color: theme.caution }}>
          {more > 0 ? `Needs approval · ${more} more waiting` : 'Needs approval'}
        </ThemedText>
      </View>
      <Glyph name="chevron-forward" size={15} color={theme.caution} />
    </PressableScale>
  );
}

function NoticeBanner({
  tone,
  icon,
  text,
  actionLabel,
  onPress,
}: Readonly<{
  tone: 'danger' | 'accent';
  icon: 'wifi-alert' | 'cellphone-arrow-down';
  text: string;
  actionLabel: string;
  onPress: () => void;
}>) {
  const theme = useTheme();
  const foreground = tone === 'danger' ? theme.negative : theme.accent;
  return (
    <PressableScale
      onPress={onPress}
      scaleTo={0.99}
      accessibilityLabel={`${text}. ${actionLabel}.`}
      style={[
        styles.banner,
        { backgroundColor: tone === 'danger' ? theme.dangerSoft : theme.accentSoft },
      ]}>
      <Glyph set="mci" name={icon} size={17} color={foreground} />
      <ThemedText
        type="caption"
        numberOfLines={2}
        style={[styles.bannerText, { color: tone === 'danger' ? theme.negative : theme.ink }]}>
        {text}
      </ThemedText>
      <ThemedText type="caption" weight="semibold" style={{ color: foreground }}>
        {actionLabel}
      </ThemedText>
    </PressableScale>
  );
}

function LoadError({
  message,
  busy,
  onRetry,
}: Readonly<{ message: string; busy: boolean; onRetry: () => void }>) {
  const theme = useTheme();
  return (
    <View style={styles.fail}>
      <Glyph set="mci" name="wifi-alert" size={30} color={theme.inkFaint} />
      <ThemedText type="headline">Can&apos;t reach your PC</ThemedText>
      <ThemedText type="callout" themeColor="inkMuted" style={styles.failText}>
        {message}
      </ThemedText>
      <Button variant="secondary" busy={busy} onPress={onRetry} style={styles.failButton}>
        Try Again
      </Button>
    </View>
  );
}

// ---------- screen ----------

export default function HomeScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { ready, api } = useConnection();
  const { preferences } = usePreferences();

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
  /** sessions whose agent is working right now */
  const [activeIDs, setActiveIDs] = useState<Set<string>>(() => new Set());
  /** Approval gates waiting on the user, across every project. */
  const [pending, setPending] = useState<PermissionRequest[]>([]);

  const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Guards against an older, slower load overwriting a newer one. */
  const loadSeq = useRef(0);

  const load = useCallback(
    async (opts: { silent?: boolean } = {}) => {
      if (!api) return;
      const client = api;
      const seq = ++loadSeq.current;
      if (!opts.silent) setRefreshing(true);
      try {
        const [list, active] = await Promise.all([
          client.sessions(50),
          client.activeSessions().catch(() => null),
        ]);
        if (seq !== loadSeq.current) return;

        setSessions(
          [...list.data].sort((a, b) => (b.time?.updated ?? 0) - (a.time?.updated ?? 0)),
        );
        if (active) setActiveIDs(new Set(Object.keys(active.data ?? {})));
        setError(null);

        // A session with a pending permission request is the one thing on this
        // screen that cannot wait. Ask each project once, in parallel; a project
        // that is slow or gone must not blank out the others.
        const directories = [
          ...new Set(
            list.data
              .map((session) => session.location?.directory)
              .filter((directory): directory is string => !!directory),
          ),
        ].slice(0, 12);
        const results = await Promise.allSettled(
          directories.map((directory) => client.permissionRequestsAt(directory)),
        );
        if (seq !== loadSeq.current) return;
        if (results.some((result) => result.status === 'fulfilled')) {
          setPending(
            results.flatMap((result) =>
              result.status === 'fulfilled' ? result.value.data : [],
            ),
          );
        }
      } catch (err) {
        if (seq === loadSeq.current) {
          setError(describeError(err));
          // A disconnected list cannot prove an approval is still waiting.
          setPending([]);
        }
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
          if (!alive) return;
          const sid = (event.data as { sessionID?: string } | undefined)?.sessionID;
          if (sid) {
            if (event.type === 'session.execution.started') {
              setActiveIDs((prev) => new Set(prev).add(sid));
            } else if (
              event.type === 'session.execution.succeeded' ||
              event.type === 'session.execution.failed'
            ) {
              setActiveIDs((prev) => {
                const next = new Set(prev);
                next.delete(sid);
                return next;
              });
            }
          }
          if (LIST_REFRESH_EVENTS.has(event.type)) scheduleReload();
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

  // One quiet GitHub check per launch; the row above the list only appears
  // when a newer build exists.
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);

  useEffect(() => {
    if (!preferences.autoCheckUpdates) return;
    // The installed versionCode is the comparand; the web preview has none,
    // so it skips the check entirely.
    if (installedVersionCode() <= 0) return;
    let alive = true;
    checkForUpdate()
      .then((found) => {
        if (alive) setUpdateInfo(found);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [preferences.autoCheckUpdates]);

  // The preference is the display gate too: switching checks off hides any
  // result already fetched, without another state write in an effect.
  const visibleUpdate = preferences.autoCheckUpdates ? updateInfo : null;

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

  const pendingBySession = useMemo(() => {
    const map = new Map<string, number>();
    for (const request of pending) {
      map.set(request.sessionID, (map.get(request.sessionID) ?? 0) + 1);
    }
    return map;
  }, [pending]);

  const attentionSessions = useMemo(
    () => (sessions ?? []).filter((session) => pendingBySession.has(session.id)),
    [pendingBySession, sessions],
  );

  const attentionIDs = useMemo(
    () => new Set(attentionSessions.map((session) => session.id)),
    [attentionSessions],
  );

  // A blocked session is not "working" even if the server still reports it as
  // active — the human gate outranks the spinner.
  const workingIDs = useMemo(() => {
    const next = new Set<string>();
    for (const id of activeIDs) {
      if (!attentionIDs.has(id)) next.add(id);
    }
    return next;
  }, [activeIDs, attentionIDs]);

  const rows = useMemo(() => {
    const out: Row[] = [];
    const stateOf = (id: string): SessionState | undefined =>
      attentionIDs.has(id) ? 'attention' : workingIDs.has(id) ? 'working' : undefined;

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
          state: stateOf(entry.id),
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
          state: stateOf(entry.id),
          last: i === unpinnedRecents.length - 1,
        });
      });
    }

    if (groups.length > 0) {
      out.push({ kind: 'section', key: 'sec:projects', title: searching ? 'Results' : 'Projects' });
      for (const group of groups) {
        const expanded = isExpanded(group);
        const members = expanded ? group.sessions.length : 0;
        const attentionCount = group.sessions.filter((s) => attentionIDs.has(s.id)).length;
        const runningCount = group.sessions.filter((s) => workingIDs.has(s.id)).length;
        out.push({
          kind: 'project',
          key: `p:${group.id}`,
          group,
          expanded,
          last: members === 0,
          attentionCount,
          runningCount,
        });
        if (expanded) {
          group.sessions.forEach((session, i) => {
            out.push({
              kind: 'session',
              key: session.id,
              id: session.id,
              title: session.title?.trim() || 'Untitled session',
              indent: true,
              state: stateOf(session.id),
              last: i === group.sessions.length - 1,
            });
          });
        }
      }
    }
    return out;
  }, [
    attentionIDs,
    groups,
    isExpanded,
    pinned,
    pinnedIDs,
    recents,
    searching,
    sessionByID,
    workingIDs,
  ]);

  if (!ready) return <ThemedView style={styles.screen} />;
  if (!api) return <Redirect href="/setup" />;

  const dotColor = {
    connected: theme.positive,
    connecting: theme.inkFaint,
    disconnected: theme.negative,
  }[streamStatus];

  const statusLabel = {
    connected: 'Connected',
    connecting: 'Connecting to your PC',
    disconnected: "Can't reach your PC",
  }[streamStatus];

  const workingCount = workingIDs.size;
  const statusDetail =
    streamStatus === 'connected' && workingCount > 0 ? ` · ${workingCount} working` : '';
  const leadAttention = attentionSessions[0] ?? null;

  const empty: ReactElement = searching ? (
    <View style={styles.emptySearch}>
      <ThemedText type="body" themeColor="inkMuted">
        No matches for “{search.trim()}”
      </ThemedText>
      <PressableScale
        onPress={() => setSearch('')}
        accessibilityLabel="Clear search"
        style={styles.clearSearch}>
        <ThemedText type="caption" style={{ color: theme.accent }}>
          Clear search
        </ThemedText>
      </PressableScale>
    </View>
  ) : (
    <View style={styles.empty}>
      <Glyph name="terminal-outline" size={28} color={theme.inkFaint} />
      <ThemedText type="headline">No sessions yet</ThemedText>
      <ThemedText type="callout" themeColor="inkMuted" style={styles.emptyText}>
        Start one in OpenCode on your PC — it shows up here.
      </ThemedText>
    </View>
  );

  return (
    <ThemedView style={styles.screen}>
      {/* nav — wordmark left, settings right, connection state named below */}
      <View style={{ paddingTop: insets.top }}>
        <View style={styles.navBar}>
          {/* The full wordmark is 270pt wide; on a narrow phone the compact
              mark keeps the header on one line without shrinking the target. */}
          <BrandWordmark
            height={15}
            text={width < 360 ? WORDMARK_COMPACT : undefined}
            color={theme.ink}
          />
          <PressableScale
            onPress={() => router.push('/settings')}
            accessibilityLabel="Settings"
            scaleTo={0.9}
            style={styles.navAction}>
            <Glyph name="settings-outline" size={19} color={theme.inkMuted} />
          </PressableScale>
        </View>
        <PressableScale
          onPress={() => void load()}
          scaleTo={0.99}
          hitSlop={8}
          accessibilityLabel={`${statusLabel}${
            workingCount > 0 ? `, ${workingCount} working` : ''
          }. Tap to refresh.`}
          style={styles.statusStrip}>
          <StatusDot color={dotColor} size={7} />
          <ThemedText
            type="caption"
            themeColor={streamStatus === 'disconnected' ? 'negative' : 'inkMuted'}>
            {statusLabel}
            {statusDetail}
          </ThemedText>
          <View style={styles.statusSpacer} />
          <Glyph name="refresh" size={12} color={theme.inkFaint} />
        </PressableScale>
      </View>

      {leadAttention && sessions !== null ? (
        <AttentionBanner
          title={leadAttention.title?.trim() || 'Untitled session'}
          more={attentionSessions.length - 1}
          onPress={() =>
            router.push({ pathname: '/session/[id]', params: { id: leadAttention.id } })
          }
        />
      ) : null}
      {error && sessions !== null ? (
        <NoticeBanner
          tone="danger"
          icon="wifi-alert"
          text={error}
          actionLabel="Retry"
          onPress={() => void load()}
        />
      ) : null}
      {visibleUpdate ? (
        <NoticeBanner
          tone="accent"
          icon="cellphone-arrow-down"
          text={`Version ${visibleUpdate.version} is available`}
          actionLabel="Update"
          onPress={() => router.push('/update')}
        />
      ) : null}

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
      ) : sessions === null && error ? (
        <LoadError message={error} busy={refreshing} onRetry={() => void load()} />
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
          ListFooterComponent={<FooterLink />}
          renderItem={({ item }) => {
            if (item.kind === 'section') {
              return <SectionHead title={item.title} />;
            }
            if (item.kind === 'project') {
              return (
                <ProjectRow
                  group={item.group}
                  expanded={item.expanded}
                  last={item.last}
                  attentionCount={item.attentionCount}
                  runningCount={item.runningCount}
                  onToggle={() =>
                    setToggled((t) => ({ ...t, [item.group.id]: !isExpanded(item.group) }))
                  }
                />
              );
            }
            return (
              <SessionRow
                title={item.title}
                hint={item.hint}
                indent={item.indent}
                pinned={pinnedIDs.has(item.id)}
                state={item.state}
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
            );
          }}
          ListEmptyComponent={empty}
        />
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  navBar: {
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: 16,
    paddingRight: 6,
  },
  navAction: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  statusStrip: {
    height: 28,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
  },
  statusSpacer: { flex: 1 },
  searchWrap: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 8 },
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
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: 16,
    marginTop: 8,
    borderRadius: Radius.control,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  bannerBody: { flex: 1, gap: 1 },
  bannerText: { flex: 1 },
  fail: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 32,
  },
  failText: { textAlign: 'center' },
  failButton: { minWidth: 148, marginTop: 8 },
  footer: { alignItems: 'center', paddingTop: 24 },
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
    paddingVertical: 8,
  },
  sessionText: { flex: 1, gap: 1 },
  pinButton: { justifyContent: 'center', paddingHorizontal: 16, paddingVertical: 12 },
  sessionRow: { paddingLeft: 16 + 22 },
  rowText: { flex: 1 },
  state: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  separator: { height: StyleSheet.hairlineWidth, marginLeft: 16 },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 32,
    paddingBottom: 32,
  },
  emptySearch: {
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 32,
    paddingTop: 48,
  },
  clearSearch: { paddingHorizontal: 8, paddingVertical: 6 },
  emptyText: { textAlign: 'center' },
});
