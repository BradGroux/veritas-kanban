import type { ExecutableAgentProvider } from './config.types.js';
import type { AgentType, TaskPriority } from './task.types.js';
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
export const ADMISSION_QUEUE_SELECTION_SCHEMA_VERSION = 'admission-queue-selection/v1' as const;
export const ADMISSION_QUEUE_SCHEDULER_POLICY_VERSION = 'admission-queue-scheduler/v1' as const;
export const ADMISSION_QUEUE_INSPECTION_SCHEMA_VERSION = 'admission-queue-inspection/v1' as const;
export const ADMISSION_QUEUE_LIST_SCHEMA_VERSION = 'admission-queue-list/v1' as const;
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

export const ADMISSION_LAUNCH_SOURCES = [
  'direct',
  'conversation',
  'recovery',
  'fallback',
  'scheduled',
  'watcher',
  'workflow',
  'child-agent',
] as const;
export type AdmissionLaunchSource = (typeof ADMISSION_LAUNCH_SOURCES)[number];

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

export interface AdmissionQueueSchedulerSettings {
  priorityLevels: number;
  defaultPriority: number;
  agingIntervalMs: number;
  maxAgePromotion: number;
  workspaceBurstLimit: number;
  evaluationLimit: number;
}

export interface AdmissionQueueLimitingScopeEvidence {
  scope: AdmissionScope;
  scopeKey: string;
}

export interface AdmissionQueueSkippedCandidateEvidence {
  queueEntryId: string;
  workspaceKey: string;
  rawPriority: number;
  effectivePriority: number;
  agePromotion: number;
  capacityReadiness: 'blocked' | 'not-evaluated';
  limitingScopes: AdmissionQueueLimitingScopeEvidence[];
  reason: 'capacity-blocked' | 'lower-rank' | 'workspace-burst';
}

export interface AdmissionQueueSelectionEvidence {
  schemaVersion: typeof ADMISSION_QUEUE_SELECTION_SCHEMA_VERSION;
  policyVersion: typeof ADMISSION_QUEUE_SCHEDULER_POLICY_VERSION;
  selectedAt: string;
  selectedQueueEntryId: string;
  workspaceKey: string;
  rawPriority: number;
  effectivePriority: number;
  agePromotion: number;
  ageMs: number;
  workspaceTurn: 'normal' | 'fairness-promoted';
  capacityReadiness: 'ready';
  limitingScopes: AdmissionQueueLimitingScopeEvidence[];
  conditionalStartFactors: Array<
    'queue-eligibility' | 'capacity-available' | 'active-reservation-release'
  >;
  snapshotSize: number;
  evaluatedCount: number;
  skipped: AdmissionQueueSkippedCandidateEvidence[];
}

export type AdmissionQueueTarget =
  | {
      kind: 'direct';
      agent: AgentType;
    }
  | {
      kind: 'workflow-root';
      workflowId: string;
      workflowVersion: number;
      workflowRunId: string;
      workflowRunRevision: number;
      associatedTaskId?: string;
      initialContextDigest: string;
      budgetPolicyDigest: string;
      executionTreeDigest: string;
    }
  | {
      kind: 'workflow-step';
      workflowId: string;
      workflowVersion: number;
      workflowRunId: string;
      workflowRunRevision: number;
      workflowStepId: string;
      workflowStepSequence: number;
      recoverySequence: number;
      parentNodeId: string;
      edge: ExecutionTreeIdentity['edge'];
      provider: ExecutableAgentProvider;
      hostId: string;
      providerRuntimeManifestDigest: string;
      requiredRuntimeCapabilitiesDigest: string;
      phaseEvidenceDigest: string;
      phaseLaunchDigest: string;
    };

