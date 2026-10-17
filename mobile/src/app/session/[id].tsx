import { Redirect, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  TextInput,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PermissionCard } from '@/components/permission-card';
import { RichText } from '@/components/rich-text';
import { basename } from '@/components/session-card';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { ToolBlock } from '@/components/tool-block';
import {
  ArrowUp,
  BackGlyph,
  Banner,
  Chevron,
  IconButton,
  PressableScale,
  ProgressSweep,
  Skeleton,
  TypingDots,
} from '@/components/ui';
import { MaxContentWidth, Radius, Spacing, Touch } from '@/constants/theme';
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
    <PressableScale
      onPress={() => setExpanded((v) => !v)}
      scaleTo={0.99}
      accessibilityLabel={expanded ? 'Collapse reasoning' : 'Expand reasoning'}
      accessibilityState={{ expanded }}
      style={[styles.reasoning, { borderLeftColor: theme.border }]}>
      <View style={styles.reasoningHead}>
        <ThemedText type="caption" themeColor="textSecondary" style={styles.semibold}>
          Reasoning
        </ThemedText>
        <Chevron open={expanded} color={theme.textTertiary} size={6} />
      </View>
      <ThemedText
        type="small"
        themeColor="textSecondary"
        numberOfLines={expanded ? undefined : 2}
        style={styles.reasoningText}>
        {text}
      </ThemedText>
    </PressableScale>
  );
}

