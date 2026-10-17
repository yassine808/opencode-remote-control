import { Redirect, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  TextInput,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { describeError } from '@/lib/api';
import { useConnection } from '@/lib/connection';
import { runEventStream, type StreamStatus } from '@/lib/events';
import type {
  AssistantMessage,
  ExecutionEventData,
  GenericMessage,
  IdleMessage,
  MessageInfo,
  MessagePart,
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
  ToolPart,
  UsageEventData,
  UserMessage,
} from '@/lib/types';

type Theme = ReturnType<typeof useTheme>;
type TaggedPart = MessagePart & { __ordinal?: number };

const TOOL_STATUS_COLORS: Record<string, string> = {
  running: '#E8A13C',
  completed: '#3FB950',
  error: '#F85149',
};

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

// ---------- message rendering ----------

function ReasoningBlock({ text, theme }: { text: string; theme: Theme }) {
  const [expanded, setExpanded] = useState(false);
  if (!text) return null;
  return (
    <Pressable
      onPress={() => setExpanded((v) => !v)}
      style={[styles.reasoning, { borderLeftColor: theme.backgroundSelected }]}>
      <ThemedText type="small" themeColor="textSecondary">
        Thinking{expanded ? '' : ' — tap to expand'}
      </ThemedText>
      <ThemedText
        type="small"
        themeColor="textSecondary"
        numberOfLines={expanded ? undefined : 3}
        style={styles.reasoningText}>
        {text}
      </ThemedText>
    </Pressable>
  );
}

function ToolBlock({ part, theme }: { part: ToolPart; theme: Theme }) {
  const [expanded, setExpanded] = useState(false);
  const status = part.state?.status ?? 'unknown';
  const color = TOOL_STATUS_COLORS[status] ?? theme.textSecondary;
  const inputPreview = part.state?.input ? JSON.stringify(part.state.input) : '';
  const outputText = (part.state?.content ?? [])
    .map((c) => c.text ?? '')
    .filter(Boolean)
    .join('\n');
  const glyph = status === 'running' ? '●' : status === 'completed' ? '✓' : status === 'error' ? '✗' : '·';

  return (
    <Pressable
      onPress={() => setExpanded((v) => !v)}
      style={[styles.tool, { backgroundColor: theme.backgroundElement }]}>
      <View style={styles.toolHeader}>
        <ThemedText type="small" style={{ color }}>
          {glyph}
        </ThemedText>
        <ThemedText type="code" style={styles.toolName} numberOfLines={1}>
          {part.name}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {status}
        </ThemedText>
      </View>
      {!expanded && inputPreview ? (
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={1} style={styles.toolPreview}>
          {inputPreview}
        </ThemedText>
      ) : null}
      {expanded && (
        <View style={styles.toolBody}>
          {inputPreview ? (
            <ThemedText type="code" style={styles.toolCode}>
              {JSON.stringify(part.state.input, null, 2)}
            </ThemedText>
          ) : null}
          {part.state?.error?.message ? (
            <ThemedText type="code" style={[styles.toolCode, { color: TOOL_STATUS_COLORS.error }]}>
              {part.state.error.message}
            </ThemedText>
          ) : null}
          {outputText ? (
            <ThemedText type="code" style={styles.toolCode}>
              {outputText.length > 4000 ? `${outputText.slice(0, 4000)}…` : outputText}
            </ThemedText>
          ) : null}
        </View>
      )}
    </Pressable>
  );
}

function MessageRow({ message, theme }: { message: MessageInfo; theme: Theme }) {
  if (message.type === 'user') {
    const text = String((message as UserMessage).text ?? '');
    return (
      <View style={[styles.userBubble, { backgroundColor: theme.backgroundSelected }]}>
        <ThemedText>{text}</ThemedText>
      </View>
    );
  }

  if (message.type === 'assistant') {
    const msg = message as AssistantMessage;
    const parts = (msg.content ?? []) as TaggedPart[];
    if (parts.length === 0 && !msg.error) {
      return (
        <View style={styles.assistantWrap}>
          <ActivityIndicator size="small" color={theme.textSecondary} />
        </View>
      );
    }
    return (
      <View style={styles.assistantWrap}>
        {parts.map((part, i) => {
          if (part.type === 'text') return <ThemedText key={i}>{(part as TextPart).text}</ThemedText>;
          if (part.type === 'reasoning')
            return <ReasoningBlock key={i} text={String(part.text ?? '')} theme={theme} />;
          if (part.type === 'tool')
            return <ToolBlock key={(part as ToolPart).id || `tool-${i}`} part={part as ToolPart} theme={theme} />;
          return null;
        })}
        {msg.error?.message ? (
          <ThemedText type="small" style={styles.errorInline}>
            {msg.error.message}
          </ThemedText>
        ) : null}
      </View>
    );
  }

  if (message.type === 'idle') {
    const outcome = (message as IdleMessage).outcome;
    return (
      <ThemedText type="small" themeColor="textSecondary" style={styles.idleLine}>
        {outcome === 'failed' ? '— turn failed' : outcome === 'interrupted' ? '— interrupted' : '— idle'}
      </ThemedText>
    );
  }

  const generic = message as GenericMessage;
  const label =
    typeof generic.title === 'string'
      ? generic.title
      : typeof generic.text === 'string'
        ? (generic.text as string)
        : message.type;
  return (
    <ThemedText type="small" themeColor="textSecondary" style={styles.systemLine} numberOfLines={3}>
      [{message.type}] {label}
    </ThemedText>
  );
}

function PermissionCard({
  request,
  busy,
  theme,
  onDecide,
}: {
  request: PermissionRequest;
  busy: boolean;
  theme: Theme;
  onDecide: (decision: PermissionDecision) => void;
}) {
  const resources = request.resources ?? [];
  const shown = resources.slice(0, 3);
  return (
    <View style={[styles.permCard, { borderColor: TOOL_STATUS_COLORS.running, backgroundColor: theme.backgroundElement }]}>
      <ThemedText type="smallBold">Approval needed</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {request.message || `OpenCode wants to run: ${request.action}`}
      </ThemedText>
      {shown.map((r) => (
        <ThemedText key={r} type="code" numberOfLines={1} style={styles.permResource}>
          {r}
        </ThemedText>
      ))}
      {resources.length > shown.length ? (
        <ThemedText type="small" themeColor="textSecondary">
          +{resources.length - shown.length} more
        </ThemedText>
      ) : null}
      <View style={styles.permButtons}>
        <Pressable
          disabled={busy}
          style={[styles.permButton, { backgroundColor: TOOL_STATUS_COLORS.completed }]}
          onPress={() => onDecide('once')}>
          <ThemedText type="smallBold" style={styles.whiteText}>
            Allow once
          </ThemedText>
        </Pressable>
        <Pressable
          disabled={busy}
          style={[styles.permButton, { backgroundColor: theme.backgroundSelected }]}
          onPress={() => onDecide('always')}>
          <ThemedText type="smallBold">Always</ThemedText>
        </Pressable>
        <Pressable
          disabled={busy}
          style={[styles.permButton, { backgroundColor: TOOL_STATUS_COLORS.error }]}
          onPress={() => onDecide('reject')}>
          <ThemedText type="smallBold" style={styles.whiteText}>
            Reject
          </ThemedText>
        </Pressable>
      </View>
    </View>
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

  const listRef = useRef<FlatList<MessageInfo>>(null);
  const autoScrollRef = useRef(true);
  const refetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadMessages = useCallback(async () => {
    if (!api || !sessionID) return;
    try {
      const res = await api.messages(sessionID, { limit: 60, order: 'desc' });
      setMessages([...res.data].reverse());
      setLoaded(true);
    } catch {
      // transient — SSE reconnect or next poll will retry
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
      setRunning(Boolean(act.data[sessionID]));
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
      if (__DEV__ && event.durable) {
        console.log(`[ocrc] ${event.type} seq=${event.durable.seq}`);
      }

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

  if (ready && !api) return <Redirect href="/setup" />;

  const title = sessionInfo?.title?.trim() || 'Session';

  return (
    <ThemedView style={styles.screen}>
      <Stack.Screen
        options={{
          title,
          headerRight: running
            ? () => (
                <Pressable onPress={() => void stop()}>
                  <ThemedText type="smallBold" style={styles.errorText}>
                    Stop
                  </ThemedText>
                </Pressable>
              )
            : undefined,
        }}
      />

      {streamStatus !== 'connected' && (
        <View style={[styles.strip, { backgroundColor: theme.backgroundElement }]}>
          <ThemedText type="small" themeColor="textSecondary">
            {streamStatus === 'connecting' ? 'Connecting…' : 'Reconnecting — updates may lag'}
          </ThemedText>
        </View>
      )}

      {execError && (
        <Pressable style={[styles.strip, styles.errorStrip]} onPress={() => setExecError(null)}>
          <ThemedText type="small" style={styles.errorText}>
            {execError} (tap to dismiss)
          </ThemedText>
        </Pressable>
      )}

      {permissions.map((request) => (
        <PermissionCard
          key={request.id}
          request={request}
          busy={permBusy}
          theme={theme}
          onDecide={(decision) => void decide(request, decision)}
        />
      ))}

      {!loaded ? (
        <View style={styles.center}>
          <ActivityIndicator color={theme.text} />
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(m) => m.id}
          renderItem={({ item }) => <MessageRow message={item} theme={theme} />}
          contentContainerStyle={styles.listContent}
          onScroll={(e: NativeSyntheticEvent<NativeScrollEvent>) => {
            const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
            const distance = contentSize.height - layoutMeasurement.height - contentOffset.y;
            autoScrollRef.current = distance < 140;
          }}
          scrollEventThrottle={100}
          onContentSizeChange={() => {
            if (autoScrollRef.current) listRef.current?.scrollToEnd({ animated: false });
          }}
          ListEmptyComponent={
            <View style={styles.center}>
              <ThemedText type="small" themeColor="textSecondary" style={styles.centerText}>
                No messages yet. Send one from the composer below.
              </ThemedText>
            </View>
          }
          ListFooterComponent={
            running ? (
              <ActivityIndicator size="small" color={theme.textSecondary} style={styles.footerSpinner} />
            ) : undefined
          }
        />
      )}

      <View
        style={[
          styles.composer,
          { backgroundColor: theme.background, borderTopColor: theme.backgroundSelected },
        ]}>
        <TextInput
          style={[styles.input, { backgroundColor: theme.backgroundElement, color: theme.text }]}
          placeholder="Message OpenCode…"
          placeholderTextColor={theme.textSecondary}
          multiline
          value={draft}
          onChangeText={setDraft}
          editable={Boolean(api)}
        />
        <Pressable
          style={[
            styles.sendButton,
            { backgroundColor: draft.trim() && !sending ? '#2F81F7' : theme.backgroundSelected },
          ]}
          disabled={!draft.trim() || sending}
          onPress={() => void send()}>
          {sending ? (
            <ActivityIndicator size="small" color="#ffffff" />
          ) : (
            <ThemedText type="smallBold" style={styles.whiteText}>
              Send
            </ThemedText>
          )}
        </Pressable>
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  strip: { paddingHorizontal: Spacing.three, paddingVertical: Spacing.two },
  errorStrip: { backgroundColor: '#F8514922' },
  errorText: { color: '#F85149' },
  errorInline: { color: '#F85149' },
  whiteText: { color: '#ffffff' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.five },
  centerText: { textAlign: 'center' },
  listContent: { padding: Spacing.three, gap: Spacing.three, flexGrow: 1 },
  userBubble: {
    alignSelf: 'flex-end',
    maxWidth: '85%',
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  assistantWrap: { gap: Spacing.two, alignSelf: 'stretch' },
  reasoning: { borderLeftWidth: 2, paddingLeft: Spacing.three, gap: Spacing.one },
  reasoningText: { fontStyle: 'italic' },
  tool: { borderRadius: Spacing.two, padding: Spacing.three, gap: Spacing.two },
  toolHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  toolName: { flex: 1 },
  toolPreview: { opacity: 0.8 },
  toolBody: { gap: Spacing.two },
  toolCode: { fontSize: 12, lineHeight: 16 },
  idleLine: { textAlign: 'center' },
  systemLine: { textAlign: 'center', fontStyle: 'italic' },
  permCard: {
    margin: Spacing.three,
    marginBottom: 0,
    borderWidth: 1,
    borderRadius: Spacing.three,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  permResource: { fontSize: 12, lineHeight: 16 },
  permButtons: { flexDirection: 'row', gap: Spacing.two, marginTop: Spacing.two },
  permButton: { paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, borderRadius: Spacing.two },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.two,
    padding: Spacing.three,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  input: {
    flex: 1,
    maxHeight: 120,
    minHeight: 40,
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    fontSize: 16,
    textAlignVertical: 'top',
  },
  sendButton: {
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
    borderRadius: Spacing.three,
    minWidth: 64,
    alignItems: 'center',
  },
  footerSpinner: { marginVertical: Spacing.three },
});
