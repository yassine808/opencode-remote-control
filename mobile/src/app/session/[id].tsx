import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { Redirect, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Animated,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Composer, type Attachment } from '@/components/composer';
import { ActivityGroup, type GroupItem } from '@/components/activity-group';
import { ContextButton, ContextSheet, type ContextStats } from '@/components/context-sheet';
import { MessageImage } from '@/components/message-image';
import { FadeRise, ND } from '@/components/motion';
import { EffortSheet, ModelSheet } from '@/components/model-sheet';
import { ModeSwitch, type Mode } from '@/components/mode-switch';
import { PermissionCard } from '@/components/permission-card';
import { PlanCard, type TodoItem } from '@/components/plan-card';
import { QuestionCard } from '@/components/question-card';
import { TurnFooter } from '@/components/turn-footer';
import { RichText } from '@/components/rich-text';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Glyph, PressableScale } from '@/components/ui';
import { WorkingIndicator } from '@/components/working-indicator';
import { Radius, Space } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { describeError } from '@/lib/api';
import { useConnection } from '@/lib/connection';
import { runEventStream, type StreamStatus } from '@/lib/events';
import { rememberRecentSession } from '@/lib/storage';
import type {
  AssistantMessage,
  ExecutionEventData,
  GenericMessage,
  MessageInfo,
  MessagePart,
  ModelInfo,
  ModelRef,
  PermissionDecision,
  PermissionRequest,
  ReasoningPart,
  ServerEvent,
  SessionInfo,
  SessionRenamedData,
  StepStartedData,
  TextBoundaryData,
  TextDeltaData,
  TextEndedData,
  TextPart,
  TokenUsage,
  ToolPart,
  UsageEventData,
  UserMessage,
} from '@/lib/types';

type TaggedPart = MessagePart & { __ordinal?: number };

// ---------- streaming merge helpers ----------

function withAssistant(
  messages: MessageInfo[],
  messageID: string,
  fn: (msg: AssistantMessage) => AssistantMessage,
): MessageInfo[] {
  const idx = messages.findIndex((m) => m.id === messageID);
  if (idx === -1) {
    return [...messages, fn({ type: 'assistant', id: messageID, content: [] })];
  }
  const next = [...messages];
  next[idx] = fn(next[idx] as AssistantMessage);
  return next;
}

function upsertPart(
  messages: MessageInfo[],
  messageID: string,
  kind: 'text' | 'reasoning',
  ordinal: number,
  fn: (part: TextPart | ReasoningPart) => TextPart | ReasoningPart,
): MessageInfo[] {
  return withAssistant(messages, messageID, (msg) => {
    const content = [...((msg.content ?? []) as TaggedPart[])];
    let i = content.findIndex((p) => p.type === kind && (p as TaggedPart).__ordinal === ordinal);
    if (i === -1) {
      content.push({ type: kind, text: '', __ordinal: ordinal } as TaggedPart);
      i = content.length - 1;
    }
    content[i] = { ...fn(content[i] as TextPart | ReasoningPart), __ordinal: ordinal } as TaggedPart;
    return { ...msg, content };
  });
}

// ---------- rows: parts, flattened across messages ----------

/** `Omit` over a union collapses it, so build rows without padTop and add it on push. */
type RowBase =
  | { kind: 'user'; id: string; text: string }
  | { kind: 'text'; id: string; text: string }
  | { kind: 'image'; id: string; uri: string; label?: string }
  | { kind: 'reasoning'; id: string; text: string; active: boolean; ms?: number }
  | { kind: 'tool'; id: string; part: ToolPart }
  | { kind: 'footer'; id: string; text: string; ms: number | null }
  | { kind: 'question'; id: string; part: ToolPart }
  | { kind: 'group'; id: string; items: GroupItem[]; active: boolean }
  | { kind: 'error'; id: string; text: string }
  | { kind: 'caption'; id: string; text: string };

/** `mid` is the id of the message a row came from — what "was already there" is judged by. */
type Row = RowBase & { padTop: number; mid: string };

/**
 * How long each reasoning part took. Uses the part's own timestamps when the
 * server sent them; otherwise splits the message's time (minus tool time)
 * across reasoning and text by length — close enough for "Thought for 12s".
 */
function estimateReasoningMs(msg: AssistantMessage, parts: TaggedPart[]): Map<number, number> {
  const out = new Map<number, number>();
  const span = (t?: { created?: number; completed?: number; start?: number; end?: number }) => {
    const a = t?.start ?? t?.created;
    const b = t?.end ?? t?.completed;
    return a != null && b != null && b > a ? b - a : null;
  };
  let toolMs = 0;
  let weight = 0;
  const weights = new Map<number, number>();
  parts.forEach((part, i) => {
    if (part.type === 'tool') {
      toolMs += span((part as ToolPart).time) ?? 0;
    } else if (part.type === 'reasoning' || part.type === 'text') {
      const own = span((part as { time?: never }).time);
      if (part.type === 'reasoning' && own != null) out.set(i, own);
      const w = String(part.text ?? '').length;
      weights.set(i, w);
      if (!(part.type === 'reasoning' && own != null)) weight += w;
    }
  });
  const total = span(msg.time);
  if (total == null || weight === 0) return out;
  const remainder = Math.max(0, total - toolMs - [...out.values()].reduce((a, b) => a + b, 0));
  parts.forEach((part, i) => {
    if (part.type === 'reasoning' && !out.has(i)) {
      out.set(i, (remainder * (weights.get(i) ?? 0)) / weight);
    }
  });
  return out;
}

/**
 * Flatten messages into transcript rows.
 *
 * No divider lines anywhere: the spacing ladder is the only thing telling a
 * reader where a turn ended — 40pt between turns, 12pt between parts, and
 * that >3x ratio is load-bearing. See the design notes.
 */
