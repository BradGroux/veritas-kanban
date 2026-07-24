import type { AgentBudgetPolicy } from './agent-budget.types.js';
import type { HarnessSupportTier, HarnessTransport } from './provider-runtime.types.js';
import type { ProviderRuntimeCapabilityState } from './provider-runtime.types.js';

export const RUN_LAUNCH_MANIFEST_SCHEMA_VERSION = 'run-launch-manifest/v1' as const;

export type RunLaunchManifestEnforcementState = 'enforced' | 'not-required' | 'unavailable';

export type RunLaunchManifestInstructionKind =
  'task' | 'profile' | 'template' | 'repository' | 'system' | 'other';

export type RunLaunchManifestOriginScope =
  | 'run'
  | 'task-envelope'
  | 'agent-profile'
  | 'workflow'
  | 'template'
  | 'provider'
  | 'workspace'
  | 'system-default';

export interface RunLaunchManifestReference {
  schemaVersion: string;
  digest: string;
}

export interface RunLaunchTaskEnvelopeReference extends RunLaunchManifestReference {
  /** Digest excluding attempt identity and capture timestamps for material drift comparison. */
  materialDigest: string;
}

export interface RunLaunchProviderRuntimeReference extends RunLaunchManifestReference {
  /** Digest excluding probe timestamp for material drift comparison. */
  materialDigest: string;
  probeRevision: number;
  provider: string;
  adapter: string;
  protocolVersion: string;
  providerVersion: string;
  providerBuild?: string;
}

export interface RunLaunchHarnessSupport {
  profileId: string;
  adapterId?: string;
  transport: HarnessTransport;
  supportTier: HarnessSupportTier;
}

export interface RunLaunchProviderRequirement {
  id: string;
  state: ProviderRuntimeCapabilityState;
  satisfied: boolean;
  advisory: boolean;
  reason: string;
}

export interface RunLaunchProviderRequirements {
  required: string[];
  capabilities: RunLaunchProviderRequirement[];
}

export interface RunLaunchRouting {
  requestedAgent: string;
  selectedAgent: string;
  selectedHost: string;
  reason: string;
  fallbackAgent: string | null;
  fallbackAllowed: boolean;
}

export interface RunLaunchProfileReference {
  id: string;
  version: string;
  role: string;
}

export interface RunLaunchReadiness {
  ready: boolean;
  overridden: boolean;
  passed: number;
  total: number;
  missingRequired: string[];
  warnings: string[];
  overrideReasonDigest?: string;
}

export interface RunLaunchInstructionReference {
  id: string;
  kind: RunLaunchManifestInstructionKind;
  digest: string;
  /** Digest with attempt-local identifiers normalized for material drift comparison. */
  materialDigest: string;
  byteLength: number;
  origin: string;
  precedence: number;
}

export interface RunLaunchRuntime {
  model?: string;
  command: string;
  args: string[];
  workingDirectory: 'task-worktree' | 'workspace' | 'provider-managed';
  worktree: 'required' | 'supported' | 'provider-managed';
  environmentKeys: string[];
  credentialReferences: string[];
}

export interface RunLaunchWorkspace {
  worktreeId: string;
  worktreeManifestId?: string;
  ownershipLeaseId?: string;
  ownershipAttemptId?: string;
  repo: string;
  branch: string;
  baseBranch: string;
  resolvedBaseCommit: string;
  baseResolutionSource:
    import('./worktree-manifest.types.js').WorktreeBaseSource | 'legacy-launch-head';
}

export interface RunLaunchTools {
  allowed: string[];
  denied: string[];
  policyIds: string[];
  mcpServers: string[];
  enforcement: RunLaunchManifestEnforcementState;
}

export interface RunLaunchPermissions {
  level: 'intern' | 'specialist' | 'lead';
  required: string[];
  enforcement: RunLaunchManifestEnforcementState;
}

export interface RunLaunchResources {
  skills: string[];
  shared: string[];
  enforcement: RunLaunchManifestEnforcementState;
}

export interface RunLaunchSandboxRule {
  id: string;
  capability: string;
  status: 'supported' | 'unsupported' | 'advisory';
}

export interface RunLaunchSandbox {
  presetId: string;
  enforcement: 'required' | 'advisory';
  decision: 'allow' | 'warn' | 'block';
  effective: {
    sandboxMode: 'read-only' | 'workspace-write' | 'danger-full-access';
    networkAccessEnabled: boolean;
    environmentKeys: string[];
    credentialReferences: string[];
  };
  unsupportedRules: RunLaunchSandboxRule[];
  warnings: string[];
}

export interface RunLaunchWorkspaceTrust {
  status: 'trusted' | 'untrusted' | 'not-required';
  source: string;
}

export interface RunLaunchManifestOrigin {
  field: string;
  scope: RunLaunchManifestOriginScope;
  source: string;
  precedence: number;
}

export interface RunLaunchManifestBlocker {
  code: string;
  field: string;
  detail: string;
  remediation: string;
}

export interface RunLaunchManifestEnforcement {
  enforceable: boolean;
  blockers: RunLaunchManifestBlocker[];
  warnings: string[];
}

/**
 * Immutable, redacted record of the effective launch inputs and their origin.
 *
 * Prompt content and credential values are intentionally excluded. References
 * and fingerprints let operators prove what was selected without disclosing it.
 */
export interface RunLaunchManifest {
  schemaVersion: typeof RUN_LAUNCH_MANIFEST_SCHEMA_VERSION;
  digest: string;
  createdAt: string;
  taskId: string;
  attemptId: string;
  taskEnvelope: RunLaunchTaskEnvelopeReference;
  providerRuntime: RunLaunchProviderRuntimeReference;
  providerRequirements: RunLaunchProviderRequirements;
  harnessSupport: RunLaunchHarnessSupport;
  routing: RunLaunchRouting;
  profile?: RunLaunchProfileReference;
  readiness: RunLaunchReadiness;
  instructions: RunLaunchInstructionReference[];
  /** Present on newly compiled manifests; absent only on pre-6.0 legacy records. */
  workspace?: RunLaunchWorkspace;
  runtime: RunLaunchRuntime;
  tools: RunLaunchTools;
  permissions: RunLaunchPermissions;
  resources: RunLaunchResources;
  requiredHealthChecks: string[];
  sandbox: RunLaunchSandbox;
  budget: AgentBudgetPolicy;
  workspaceTrust: RunLaunchWorkspaceTrust;
  origins: RunLaunchManifestOrigin[];
  enforcement: RunLaunchManifestEnforcement;
}

export interface RunLaunchManifestDrift {
  field: string;
  beforeDigest: string;
  afterDigest: string;
}

export interface RunLaunchManifestDriftResult {
  material: boolean;
  changes: RunLaunchManifestDrift[];
}

export interface RunLaunchManifestPreview {
  manifest: RunLaunchManifest;
  parentAttemptId?: string;
  drift?: RunLaunchManifestDriftResult;
}
