/**
 * Session alerts: local notifications for the two moments that cannot wait —
 * a prompt ending, and the agent asking for an approval or an answer.
 *
 * One stream for the whole app, not one per screen: the alert must arrive
 * while the reader is on the launcher or in another conversation. Alerts are
 * suppressed for the session already on screen, and throttled per session so
 * a burst of tool events cannot turn into a stack of banners.
 *
 * Known ceiling: this is a JS-side stream. When Android suspends the app the
 * stream stops, so a prompt that finishes after suspension has no alert. The
 * reliable path for that is a server-side push (ntfy); this provider is the
 * local half of it.
 */

import * as Notifications from 'expo-notifications';
import { router, usePathname } from 'expo-router';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AppState, Platform } from 'react-native';

import type { OpenCodeApi } from './api';
import { useConnection } from './connection';
import { runEventStream } from './events';
import { basename } from './paths';
import { usePreferences } from './preferences';
import type { PermissionRequest, ServerEvent } from './types';

const NATIVE = Platform.OS !== 'web';
const THROTTLE_MS = 10_000;

type PermissionState = 'checking' | 'granted' | 'denied' | 'undetermined';

function permissionState(status: { granted: boolean; canAskAgain: boolean }): PermissionState {
  return status.granted ? 'granted' : status.canAskAgain ? 'undetermined' : 'denied';
}

interface NotificationPermission {
  permission: PermissionState;
  /** Ask the OS; resolves true only when alerts are allowed. */
  request: () => Promise<boolean>;
}

const PermissionContext = createContext<NotificationPermission>({
  permission: 'undetermined',
  request: async () => false,
});

/** Null-safe for previews and for the web build. */
export function useNotificationPermission(): NotificationPermission {
  return useContext(PermissionContext);
}

export function NotificationsProvider({ children }: Readonly<{ children: ReactNode }>) {
  const { api } = useConnection();
  const { preferences } = usePreferences();
  const pathname = usePathname();
  const [permission, setPermission] = useState<PermissionState>(
    NATIVE ? 'checking' : 'undetermined',
  );
  const pathRef = useRef(pathname);
  const askedRef = useRef(false);
  const handledResponseRef = useRef<string | null>(null);

  useEffect(() => {
    pathRef.current = pathname;
  }, [pathname]);

  useEffect(() => {
    if (!NATIVE) return;
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: false,
        shouldSetBadge: false,
      }),
    });
  }, []);

  useEffect(() => {
    if (!NATIVE) return;
    let alive = true;
    Notifications.getPermissionsAsync()
      .then((status) => {
        if (!alive) return;
        setPermission(permissionState(status));
      })
      .catch(() => {
        if (alive) setPermission('denied');
      });
    return () => {
      alive = false;
    };
  }, []);

  // Android settings can grant or revoke alerts while the app is away. Re-read
  // on return so the Alerts row and the stream follow the real permission.
  useEffect(() => {
    if (!NATIVE) return;
    let alive = true;
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      Notifications.getPermissionsAsync()
        .then((status) => {
          if (alive) setPermission(permissionState(status));
        })
        .catch(() => {});
    });
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);

  const request = useCallback(async () => {
    if (!NATIVE) return false;
    try {
      const status = await Notifications.requestPermissionsAsync();
      setPermission(permissionState(status));
      return status.granted;
    } catch {
      return false;
    }
  }, []);

  // Ask once, after pairing rather than at first paint: the permission prompt
  // belongs to the feature the user just set up, not to the splash screen.
  useEffect(() => {
    if (!NATIVE || !api || !preferences.notifications) return;
    if (permission !== 'undetermined' || askedRef.current) return;
    askedRef.current = true;
    void request();
  }, [api, preferences.notifications, permission, request]);

  // Tapping an alert opens the conversation it came from. The cold-start
  // response is replayed by expo-notifications, so handle each one once.
  useEffect(() => {
    if (!NATIVE) return;
    const open = (data: unknown) => {
      const sessionID =
        data && typeof data === 'object' && 'sessionID' in data
          ? (data as { sessionID?: unknown }).sessionID
          : undefined;
      if (typeof sessionID !== 'string' || !sessionID) return;
      router.push({ pathname: '/session/[id]', params: { id: sessionID } });
    };
    const handle = (response: Notifications.NotificationResponse | null) => {
      if (!response) return;
      const id = response.notification.request.identifier;
      if (handledResponseRef.current === id) return;
      handledResponseRef.current = id;
      open(response.notification.request.content.data);
    };
    const sub = Notifications.addNotificationResponseReceivedListener(handle);
    void Notifications.getLastNotificationResponseAsync()
      .then(async (response) => {
        handle(response);
        if (response) await Notifications.clearLastNotificationResponseAsync();
      })
      .catch(() => {});
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (!NATIVE || !api || !preferences.notifications || permission !== 'granted') return;
    let alive = true;
    const ctrl = new AbortController();
    const lastSent = new Map<string, number>();

    void runEventStream({
      baseUrl: api.baseUrl,
      token: api.token,
      signal: ctrl.signal,
      onEvent: (event) => {
        if (!alive) return;
        void notifyForEvent(api, event, pathRef.current, lastSent);
      },
    });

    return () => {
      alive = false;
      ctrl.abort();
    };
  }, [api, preferences.notifications, permission]);

  const value = useMemo<NotificationPermission>(
    () => ({ permission, request }),
    [permission, request],
  );

  return <PermissionContext.Provider value={value}>{children}</PermissionContext.Provider>;
}

