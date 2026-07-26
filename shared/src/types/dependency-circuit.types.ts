export const DEPENDENCY_CIRCUIT_SCHEMA_VERSION = 'dependency-circuit/v1' as const;
export const DEPENDENCY_CIRCUIT_POLICY_SCHEMA_VERSION =
  'dependency-circuit-policy/v1' as const;

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

export type DependencyKind = (typeof DEPENDENCY_KINDS)[number];
export type DependencyOutcome = (typeof DEPENDENCY_OUTCOMES)[number];
export type DependencyCircuitState = (typeof DEPENDENCY_CIRCUIT_STATES)[number];

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

export interface DependencyCircuitLease {
  id: string;
  circuitKey: string;
  probe: boolean;
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
      reason: 'circuit-open' | 'probe-concurrency-exhausted';
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