export interface AdmissionQueueEntry {
  schemaVersion: typeof ADMISSION_QUEUE_ENTRY_SCHEMA_VERSION;
  id: string;
  revision: number;
  state: AdmissionQueueState;
  enqueueSequence: number;
  /** Numeric scheduling priority. Legacy entries without it use the configured default. */
  priority?: number;
  /** Legacy direct-launch discriminator. New entries also persist target. */
  agent?: AgentType;
  target?: AdmissionQueueTarget;
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
  selectionEvidence?: AdmissionQueueSelectionEvidence;
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
  order?: 'fifo' | 'updated-desc';
  withSelectionEvidence?: boolean;
}

export interface AdmissionQueueInspectionQuery {
  workspaceId?: string;
  rootObjectiveId?: string;
  nodeId?: string;
  sources?: AdmissionLaunchSource[];
  states?: AdmissionQueueState[];
  priority?: number;
  limitingScopes?: AdmissionScope[];
  minAgeMs?: number;
  maxAgeMs?: number;
  page?: number;
  limit?: number;
}

export interface AdmissionQueueInspectionEntry {
  schemaVersion: typeof ADMISSION_QUEUE_INSPECTION_SCHEMA_VERSION;
  id: string;
  state: AdmissionQueueState;
  position?: number;
  rawPriority: number;
  effectivePriority: number;
  agePromotion: number;
  ageMs: number;
  readiness: 'conditional' | 'delayed' | 'reserved' | 'dispatched' | 'terminal';
  lease: {
    posture: 'none' | 'active' | 'expired' | 'dispatched' | 'terminal';
    expiresAt?: string;
  };
  limitingPolicies: Array<{
    scope: AdmissionScope;
    scopeKey: string;
    limits: AdmissionCapacityLimit;
  }>;
  conditionalStartFactors: Array<
    | 'queue-eligibility'
    | 'capacity-available'
    | 'capacity-recheck'
    | 'active-reservation-release'
    | 'policy-recheck'
    | 'lease-expiry'
    | 'retry-backoff'
  >;
  launch: {
    source: AdmissionLaunchSource;
    target: 'direct' | 'workflow-root' | 'workflow-step' | 'legacy-direct';
    workspaceId: string;
    taskKey: string;
    rootTaskKey: string;
    workspaceKey: string;
    provider: AdmissionProvider;
    hostKey: string;
    workflowRunKey?: string;
    workflowStepKey?: string;
    rootObjectiveKey?: string;
    nodeKey?: string;
  };
  navigation: {
    taskId?: string;
    attemptId: string;
    workflowId?: string;
    workflowRunId?: string;
    workflowStepId?: string;
    executionTree?: ExecutionTreeIdentity;
  };
  selectionEvidence?: AdmissionQueueSelectionEvidence;
  retry: {
    count: number;
    maximum: number;
    availableAt: string;
  };
  createdAt: string;
  updatedAt: string;
}

export interface AdmissionQueueDepth {
  global: {
    current: number;
    limit: number;
  };
  workspaces: Array<{
    workspaceId: string;
    workspaceKey: string;
    current: number;
    limit: number;
  }>;
}

export interface AdmissionQueueListResponse {
  schemaVersion: typeof ADMISSION_QUEUE_LIST_SCHEMA_VERSION;
  generatedAt: string;
  conditional: true;
  depth: AdmissionQueueDepth;
  pagination: {
    page: number;
    limit: number;
    total: number;
    hasMore: boolean;
    snapshotTruncated: boolean;
  };
  entries: AdmissionQueueInspectionEntry[];
}

export interface AdmissionQueueGetResponse {
  schemaVersion: typeof ADMISSION_QUEUE_INSPECTION_SCHEMA_VERSION;
  generatedAt: string;
  conditional: true;
  depth: AdmissionQueueDepth;
  entry: AdmissionQueueInspectionEntry;
}

export interface AdmissionQueueDraft {
  id: string;
  agent?: AgentType;
  target?: AdmissionQueueTarget;
  attemptId: string;
  priority?: number;
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
  reclaimReleased?: boolean;
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
  selectionEvidence: AdmissionQueueSelectionEvidence;
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
    scheduler: AdmissionQueueSchedulerSettings;
  };
}

export type AdmissionQueuePriority = number | TaskPriority;
