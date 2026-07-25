import type { ExecutableAgentProvider } from './config.types.js';
import type { AgentType } from './task.types.js';
import type {
  ExecutionTreeBudgetPolicy,
  ExecutionTreeBudgetState,
  ExecutionTreeBudgetSummary,
  ExecutionTreeBudgetUsageEvent,
  ExecutionTreeIdentity,
} from './execution-tree-budget.types.js';
import type { AgentBudgetUsage } from './agent-budget.types.js';

export const ADMISSION_REQUEST_SCHEMA_VERSION = 'admission-request/v1' as const;
export const ADMISSION_DECISION_SCHEMA_VERSION = 'admission-decision/v1' as const;
export const ADMISSION_RESERVATION_SCHEMA_VERSION = 'admission-reservation/v1' as const;
export const ADMISSION_QUEUE_ENTRY_SCHEMA_VERSION = 'admission-queue-entry/v1' as const;
export const ADMISSION_CONTROL_PROVIDER = 'workflow-control' as const;
export type AdmissionProvider = ExecutableAgentProvider | typeof ADMISSION_CONTROL_PROVIDER;

export const ADMISSION_SCOPES = [
  'global',
  'task',
  'workspace',
  'root-task',
  'provider',
  'host',
] as const;
export type AdmissionScope = (typeof ADMISSION_SCOPES)[number];

export const ADMISSION_RESERVATION_STATES = ['active', 'released', 'expired'] as const;
export type AdmissionReservationState = (typeof ADMISSION_RESERVATION_STATES)[number];

export const ADMISSION_QUEUE_STATES = [
  'queued',
  'leased',
  'requeued',
  'dispatched',
  'terminal',
] as const;
export type AdmissionQueueState = (typeof ADMISSION_QUEUE_STATES)[number];

export const ADMISSION_DECISION_OUTCOMES = [
  'admitted',
  'queued',
  'queue-overflow',
  'retryable-overload',
  'terminal-policy-denial',
] as const;
export type AdmissionDecisionOutcome = (typeof ADMISSION_DECISION_OUTCOMES)[number];

/** Capacity requested by one launch. Memory is an operator estimate, not a prediction. */
export interface AdmissionCapacityRequest {
  runSlots: number;
  processSlots: number;
  estimatedMemoryMb: number;
}

/** Omitted ceilings are unlimited. */
export interface AdmissionCapacityLimit {
  concurrentRuns?: number;
  processSlots?: number;
  estimatedMemoryMb?: number;
}

export interface AdmissionLimitPolicy {
  id: string;
  scope: AdmissionScope;
  scopeId: string;
  limits: AdmissionCapacityLimit;
}

export type AdmissionLaunchSource =
  | 'direct'
  | 'conversation'
  | 'recovery'
  | 'fallback'
  | 'scheduled'
  | 'watcher'
  | 'workflow'
  | 'child-agent';

export interface AdmissionRequest {
  schemaVersion: typeof ADMISSION_REQUEST_SCHEMA_VERSION;
  idempotencyKey: string;
  source: AdmissionLaunchSource;
  taskId: string;
  rootTaskId: string;
  workspaceId: string;
  provider: AdmissionProvider;
  hostId: string;
  workflowRunId?: string;
  workflowStepId?: string;
  rootReservationId?: string;
  executionTree?: ExecutionTreeIdentity;
  budgetPolicies?: ExecutionTreeBudgetPolicy[];
  budgetRequest?: AgentBudgetUsage;
  requested: AdmissionCapacityRequest;
  requestedAt: string;
}

export interface AdmissionReservationLease {
  ownerId: string;
  hostId: string;
  processId: number;
  acquiredAt: string;
  heartbeatAt: string;
  expiresAt: string;
}

export interface AdmissionReservationRelease {
  reason: 'start-failed' | 'completed' | 'failed' | 'cancelled' | 'interrupted' | 'reconciled';
  idempotencyKey: string;
  releasedAt: string;
}

export interface AdmissionReservation {
  schemaVersion: typeof ADMISSION_RESERVATION_SCHEMA_VERSION;
  id: string;
  revision: number;
  state: AdmissionReservationState;
  request: AdmissionRequest;
  policies: AdmissionLimitPolicy[];
  attemptId?: string;
  lease: AdmissionReservationLease;
  release?: AdmissionReservationRelease;
  executionBudget?: ExecutionTreeBudgetState;
  createdAt: string;
  updatedAt: string;
}

export interface AdmissionQueueTerminalEvidence {
  code: string;
  reason: string;
  recordedAt: string;
}

export interface AdmissionQueueEntry {
  schemaVersion: typeof ADMISSION_QUEUE_ENTRY_SCHEMA_VERSION;
  id: string;
  revision: number;
  state: AdmissionQueueState;
  enqueueSequence: number;
  agent: AgentType;
  attemptId: string;
  request: AdmissionRequest;
  policies: AdmissionLimitPolicy[];
  limitingPolicies: AdmissionLimitPolicy[];
  limitingBudgetPolicies?: ExecutionTreeBudgetPolicy[];
  retryAfterMs: number;
  retryCount: number;
  maxRetries: number;
  availableAt: string;
  lease?: AdmissionReservationLease;
  reservationId?: string;
  dispatchedAttemptId?: string;
  terminal?: AdmissionQueueTerminalEvidence;
  createdAt: string;
  updatedAt: string;
}

