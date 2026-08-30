import {
  PHASE_AUTHORITY_DIMENSIONS,
  RUN_ACCESS_CHANGE_PREVIEW_SCHEMA_VERSION,
  type PhaseAuthority,
  type PhaseAuthorityDimension,
  type PhaseAuthorityEnforcement,
  type PhaseCapabilityCompilerSources,
  type RunAccessChangeInput,
  type RunAccessChangePreview,
  type RunAccessChangeResult,
  type RunPhaseAuthoritySnapshot,
} from '@veritas-kanban/shared';
import { ConflictError } from '../middleware/error-handler.js';
import { runAccessChangeInputSchema } from '../schemas/phase-capability-schemas.js';
import { digestRunLaunchValue } from '../utils/run-launch-manifest-digest.js';
import {
  compilePhaseCapabilityAuthority,
  getBuiltInPhaseCapabilityProfile,
} from './phase-capability-service.js';
import {
  getPhaseTransitionService,
  calculatePhaseAuthorityDelta,
  type PhaseTransitionActorContext,
  type PhaseTransitionService,
} from './phase-transition-service.js';
import {
  getRunAccessSummaryService,
  type RunAccessSummaryService,
} from './run-access-summary-service.js';
import {
  getRunPhaseAuthorityService,
  type RunPhaseAuthorityService,
} from './run-phase-authority-service.js';

const ACP_LIVE_DIMENSIONS = new Set<PhaseAuthorityDimension>([
  'command.execute',
  'external.action',
  'artifact.plan.write',
]);

export interface RunAccessChangeServiceOptions {
  phases?: Pick<RunPhaseAuthorityService, 'getActive'>;
  access?: Pick<RunAccessSummaryService, 'get'>;
  transitions?: Pick<PhaseTransitionService, 'transition'>;
}

/**
 * Builds access transitions from server-owned launch evidence. Callers choose
 * a reviewed phase profile, never submit mutable authority evidence.
 */
export class RunAccessChangeService {
  constructor(private readonly options: RunAccessChangeServiceOptions = {}) {}

