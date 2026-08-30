import type { AgentBudgetPolicy, AgentBudgetUsage } from './agent-budget.types.js';
import type { AdmissionCapacityRequest, AdmissionLimitPolicy } from './admission-control.types.js';
import type { PhaseAuthorityDimension, PhaseIdentity } from './phase-capability.types.js';
import type {
  HarnessSupportTier,
  ProviderRuntimeCapabilityState,
} from './provider-runtime.types.js';
import type {
  RunLaunchCredentialDelivery,
  RunLaunchFilesystemRootAccess,
  RunLaunchFilesystemRootScope,
} from './run-launch-manifest.types.js';
import type { RunToolPolicyDecision, ToolServerRequirement } from './tool-control-plane.types.js';

export const RUN_ACCESS_SUMMARY_SCHEMA_VERSION = 'run-access-summary/v1' as const;

export type RunAccessSummaryStatus = 'complete' | 'incomplete' | 'blocked';
export type RunAccessSourceKind =
  | 'run-launch-manifest'
  | 'phase-capability-evidence'
  | 'phase-transition-record'
  | 'provider-runtime-manifest'
  | 'run-tool-catalog'
  | 'credential-definition'
  | 'credential-lease'
  | 'admission-reservation'
  | 'task-attempt';

export interface RunAccessSourceReference {
  kind: RunAccessSourceKind;
  schemaVersion: string;
  recordId: string;
  digest: string;
  state: 'verified' | 'missing' | 'conflict';
}

export interface RunAccessFieldSource {
  kind: RunAccessSourceKind;
  digest: string;
  field: string;
}

export interface RunAccessBlocker {
  code: string;
  message: string;
  source?: RunAccessFieldSource;
}

export interface RunAccessFilesystemTarget {
  label: string;
  access: RunLaunchFilesystemRootAccess;
  scope: RunLaunchFilesystemRootScope | 'task-worktree';
  pathDigest?: string;
  enforceability: 'enforced' | 'advisory' | 'unavailable';
  source: RunAccessFieldSource;
}

export interface RunAccessTool {
  server: string;
  name: string;
  qualifiedName: string;
  decision: RunToolPolicyDecision;
  availability: 'ready' | 'degraded' | 'missing';
  requirement: ToolServerRequirement;
  enforceability: 'enforced' | 'advisory' | 'unavailable';
  externalAction?: 'read' | 'mutate';
  source: RunAccessFieldSource;
}

export interface RunAccessIntegration {
  definition: string;
  accountLabel: string;
  delivery: RunLaunchCredentialDelivery;
  state: 'brokered' | 'unavailable' | 'expired' | 'revoked';
  approval: 'not-required' | 'required';
  externalTargets: string[];
  expiresAt: string | null;
  source: RunAccessFieldSource;
}

export interface RunAccessSummary {
  schemaVersion: typeof RUN_ACCESS_SUMMARY_SCHEMA_VERSION;
  digest: string;
  status: RunAccessSummaryStatus;
  generatedAt: string;
  version: {
    kind: 'launch' | 'transition';
    sequence: number;
    immutableEvidenceDigest: string;
  };
  identity: {
    taskId: string;
    runId: string;
    attemptId: string;
    launchManifestDigest: string | null;
    phaseEvidenceDigest: string | null;
    transitionSequence: number;
    phase: PhaseIdentity | null;
    provider: string | null;
    adapter: string | null;
    selectedHost: string | null;
    sources: RunAccessFieldSource[];
  };
  filesystem: {
    sandboxMode: 'read-only' | 'workspace-write' | 'danger-full-access' | 'unknown';
    targets: RunAccessFilesystemTarget[];
    artifactOutput: {
      allowed: boolean;
      label: string;
      enforceability: 'enforced' | 'advisory' | 'unavailable';
      source: RunAccessFieldSource;
    };
    source: RunAccessFieldSource;
  };
  network: {
    enabled: boolean;
    policy: 'disabled' | 'allowlist' | 'unrestricted' | 'unknown';
    externalTargets: string[];
    approvalRequired: boolean;
    enforceability: ProviderRuntimeCapabilityState;
    source: RunAccessFieldSource;
  };
  tools: RunAccessTool[];
  integrations: RunAccessIntegration[];
  approvals: {
    requiredDimensions: PhaseAuthorityDimension[];
    toolCount: number;
    integrationCount: number;
    source: RunAccessFieldSource;
  };
  budgets: {
    policy: AgentBudgetPolicy | null;
    usage: AgentBudgetUsage | null;
    capacity: AdmissionCapacityRequest | null;
    concurrencyPolicies: AdmissionLimitPolicy[];
    reservationState: 'active' | 'released' | 'expired' | 'missing';
    source: RunAccessFieldSource;
  };
  support: {
    tier: HarnessSupportTier | 'unknown';
    enforceable: boolean;
    degraded: boolean;
    blockers: RunAccessBlocker[];
    source: RunAccessFieldSource;
  };
  sources: RunAccessSourceReference[];
  blockers: RunAccessBlocker[];
}

export interface RunAccessSummaryResponse {
  current: RunAccessSummary;
  history: RunAccessSummary[];
}
