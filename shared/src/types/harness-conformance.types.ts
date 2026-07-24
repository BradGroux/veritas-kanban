import type {
  KnownProviderRuntimeCapabilityId,
  ProviderRuntimeCapabilityState,
} from './provider-runtime.types.js';

export const HARNESS_CONFORMANCE_SUITE_SCHEMA_VERSION = 'harness-conformance-suite/v1' as const;
export const HARNESS_CONFORMANCE_RESULT_SCHEMA_VERSION = 'harness-conformance-result/v1' as const;

export type HarnessConformanceMode = 'mock' | 'local' | 'credential-gated';
export type HarnessConformanceFailureClass =
  | 'assertion'
  | 'fixture-reset'
  | 'provider-launch'
  | 'provider-timeout'
  | 'provider-crash'
  | 'policy-block'
  | 'malformed-output'
  | 'verification'
  | 'unknown';

export interface HarnessConformanceFixture {
  id: string;
  revision: number;
  digest: string;
  repository?: string;
  seed?: string;
}

export interface HarnessConformanceCombination {
  id: string;
  provider: string;
  model?: string;
  profileId: string;
  policyId?: string;
  sandboxPresetId?: string;
  mode: HarnessConformanceMode;
}

export type HarnessConformanceAssertion =
  | { kind: 'outcome'; expected: 'passed' | 'failed' | 'blocked' }
  | { kind: 'file'; path: string; expected: 'created' | 'modified' | 'deleted' | 'unchanged' }
  | { kind: 'tool'; name: string; expected: 'called' | 'not-called' | 'allowed' | 'denied' }
  | { kind: 'approval'; expected: 'requested' | 'approved' | 'denied' | 'not-requested' }
  | { kind: 'network'; host: string; expected: 'allowed' | 'denied' | 'not-attempted' }
  | { kind: 'policy'; policyId: string; expected: 'allowed' | 'denied' | 'approval' }
  | { kind: 'completion'; expectedSchema: string; valid: boolean }
  | {
      kind: 'capability';
      capabilityId: KnownProviderRuntimeCapabilityId;
      expected: ProviderRuntimeCapabilityState;
    };

export interface HarnessConformanceScenario {
  id: string;
  objective: string;
  repetitions: number;
  assertions: HarnessConformanceAssertion[];
}

export interface HarnessConformanceCapabilityClaim {
  profileId: string;
  capabilityId: KnownProviderRuntimeCapabilityId;
  scenarioIds: string[];
}

export interface HarnessConformanceBaseline {
  revision: number;
  combinationId: string;
  scenarioId: string;
  minPassRate: number;
  maxMeanLatencyMs?: number;
  maxLatencyStdDevMs?: number;
  maxMeanTokens?: number;
  maxMeanCostUsd?: number;
}

export interface HarnessConformanceSuite {
  schemaVersion: typeof HARNESS_CONFORMANCE_SUITE_SCHEMA_VERSION;
  id: string;
  revision: number;
  objective: string;
  fixture: HarnessConformanceFixture;
  combinations: HarnessConformanceCombination[];
  scenarios: HarnessConformanceScenario[];
  capabilityClaims: HarnessConformanceCapabilityClaim[];
  baselines: HarnessConformanceBaseline[];
}

export interface HarnessConformanceEvidenceReference {
  launchManifestDigest: string;
  providerRuntimeManifestDigest: string;
  taskId?: string;
  attemptId?: string;
  eventSequenceStart?: number;
  eventSequenceEnd?: number;
}

export interface HarnessConformanceObservation {
  outcome: 'passed' | 'failed' | 'blocked';
  durationMs: number;
  tokens?: number;
  costUsd?: number;
  retries?: number;
  files?: Array<{ path: string; state: 'created' | 'modified' | 'deleted' | 'unchanged' }>;
  tools?: Array<{ name: string; outcome: 'allowed' | 'denied' }>;
  approvals?: Array<{ outcome: 'requested' | 'approved' | 'denied' }>;
  network?: Array<{ host: string; decision: 'allowed' | 'denied' }>;
  policies?: Array<{ policyId: string; decision: 'allowed' | 'denied' | 'approval' }>;
  completions?: Array<{ schema: string; valid: boolean }>;
  capabilities?: Array<{
    id: KnownProviderRuntimeCapabilityId;
    state: ProviderRuntimeCapabilityState;
  }>;
  evidence: HarnessConformanceEvidenceReference;
  failureClass?: HarnessConformanceFailureClass;
  diagnostic?: string;
}

export interface HarnessConformanceAssertionResult {
  assertion: HarnessConformanceAssertion;
  passed: boolean;
  detail: string;
}

export interface HarnessConformanceTrialResult {
  combinationId: string;
  scenarioId: string;
  trial: number;
  passed: boolean;
  failureClass?: HarnessConformanceFailureClass;
  diagnostic?: string;
  observation?: Omit<HarnessConformanceObservation, 'diagnostic'>;
  assertions: HarnessConformanceAssertionResult[];
}

export interface HarnessConformanceAggregate {
  combinationId: string;
  scenarioId: string;
  trials: number;
  passed: number;
  passRate: number;
  meanLatencyMs: number;
  p95LatencyMs: number;
  latencyStdDevMs: number;
  meanTokens: number;
  totalTokens: number;
  meanCostUsd: number;
  totalCostUsd: number;
  retries: number;
  baselineRevision?: number;
  regressions: string[];
}

export interface HarnessConformanceResult {
  schemaVersion: typeof HARNESS_CONFORMANCE_RESULT_SCHEMA_VERSION;
  id: string;
  suiteId: string;
  suiteRevision: number;
  fixture: HarnessConformanceFixture;
  startedAt: string;
  completedAt: string;
  status: 'passed' | 'failed' | 'regression';
  trials: HarnessConformanceTrialResult[];
  aggregates: HarnessConformanceAggregate[];
}

export interface HarnessConformanceExecutionInput {
  suite: HarnessConformanceSuite;
  combination: HarnessConformanceCombination;
  scenario: HarnessConformanceScenario;
  trial: number;
}

export interface HarnessConformanceExecutor {
  reset(input: HarnessConformanceExecutionInput): Promise<void>;
  execute(input: HarnessConformanceExecutionInput): Promise<HarnessConformanceObservation>;
}