function buildRows(messages: MessageInfo[], running: boolean): Row[] {
  const rows: Row[] = [];
  let mid = '';

  // One footer per prompt: copy + how long the whole turn took.
  interface Turn {
    mid: string;
    start?: number;
    end?: number;
    texts: string[];
  }
  const turnRef: { cur: Turn | null } = { cur: null };
  const flushTurn = () => {
    const t = turnRef.cur;
    turnRef.cur = null;
    if (!t) return;
    const text = t.texts.join('\n\n').trim();
    if (!text) return;
    const ms = t.start != null && t.end != null && t.end > t.start ? t.end - t.start : null;
    const saved = mid;
    mid = t.mid;
    push({ kind: 'footer', id: `${t.mid}-footer`, text, ms });
    mid = saved;
  };

  const push = (row: RowBase) => {
    const prev = rows[rows.length - 1];
    let padTop = 0;
    if (rows.length > 0) {
      const userish = row.kind === 'user' || row.kind === 'image';
      const prevUserish = prev?.kind === 'user' || prev?.kind === 'image';
      // An image and its caption are one user turn — they stay tight — while
      // any other user-side row (or the reply it opens) takes the turn gap.
      const sameUserMessage =
        prev != null && prevUserish && row.id.startsWith(prev.id.split('-img')[0]);
      padTop =
        userish || prevUserish
          ? sameUserMessage
            ? Space.betweenParts
            : Space.betweenTurns
          : Space.betweenParts;
    }
    rows.push({ ...row, padTop, mid });
  };

  for (const message of messages) {
    mid = message.id;
    if (message.type === 'user') {
      flushTurn();
      const user = message as UserMessage;
      turnRef.cur = { mid: message.id, start: user.time?.created, texts: [] };
      const files = Array.isArray(user.files) ? user.files : [];
      files.forEach((file, i) => {
        const mime = typeof file?.mime === 'string' ? file.mime : '';
        if (!mime.startsWith('image/') || typeof file.data !== 'string' || !file.data) return;
        push({
          kind: 'image',
          id: `${message.id}-img${i}`,
          uri: `data:${mime};base64,${file.data}`,
          label: typeof file.name === 'string' && file.name ? file.name : undefined,
        });
      });
      const text = String(user.text ?? '');
      if (text) push({ kind: 'user', id: message.id, text });
      continue;
    }

    if (message.type === 'assistant') {
      const msg = message as AssistantMessage;
      const parts = (msg.content ?? []) as TaggedPart[];
      const cur: Turn = turnRef.cur ?? { mid: message.id, texts: [] };
      turnRef.cur = cur;
      const endAt = msg.time?.completed ?? msg.time?.streamed ?? msg.time?.created;
      if (endAt != null) cur.end = Math.max(cur.end ?? 0, endAt);
      const reasoningMs = estimateReasoningMs(msg, parts);
      parts.forEach((part, i) => {
        if (part.type === 'text') {
          const text = String((part as TextPart).text ?? '');
          if (text) {
            push({ kind: 'text', id: `${message.id}-t${i}`, text });
            cur.texts.push(text);
          }
        } else if (part.type === 'reasoning') {
          const text = String(part.text ?? '');
          if (text) {
            push({
              kind: 'reasoning',
              id: `${message.id}-r${i}`,
              text,
              active: false,
              ms: reasoningMs.get(i),
            });
          }
        } else if (part.type === 'tool') {
          push({
            kind: (part as ToolPart).name === 'question' ? 'question' : 'tool',
            id: (part as ToolPart).id || `${message.id}-x${i}`,
            part: part as ToolPart,
          });
        }
      });
      if (msg.error?.message) {
        push({ kind: 'error', id: `${message.id}-err`, text: msg.error.message });
      }
      continue;
    }

    if (message.type === 'idle') continue; // no divider lines — turn end is spacing

    const generic = message as GenericMessage;
    const label =
      typeof generic.title === 'string'
        ? generic.title
        : typeof generic.text === 'string'
          ? String(generic.text)
          : null;
    const slug = message.type.split('-').join(' ');
    push({
      kind: 'caption',
      id: message.id,
      text: label ? `${slug} — ${label}` : slug,
    });
  }

  // The running turn gets its footer when it finishes.
  if (!running) flushTurn();

  // A reasoning part is live only while it is the newest thing on screen.
  if (running && rows.length > 0) {
    const last = rows[rows.length - 1];
    if (last.kind === 'reasoning') last.active = true;
  }

  return rows;
}

/**
 * Fold each run of reasoning + tool rows into one collapsible group
 * ("2 commands, 3 thoughts, 1 read"). Text, questions, errors and user turns
 * break a run.
 */
function groupRows(flat: Row[], running: boolean): Row[] {
  const out: Row[] = [];
  let run: Row[] = [];

  const flush = (isLast: boolean) => {
    if (run.length === 0) return;
    const items: GroupItem[] = run.map((r) =>
      r.kind === 'reasoning'
        ? { kind: 'reasoning', id: r.id, text: r.text, active: r.active, ms: r.ms }
        : { kind: 'tool', id: r.id, part: (r as Extract<Row, { kind: 'tool' }>).part },
    );
    const live = items.some((it) =>
      it.kind === 'reasoning'
        ? it.active
        : it.part.state.status === 'running' || it.part.state.status === 'pending',
    );
    out.push({
      kind: 'group',
      id: `grp-${run[0].id}`,
      items,
      active: live || (running && isLast),
      padTop: run[0].padTop,
      mid: run[0].mid,
    });
    run = [];
  };

  flat.forEach((row, i) => {
    if (row.kind === 'reasoning' || row.kind === 'tool') {
      run.push(row);
    } else {
      flush(false);
      out.push(row);
    }
    if (i === flat.length - 1) flush(true);
  });
  return out;
}

