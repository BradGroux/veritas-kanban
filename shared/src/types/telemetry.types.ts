// Telemetry Types

import type { TaskStatus, AgentType } from './task.types.js';

export type TelemetryEventType =
  | 'task.created'
  | 'task.status_changed'
  | 'task.archived'
  | 'task.restored'
  | 'run.started'
  | 'run.completed'
  | 'run.error'
  | 'run.tokens';

/** Base telemetry event - all events extend this */
export interface TelemetryEvent {
  id: string;
  type: TelemetryEventType;
  timestamp: string;
  taskId?: string;
  project?: string;
}

/** Task lifecycle events */
export interface TaskTelemetryEvent extends TelemetryEvent {
  type: 'task.created' | 'task.status_changed' | 'task.archived' | 'task.restored';
  taskId: string;
  status?: TaskStatus;
  previousStatus?: TaskStatus;
}

/** Agent run started event */
export interface RunStartedEvent extends TelemetryEvent {
  type: 'run.started';
  taskId: string;
  agent: string;
  model?: string;
  sessionKey?: string;
  attemptId?: string;
}

/** Agent run completed event */
export interface RunCompletedEvent extends TelemetryEvent {
  type: 'run.completed';
  taskId: string;
  agent: string;
  success: boolean;
  durationMs?: number;
  error?: string;
  exitCode?: number;
  attemptId?: string;
}

/** Agent run error event */
export interface RunErrorEvent extends TelemetryEvent {
  type: 'run.error';
  taskId: string;
  agent: string;
  error: string;
  stackTrace?: string;
  attemptId?: string;
}

/** Legacy combined run event (for backward compatibility) */
export interface RunTelemetryEvent extends TelemetryEvent {
  type: 'run.started' | 'run.completed' | 'run.error';
  taskId: string;
  attemptId?: string;
  agent: string;
  durationMs?: number;
  exitCode?: number;
  success?: boolean;
  error?: string;
  model?: string;
  sessionKey?: string;
  stackTrace?: string;
}

/** Token usage events */
export interface TokenTelemetryEvent extends TelemetryEvent {
  type: 'run.tokens';
  taskId: string;
  agent: string;
  inputTokens: number;
  outputTokens: number;
  cacheTokens?: number;
  totalTokens?: number;
  cost?: number;
  model?: string;
  attemptId?: string;
}

/** Union type for all telemetry events */
export type AnyTelemetryEvent =
  | TaskTelemetryEvent
  | RunTelemetryEvent
  | RunStartedEvent
  | RunCompletedEvent
  | RunErrorEvent
  | TokenTelemetryEvent;

/** Telemetry configuration */
export interface TelemetryConfig {
  enabled: boolean;
  retention: number; // Days to retain events
  traces?: boolean; // Optional trace collection (future)
}

/** Low-level trace step types captured during an agent attempt. */
export type AgentRunTraceStepType =
  | 'init'
  | 'execute'
  | 'stream'
  | 'retry'
  | 'abort'
  | 'finalize'
  | 'complete'
  | 'error';

/** Additional run context persisted with each trace for replay/audit surfaces. */
export interface AgentRunTraceMetadata {
  clientSource?: string;
  mode?: string | null;
  capabilitySet?: string[];
  workspaceId?: string;
  sessionKey?: string;
  runKey?: string;
  policyProfile?: string;
  provider?: string;
  model?: string;
  taskType?: string;
  repo?: string;
  branch?: string;
  baseBranch?: string;
  worktreePath?: string;
}

/** A single sequenced step inside an agent run trace. */
export interface AgentRunTraceStep {
  type: AgentRunTraceStepType;
  sequence?: number;
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
  metadata?: Record<string, unknown>;
}

/** Stored or active trace for one agent attempt. */
export interface AgentRunTrace {
  traceId: string; // Same as attemptId
  taskId: string;
  agent: AgentType;
  project?: string;
  startedAt: string;
  endedAt?: string;
  totalDurationMs?: number;
  steps: AgentRunTraceStep[];
  status: 'running' | 'completed' | 'failed' | 'error';
  metadata?: AgentRunTraceMetadata;
}

/** Timeline event categories exposed to the task run replay UI. */
export type AgentRunTimelineEventType =
  | 'prompt'
  | 'command'
  | 'file'
  | 'policy'
  | 'approval'
  | 'error'
  | 'usage'
  | 'tool'
  | 'result';

export type AgentRunTimelineEventSource = 'live' | 'stored' | 'derived';

export interface AgentRunTimelineEvent {
  id: string;
  sequence: number;
  type: AgentRunTimelineEventType;
  source: AgentRunTimelineEventSource;
  timestamp: string;
  title: string;
  detail?: string;
  durationMs?: number;
  metadata?: Record<string, unknown>;
  link?: {
    label: string;
    href: string;
    target?: 'agent' | 'changes' | 'details' | 'review' | 'work-products' | 'workflow' | 'external';
  };
}

/** Query options for fetching events */
export interface TelemetryQueryOptions {
  type?: TelemetryEventType | TelemetryEventType[];
  since?: string; // ISO timestamp
  until?: string; // ISO timestamp
  taskId?: string;
  project?: string;
  limit?: number;
}