  async preview(
    workspaceId: string,
    taskId: string,
    request: RunAccessChangeInput
  ): Promise<RunAccessChangePreview> {
    const input = runAccessChangeInputSchema.parse(request);
    const snapshot = await (this.options.phases ?? getRunPhaseAuthorityService()).getActive(
      workspaceId,
      taskId,
      input.attemptId,
      100
    );
    if (!snapshot) {
      throw new ConflictError('This run has no governed phase authority to change.', {
        taskId,
        attemptId: input.attemptId,
      });
    }
    assertExpectedPreviewState(snapshot, input);

    const access = await (this.options.access ?? getRunAccessSummaryService()).get(
      workspaceId,
      taskId,
      input.attemptId
    );
    if (access.current.digest !== input.expectedAccessSummaryDigest) {
      throw new ConflictError('Run Access change summary evidence is stale.', {
        activeAccessSummaryDigest: access.current.digest,
        receivedAccessSummaryDigest: input.expectedAccessSummaryDigest,
      });
    }
    const targetEvidence = compileTargetEvidence(
      snapshot.launch.evidence.effectiveAuthority,
      input.targetPhase
    );
    const authorityDelta = calculatePhaseAuthorityDelta(
      snapshot.effectiveEvidence.effectiveAuthority,
      targetEvidence.effectiveAuthority
    );
    const changedDimensions = authorityDelta.entries.map((entry) => entry.dimension);
    const provider = access.current.identity.provider ?? 'unknown';
    const blockers = transitionBlockers(provider, changedDimensions, targetEvidence.status);
    const requiresRelaunch = blockers.some(
      (blocker) => blocker.code === 'provider-boundary-relaunch-required'
    );
    const approvalRequired = authorityDelta.entries.some((entry) => entry.addedScopes.length > 0);
    const revisionPayload = {
      taskId,
      attemptId: input.attemptId,
      requestId: input.requestId,
      operation: input.operation,
      targetPhase: input.targetPhase,
      reason: input.reason,
      expectedAccessSummaryDigest: input.expectedAccessSummaryDigest,
      expectedSequence: snapshot.transitionSequence,
      expectedPhaseEvidenceDigest: snapshot.effectiveEvidence.digest,
      expectedManifestDigest: snapshot.manifestDigest,
      targetEvidenceDigest: targetEvidence.digest,
      authorityDelta,
      provider,
      blockers,
      approvalTtlMs: input.approvalTtlMs,
    };

    return {
      schemaVersion: RUN_ACCESS_CHANGE_PREVIEW_SCHEMA_VERSION,
      requestRevision: digestRunLaunchValue(revisionPayload),
      taskId,
      attemptId: input.attemptId,
      requestId: input.requestId,
      operation: input.operation,
      targetPhase: input.targetPhase,
      reason: input.reason,
      expectedAccessSummaryDigest: input.expectedAccessSummaryDigest,
      expectedSequence: snapshot.transitionSequence,
      expectedPhaseEvidenceDigest: snapshot.effectiveEvidence.digest,
      expectedManifestDigest: snapshot.manifestDigest,
      targetEvidence,
      authorityDelta,
      affectedTools: changedDimensions.some(
        (dimension) => dimension === 'command.execute' || dimension === 'external.action'
      )
        ? access.current.tools.map((tool) => tool.qualifiedName).sort()
        : [],
      affectedIntegrations: changedDimensions.some(
        (dimension) =>
          dimension === 'credential.access' ||
          dimension === 'network.egress' ||
          dimension === 'external.action'
      )
        ? access.current.integrations.map((integration) => integration.accountLabel).sort()
        : [],
      budgetImpact: {
        classification: 'unchanged',
        before: structuredClone(access.current.budgets),
        after: structuredClone(access.current.budgets),
      },
      approval: {
        required: approvalRequired,
        class: approvalRequired ? 'exact-action' : 'none',
      },
      enforcement: {
        state: blockers.length > 0 ? 'blocked' : 'ready',
        provider,
        safeBoundary: requiresRelaunch ? 'pause-before-relaunch' : 'active-run',
        requiresRelaunch,
        blockers,
      },
    };
  }

  async apply(
    workspaceId: string,
    taskId: string,
    request: RunAccessChangeInput,
    actor: PhaseTransitionActorContext
  ): Promise<RunAccessChangeResult> {
    const input = runAccessChangeInputSchema.parse(request);
    if (!input.requestRevision) {
      throw new ConflictError('Applying a Run Access change requires its exact preview revision.');
    }
    const preview = await this.preview(workspaceId, taskId, input);
    if (preview.requestRevision !== input.requestRevision) {
      throw new ConflictError('Run Access change preview is stale.', {
        expectedRequestRevision: preview.requestRevision,
        receivedRequestRevision: input.requestRevision,
      });
    }
    if (preview.enforcement.state === 'blocked') {
      throw new ConflictError('Run Access change cannot be enforced on the active run.', {
        blockers: preview.enforcement.blockers,
        safeBoundary: preview.enforcement.safeBoundary,
        requiresRelaunch: preview.enforcement.requiresRelaunch,
      });
    }

    const snapshot = await (this.options.phases ?? getRunPhaseAuthorityService()).getActive(
      workspaceId,
      taskId,
      input.attemptId,
      1
    );
    if (!snapshot) {
      throw new ConflictError('This run has no governed phase authority to change.');
    }

    const transition = await (this.options.transitions ?? getPhaseTransitionService()).transition(
      workspaceId,
      taskId,
      {
        attemptId: input.attemptId,
        operationId: input.requestId,
        expectedSequence: preview.expectedSequence,
        expectedPhaseEvidenceDigest: preview.expectedPhaseEvidenceDigest,
        expectedManifestDigest: preview.expectedManifestDigest,
        reason: input.reason,
        fromEvidence: snapshot.effectiveEvidence,
        targetEvidence: preview.targetEvidence,
        approvalId: input.approvalId,
        approvalTtlMs: input.approvalTtlMs,
      },
      actor
    );
    return { preview, transition };
  }
}