async function notifyForEvent(
  api: OpenCodeApi,
  event: ServerEvent,
  pathname: string,
  lastSent: Map<string, number>,
): Promise<void> {
  const data = event.data as Record<string, unknown> | undefined;
  const sessionID = typeof data?.sessionID === 'string' ? data.sessionID : undefined;
  if (!sessionID) return;

  // The screen already shows the answer/permission card. Everywhere else —
  // launcher, another conversation, or the app in the background — tell them.
  if (AppState.currentState === 'active' && pathname === `/session/${sessionID}`) return;

  // Filter before reserving the throttle slot: a non-question tool call must
  // not block the question that follows it in the same session.
  const isQuestion = event.type === 'session.tool.called' && data?.name === 'question';
  if (
    event.type !== 'session.execution.succeeded' &&
    event.type !== 'session.execution.failed' &&
    event.type !== 'permission.asked' &&
    !isQuestion
  ) {
    return;
  }

  const key = `${event.type}:${sessionID}`;
  const now = Date.now();
  const previous = lastSent.get(key) ?? 0;
  if (now - previous < THROTTLE_MS) return;

  // Reserve the slot before any await. Permission events can arrive together,
  // and a detail fetch must not let each of them through the gate.
  lastSent.set(key, now);
  if (lastSent.size > 50) lastSent.clear();

  const project = projectName(event);
  let title: string;
  let body: string;

  switch (event.type) {
    case 'session.execution.succeeded':
      title = 'Prompt finished';
      body = `${project} finished its turn.`;
      break;
    case 'session.execution.failed':
      title = 'Prompt failed';
      body = errorText(data) ?? `${project} stopped with an error.`;
      break;
    case 'permission.asked':
      title = 'Approval needed';
      body = await permissionText(api, sessionID, data, project);
      break;
    case 'session.tool.called':
      title = 'Question from the agent';
      body = questionText(data, project) ?? `${project} is waiting for your answer.`;
      break;
    default:
      return;
  }

  try {
    await Notifications.scheduleNotificationAsync({
      content: { title, body: clip(body), data: { sessionID }, sound: false },
      trigger: null,
    });
  } catch {
    // An alert is best-effort; never let it disturb the session flow.
  }
}

function projectName(event: ServerEvent): string {
  const directory = event.location?.directory;
  return (directory ? basename(directory) : '') || 'The agent';
}

function clip(text: string): string {
  return text.length > 160 ? `${text.slice(0, 157)}…` : text;
}

function errorText(data: Record<string, unknown> | undefined): string | null {
  const error = data?.error;
  if (!error || typeof error !== 'object' || !('message' in error)) return null;
  const message = (error as { message?: unknown }).message;
  return typeof message === 'string' && message.trim() ? clip(message.trim()) : null;
}

function questionText(data: Record<string, unknown> | undefined, project: string): string | null {
  const input = data?.input;
  if (!input || typeof input !== 'object' || !('questions' in input)) return null;
  const questions = (input as { questions?: unknown }).questions;
  if (!Array.isArray(questions) || questions.length === 0) return null;
  const first = questions[0];
  if (!first || typeof first !== 'object' || !('question' in first)) return null;
  const question = (first as { question?: unknown }).question;
  return typeof question === 'string' && question.trim() ? `${project} · ${question.trim()}` : null;
}

async function permissionText(
  api: OpenCodeApi,
  sessionID: string,
  data: Record<string, unknown> | undefined,
  project: string,
): Promise<string> {
  try {
    const res = await api.sessionPermissionRequests(sessionID);
    const requestID =
      typeof data?.requestID === 'string'
        ? data.requestID
        : typeof data?.id === 'string'
          ? data.id
          : undefined;
    const request = res.data.find((item) => item.id === requestID) ?? res.data[0];
    if (request) return `${project} · ${describePermission(request)}`;
  } catch {
    // The generic line below is enough when the detail fetch fails.
  }
  return `${project} is waiting for your approval.`;
}

function describePermission(request: PermissionRequest): string {
  if (request.message?.trim()) return request.message.trim();
  const resources = request.resources.slice(0, 2).join(', ');
  return resources ? `${request.action}: ${resources}` : request.action;
}
