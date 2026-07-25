import type { RunApprovalActor, RunApprovalRequest } from './run-approval.types.js';

export const PHASE_CAPABILITY_PROFILE_SCHEMA_VERSION = 'phase-capability-profile/v1' as const;
export const PHASE_CAPABILITY_EVIDENCE_SCHEMA_VERSION = 'phase-capability-evidence/v1' as const;
export const PHASE_TRANSITION_INTENT_SCHEMA_VERSION = 'phase-transition-intent/v1' as const;
export const PHASE_TRANSITION_RECORD_SCHEMA_VERSION = 'phase-transition-record/v1' as const;

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

export type PhaseTransitionPolicyDecision =
  'allow' | 'approved-expansion' | 'emergency-override' | 'override-expired';

export interface PhaseAuthorityDeltaEntry {
  dimension: PhaseAuthorityDimension;
  addedScopes: string[];
  removedScopes: string[];
}

export interface PhaseAuthorityDelta {
  classification: 'same' | 'narrowing' | 'expanding' | 'mixed';
  entries: PhaseAuthorityDeltaEntry[];
}

export interface PhaseEmergencyOverrideEvidence {
  permission: 'admin:manage';
  justification: string;
  expiresAt: string;
}

/**
 * One append-only, applied phase transition.
 *
 * `eventReference` is the deterministic run-event dedupe key. This lets an
 * idempotent retry reconcile a missing projection without mutating the
 * transition.
 */
export interface PhaseTransitionRecord {
  schemaVersion: typeof PHASE_TRANSITION_RECORD_SCHEMA_VERSION;
  id: string;
  workspaceId: string;
  taskId: string;
  attemptId: string;
  sequence: number;
  operationId: string;
  priorEvidence: PhaseCapabilityEvidence;
  effectiveEvidence: PhaseCapabilityEvidence;
  authorityDelta: PhaseAuthorityDelta;
  actor: RunApprovalActor;
  reason: string;
  policyDecision: PhaseTransitionPolicyDecision;
  approvalId?: string;
  emergencyOverride?: PhaseEmergencyOverrideEvidence;
  manifestDigest: string;
  eventReference: string;
  createdAt: string;
}

export interface PhaseTransitionRequestInput {
  attemptId: string;
  operationId: string;
  expectedSequence: number;
  expectedPhaseEvidenceDigest: string;
  expectedManifestDigest: string;
  reason: string;
  fromEvidence?: PhaseCapabilityEvidence;
  targetEvidence: PhaseCapabilityEvidence;
  approvalId?: string;
  approvalTtlMs?: number;
  emergencyOverride?: {
    justification: string;
    expiresAt: string;
  };
}

export interface PhaseTransitionQuery {
  workspaceId: string;
  taskId: string;
  attemptId: string;
  limit?: number;
}

export interface PhaseTransitionAppendInput {
  record: PhaseTransitionRecord;
  expectedSequence: number;
  expectedPhaseEvidenceDigest: string;
  expectedManifestDigest: string;
}

export interface PhaseTransitionAppendResult {
  record?: PhaseTransitionRecord;
  appended: boolean;
  reason?: 'stale-sequence' | 'stale-phase-evidence' | 'stale-manifest' | 'operation-reused';
}

export interface PhaseTransitionResult {
  status: 'applied' | 'approval-required';
  current: PhaseTransitionRecord | null;
  record?: PhaseTransitionRecord;
  approval?: RunApprovalRequest;
  targetEvidenceDigest: string;
}