function MessageRow({ message, theme }: { message: MessageInfo; theme: Theme }) {
  if (message.type === 'user') {
    const text = String((message as UserMessage).text ?? '');
    return (
      <View style={[styles.userBubble, { backgroundColor: theme.accent }]}>
        <ThemedText selectable style={{ color: theme.onAccent }}>
          {text}
        </ThemedText>
      </View>
    );
  }

  if (message.type === 'assistant') {
    const msg = message as AssistantMessage;
    const parts = (msg.content ?? []) as TaggedPart[];
    if (parts.length === 0 && !msg.error) {
      return (
        <View style={styles.assistantWrap}>
          <TypingDots color={theme.textTertiary} />
        </View>
      );
    }
    return (
      <View style={styles.assistantWrap}>
        {parts.map((part, i) => {
          if (part.type === 'text') return <RichText key={i} text={String((part as TextPart).text ?? '')} />;
          if (part.type === 'reasoning')
            return <ReasoningBlock key={i} text={String(part.text ?? '')} theme={theme} />;
          if (part.type === 'tool')
            return <ToolBlock key={(part as ToolPart).id || `tool-${i}`} part={part as ToolPart} />;
          return null;
        })}
        {msg.error?.message ? (
          <View style={[styles.inlineError, { backgroundColor: theme.dangerSoft }]}>
            <ThemedText type="small" themeColor="danger">
              {msg.error.message}
            </ThemedText>
          </View>
        ) : null}
      </View>
    );
  }

  if (message.type === 'idle') {
    const outcome = (message as IdleMessage).outcome;
    const label = outcome === 'failed' ? 'Turn failed' : outcome === 'interrupted' ? 'Stopped' : 'Done';
    const color = outcome === 'failed' ? theme.danger : theme.textTertiary;
    return (
      <View style={styles.divider}>
        <View style={[styles.dividerLine, { backgroundColor: theme.border }]} />
        <ThemedText type="caption" style={{ color }}>
          {label}
        </ThemedText>
        <View style={[styles.dividerLine, { backgroundColor: theme.border }]} />
      </View>
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
    <View style={[styles.systemChip, { backgroundColor: theme.backgroundSelected }]}>
      <ThemedText type="caption" themeColor="textSecondary" numberOfLines={3}>
        {message.type === label ? label : `${message.type}: ${label}`}
      </ThemedText>
    </View>
  );
}

function LoadingMessages() {
  return (
    <View style={styles.loading}>
      <Skeleton style={styles.skelUser} />
      <Skeleton style={styles.skelLine} />
      <Skeleton style={[styles.skelLine, { width: '70%' }]} />
      <Skeleton style={styles.skelTool} />
    </View>
  );
}

/** Floating "jump to latest" — appears only after the reader scrolls up. */
function JumpButton({ visible, onPress }: { visible: boolean; onPress: () => void }) {
  const theme = useTheme();
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(v, {
      toValue: visible ? 1 : 0,
      duration: 180,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: Platform.OS !== 'web',
    }).start();
  }, [visible, v]);
  return (
    <Animated.View
      pointerEvents={visible ? 'auto' : 'none'}
      style={[
        styles.jump,
        { opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }] },
      ]}>
      <PressableScale
        onPress={onPress}
        accessibilityLabel="Jump to latest message"
        style={[styles.jumpInner, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
        <Chevron open color={theme.text} size={7} />
        <ThemedText type="smallBold">Latest</ThemedText>
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
  const [showJump, setShowJump] = useState(false);
  const [focused, setFocused] = useState(false);
  const insets = useSafeAreaInsets();

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
  const subtitle = [
    sessionInfo?.location?.directory ? basename(sessionInfo.location.directory) : null,
    sessionInfo?.model?.id ?? null,
  ]
    .filter(Boolean)
    .join('  /  ');
  const canSend = Boolean(draft.trim()) && !sending;

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };

  const jumpToLatest = () => {
    autoScrollRef.current = true;
    setShowJump(false);
    listRef.current?.scrollToEnd({ animated: true });
  };

  return (
    <ThemedView style={styles.screen}>
      {/* header */}
      <View style={[styles.header, { paddingTop: insets.top + Spacing.two, borderBottomColor: theme.border }]}>
        <View style={styles.headerInner}>
          <IconButton onPress={goBack} label="Back to sessions">
            <BackGlyph color={theme.text} />
          </IconButton>
          <View style={styles.headerText}>
            <ThemedText type="smallBold" numberOfLines={1} accessibilityRole="header" style={styles.headerTitle}>
              {title}
            </ThemedText>
            {subtitle ? (
              <ThemedText type="caption" themeColor="textSecondary" numberOfLines={1}>
                {subtitle}
              </ThemedText>
            ) : null}
          </View>
          {running ? (
            <PressableScale
              onPress={() => void stop()}
              accessibilityLabel="Stop the agent"
              scaleTo={0.94}
              style={[styles.stop, { backgroundColor: theme.dangerSoft }]}>
              <View style={[styles.stopSquare, { backgroundColor: theme.danger }]} />
              <ThemedText type="smallBold" themeColor="danger">
                Stop
              </ThemedText>
            </PressableScale>
          ) : (
            <View style={{ width: Touch }} />
          )}
        </View>
        <ProgressSweep active={running} color={theme.running} />
      </View>

      {streamStatus !== 'connected' && (
        <Banner tone="info">{streamStatus === 'connecting' ? 'Connecting…' : 'Reconnecting. Updates may lag.'}</Banner>
      )}

      {execError && (
        <Banner tone="danger" actionLabel="Dismiss" onAction={() => setExecError(null)}>
          {execError}
        </Banner>
      )}

      {/* conversation */}
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.flex}>
          {!loaded ? (
            <LoadingMessages />
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
                const far = distance > 400;
                setShowJump((prev) => (prev === far ? prev : far));
              }}
              scrollEventThrottle={100}
              keyboardShouldPersistTaps="handled"
              onContentSizeChange={() => {
                if (autoScrollRef.current) listRef.current?.scrollToEnd({ animated: false });
              }}
              ListEmptyComponent={
                <View style={styles.center}>
                  <ThemedText type="subtitle">Nothing here yet</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary" style={styles.centerText}>
                    Send a message below to start working with OpenCode.
                  </ThemedText>
                </View>
              }
              ListFooterComponent={
                running && messages[messages.length - 1]?.type !== 'assistant' ? (
                  <View style={styles.footer}>
                    <TypingDots color={theme.textTertiary} />
                  </View>
                ) : undefined
              }
            />
          )}
          <JumpButton visible={showJump} onPress={jumpToLatest} />
        </View>

        {/* approvals sit right above the composer so they are always in thumb reach */}
        {permissions.length > 0 && (
          <View style={styles.dock}>
            <PermissionCard
              request={permissions[0]}
              index={0}
              total={permissions.length}
              busy={permBusy}
              onDecide={(decision) => void decide(permissions[0], decision)}
            />
          </View>
        )}

        <View
          style={[
            styles.composerWrap,
            { borderTopColor: theme.border, paddingBottom: Math.max(insets.bottom, Spacing.two) + Spacing.one },
          ]}>
          <View
            style={[
              styles.composer,
              { backgroundColor: theme.backgroundElement, borderColor: focused ? theme.accent : theme.border },
            ]}>
            <TextInput
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              style={[styles.input, { color: theme.text }]}
              placeholder={running ? 'Add a follow-up…' : 'Message OpenCode…'}
              placeholderTextColor={theme.textTertiary}
              multiline
              numberOfLines={1}
              value={draft}
              onChangeText={setDraft}
              editable={Boolean(api)}
              accessibilityLabel="Message"
              onKeyPress={(e) => {
                // Web: Enter sends, Shift+Enter adds a line.
                if (Platform.OS !== 'web') return;
                const ne = e.nativeEvent as unknown as { key: string; shiftKey?: boolean };
                if (ne.key === 'Enter' && !ne.shiftKey) {
                  (e as unknown as { preventDefault?: () => void }).preventDefault?.();
                  void send();
                }
              }}
            />
            <PressableScale
              disabled={!canSend}
              onPress={() => void send()}
              accessibilityLabel="Send message"
              scaleTo={0.9}
              style={[
                styles.send,
                { backgroundColor: canSend || sending ? theme.accent : theme.backgroundSelected },
              ]}>
              {sending ? (
                <ActivityIndicator size="small" color={theme.onAccent} />
              ) : (
                <ArrowUp color={canSend ? theme.onAccent : theme.textTertiary} />
              )}
            </PressableScale>
          </View>
        </View>
      </KeyboardAvoidingView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  flex: { flex: 1 },
  semibold: { fontWeight: '600' },
  header: { borderBottomWidth: StyleSheet.hairlineWidth },
  headerInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three - 4,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.two + 2,
  },
  headerText: { flex: 1, gap: 1 },
  headerTitle: { fontSize: 16, lineHeight: 22 },
  stop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 38,
    paddingHorizontal: 14,
    borderRadius: Radius.pill,
  },
  stopSquare: { width: 10, height: 10, borderRadius: 2 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.five, gap: Spacing.two },
  centerText: { textAlign: 'center', maxWidth: 280 },
  listContent: {
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    padding: Spacing.three,
    gap: Spacing.four - 4,
    flexGrow: 1,
  },
  userBubble: {
    alignSelf: 'flex-end',
    maxWidth: '85%',
    borderRadius: Radius.large,
    borderBottomRightRadius: 6,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + 2,
  },
  assistantWrap: { gap: Spacing.two + 2, alignSelf: 'stretch' },
  reasoning: { borderLeftWidth: 2, paddingLeft: Spacing.three - 2, gap: 2 },
  reasoningHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  reasoningText: { fontStyle: 'italic' },
  inlineError: { borderRadius: Radius.medium, padding: Spacing.three - 2 },
  divider: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three - 4, paddingVertical: Spacing.one },
  dividerLine: { flex: 1, height: StyleSheet.hairlineWidth },
  systemChip: {
    alignSelf: 'center',
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.three - 2,
    paddingVertical: 4,
    maxWidth: '92%',
  },
  footer: { paddingTop: Spacing.three - 4 },
  loading: {
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    padding: Spacing.three,
    gap: Spacing.three - 4,
  },
  skelUser: { height: 44, width: '55%', alignSelf: 'flex-end', borderRadius: Radius.large },
  skelLine: { height: 14, width: '95%' },
  skelTool: { height: 56, borderRadius: Radius.medium, marginTop: Spacing.two },
  jump: { position: 'absolute', alignSelf: 'center', bottom: Spacing.three },
  jumpInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 38,
    paddingHorizontal: Spacing.three,
    borderRadius: Radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  dock: { width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  composerWrap: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: Spacing.two + 2,
    paddingHorizontal: Spacing.three,
    alignItems: 'center',
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    width: '100%',
    maxWidth: MaxContentWidth,
    borderRadius: 26,
    borderWidth: StyleSheet.hairlineWidth,
    paddingLeft: Spacing.three,
    paddingRight: 5,
    paddingVertical: 5,
    gap: Spacing.two,
  },
  input: {
    flex: 1,
    maxHeight: 132,
    minHeight: 36,
    paddingTop: Platform.OS === 'ios' ? 8 : 6,
    paddingBottom: Platform.OS === 'ios' ? 8 : 6,
    fontSize: 16,
    lineHeight: 22,
    textAlignVertical: 'center',
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null),
  },
  send: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
});