// ---------- todos from the agent's todowrite/todoread calls ----------

function normalizeTodos(value: unknown): TodoItem[] {
  if (!Array.isArray(value)) return [];
  const statuses = new Set(['pending', 'in_progress', 'completed', 'cancelled']);
  return value
    .filter((t): t is Record<string, unknown> => !!t && typeof t === 'object')
    .filter((t) => typeof t.content === 'string')
    .map((t) => ({
      content: t.content as string,
      status: statuses.has(String(t.status)) ? (t.status as TodoItem['status']) : 'pending',
      priority: typeof t.priority === 'string' ? t.priority : undefined,
    }));
}

function extractTodos(messages: MessageInfo[]): TodoItem[] {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.type !== 'assistant') continue;
    const parts = (message as AssistantMessage).content ?? [];
    for (let j = parts.length - 1; j >= 0; j--) {
      const part = parts[j];
      if (part.type !== 'tool') continue;
      const tool = part as ToolPart;
      if (tool.name !== 'todowrite' && tool.name !== 'todoread') continue;

      const fromInput = normalizeTodos(tool.state.input?.todos);
      if (fromInput.length) return fromInput;

      const text = tool.state.content?.[0]?.text;
      if (typeof text === 'string') {
        try {
          const parsed: unknown = JSON.parse(text);
          const direct = normalizeTodos(parsed);
          if (direct.length) return direct;
          if (parsed && typeof parsed === 'object') {
            const nested = normalizeTodos((parsed as Record<string, unknown>).todos);
            if (nested.length) return nested;
          }
        } catch {
          // not JSON — try the next candidate
        }
      }
    }
  }
  return [];
}

// ---------- activity label for the working indicator ----------

const TOOL_ACTIVITY: Record<string, string> = {
  read: 'Reading files',
  edit: 'Editing files',
  write: 'Editing files',
  patch: 'Editing files',
  bash: 'Running a command',
  glob: 'Searching the project',
  grep: 'Searching the project',
  find: 'Searching the project',
  list: 'Searching the project',
  webfetch: 'Searching the web',
  websearch: 'Searching the web',
  task: 'Running a subagent',
  todowrite: 'Planning',
  shell: 'Running a command',
};

function activityFor(rows: Row[]): string {
  const last = rows[rows.length - 1];
  if (!last) return 'Thinking';
  switch (last.kind) {
    case 'reasoning':
      return 'Thinking';
    case 'text':
      return 'Writing';
    case 'question':
      return 'Waiting for your answer';
    case 'tool': {
      const name = last.part.name;
      if (TOOL_ACTIVITY[name]) return TOOL_ACTIVITY[name];
      return name.charAt(0).toUpperCase() + name.slice(1);
    }
    default:
      return 'Thinking';
  }
}

// ---------- context window ----------

/**
 * The window's current fill is the newest assistant message that reported
 * tokens: input + output + reasoning + cache reads/writes — the same sum the
 * server bills the next turn against.
 */
function latestTokens(messages: MessageInfo[]): ContextStats['tokens'] {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.type !== 'assistant') continue;
    const t: TokenUsage | undefined = (message as AssistantMessage).tokens;
    if (!t) continue;
    const input = t.input ?? 0;
    const output = t.output ?? 0;
    const reasoning = t.reasoning ?? 0;
    const cacheRead = t.cache?.read ?? 0;
    const cacheWrite = t.cache?.write ?? 0;
    const total = input + output + reasoning + cacheRead + cacheWrite;
    if (total > 0) return { input, output, reasoning, cacheRead, cacheWrite, total };
  }
  return null;
}

const PAGE_SIZE = 60;

// ---------- small animated pieces ----------

/** A row slides in once — never again when it is scrolled back into view. */
function RowEnter({
  id,
  animate,
  played,
  children,
}: {
  id: string;
  animate: boolean;
  played: Set<string>;
  children: ReactNode;
}) {
  useEffect(() => {
    played.add(id);
  }, [id, played]);
  return (
    <FadeRise enabled={animate} distance={animate ? 14 : 0} duration={380}>
      {children}
    </FadeRise>
  );
}

/** Appears (bottom left) when the reader has scrolled away from the newest turn. */
function JumpButton({ visible, onPress }: { visible: boolean; onPress: () => void }) {
  const theme = useTheme();
  const [p] = useState(() => new Animated.Value(0));

  useEffect(() => {
    const anim = Animated.spring(p, {
      toValue: visible ? 1 : 0,
      friction: 7,
      tension: 140,
      useNativeDriver: ND,
    });
    anim.start();
    return () => anim.stop();
  }, [visible, p]);

  return (
    <Animated.View
      pointerEvents={visible ? 'auto' : 'none'}
      style={{
        position: 'absolute',
        left: 16,
        bottom: 12,
        opacity: p.interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolate: 'clamp' }),
        transform: [
          { translateY: p.interpolate({ inputRange: [0, 1], outputRange: [18, 0] }) },
          { scale: p.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] }) },
        ],
      }}>
      <PressableScale
        onPress={onPress}
        scaleTo={0.94}
        accessibilityLabel="Jump to latest"
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          height: 36,
          paddingHorizontal: 14,
          borderRadius: 18,
          backgroundColor: theme.surfaceRaised,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.hairline,
          elevation: 4,
          shadowColor: '#000',
          shadowOpacity: 0.25,
          shadowRadius: 8,
          shadowOffset: { width: 0, height: 3 },
        }}>
        <Glyph name="arrow-down" size={15} color={theme.ink} />
        <ThemedText type="callout" weight="semibold" style={{ color: theme.ink }}>
          Jump to latest
        </ThemedText>
      </PressableScale>
    </Animated.View>
  );
}