function compileTargetEvidence(
  ceiling: PhaseAuthority,
  targetPhase: RunAccessChangeInput['targetPhase']
) {
  const source = <
    TKind extends PhaseCapabilityCompilerSources[keyof PhaseCapabilityCompilerSources]['kind'],
  >(
    kind: TKind
  ) => ({
    id: `run-access-ceiling:${kind}`,
    kind,
    authority: cloneAuthority(ceiling),
    enforcement: enforced(),
  });
  const sources: PhaseCapabilityCompilerSources = {
    parent: source('parent'),
    agentProfile: source('agent-profile'),
    sandbox: source('sandbox'),
    toolCatalog: source('tool-catalog'),
    launchPolicy: source('launch-policy'),
  };
  return compilePhaseCapabilityAuthority({
    profile: getBuiltInPhaseCapabilityProfile(targetPhase),
    sources,
  });
}

function transitionBlockers(
  provider: string,
  changedDimensions: PhaseAuthorityDimension[],
  targetStatus: 'allowed' | 'narrowed' | 'blocked'
): RunAccessChangePreview['enforcement']['blockers'] {
  if (targetStatus !== 'allowed') {
    return [
      {
        code: 'target-authority-denied',
        message: 'The immutable launch authority cannot satisfy the selected target phase.',
        dimensions: [...changedDimensions],
      },
    ];
  }
  if (changedDimensions.length === 0) return [];
  if (provider !== 'acp-stdio') {
    return [
      {
        code: 'provider-live-transition-unsupported',
        message: `${provider} cannot prove atomic live authority changes. Relaunch with the target phase.`,
        dimensions: [...changedDimensions],
      },
    ];
  }
  const relaunchDimensions = changedDimensions.filter(
    (dimension) => !ACP_LIVE_DIMENSIONS.has(dimension)
  );
  return relaunchDimensions.length > 0
    ? [
        {
          code: 'provider-boundary-relaunch-required',
          message:
            'The selected change crosses a process boundary that ACP cannot atomically replace. Pause before relaunch.',
          dimensions: relaunchDimensions,
        },
      ]
    : [];
}

function assertExpectedPreviewState(
  snapshot: RunPhaseAuthoritySnapshot,
  input: RunAccessChangeInput
): void {
  if (
    snapshot.transitionSequence !== input.expectedSequence ||
    snapshot.effectiveEvidence.digest !== input.expectedPhaseEvidenceDigest ||
    snapshot.manifestDigest !== input.expectedManifestDigest
  ) {
    throw new ConflictError('Run Access change compare-and-set evidence is stale.', {
      activeSequence: snapshot.transitionSequence,
      activePhaseEvidenceDigest: snapshot.effectiveEvidence.digest,
      activeManifestDigest: snapshot.manifestDigest,
    });
  }
}

function cloneAuthority(value: PhaseAuthority): PhaseAuthority {
  return Object.fromEntries(
    PHASE_AUTHORITY_DIMENSIONS.map((dimension) => [dimension, [...value[dimension]]])
  ) as PhaseAuthority;
}

function enforced(): PhaseAuthorityEnforcement {
  return Object.fromEntries(
    PHASE_AUTHORITY_DIMENSIONS.map((dimension) => [dimension, 'enforced'])
  ) as PhaseAuthorityEnforcement;
}

let singleton: RunAccessChangeService | undefined;

export function getRunAccessChangeService(): RunAccessChangeService {
  singleton ??= new RunAccessChangeService();
  return singleton;
}
