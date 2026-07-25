import type { ExecutableAgentProvider } from './config.types.js';

export const ADMISSION_REQUEST_SCHEMA_VERSION = 'admission-request/v1' as const;
export const ADMISSION_DECISION_SCHEMA_VERSION = 'admission-decision/v1' as const;
export const ADMISSION_RESERVATION_SCHEMA_VERSION = 'admission-reservation/v1' as const;

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

export const ADMISSION_DECISION_OUTCOMES = [
  'admitted',
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
  provider: ExecutableAgentProvider;
  hostId: string;
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
  createdAt: string;
  updatedAt: string;
}

export interface AdmissionDecision {
  schemaVersion: typeof ADMISSION_DECISION_SCHEMA_VERSION;
  outcome: AdmissionDecisionOutcome;
  request: AdmissionRequest;
  reservation?: AdmissionReservation;
  limitingPolicies: AdmissionLimitPolicy[];
  retryAfterMs?: number;
  reason: string;
  decidedAt: string;
}

export interface AdmissionReservationListQuery {
  workspaceId?: string;
  taskId?: string;
  rootTaskId?: string;
  provider?: ExecutableAgentProvider;
  hostId?: string;
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
}

export interface AdmissionSettings {
  enabled: boolean;
  leaseMs: number;
  heartbeatMs: number;
  retryAfterMs: number;
  defaultRequest: AdmissionCapacityRequest;
  global: AdmissionCapacityLimit;
  workspaces: Record<string, AdmissionCapacityLimit>;
  rootTasks: Record<string, AdmissionCapacityLimit>;
  providers: Partial<Record<ExecutableAgentProvider, AdmissionCapacityLimit>>;
  hosts: Record<string, AdmissionCapacityLimit>;
}
