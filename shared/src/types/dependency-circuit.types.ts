export const DEPENDENCY_CIRCUIT_SCHEMA_VERSION = 'dependency-circuit/v1' as const;
export const DEPENDENCY_CIRCUIT_POLICY_SCHEMA_VERSION =
  'dependency-circuit-policy/v1' as const;
export const DEPENDENCY_CIRCUIT_STATE_SCHEMA_VERSION =
  'dependency-circuit-state/v1' as const;
export const DEPENDENCY_CIRCUIT_OVERRIDE_SCHEMA_VERSION =
  'dependency-circuit-override/v1' as const;

export const DEPENDENCY_KINDS = [
  'provider',
  'model-endpoint',
  'agent-host',
  'mcp-server',
  'tool-server',
  'integration',
  'storage',
] as const;

export const DEPENDENCY_OUTCOMES = [
  'success',
  'slow-success',
  'dependency-failure',
  'caller-cancellation',
  'policy-block',
  'validation-error',
  'timeout',
  'throttled',
  'overload',
] as const;

export const DEPENDENCY_CIRCUIT_STATES = ['closed', 'open', 'half-open'] as const;
export const DEPENDENCY_ROUTE_NO_MATCH_ACTIONS = [
  'reject',
  'queue',
  'operator-approval',
] as const;
export const DEPENDENCY_RETRY_BUDGET_KINDS = [
  'transport-retry',
  'throttling-backoff',
  'circuit-rejection',
  'model-resample',
  'watchdog-recovery',
  'provider-fallback',
] as const;
export const DEPENDENCY_CIRCUIT_OVERRIDE_MODES = ['allow', 'block'] as const;

export type DependencyKind = (typeof DEPENDENCY_KINDS)[number];
export type DependencyOutcome = (typeof DEPENDENCY_OUTCOMES)[number];
export type DependencyCircuitState = (typeof DEPENDENCY_CIRCUIT_STATES)[number];
export type DependencyRouteNoMatchAction = (typeof DEPENDENCY_ROUTE_NO_MATCH_ACTIONS)[number];
export type DependencyRetryBudgetKind = (typeof DEPENDENCY_RETRY_BUDGET_KINDS)[number];
export type DependencyCircuitOverrideMode =
  (typeof DEPENDENCY_CIRCUIT_OVERRIDE_MODES)[number];

export interface DependencyIdentity {
  kind: DependencyKind;
  id: string;
  workspaceId?: string;
  provider?: string;
  model?: string;
  hostId?: string;
}

export interface DependencyCircuitPolicy {
  schemaVersion: typeof DEPENDENCY_CIRCUIT_POLICY_SCHEMA_VERSION;
  minimumSamples: number;
  rollingWindowMs: number;
  failureRateThreshold: number;
  slowCallDurationMs: number;
  slowCallRateThreshold: number;
  openDurationMs: number;
  openDurationJitterRatio: number;
  halfOpenMaxConcurrent: number;
  probeSuccessThreshold: number;
}

export interface DependencyCircuitReason {
  code:
    | 'failure-rate'
    | 'slow-call-rate'
    | 'probe-failed'
    | 'operator-reset'
    | 'probe-window-opened'
    | 'probe-succeeded';
  observedAt: string;
  sampleCount: number;
  failureCount: number;
  slowCallCount: number;
  failureRate: number;
  slowCallRate: number;
}

export interface DependencyCircuitSnapshot {
  schemaVersion: typeof DEPENDENCY_CIRCUIT_SCHEMA_VERSION;
  key: string;
  dependency: DependencyIdentity;
  policy: DependencyCircuitPolicy;
  state: DependencyCircuitState;
  reason?: DependencyCircuitReason;
  sampleCount: number;
  failureCount: number;
  slowCallCount: number;
  failureRate: number;
  slowCallRate: number;
  openedAt?: string;
  nextProbeAt?: string;
  halfOpenInFlight: number;
  halfOpenSuccesses: number;
  lastOutcome?: DependencyOutcome;
  lastOutcomeAt?: string;
  updatedAt: string;
}

export interface DependencyCircuitSample {
  occurredAt: string;
  outcome: DependencyOutcome;
  durationMs: number;
}

export interface DependencyCircuitPersistedState {
  schemaVersion: typeof DEPENDENCY_CIRCUIT_STATE_SCHEMA_VERSION;
  snapshot: DependencyCircuitSnapshot;
  samples: DependencyCircuitSample[];
  capturedAt: string;
}

export interface DependencyCircuitLease {
  id: string;
  circuitKey: string;
  probe: boolean;
  overrideId?: string;
  acquiredAt: string;
}

export type DependencyCircuitAdmission =
  | {
      allowed: true;
      decision: 'allow' | 'probe';
      lease: DependencyCircuitLease;
      snapshot: DependencyCircuitSnapshot;
    }
  | {
      allowed: false;
      decision: 'reject';
      reason: 'circuit-open' | 'probe-concurrency-exhausted' | 'operator-block';
      retryAt?: string;
      snapshot: DependencyCircuitSnapshot;
    };

export interface DependencyOutcomeSignals {
  succeeded?: boolean;
  durationMs?: number;
  callerCancelled?: boolean;
  policyBlocked?: boolean;
  validationFailed?: boolean;
  timedOut?: boolean;
  statusCode?: number;
  errorCode?: string;
}

export interface DependencyRouteCandidate {
  id: string;
  label: string;
  dependency: DependencyIdentity;
  priority: number;
  policy?: DependencyCircuitPolicy;
}

export interface DependencyRoutePolicy {
  allowFallback: boolean;
  noMatchAction: DependencyRouteNoMatchAction;
}

export interface DependencyRouteExclusion {
  candidateId: string;
  dependencyKey: string;
  reason: 'circuit-open' | 'probe-concurrency-exhausted' | 'operator-block';
  retryAt?: string;
  snapshot: DependencyCircuitSnapshot;
}

export type DependencyRouteDecision =
  | {
      selected: true;
      candidate: DependencyRouteCandidate;
      admission: Extract<DependencyCircuitAdmission, { allowed: true }>;
      fallback: boolean;
      reason: string;
      exclusions: DependencyRouteExclusion[];
    }
  | {
      selected: false;
      action: DependencyRouteNoMatchAction;
      reason: string;
      exclusions: DependencyRouteExclusion[];
    };

export interface DependencyRetryBudgetPolicy {
  limits: Record<DependencyRetryBudgetKind, number>;
}

export interface DependencyRetryBudgetUsage {
  used: Record<DependencyRetryBudgetKind, number>;
}

export interface DependencyRetryBudgetDecision {
  kind: DependencyRetryBudgetKind;
  allowed: boolean;
  limit: number;
  used: number;
  remaining: number;
}

export interface DependencyCircuitOverride {
  schemaVersion: typeof DEPENDENCY_CIRCUIT_OVERRIDE_SCHEMA_VERSION;
  id: string;
  circuitKey: string;
  mode: DependencyCircuitOverrideMode;
  reason: string;
  actorId: string;
  createdAt: string;
  expiresAt: string;
}
