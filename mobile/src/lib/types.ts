/**
 * Types for the OpenCode V2 HTTP API.
 * Shapes were validated against a live server (v2.0.28) during M0 — see PLAN.md.
 */

// ---------- core ----------

export interface LocationPublicRef {
  directory: string;
}

export interface ModelRef {
  id: string;
  providerID: string;
  variant?: string | null;
}

/** An effort level a model exposes (low…max, thinking…). */
export interface ModelVariant {
  id: string;
  settings?: Record<string, unknown>;
}

export interface ModelInfo {
  /** The provider's own id — slashes allowed (`deepseek/deepseek-v4.1-flash`). */
  id: string;
  modelID: string;
  providerID: string;
  family?: string;
  name: string;
  variants: ModelVariant[];
  status: 'alpha' | 'beta' | 'deprecated' | 'active';
  enabled: boolean;
  time?: { released?: number };
  limit?: { context: number; output: number };
}

export interface ModelListResponse {
  location: LocationPublicRef;
  data: ModelInfo[];
}

export interface TokenUsage {
  input: number;
  output: number;
  reasoning: number;
  cache: { read: number; write: number };
}

export type SessionOutcome = 'succeeded' | 'failed' | 'interrupted';

export interface SessionInfo {
  id: string;
  parentID?: string | null;
  projectID: string;
  title?: string | null;
  agent?: string | null;
  model?: ModelRef | null;
  cost?: number;
  tokens?: TokenUsage;
  outcome?: SessionOutcome;
  time: {
    created: number;
    updated: number;
    idle?: number | null;
    viewed?: number | null;
  };
  location: LocationPublicRef;
}

export interface ServerInfo {
  version: string;
  pid: number;
  urls: string[];
  paths: { tmp: string };
  capabilities: { persistentPty: boolean };
}

export interface Cursor {
  previous?: string | null;
  next?: string | null;
}

export interface ListResponse<T> {
  data: T[];
  cursor?: Cursor;
}

// ---------- messages ----------

export interface MessageTime {
  created?: number;
  streamed?: number;
  completed?: number;
}

export interface TextPart {
  type: 'text';
  text: string;
}

export interface ReasoningPart {
  type: 'reasoning';
  text: string;
}

export interface ToolContentBlock {
  type: string;
  text?: string;
}

export interface ToolState {
  status: string; // running | completed | error | ...
  input?: Record<string, unknown>;
  content?: ToolContentBlock[];
  metadata?: Record<string, unknown>;
  error?: { message?: string } & Record<string, unknown>;
}

export interface ToolPart {
  type: 'tool';
  id: string;
  name: string;
  executed?: boolean;
  state: ToolState;
  time?: MessageTime;
}

export interface UnknownPart {
  type: string;
  [key: string]: unknown;
}

export type MessagePart = TextPart | ReasoningPart | ToolPart | UnknownPart;

export interface UserMessage {
  type: 'user';
  id: string;
  time?: MessageTime;
  text: string;
  files?: unknown[];
}

export interface AssistantMessage {
  type: 'assistant';
  id: string;
  time?: MessageTime;
  agent?: string;
  model?: ModelRef;
  content?: MessagePart[];
  error?: { message?: string } & Record<string, unknown>;
  finish?: string;
  cost?: number;
  tokens?: TokenUsage;
}

export interface IdleMessage {
  type: 'idle';
  id: string;
  time?: MessageTime;
  outcome?: SessionOutcome;
}

/** system, synthetic, skill, shell, compaction, agent-switched, model-switched, ... */
export interface GenericMessage {
  type: string;
  id: string;
  time?: MessageTime;
  [key: string]: unknown;
}

export type MessageInfo = UserMessage | AssistantMessage | IdleMessage | GenericMessage;

// ---------- prompt ----------

export interface PromptFileAttachment {
  uri: string;
  name?: string;
  description?: string;
}

export interface PromptBody {
  text?: string;
  files?: PromptFileAttachment[];
  delivery?: 'steer' | 'queue';
}

export interface PromptAccepted {
  data: {
    id: string;
    sessionID: string;
    time?: { created?: number };
    type: 'user';
    payload?: { text?: string };
    delivery?: string;
  };
}

// ---------- permissions ----------

export interface PermissionRequest {
  id: string;
  sessionID: string;
  action: string;
  resources: string[];
  save?: string[];
  metadata?: Record<string, unknown>;
  message?: string;
}

export type PermissionDecision = 'once' | 'always' | 'reject';

// ---------- pairing ----------

export interface PairingCode {
  code: string;
  expires_in: number;
}

// ---------- sessions: active ----------

export interface ActiveSessionsResponse {
  data: Record<string, { type: string }>;
}

// ---------- SSE events ----------

export interface DurableMeta {
  aggregateID: string;
  seq: number;
  version: number;
}

export interface ServerEvent<T = unknown> {
  id: string;
  created?: number;
  type: string;
  location?: LocationPublicRef;
  data: T;
  durable?: DurableMeta;
}

export interface SessionScoped {
  sessionID: string;
}

export interface TextDeltaData extends SessionScoped {
  assistantMessageID: string;
  ordinal: number;
  delta: string;
}

export interface TextBoundaryData extends SessionScoped {
  assistantMessageID: string;
  ordinal: number;
}

export interface TextEndedData extends TextBoundaryData {
  text: string;
}

export interface StepStartedData extends SessionScoped {
  agent?: string;
  model?: ModelRef;
  assistantMessageID: string;
  started?: number;
}

export interface StepEndedData extends SessionScoped {
  assistantMessageID: string;
  finish?: string;
  cost?: number;
  tokens?: TokenUsage;
}

export interface ToolEventData extends SessionScoped {
  assistantMessageID: string;
  id: string;
  name?: string;
  input?: Record<string, unknown>;
  content?: ToolContentBlock[];
  metadata?: Record<string, unknown>;
  executed?: boolean;
  text?: string;
}

export interface ExecutionEventData extends SessionScoped {
  error?: { type?: string; message?: string } & Record<string, unknown>;
}

export interface SessionRenamedData extends SessionScoped {
  title: string;
}

export interface UsageEventData extends SessionScoped {
  cost?: number;
  tokens?: TokenUsage;
}

export interface InboxEnqueuedData extends SessionScoped {
  inboxID: string;
  item?: { type?: string; payload?: { text?: string }; delivery?: string };
}
