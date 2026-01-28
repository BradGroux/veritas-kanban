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
  traces?: boolean;  // Optional trace collection (future)
}

/** Query options for fetching events */
export interface TelemetryQueryOptions {
  type?: TelemetryEventType | TelemetryEventType[];
  since?: string;  // ISO timestamp
  until?: string;  // ISO timestamp
  taskId?: string;
  project?: string;
  limit?: number;
}
