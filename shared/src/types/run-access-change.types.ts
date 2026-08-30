import type {
  PhaseAuthorityDelta,
  PhaseAuthorityDimension,
  PhaseCapabilityEvidence,
  PhaseName,
  PhaseTransitionResult,
} from './phase-capability.types.js';
import type { RunAccessSummary } from './run-access-summary.types.js';

export const RUN_ACCESS_CHANGE_PREVIEW_SCHEMA_VERSION = 'run-access-change-preview/v1' as const;

export interface RunAccessChangeInput {
  attemptId: string;
  requestId: string;
  operation: 'transition-phase';
  targetPhase: PhaseName;
  reason: string;
  expectedAccessSummaryDigest: string;
  expectedSequence: number;
  expectedPhaseEvidenceDigest: string;
  expectedManifestDigest: string;
  requestRevision?: string;
  approvalId?: string;
  approvalTtlMs?: number;
}

export interface RunAccessChangeBlocker {
  code:
    | 'target-authority-denied'
    | 'provider-live-transition-unsupported'
    | 'provider-boundary-relaunch-required';
  message: string;
  dimensions: PhaseAuthorityDimension[];
}

export interface RunAccessChangePreview {
  schemaVersion: typeof RUN_ACCESS_CHANGE_PREVIEW_SCHEMA_VERSION;
  requestRevision: string;
  taskId: string;
  attemptId: string;
  requestId: string;
  operation: 'transition-phase';
  targetPhase: PhaseName;
  reason: string;
  expectedAccessSummaryDigest: string;
  expectedSequence: number;
  expectedPhaseEvidenceDigest: string;
  expectedManifestDigest: string;
  targetEvidence: PhaseCapabilityEvidence;
  authorityDelta: PhaseAuthorityDelta;
  affectedTools: string[];
  affectedIntegrations: string[];
  budgetImpact: {
    classification: 'unchanged';
    before: RunAccessSummary['budgets'];
    after: RunAccessSummary['budgets'];
  };
  approval: {
    required: boolean;
    class: 'none' | 'exact-action';
  };
  enforcement: {
    state: 'ready' | 'blocked';
    provider: string;
    safeBoundary: 'active-run' | 'pause-before-relaunch';
    requiresRelaunch: boolean;
    blockers: RunAccessChangeBlocker[];
  };
}

export interface RunAccessChangeResult {
  preview: RunAccessChangePreview;
  transition: PhaseTransitionResult;
}
