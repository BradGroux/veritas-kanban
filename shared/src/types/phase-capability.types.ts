export const PHASE_CAPABILITY_PROFILE_SCHEMA_VERSION = 'phase-capability-profile/v1' as const;
export const PHASE_CAPABILITY_EVIDENCE_SCHEMA_VERSION = 'phase-capability-evidence/v1' as const;
export const PHASE_TRANSITION_INTENT_SCHEMA_VERSION = 'phase-transition-intent/v1' as const;

export const PHASE_NAMES = ['explore', 'plan', 'implement', 'verify', 'publish'] as const;
export type PhaseName = (typeof PHASE_NAMES)[number];

export const PHASE_AUTHORITY_DIMENSIONS = [
  'filesystem.read',
  'filesystem.write',
  'command.execute',
  'network.egress',
  'credential.access',
  'external.action',
  'artifact.plan.write',
] as const;
export type PhaseAuthorityDimension = (typeof PHASE_AUTHORITY_DIMENSIONS)[number];

export const PHASE_AUTHORITY_SOURCE_KINDS = [
  'parent',
  'agent-profile',
  'sandbox',
  'tool-catalog',
  'launch-policy',
] as const;
export type PhaseAuthoritySourceKind = (typeof PHASE_AUTHORITY_SOURCE_KINDS)[number];

/**
 * Exact, non-secret authority scopes keyed by dimension.
 *
 * `*` means the source does not narrow that dimension. Every other entry is
 * matched exactly. Paths, destinations, credential definition IDs, command
 * classes, and external action classes are never inferred from prefixes.
 */
export type PhaseAuthority = Record<PhaseAuthorityDimension, string[]>;

export type PhaseAuthorityEnforcementState = 'enforced' | 'unenforceable' | 'unsupported';
export type PhaseAuthorityEnforcement = Record<
  PhaseAuthorityDimension,
  PhaseAuthorityEnforcementState
>;

export interface PhaseAuthoritySource {
  id: string;
  kind: PhaseAuthoritySourceKind;
  authority: PhaseAuthority;
  enforcement: PhaseAuthorityEnforcement;
}

export interface PhaseCapabilityCompilerSources {
  parent: PhaseAuthoritySource & { kind: 'parent' };
  agentProfile: PhaseAuthoritySource & { kind: 'agent-profile' };
  sandbox: PhaseAuthoritySource & { kind: 'sandbox' };
  toolCatalog: PhaseAuthoritySource & { kind: 'tool-catalog' };
  launchPolicy: PhaseAuthoritySource & { kind: 'launch-policy' };
}

export interface PhasePlanArtifactPolicy {
  mode: 'disabled' | 'harness-exact-path';
  owner: 'veritas-kanban';
  maximumPaths: 0 | 1;
  transport: 'harness-api';
  shellRedirection: false;
  indirectWrites: false;
}

export interface PhaseCapabilityProfile {
  schemaVersion: typeof PHASE_CAPABILITY_PROFILE_SCHEMA_VERSION;
  id: string;
  version: number;
  phase: PhaseName;
  name: string;
  description: string;
  builtIn?: boolean;
  authority: PhaseAuthority;
  requiredDimensions: PhaseAuthorityDimension[];
  approvalRequiredDimensions: PhaseAuthorityDimension[];
  planArtifactPolicy: PhasePlanArtifactPolicy;
}

export type PhaseIdentity =
  | {
      mode: 'legacy';
      phase: 'legacy';
    }
  | {
      mode: 'profile';
      phase: PhaseName;
      profileId: string;
      profileVersion: number;
    };

export interface PhaseTransitionIntent {
  schemaVersion: typeof PHASE_TRANSITION_INTENT_SCHEMA_VERSION;
  from: PhaseIdentity;
  to: PhaseIdentity;
  actor: string;
  reason: string;
  requestedAt: string;
  parentEvidenceDigest?: string;
}

export interface PhasePlanArtifactRequest {
  exactPath: string;
  owner: 'veritas-kanban';
  transport: 'harness-api';
}

export interface EffectivePhasePlanArtifact {
  exactPath: string;
  owner: 'veritas-kanban';
  transport: 'harness-api';
  shellRedirection: false;
  indirectWrites: false;
}

export type PhaseCapabilityBlockerCode =
  | 'required-authority-denied'
  | 'required-authority-unsupported'
  | 'required-authority-unenforceable'
  | 'plan-artifact-not-allowed'
  | 'plan-artifact-path-invalid';

export interface PhaseCapabilityBlocker {
  code: PhaseCapabilityBlockerCode;
  message: string;
  dimension?: PhaseAuthorityDimension;
  sourceId?: string;
}

export interface PhaseAuthorityEvaluation {
  dimension: PhaseAuthorityDimension;
  requestedScopes: string[];
  effectiveScopes: string[];
  required: boolean;
  limitingSourceIds: string[];
}

export interface PhaseCapabilityEvidence {
  schemaVersion: typeof PHASE_CAPABILITY_EVIDENCE_SCHEMA_VERSION;
  digest: string;
  status: 'allowed' | 'narrowed' | 'blocked';
  identity: PhaseIdentity;
  requestedAuthority: PhaseAuthority;
  effectiveAuthority: PhaseAuthority;
  requiredDimensions: PhaseAuthorityDimension[];
  approvalRequiredDimensions: PhaseAuthorityDimension[];
  evaluations: PhaseAuthorityEvaluation[];
  blockers: PhaseCapabilityBlocker[];
  warnings: string[];
  planArtifact?: EffectivePhasePlanArtifact;
}

export interface PhaseCapabilityCompilerInput {
  profile?: PhaseCapabilityProfile;
  sources: PhaseCapabilityCompilerSources;
  planArtifact?: PhasePlanArtifactRequest;
}