export interface AdmissionDecision {
  schemaVersion: typeof ADMISSION_DECISION_SCHEMA_VERSION;
  outcome: AdmissionDecisionOutcome;
  request: AdmissionRequest;
  reservation?: AdmissionReservation;
  queueEntry?: AdmissionQueueEntry;
  limitingPolicies: AdmissionLimitPolicy[];
  limitingBudgetPolicies?: ExecutionTreeBudgetPolicy[];
  retryAfterMs?: number;
  reason: string;
  decidedAt: string;
}

export interface AdmissionQueueListQuery {
  workspaceId?: string;
  taskId?: string;
  states?: AdmissionQueueState[];
  eligibleAt?: string;
  limit?: number;
}

export interface AdmissionQueueDraft {
  id: string;
  agent: AgentType;
  attemptId: string;
  request: AdmissionRequest;
  policies: AdmissionLimitPolicy[];
  limitingPolicies: AdmissionLimitPolicy[];
  limitingBudgetPolicies?: ExecutionTreeBudgetPolicy[];
  retryAfterMs: number;
  maxRetries: number;
  availableAt: string;
  createdAt: string;
}

export interface AdmissionReservationListQuery {
  workspaceId?: string;
  taskId?: string;
  rootTaskId?: string;
  provider?: AdmissionProvider;
  hostId?: string;
  workflowRunId?: string;
  workflowStepId?: string;
  rootReservationId?: string;
  rootObjectiveId?: string;
  nodeId?: string;
  parentNodeId?: string;
  states?: AdmissionReservationState[];
  limit?: number;
}

export interface AdmissionReservationCompareAndSetInput {
  id: string;
  expectedRevision: number;
  next: AdmissionReservation;
}

export interface AdmissionReservationCompareAndSetResult {
  record?: AdmissionReservation;
  updated: boolean;
  reason?: 'not-found' | 'stale-revision' | 'invalid-revision';
}

export interface AdmissionReservationClaimInput {
  record: AdmissionReservation;
  now: string;
  reclaimExpired?: boolean;
}

export interface AdmissionReservationClaimResult {
  record?: AdmissionReservation;
  created: boolean;
  reclaimed?: boolean;
  limitingPolicies: AdmissionLimitPolicy[];
  limitingBudgetPolicies?: ExecutionTreeBudgetPolicy[];
  budgetRetryable?: boolean;
}

export interface AdmissionReservationClaimOrQueueInput {
  record: AdmissionReservation;
  queue: AdmissionQueueDraft;
  now: string;
  globalQueueLimit: number;
  workspaceQueueLimit: number;
}

export interface AdmissionReservationClaimOrQueueResult extends AdmissionReservationClaimResult {
  queueEntry?: AdmissionQueueEntry;
  queueOverflow?: 'global' | 'workspace';
  queueConflict?: boolean;
}

export interface AdmissionQueuedClaimInput {
  queueId: string;
  expectedRevision: number;
  record: AdmissionReservation;
  now: string;
}

export interface AdmissionQueuedClaimResult {
  entry?: AdmissionQueueEntry;
  reservation?: AdmissionReservation;
  stale: boolean;
  limitingPolicies: AdmissionLimitPolicy[];
  limitingBudgetPolicies?: ExecutionTreeBudgetPolicy[];
  budgetRetryable?: boolean;
}

export interface AdmissionQueueCompareAndSetInput {
  id: string;
  expectedRevision: number;
  next: AdmissionQueueEntry;
}

export interface AdmissionQueueCompareAndSetResult {
  record?: AdmissionQueueEntry;
  updated: boolean;
  reason?: 'not-found' | 'stale-revision' | 'invalid-revision';
}

export interface AdmissionQueueClaim {
  entry: AdmissionQueueEntry;
  reservation: AdmissionReservation;
}

export interface AdmissionBudgetUsageInput {
  reservationId: string;
  event: ExecutionTreeBudgetUsageEvent;
}

export interface AdmissionExecutionTreeSummaryInput {
  rootObjectiveId: string;
  limit?: number;
}

export type AdmissionExecutionTreeSummary = ExecutionTreeBudgetSummary;

export interface AdmissionSettings {
  enabled: boolean;
  leaseMs: number;
  heartbeatMs: number;
  retryAfterMs: number;
  defaultRequest: AdmissionCapacityRequest;
  global: AdmissionCapacityLimit;
  workspaces: Record<string, AdmissionCapacityLimit>;
  rootTasks: Record<string, AdmissionCapacityLimit>;
  providers: Partial<Record<AdmissionProvider, AdmissionCapacityLimit>>;
  hosts: Record<string, AdmissionCapacityLimit>;
  queue: {
    enabled: boolean;
    globalLimit: number;
    workspaceLimit: number;
    leaseMs: number;
    retryBackoffMs: number;
    maxRetries: number;
  };
}