// ---------- screen ----------

export default function SessionScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const sessionID = typeof params.id === 'string' ? params.id : params.id?.[0];
  const theme = useTheme();
  const { ready, api } = useConnection();

  const [sessionInfo, setSessionInfo] = useState<SessionInfo | null>(null);
  const [messages, setMessages] = useState<MessageInfo[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [running, setRunning] = useState(false);
  const [permissions, setPermissions] = useState<PermissionRequest[]>([]);
  const [permBusy, setPermBusy] = useState(false);
  const [execError, setExecError] = useState<string | null>(null);
  const [streamStatus, setStreamStatus] = useState<StreamStatus>('disconnected');
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [turnStartedAt, setTurnStartedAt] = useState(() => Date.now());
  const [models, setModels] = useState<ModelInfo[] | null>(null);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelSheetOpen, setModelSheetOpen] = useState(false);
  const [effortSheetOpen, setEffortSheetOpen] = useState(false);
  /** the reader's pick, until the server's own value catches up */
  const [modeOverride, setModeOverride] = useState<Mode | null>(null);
  const [modeBusy, setModeBusy] = useState(false);
  const [modelBusy, setModelBusy] = useState(false);
  const [todosOpen, setTodosOpen] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const [showJump, setShowJump] = useState(false);
  /** mirrors autoScrollRef so the list can switch anchoring when the reader leaves the end */
  const [pinned, setPinned] = useState(true);
  const insets = useSafeAreaInsets();

  const listRef = useRef<FlatList<Row>>(null);
  const autoScrollRef = useRef(true);
  /** the reader's finger is on the list — only then may a scroll mean "I left the end" */
  const draggingRef = useRef(false);
  /** every row is rendered on first open, so the true end is measurable */
  const initialCountRef = useRef(0);
  const dragEndTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastFollowRef = useRef(0);
  const followTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openingRef = useRef(true);
  const refetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recordedRef = useRef<string | null>(null);
  /** Messages present at first load — only newer ones animate in. */
  const baselineRef = useRef<Set<string> | null>(null);
  const playedRef = useRef<Set<string>>(new Set());
  const modelsAskedRef = useRef<string | null>(null);

  useEffect(() => {
    baselineRef.current = null;
    playedRef.current = new Set();
    modelsAskedRef.current = null;
  }, [sessionID]);

  const loadMessages = useCallback(async () => {
    if (!api || !sessionID) return;
    try {
      const res = await api.messages(sessionID, { limit: PAGE_SIZE, order: 'desc' });
      if (!baselineRef.current) baselineRef.current = new Set(res.data.map((m) => m.id));
      setMessages([...res.data].reverse());
      setLoaded(true);
    } catch {
      // A deleted session 404s forever; an offline PC can stay away for a
      // while. Either way, resolve to the empty state rather than a spinner
      // that never stops; the SSE resync refills the moment one lands.
      setLoaded(true);
    }
  }, [api, sessionID]);

  const loadMeta = useCallback(async () => {
    if (!api || !sessionID) return;
    try {
      const [session, perms, act] = await Promise.all([
        api.session(sessionID),
        api.sessionPermissionRequests(sessionID),
        api.activeSessions(),
      ]);
      setSessionInfo(session.data);
      setPermissions(perms.data);
      const isRunning = Boolean(act.data[sessionID]);
      setRunning((prev) => {
        if (!prev && isRunning) setTurnStartedAt(Date.now());
        return isRunning;
      });
    } catch {
      // transient — SSE reconnect or next poll will retry
    }
  }, [api, sessionID]);

  const scheduleRefetch = useCallback(
    (soon = false) => {
      if (refetchTimer.current) return;
      refetchTimer.current = setTimeout(() => {
        refetchTimer.current = null;
        void loadMessages();
        void loadMeta();
      }, soon ? 150 : 500);
    },
    [loadMessages, loadMeta],
  );

  const handleEvent = useCallback(
    (event: ServerEvent) => {
      const data = event.data as Record<string, any> | undefined;
      if (event.type.startsWith('session.') && data?.sessionID && data.sessionID !== sessionID) return;

      switch (event.type) {
        case 'session.step.started': {
          const d = data as unknown as StepStartedData;
          setMessages((prev) =>
            prev.some((m) => m.id === d.assistantMessageID)
              ? prev
              : [
                  ...prev,
                  {
                    type: 'assistant',
                    id: d.assistantMessageID,
                    agent: d.agent,
                    model: d.model,
                    time: { created: d.started },
                    content: [],
                  } as AssistantMessage,
                ],
          );
          setTurnStartedAt((t) => (t ? t : Date.now()));
          setRunning(true);
          break;
        }
        case 'session.reasoning.started':
        case 'session.text.started': {
          const kind = event.type.includes('reasoning') ? 'reasoning' : 'text';
          const d = data as unknown as TextBoundaryData;
          setMessages((prev) => upsertPart(prev, d.assistantMessageID, kind, d.ordinal, (p) => p));
          break;
        }
        case 'session.reasoning.delta':
        case 'session.text.delta': {
          const kind = event.type.includes('reasoning') ? 'reasoning' : 'text';
          const d = data as unknown as TextDeltaData;
          setMessages((prev) =>
            upsertPart(prev, d.assistantMessageID, kind, d.ordinal, (p) => ({
              ...p,
              text: (p.text ?? '') + d.delta,
            })),
          );
          break;
        }
        case 'session.reasoning.ended':
        case 'session.text.ended': {
          const kind = event.type.includes('reasoning') ? 'reasoning' : 'text';
          const d = data as unknown as TextEndedData;
          setMessages((prev) =>
            upsertPart(prev, d.assistantMessageID, kind, d.ordinal, (p) => ({ ...p, text: d.text })),
          );
          break;
        }
        case 'session.tool.input.started':
        case 'session.tool.input.ended':
        case 'session.tool.called':
        case 'session.tool.progress':
        case 'session.tool.success':
        case 'session.tool.failed':
        case 'session.step.ended':
          scheduleRefetch();
          break;
        case 'session.execution.started':
          setRunning(true);
          setExecError(null);
          break;
        case 'session.execution.succeeded':
          setRunning(false);
          setExecError(null);
          scheduleRefetch(true);
          break;
        case 'session.execution.failed': {
          const d = data as unknown as ExecutionEventData;
          setRunning(false);
          setExecError(d?.error?.message ?? 'Execution failed');
          scheduleRefetch(true);
          break;
        }
        case 'session.renamed': {
          const d = data as unknown as SessionRenamedData;
          setSessionInfo((s) => (s ? { ...s, title: d.title } : s));
          break;
        }
        case 'session.inbox.enqueued':
          scheduleRefetch();
          break;
        case 'session.usage.updated': {
          const d = data as unknown as UsageEventData;
          setSessionInfo((s) => (s ? { ...s, cost: d.cost ?? s.cost, tokens: d.tokens ?? s.tokens } : s));
          break;
        }
        default:
          break;
      }
    },
    [scheduleRefetch, sessionID],
  );

  useFocusEffect(
    useCallback(() => {
      if (!api || !sessionID) return;
      let alive = true;
      const ctrl = new AbortController();

      setLoaded(false);
      void loadMessages();
      void loadMeta();

      void runEventStream({
        baseUrl: api.baseUrl,
        token: api.token,
        signal: ctrl.signal,
        onStatus: (status) => {
          if (!alive) return;
          setStreamStatus(status);
          if (status === 'connected') {
            // Resync: the stream is volatile and events during the gap were lost.
            void loadMessages();
            void loadMeta();
          }
        },
        onEvent: (event) => {
          if (alive) handleEvent(event);
        },
      });

      return () => {
        alive = false;
        ctrl.abort();
        if (refetchTimer.current) {
          clearTimeout(refetchTimer.current);
          refetchTimer.current = null;
        }
      };
    }, [api, sessionID, loadMessages, loadMeta, handleEvent]),
  );

  // "Recently opened" is recorded here, not at the launcher: every way in —
  // tap, deep link, browser back/forward — passes through this screen, and
  // it catches the freshest title the session had while open here.
  useEffect(() => {
    const info = sessionInfo;
    if (!info || recordedRef.current === info.id) return;
    recordedRef.current = info.id;
    void rememberRecentSession({
      id: info.id,
      title: info.title ?? null,
      directory: info.location?.directory ?? null,
    });
  }, [sessionInfo]);

  // Opening a conversation always lands on the newest turn. The first pass
  // runs with the transcript; the second catches late layout (fonts, code
  // blocks). onScroll's guard only takes over once the reader scrolls away.
  useEffect(() => {
    if (!loaded) return;
    autoScrollRef.current = true;
    draggingRef.current = false;
    setShowJump(false);
    openingRef.current = true;
    const toEnd = () => {
      if (openingRef.current && autoScrollRef.current) {
        listRef.current?.scrollToEnd({ animated: false });
      }
    };
    const raf = requestAnimationFrame(toEnd);
    // late layout (fonts, code blocks, images) keeps moving the end — chase it,
    // but only until the opening settles or the reader touches the list
    const timers = [100, 300, 700].map((ms) => setTimeout(toEnd, ms));
    const done = setTimeout(() => {
      openingRef.current = false;
    }, 900);
    return () => {
      cancelAnimationFrame(raf);
      timers.forEach(clearTimeout);
      clearTimeout(done);
    };
  }, [loaded]);

  // Poll for permission requests while the session is executing.
  useEffect(() => {
    if (!api || !sessionID || !running) return;
    let alive = true;
    const refresh = async () => {
      try {
        const perms = await api.sessionPermissionRequests(sessionID);
        if (!alive) return;
        const mine = perms.data;
        setPermissions((prev) => {
          const same = prev.length === mine.length && prev.every((p, i) => p.id === mine[i]?.id);
          return same ? prev : mine;
        });
      } catch {
        // ignore — next tick retries
      }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 3000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [api, sessionID, running]);

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!api || !sessionID || !text || sending) return;
    setSending(true);
    try {
      await api.prompt(sessionID, { text });
      setDraft('');
      setTurnStartedAt(Date.now());
      setRunning(true);
      scheduleRefetch(true);
    } catch (err) {
      setExecError(describeError(err));
    } finally {
      setSending(false);
    }
  }, [api, sessionID, draft, sending, scheduleRefetch]);

  const stop = useCallback(async () => {
    if (!api || !sessionID) return;
    try {
      await api.interrupt(sessionID);
    } catch {
      // best effort
    }
  }, [api, sessionID]);

  const decide = useCallback(
    async (request: PermissionRequest, decision: PermissionDecision) => {
      if (!api || !sessionID) return;
      setPermBusy(true);
      try {
        await api.replyPermission(sessionID, request.id, decision);
        setPermissions((prev) => prev.filter((p) => p.id !== request.id));
      } catch (err) {
        setExecError(describeError(err));
      } finally {
        setPermBusy(false);
      }
    },
    [api, sessionID],
  );

  const loadModels = useCallback(
    async (silent = false) => {
      const directory = sessionInfo?.location?.directory;
      if (!api || !sessionID || !directory || models || modelsLoading) return;
      setModelsLoading(true);
      try {
        const res = await api.models(directory);
        setModels(res.data);
      } catch (err) {
        // The background fetch (for the context limit) fails quietly; the
        // picker, which needs the list, says so.
        if (!silent) setExecError(describeError(err));
      } finally {
        setModelsLoading(false);
      }
    },
    [api, sessionID, sessionInfo?.location?.directory, models, modelsLoading],
  );

  // The context ring needs the model's window size, so fetch the list early.
  useEffect(() => {
    const directory = sessionInfo?.location?.directory;
    if (!directory || modelsAskedRef.current === directory) return;
    modelsAskedRef.current = directory;
    void loadModels(true);
  }, [sessionInfo?.location?.directory, loadModels]);

  const openModelSheet = useCallback(() => {
    setModelSheetOpen(true);
    void loadModels();
  }, [loadModels]);

  const switchModel = useCallback(
    async (model: ModelInfo, variant?: string) => {
      if (!api || !sessionID) return;
      const prev = sessionInfo?.model ?? null;
      // `default` is the server's "no explicit effort" marker; treat it as none.
      const prevVariant = prev?.variant && prev.variant !== 'default' ? prev.variant : null;
      const nextVariant = variant && variant !== 'default' ? variant : null;
      const same =
        prev?.id === model.id &&
        prev?.providerID === model.providerID &&
        prevVariant === nextVariant;
      if (same) return;
      const ref: ModelRef = { id: model.id, providerID: model.providerID, variant: nextVariant };
      setModelBusy(true);
      // Optimistic: the pill reads the new model immediately; the next
      // refetch and step.started event confirm it, and an error rolls back.
      setSessionInfo((s) => (s ? { ...s, model: ref } : s));
      try {
        await api.switchModel(sessionID, {
          id: ref.id,
          providerID: ref.providerID,
          ...(nextVariant ? { variant: nextVariant } : {}),
        });
      } catch (err) {
        setSessionInfo((s) => (s ? { ...s, model: prev } : s));
        setExecError(describeError(err));
      } finally {
        setModelBusy(false);
      }
    },
    [api, sessionID, sessionInfo?.model],
  );

  const flatRows = useMemo(() => buildRows(messages, running), [messages, running]);
  const rows = useMemo(() => groupRows(flatRows, running), [flatRows, running]);
  if (initialCountRef.current === 0 && rows.length > 0) initialCountRef.current = rows.length;
  const todos = useMemo(() => extractTodos(messages), [messages]);
  const activity = useMemo(() => activityFor(flatRows), [flatRows]);

  const currentModel = sessionInfo?.model ?? null;

  const serverMode: Mode = /plan/i.test(sessionInfo?.agent ?? '') ? 'plan' : 'build';
  const mode: Mode = modeOverride ?? serverMode;
  // the server's value is the truth again once it changes (e.g. switched from the CLI)
  useEffect(() => {
    setModeOverride(null);
  }, [sessionInfo?.agent]);

  const switchMode = useCallback(
    async (next: Mode) => {
      if (!api || !sessionID) return;
      const prev = modeOverride;
      setModeOverride(next);
      setModeBusy(true);
      try {
        await api.switchAgent(sessionID, next);
        setSessionInfo((s) => (s ? { ...s, agent: next } : s));
      } catch (err) {
        setModeOverride(prev);
        setExecError(describeError(err));
      } finally {
        setModeBusy(false);
      }
    },
    [api, sessionID, modeOverride],
  );

  const modelLabel = useMemo(() => {
    if (!currentModel) return null;
    const info = models?.find(
      (m) => m.id === currentModel.id && m.providerID === currentModel.providerID,
    );
    const name = info?.name ?? currentModel.id.split('/').pop() ?? currentModel.id;
    return name;
  }, [currentModel, models]);

  const currentInfo = useMemo(
    () =>
      currentModel
        ? (models?.find(
            (m) => m.id === currentModel.id && m.providerID === currentModel.providerID,
          ) ?? null)
        : null,
    [currentModel, models],
  );
  // The effort button exists only when this model has effort levels.
  const effortLabel = useMemo(() => {
    if (!currentInfo || !currentInfo.variants?.some((v) => v.id !== 'default')) return null;
    const v = currentModel?.variant;
    return v && v !== 'default' ? v : 'Default';
  }, [currentInfo, currentModel]);

  const contextStats = useMemo<ContextStats>(() => {
    const info = currentModel
      ? models?.find((m) => m.id === currentModel.id && m.providerID === currentModel.providerID)
      : undefined;
    const limit = info?.limit?.context && info.limit.context > 0 ? info.limit.context : null;
    const tokens = latestTokens(messages);
    return {
      title: sessionInfo?.title?.trim() || 'Session',
      provider: currentModel?.providerID ?? null,
      modelName: info?.name ?? (currentModel ? (currentModel.id.split('/').pop() ?? currentModel.id) : null),
      contextLimit: limit,
      tokens,
      usage: tokens && limit ? Math.min(1, tokens.total / limit) : null,
      messages: messages.length,
      messagesCapped: messages.length >= PAGE_SIZE,
      userMessages: messages.filter((m) => m.type === 'user').length,
      assistantMessages: messages.filter((m) => m.type === 'assistant').length,
      cost: sessionInfo?.cost,
      created: sessionInfo?.time?.created,
      lastActivity: sessionInfo?.time?.updated,
      running,
    };
  }, [messages, models, currentModel, sessionInfo, running]);

  /** New text while pinned to the end: glide there, at most a few times a second. */
  const followEnd = useCallback(() => {
    if (!autoScrollRef.current || draggingRef.current) return;
    if (openingRef.current) {
      listRef.current?.scrollToEnd({ animated: false });
      return;
    }
    const wait = 220 - (Date.now() - lastFollowRef.current);
    if (followTimer.current) return;
    followTimer.current = setTimeout(
      () => {
        followTimer.current = null;
        if (!autoScrollRef.current || draggingRef.current) return;
        lastFollowRef.current = Date.now();
        listRef.current?.scrollToEnd({ animated: true });
      },
      Math.max(0, wait),
    );
  }, []);

  useEffect(
    () => () => {
      if (followTimer.current) clearTimeout(followTimer.current);
      if (dragEndTimer.current) clearTimeout(dragEndTimer.current);
    },
    [],
  );

  const jumpToLatest = useCallback(() => {
    autoScrollRef.current = true;
    draggingRef.current = false;
    openingRef.current = false;
    setPinned(true);
    listRef.current?.scrollToEnd({ animated: true });
    setShowJump(false);
  }, []);

  const todoSummary = useMemo(() => {
    const total = todos.length;
    const done = todos.filter((t) => t.status === 'completed' || t.status === 'cancelled').length;
    const active = todos.some((t) => t.status === 'in_progress');
    const allDone = total > 0 && done === total;
    return {
      total,
      done,
      color: allDone ? theme.positive : active ? theme.clay : theme.inkMuted,
      soft: allDone ? theme.positiveSoft : active ? theme.claySoft : theme.inkWell,
    };
  }, [todos, theme]);

  if (ready && !api) return <Redirect href="/setup" />;

  const title = sessionInfo?.title?.trim() || 'Session';

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };

  const quiet = { color: theme.inkMuted } as const;

  return (
    <ThemedView style={{ flex: 1 }}>
      {/* nav — inline title, tinted back chevron, nothing else */}
      <View style={{ paddingTop: insets.top }}>
        <View
          style={{
            height: 44,
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: 6,
          }}>
          <PressableScale
            onPress={goBack}
            hitSlop={12}
            accessibilityLabel="Back to sessions"
            style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}>
            <Glyph name="chevron-back" size={26} color={theme.accent} />
          </PressableScale>
          <View style={{ flex: 1, alignItems: 'center' }}>
            <ThemedText type="headline" numberOfLines={1} accessibilityRole="header">
              {title}
            </ThemedText>
          </View>
          {todos.length > 0 ? (
            <FadeRise distance={0} duration={300}>
              <PressableScale
                onPress={() => setTodosOpen((v) => !v)}
                scaleTo={0.94}
                hitSlop={10}
                accessibilityLabel={`To-do list, ${todoSummary.done} of ${todoSummary.total} done`}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 4,
                  height: 26,
                  paddingHorizontal: 9,
                  borderRadius: 13,
                  backgroundColor: todoSummary.soft,
                }}>
                <Glyph set="mci" name="format-list-checks" size={13} color={todoSummary.color} />
                <ThemedText
                  type="caption"
                  weight="semibold"
                  style={{ color: todoSummary.color, fontVariant: ['tabular-nums'] }}>
                  {todoSummary.done}/{todoSummary.total}
                </ThemedText>
              </PressableScale>
            </FadeRise>
          ) : null}
          {/* context ring — how full the window is; tap for the full ledger */}
          <ContextButton
            usage={contextStats.usage}
            running={running}
            onPress={() => setContextOpen(true)}
          />
        </View>
        {/* Build / Plan */}
        <View style={{ alignItems: 'center', paddingBottom: 8 }}>
          <ModeSwitch mode={mode} onChange={(m) => void switchMode(m)} disabled={modeBusy} />
        </View>
      </View>

      {/* conversation */}
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={{ flex: 1 }}>
          {!loaded ? (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <ActivityIndicator size="small" color={theme.inkMuted} />
                <ThemedText type="callout" style={quiet}>
                  Loading conversation
                </ThemedText>
              </View>
            </View>
          ) : (
            <FlatList
              ref={listRef}
              data={rows}
              keyExtractor={(r) => r.id}
              contentContainerStyle={{
                flexGrow: 1,
                paddingHorizontal: Space.gutter,
                paddingTop: Space.gutter,
                paddingBottom: Space.betweenParts,
                maxWidth: 560,
                width: '100%',
                alignSelf: 'center',
              }}
              // Away from the end, whatever the reader is looking at stays put
              // while new text lands below (or content above changes height).
              maintainVisibleContentPosition={pinned ? undefined : { minIndexForVisible: 0 }}
              initialNumToRender={Math.max(20, initialCountRef.current)}
              windowSize={21}
              onScrollBeginDrag={() => {
                // The reader's finger wins over everything automatic.
                if (dragEndTimer.current) clearTimeout(dragEndTimer.current);
                if (followTimer.current) {
                  clearTimeout(followTimer.current);
                  followTimer.current = null;
                }
                openingRef.current = false;
                draggingRef.current = true;
              }}
              onScrollEndDrag={() => {
                // A fling continues after the finger lifts (momentum begin cancels this).
                if (dragEndTimer.current) clearTimeout(dragEndTimer.current);
                dragEndTimer.current = setTimeout(() => {
                  draggingRef.current = false;
                }, 120);
              }}
              onMomentumScrollBegin={() => {
                if (dragEndTimer.current) clearTimeout(dragEndTimer.current);
                draggingRef.current = true;
              }}
              onMomentumScrollEnd={() => {
                draggingRef.current = false;
              }}
              onScroll={(e: NativeSyntheticEvent<NativeScrollEvent>) => {
                const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
                const distance = contentSize.height - layoutMeasurement.height - contentOffset.y;
                // Only the reader may un-pin (or re-pin) the view; our own glides
                // and layout growth never do.
                if (draggingRef.current) autoScrollRef.current = distance < 80;
                const away = autoScrollRef.current ? false : distance > 320;
                setShowJump((prev) => (prev === away ? prev : away));
                const nowPinned = autoScrollRef.current;
                setPinned((prev) => (prev === nowPinned ? prev : nowPinned));
              }}
              scrollEventThrottle={50}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              onContentSizeChange={() => {
                // Opening lands on the newest turn instantly; after that, new text
                // only glides the view along while the reader is at the end.
                followEnd();
              }}
              ListEmptyComponent={
                <View style={{ flex: 1 }} />
              }
              renderItem={({ item: row }) => (
                <View style={{ paddingTop: row.padTop }}>
                  <RowEnter
                    id={row.id}
                    played={playedRef.current}
                    animate={
                      baselineRef.current != null &&
                      !baselineRef.current.has(row.mid) &&
                      !playedRef.current.has(row.id)
                    }>
                  {row.kind === 'image' ? (
                    <MessageImage uri={row.uri} label={row.label} align="right" />
                  ) : row.kind === 'user' ? (
                    <View
                      style={{
                        alignSelf: 'flex-end',
                        marginLeft: Space.userInset,
                        backgroundColor: theme.surfaceRaised,
                        borderRadius: 12,
                        paddingHorizontal: 14,
                        paddingVertical: 10,
                      }}>
                      <ThemedText type="body" selectable>
                        {row.text}
                      </ThemedText>
                    </View>
                  ) : row.kind === 'text' ? (
                    <RichText text={row.text} />
                  ) : row.kind === 'group' ? (
                    <ActivityGroup items={row.items} active={row.active} />
                  ) : row.kind === 'footer' ? (
                    <TurnFooter text={row.text} ms={row.ms} />
                  ) : row.kind === 'question' ? (
                    <QuestionCard part={row.part} />
                  ) : row.kind === 'error' ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Glyph name="warning-outline" size={13} color={theme.negative} />
                      <ThemedText type="callout" style={{ color: theme.negative, flexShrink: 1 }}>
                        {row.text}
                      </ThemedText>
                    </View>
                  ) : (
                    <ThemedText
                      type="caption"
                      numberOfLines={3}
                      style={{ color: theme.inkFaint, textAlign: 'center' }}>
                      {row.text}
                    </ThemedText>
                  )}
                  </RowEnter>
                </View>
              )}
              ListFooterComponent={
                <View
                  style={{
                    gap: 12,
                    marginTop: rows.length > 0 ? 12 : 0,
                  }}>
                  {streamStatus === 'disconnected' ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Glyph name="cloud-offline-outline" size={13} color={theme.inkMuted} />
                      <ThemedText type="callout" style={quiet}>
                        Reconnecting — updates may lag.
                      </ThemedText>
                    </View>
                  ) : null}

                  {execError ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Glyph name="warning-outline" size={13} color={theme.negative} />
                      <ThemedText type="callout" style={{ color: theme.negative, flexShrink: 1 }}>
                        {execError}
                      </ThemedText>
                    </View>
                  ) : null}

                  {todos.length > 0 ? <PlanCard todos={todos} /> : null}

                  {running ? (
                    <WorkingIndicator activity={activity} since={turnStartedAt} />
                  ) : null}
                </View>
              }
            />
          )}
          <JumpButton visible={showJump && loaded} onPress={jumpToLatest} />
        </View>

        <View
          style={{
            paddingBottom: Math.max(insets.bottom, 8),
            paddingTop: 4,
            maxWidth: 560,
            width: '100%',
            alignSelf: 'center',
          }}>
          <Composer
            value={draft}
            onChangeText={setDraft}
            running={running}
            busy={sending}
            onSend={() => void send()}
            onStop={() => void stop()}
            disabled={!api}
            modelLabel={modelLabel}
            onModelPress={openModelSheet}
            effortLabel={effortLabel}
            onEffortPress={() => {
              void loadModels();
              setEffortSheetOpen(true);
            }}
          />
        </View>
      </KeyboardAvoidingView>

      {/* to-do list — the header chip expands it over the transcript */}
      {todosOpen && todos.length > 0 ? (
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}>
          <Pressable
            style={{ flex: 1 }}
            onPress={() => setTodosOpen(false)}
            accessibilityLabel="Close to-do list"
          />
          <FadeRise
            distance={-10}
            duration={260}
            style={{
              position: 'absolute',
              top: insets.top + 50,
              right: 10,
              width: 300,
              maxWidth: '92%',
              maxHeight: 420,
            }}>
            <View
              style={{
                maxHeight: 420,
                borderRadius: Radius.block,
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: theme.hairline,
                backgroundColor: theme.surface,
                overflow: 'hidden',
                elevation: 8,
                shadowColor: '#000',
                shadowOpacity: 0.25,
                shadowRadius: 16,
                shadowOffset: { width: 0, height: 8 },
              }}>
              <ScrollView showsVerticalScrollIndicator={false}>
                <PlanCard todos={todos} />
              </ScrollView>
            </View>
          </FadeRise>
        </View>
      ) : null}

      <ContextSheet
        visible={contextOpen}
        stats={contextStats}
        onClose={() => setContextOpen(false)}
      />

      <ModelSheet
        visible={modelSheetOpen}
        models={models}
        loading={modelsLoading}
        current={currentModel}
        busy={modelBusy}
        onClose={() => setModelSheetOpen(false)}
        onPick={(model, variant) => void switchModel(model, variant)}
      />

      <EffortSheet
        visible={effortSheetOpen}
        model={currentInfo}
        current={currentModel}
        busy={modelBusy}
        onClose={() => setEffortSheetOpen(false)}
        onPick={(model, variant) => void switchModel(model, variant)}
      />

      {/* approvals — a sheet over everything, always in reach */}
      <PermissionCard
        request={permissions[0] ?? null}
        index={0}
        total={permissions.length}
        busy={permBusy}
        onDecide={(decision) => {
          if (permissions[0]) void decide(permissions[0], decision);
        }}
      />
    </ThemedView>
  );
}
