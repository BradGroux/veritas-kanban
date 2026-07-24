import type { ExecutableAgentProvider } from './config.types.js';

export const RUN_EVENT_SCHEMA_VERSION = 'run-event/v1' as const;

export const RUN_EVENT_KINDS = [
  'run.started',
  'run.completed',
  'run.failed',
  'run.interrupted',
  'run.recovered',
  'conversation.started',
  'conversation.resumed',
  'conversation.followed-up',
  'conversation.forked',
  'conversation.steered',
  'conversation.interrupted',
  'conversation.compacted',
  'conversation.archived',
  'conversation.closed',
  'message.operator',
  'message.assistant',
  'message.delta',
  'reasoning.delta',
  'progress',
  'stream.stdout',
  'stream.stderr',
  'command.started',
  'command.completed',
  'file.changed',
  'tool.started',
  'tool.completed',
  'approval.requested',
  'approval.resolved',
  'artifact.created',
  'usage.updated',
  'run.error',
  'provider.unknown',
] as const;

export type KnownRunEventKind = (typeof RUN_EVENT_KINDS)[number];

/**
 * Known event kinds receive stable projection semantics. Namespaced unknown
 * kinds remain valid so newer provider events can be stored and replayed
 * without pretending Veritas understands them.
 */
export type RunEventKind = KnownRunEventKind | (string & {});

export type RunEventRedactionStatus = 'none' | 'redacted' | 'dropped';

export type RunEventJsonValue =
  null | boolean | number | string | RunEventJsonValue[] | { [key: string]: RunEventJsonValue };

export interface RunEventSource {
  provider: ExecutableAgentProvider | 'operator' | 'system';
  adapter: string;
  agent?: string;
  model?: string;
}

export interface RunEventRedaction {
  status: RunEventRedactionStatus;
  fields: string[];
  originalBytes: number;
  persistedBytes: number;
}

export interface RunEventEnvelope {
  schemaVersion: typeof RUN_EVENT_SCHEMA_VERSION;
  eventId: string;
  taskId: string;
  runId: string;
  attemptId: string;
  sessionId?: string;
  turnId?: string;
  itemId?: string;
  providerEventId?: string;
  parentEventId?: string;
  causalEventId?: string;
  sequence: number;
  providerTimestamp?: string;
  receivedAt: string;
  kind: RunEventKind;
  source: RunEventSource;
  redaction: RunEventRedaction;
  payload: Record<string, RunEventJsonValue>;
  payloadHash: string;
  dedupeKey?: string;
}

export interface RunEventAppendInput {
  taskId: string;
  attemptId: string;
  sessionId?: string;
  turnId?: string;
  itemId?: string;
  providerEventId?: string;
  parentEventId?: string;
  causalEventId?: string;
  providerTimestamp?: string;
  kind: RunEventKind;
  source: RunEventSource;
  payload: Record<string, unknown>;
  dedupeKey?: string;
}

export interface RunEventAppendResult {
  event: RunEventEnvelope;
  appended: boolean;
}

export interface RunEventQuery {
  taskId: string;
  attemptId: string;
  afterSequence?: number;
  limit?: number;
}

export interface RunEventPage {
  schemaVersion: typeof RUN_EVENT_SCHEMA_VERSION;
  taskId: string;
  attemptId: string;
  events: RunEventEnvelope[];
  nextCursor: number;
  hasMore: boolean;
}

export interface RunEventSubscriptionRequest {
  type: 'subscribe';
  taskId: string;
  attemptId?: string;
  afterSequence?: number;
  workspaceId?: string;
}
