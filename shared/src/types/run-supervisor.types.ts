import type { AgentBudgetState } from './agent-budget.types.js';
import type { ExecutableAgentProvider } from './config.types.js';
import type { CompletionResult } from './task-envelope.types.js';

export const RUN_SUPERVISOR_SCHEMA_VERSION = 'run-supervisor/v1' as const;

export const RUN_SUPERVISOR_STATES = [
  'launching',
  'running',
  'recovering',
  'reattached',
  'recovery-required',
  'completed',
  'failed',
  'interrupted',
  'cancelled',
] as const;

export type RunSupervisorState = (typeof RUN_SUPERVISOR_STATES)[number];
export type RunSupervisorTerminalState = Extract<
  RunSupervisorState,
  'completed' | 'failed' | 'interrupted' | 'cancelled'
>;

export const RUN_SUPERVISOR_RECOVERY_OPERATIONS = ['status', 'stop', 'reattach', 'resume'] as const;
export type RunSupervisorRecoveryOperation = (typeof RUN_SUPERVISOR_RECOVERY_OPERATIONS)[number];

export const RUN_SUPERVISOR_RECOVERY_REASON_CODES = [
  'binding-mismatch',
  'lease-held',
  'foreign-host',
  'process-not-found',
  'process-identity-mismatch',
  'process-identity-unverifiable',
  'process-exited',
  'session-unreachable',
  'adapter-reattach-unsupported',
  'in-process-state-lost',
  'supervisor-record-missing',
  'terminal-result-missing',
  'unknown',
] as const;

export type RunSupervisorRecoveryReasonCode = (typeof RUN_SUPERVISOR_RECOVERY_REASON_CODES)[number];

export interface RunSupervisorLease {
  ownerId: string;
  hostId: string;
  processId: number;
  acquiredAt: string;
  heartbeatAt: string;
  expiresAt: string;
}

export interface RunSupervisorLocalProcessHandle {
  kind: 'local-process';
  hostId: string;
  pid: number;
  processGroupId?: number;
  startToken?: string;
  sessionId?: string;
  threadId?: string;
}

export interface RunSupervisorRemoteSessionHandle {
  kind: 'remote-session';
  hostId: string;
  sessionId: string;
  threadId?: string;
}

export interface RunSupervisorInProcessHandle {
  kind: 'in-process';
  hostId: string;
}

export type RunSupervisorControlHandle =
  RunSupervisorLocalProcessHandle | RunSupervisorRemoteSessionHandle | RunSupervisorInProcessHandle;

export interface RunSupervisorBindings {
  provider: ExecutableAgentProvider;
  adapter: string;
  providerVersion?: string;
  providerRuntimeManifestDigest: string;
  taskEnvelopeDigest: string;
  runLaunchManifestDigest: string;
  worktreePath: string;
  worktreeManifestId?: string;
  worktreeLeaseId?: string;
  worktreeFingerprint: string;
}

export interface RunSupervisorRecoveryRecord {
  code: RunSupervisorRecoveryReasonCode;
  detail: string;
  nextAction: string;
  recordedAt: string;
}

export interface RunSupervisorTerminalRecord {
  state: RunSupervisorTerminalState;
  summary: string;
  idempotencyKey?: string;
  completionResult?: CompletionResult;
  recordedAt: string;
}

export interface RunSupervisorRecord {
  schemaVersion: typeof RUN_SUPERVISOR_SCHEMA_VERSION;
  id: string;
  workspaceId: string;
  taskId: string;
  attemptId: string;
  state: RunSupervisorState;
  revision: number;
  bindings: RunSupervisorBindings;
  control: RunSupervisorControlHandle;
  recoveryOperations: RunSupervisorRecoveryOperation[];
  budget?: AgentBudgetState;
  lastEventSequence: number;
  lease: RunSupervisorLease;
  recovery?: RunSupervisorRecoveryRecord;
  terminal?: RunSupervisorTerminalRecord;
  createdAt: string;
  updatedAt: string;
}

export interface RunSupervisorListQuery {
  workspaceId: string;
  taskId?: string;
  attemptId?: string;
  states?: RunSupervisorState[];
}

export interface RunSupervisorCompareAndSetInput {
  id: string;
  expectedRevision: number;
  next: RunSupervisorRecord;
}

export interface RunSupervisorCompareAndSetResult {
  record?: RunSupervisorRecord;
  updated: boolean;
  reason?: 'not-found' | 'stale-revision' | 'invalid-revision';
}
