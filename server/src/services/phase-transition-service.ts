import { nanoid } from 'nanoid';
import {
  EXECUTABLE_AGENT_PROVIDERS,
  PHASE_AUTHORITY_DIMENSIONS,
  PHASE_TRANSITION_RECORD_SCHEMA_VERSION,
  type ExecutableAgentProvider,
  type PhaseAuthority,
  type PhaseAuthorityDelta,
  type PhaseAuthorityDeltaEntry,
  type PhaseCapabilityEvidence,
  type PhaseTransitionRecord,
  type PhaseTransitionRequestInput,
  type PhaseTransitionResult,
  type RunApprovalActor,
  type RunApprovalRequest,
  type Task,
} from '@veritas-kanban/shared';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../middleware/error-handler.js';
import {
  phaseCapabilityEvidenceSchema,
  phaseTransitionRecordSchema,
  phaseTransitionRequestInputSchema,
} from '../schemas/phase-capability-schemas.js';
import type { PhaseTransitionRepository, TaskRepository } from '../storage/interfaces.js';
import { FilePhaseTransitionRepository } from '../storage/phase-transition-repository.js';
import { getStorage, getStorageTypeFromEnv } from '../storage/index.js';
import { verifyPhaseCapabilityEvidenceDigest } from './phase-capability-service.js';
import {
  getRunApprovalBrokerService,
  type RunApprovalBrokerService,
} from './run-approval-broker-service.js';
import { RunEventJournalService } from './run-event-journal-service.js';

const MAX_OVERRIDE_TTL_MS = 24 * 60 * 60 * 1_000;

export interface PhaseTransitionActorContext {
  actor: RunApprovalActor;
  administrator: boolean;
}

export interface PhaseTransitionServiceOptions {
  repository?: PhaseTransitionRepository;
  tasks?: Pick<TaskRepository, 'findById'>;
  approvals?: Pick<RunApprovalBrokerService, 'request'>;
  journal?: Pick<RunEventJournalService, 'append'>;
  now?: () => Date;
  id?: () => string;
}

let fileRepository: FilePhaseTransitionRepository | undefined;
let singleton: PhaseTransitionService | undefined;

function defaultRepository(): PhaseTransitionRepository {
  if (getStorageTypeFromEnv() === 'sqlite') return getStorage().phaseTransitions;
  fileRepository ??= new FilePhaseTransitionRepository();
  return fileRepository;
}

export class PhaseTransitionService {
  private readonly repository: PhaseTransitionRepository;
  private readonly tasks: Pick<TaskRepository, 'findById'>;
  private readonly approvals: Pick<RunApprovalBrokerService, 'request'>;
  private readonly journal: Pick<RunEventJournalService, 'append'>;
  private readonly now: () => Date;
  private readonly id: () => string;

  constructor(options: PhaseTransitionServiceOptions = {}) {
    this.repository = options.repository ?? defaultRepository();
    this.tasks = options.tasks ?? getStorage().tasks;
    this.approvals = options.approvals ?? getRunApprovalBrokerService();
    this.journal = options.journal ?? new RunEventJournalService();
    this.now = options.now ?? (() => new Date());
    this.id = options.id ?? (() => `phasetransition_${nanoid(18)}`);
  }

  async getCurrent(
    workspaceId: string,
    taskId: string,
    attemptId: string
  ): Promise<PhaseTransitionRecord | null> {
    const current = await this.repository.getCurrent(workspaceId, taskId, attemptId);
    if (!current?.emergencyOverride) return current;
    if (Date.parse(current.emergencyOverride.expiresAt) > this.now().getTime()) return current;
    return this.expireOverride(current);
  }

  async list(
    workspaceId: string,
    taskId: string,
    attemptId: string,
    limit = 100
  ): Promise<PhaseTransitionRecord[]> {
    await this.getCurrent(workspaceId, taskId, attemptId);
    return this.repository.list({ workspaceId, taskId, attemptId, limit });
  }

  async transition(
    workspaceId: string,
    taskId: string,
    request: PhaseTransitionRequestInput,
    actorContext: PhaseTransitionActorContext
  ): Promise<PhaseTransitionResult> {
    const input = phaseTransitionRequestInputSchema.parse(request);
    if (actorContext.actor.workspaceId !== workspaceId) {
      throw new ForbiddenError('Phase transition actor does not belong to this workspace.');
    }
    const targetEvidence = verifiedEvidence(input.targetEvidence, 'Target phase evidence');
    if (targetEvidence.status === 'blocked') {
      throw new ForbiddenError('Blocked phase evidence cannot become active.', {
        evidenceDigest: targetEvidence.digest,
        blockers: targetEvidence.blockers.map((blocker) => blocker.code),
      });
    }
    if (targetEvidence.identity.mode !== 'profile') {
      throw new ValidationError('Operator transitions must target a defined phase profile.');
    }

    const existing = await this.repository.getByOperationId(
      workspaceId,
      taskId,
      input.attemptId,
      input.operationId
    );
    if (existing) {
      if (
        existing.priorEvidence.digest !== input.expectedPhaseEvidenceDigest ||
        existing.effectiveEvidence.digest !== targetEvidence.digest ||
        existing.manifestDigest !== input.expectedManifestDigest ||
        existing.sequence !== input.expectedSequence + 1
      ) {
        throw transitionConflict('operation-reused', existing);
      }
      await this.projectEvent(existing);
      return {
        status: 'applied',
        current: existing,
        record: existing,
        targetEvidenceDigest: targetEvidence.digest,
      };
    }

    const task = await this.activeTask(taskId, input);
    const current = await this.getCurrent(workspaceId, taskId, input.attemptId);
    const priorEvidence = current
      ? current.effectiveEvidence
      : input.fromEvidence
        ? verifiedEvidence(input.fromEvidence, 'Initial phase evidence')
        : undefined;
    if (!priorEvidence) {
      throw new ValidationError(
        'The first transition for a run requires the exact initial phase evidence.'
      );
    }
    assertExpectedState(current, priorEvidence, input);

    const authorityDelta = calculatePhaseAuthorityDelta(
      priorEvidence.effectiveAuthority,
      targetEvidence.effectiveAuthority
    );
    const expansion = hasExpansion(authorityDelta);
    let policyDecision: PhaseTransitionRecord['policyDecision'] = 'allow';
    let approval: RunApprovalRequest | undefined;
    let emergencyOverride: PhaseTransitionRecord['emergencyOverride'];

    if (input.emergencyOverride) {
      if (!expansion) {
        throw new ValidationError('Emergency override is reserved for authority expansion.');
      }
      if (!actorContext.administrator) {
        throw new ForbiddenError('Emergency phase override requires admin:manage permission.');
      }
      const expiresAt = Date.parse(input.emergencyOverride.expiresAt);
      const now = this.now().getTime();
      if (
        !Number.isFinite(expiresAt) ||
        expiresAt <= now ||
        expiresAt - now > MAX_OVERRIDE_TTL_MS
      ) {
        throw new ValidationError('Emergency phase override must expire within 24 hours.');
      }
      policyDecision = 'emergency-override';
      emergencyOverride = {
        permission: 'admin:manage',
        justification: input.emergencyOverride.justification,
        expiresAt: input.emergencyOverride.expiresAt,
      };
    } else if (expansion) {
      approval = await this.expansionApproval(
        task,
        workspaceId,
        input,
        priorEvidence,
        authorityDelta
      );
      if (input.approvalId && input.approvalId !== approval.id) {
        throw new ConflictError(
          'Phase transition approval does not match the requested expansion.',
          {
            expectedApprovalId: approval.id,
            receivedApprovalId: input.approvalId,
          }
        );
      }
      if (approval.status === 'pending') {
        return {
          status: 'approval-required',
          current,
          approval,
          targetEvidenceDigest: targetEvidence.digest,
        };
      }
      if (approval.status !== 'approved') {
        throw new ConflictError('Phase transition approval is not approved.', {
          approvalId: approval.id,
          status: approval.status,
        });
      }
      policyDecision = 'approved-expansion';
    }

    const transitionId = this.id();
    const record = phaseTransitionRecordSchema.parse({
      schemaVersion: PHASE_TRANSITION_RECORD_SCHEMA_VERSION,
      id: transitionId,
      workspaceId,
      taskId,
      attemptId: input.attemptId,
      sequence: input.expectedSequence + 1,
      operationId: input.operationId,
      priorEvidence,
      effectiveEvidence: targetEvidence,
      authorityDelta,
      actor: actorContext.actor,
      reason: input.reason,
      policyDecision,
      ...(approval ? { approvalId: approval.id } : {}),
      ...(emergencyOverride ? { emergencyOverride } : {}),
      manifestDigest: input.expectedManifestDigest,
      eventReference: phaseEventReference(transitionId),
      createdAt: this.now().toISOString(),
    });
    const result = await this.repository.append({
      record,
      expectedSequence: input.expectedSequence,
      expectedPhaseEvidenceDigest: input.expectedPhaseEvidenceDigest,
      expectedManifestDigest: input.expectedManifestDigest,
    });
    if (!result.record || result.reason) {
      throw transitionConflict(result.reason, result.record);
    }
    await this.projectEvent(result.record);
    return {
      status: 'applied',
      current: result.record,
      record: result.record,
      targetEvidenceDigest: targetEvidence.digest,
    };
  }

  private async activeTask(taskId: string, input: PhaseTransitionRequestInput): Promise<Task> {
    const task = await this.tasks.findById(taskId);
    if (!task) throw new NotFoundError('Task not found.');
    if (task.attempt?.id !== input.attemptId || task.attempt.status !== 'running') {
      throw new ConflictError('Phase transition does not match the active running attempt.', {
        expectedAttemptId: input.attemptId,
        activeAttemptId: task.attempt?.id,
        activeStatus: task.attempt?.status,
      });
    }
    if (task.attempt.runLaunchManifest?.digest !== input.expectedManifestDigest) {
      throw new ConflictError('Phase transition launch-manifest evidence is stale.', {
        expectedManifestDigest: input.expectedManifestDigest,
        activeManifestDigest: task.attempt.runLaunchManifest?.digest,
      });
    }
    if (
      !task.attempt.provider ||
      !EXECUTABLE_AGENT_PROVIDERS.includes(task.attempt.provider as ExecutableAgentProvider)
    ) {
      throw new ConflictError('Active attempt does not identify an executable provider.');
    }
    return task;
  }

  private async expansionApproval(
    task: Task,
    workspaceId: string,
    input: PhaseTransitionRequestInput,
    priorEvidence: PhaseCapabilityEvidence,
    authorityDelta: PhaseAuthorityDelta
  ): Promise<RunApprovalRequest> {
    const added = authorityDelta.entries.flatMap((entry) =>
      entry.addedScopes.map((scope) => `${entry.dimension}:${scope}`)
    );
    const critical = authorityDelta.entries.some(
      (entry) =>
        entry.addedScopes.length > 0 &&
        (entry.dimension === 'credential.access' || entry.dimension === 'external.action')
    );
    return this.approvals.request({
      workspaceId,
      taskId: task.id,
      attemptId: input.attemptId,
      provider: task.attempt?.provider as ExecutableAgentProvider,
      agentId: task.attempt?.agent ?? 'agent',
      requestKind: 'approval',
      actionClass: 'workflow',
      action: 'Expand active run phase authority',
      exactAction: {
        operationId: input.operationId,
        fromEvidenceDigest: priorEvidence.digest,
        toEvidenceDigest: input.targetEvidence.digest,
        manifestDigest: input.expectedManifestDigest,
        authorityDelta,
      },
      details: `Transition from ${identityLabel(priorEvidence)} to ${identityLabel(input.targetEvidence)}.`,
      resourceScope: added,
      riskClass: critical ? 'critical' : 'high',
      policyReason: 'Authority-expanding phase transitions require exact-action approval.',
      evidenceRevision: input.expectedPhaseEvidenceDigest,
      providerRequestId: `phase:${input.operationId}`,
      mobileSafe: false,
      ttlMs: input.approvalTtlMs,
    });
  }

  private async expireOverride(current: PhaseTransitionRecord): Promise<PhaseTransitionRecord> {
    const operationId = `override-expiry:${current.id}`;
    const transitionId = this.id();
    const record = phaseTransitionRecordSchema.parse({
      schemaVersion: PHASE_TRANSITION_RECORD_SCHEMA_VERSION,
      id: transitionId,
      workspaceId: current.workspaceId,
      taskId: current.taskId,
      attemptId: current.attemptId,
      sequence: current.sequence + 1,
      operationId,
      priorEvidence: current.effectiveEvidence,
      effectiveEvidence: current.priorEvidence,
      authorityDelta: calculatePhaseAuthorityDelta(
        current.effectiveEvidence.effectiveAuthority,
        current.priorEvidence.effectiveAuthority
      ),
      actor: {
        id: 'phase-override-expiry',
        label: 'Phase override expiry',
        type: 'service',
        authMethod: 'system',
        workspaceId: current.workspaceId,
      },
      reason: `Emergency phase override ${current.id} expired.`,
      policyDecision: 'override-expired',
      manifestDigest: current.manifestDigest,
      eventReference: phaseEventReference(transitionId),
      createdAt: this.now().toISOString(),
    });
    const result = await this.repository.append({
      record,
      expectedSequence: current.sequence,
      expectedPhaseEvidenceDigest: current.effectiveEvidence.digest,
      expectedManifestDigest: current.manifestDigest,
    });
    if (!result.record || result.reason) {
      const latest = await this.repository.getCurrent(
        current.workspaceId,
        current.taskId,
        current.attemptId
      );
      if (latest && latest.sequence > current.sequence) return latest;
      throw transitionConflict(result.reason, result.record);
    }
    await this.projectEvent(result.record);
    return result.record;
  }

  private async projectEvent(record: PhaseTransitionRecord): Promise<void> {
    await this.journal.append({
      taskId: record.taskId,
      attemptId: record.attemptId,
      kind:
        record.policyDecision === 'override-expired'
          ? 'phase.override-expired'
          : 'phase.transitioned',
      source: {
        provider: record.policyDecision === 'override-expired' ? 'system' : 'operator',
        adapter: 'phase-transition-service',
      },
      payload: {
        transitionId: record.id,
        sequence: record.sequence,
        operationId: record.operationId,
        fromEvidenceDigest: record.priorEvidence.digest,
        toEvidenceDigest: record.effectiveEvidence.digest,
        policyDecision: record.policyDecision,
        approvalId: record.approvalId,
        overrideExpiresAt: record.emergencyOverride?.expiresAt,
        manifestDigest: record.manifestDigest,
      },
      dedupeKey: record.eventReference,
    });
  }
}

export function calculatePhaseAuthorityDelta(
  from: PhaseAuthority,
  to: PhaseAuthority
): PhaseAuthorityDelta {
  const entries: PhaseAuthorityDeltaEntry[] = [];
  for (const dimension of PHASE_AUTHORITY_DIMENSIONS) {
    const delta = scopeDelta(from[dimension], to[dimension]);
    if (delta.addedScopes.length || delta.removedScopes.length) {
      entries.push({ dimension, ...delta });
    }
  }
  const expanded = entries.some((entry) => entry.addedScopes.length > 0);
  const narrowed = entries.some((entry) => entry.removedScopes.length > 0);
  return {
    classification:
      expanded && narrowed ? 'mixed' : expanded ? 'expanding' : narrowed ? 'narrowing' : 'same',
    entries,
  };
}

function scopeDelta(
  from: string[],
  to: string[]
): Pick<PhaseAuthorityDeltaEntry, 'addedScopes' | 'removedScopes'> {
  if (from.includes('*') && to.includes('*')) return { addedScopes: [], removedScopes: [] };
  if (from.includes('*')) return { addedScopes: [], removedScopes: ['*'] };
  if (to.includes('*')) return { addedScopes: ['*'], removedScopes: [] };
  const fromSet = new Set(from);
  const toSet = new Set(to);
  return {
    addedScopes: to.filter((scope) => !fromSet.has(scope)),
    removedScopes: from.filter((scope) => !toSet.has(scope)),
  };
}

function hasExpansion(delta: PhaseAuthorityDelta): boolean {
  return delta.entries.some((entry) => entry.addedScopes.length > 0);
}

function verifiedEvidence(input: PhaseCapabilityEvidence, label: string): PhaseCapabilityEvidence {
  const evidence = phaseCapabilityEvidenceSchema.parse(input);
  if (!verifyPhaseCapabilityEvidenceDigest(evidence)) {
    throw new ConflictError(`${label} digest does not match its content.`);
  }
  return evidence;
}

function assertExpectedState(
  current: PhaseTransitionRecord | null,
  priorEvidence: PhaseCapabilityEvidence,
  input: PhaseTransitionRequestInput
): void {
  if ((current?.sequence ?? 0) !== input.expectedSequence) {
    throw new ConflictError('Phase transition sequence is stale.', {
      expectedSequence: input.expectedSequence,
      activeSequence: current?.sequence ?? 0,
    });
  }
  if (priorEvidence.digest !== input.expectedPhaseEvidenceDigest) {
    throw new ConflictError('Phase transition evidence is stale.', {
      expectedPhaseEvidenceDigest: input.expectedPhaseEvidenceDigest,
      activePhaseEvidenceDigest: priorEvidence.digest,
    });
  }
  if (current && current.manifestDigest !== input.expectedManifestDigest) {
    throw new ConflictError('Phase transition manifest reference is stale.', {
      expectedManifestDigest: input.expectedManifestDigest,
      activeManifestDigest: current.manifestDigest,
    });
  }
}

function phaseEventReference(transitionId: string): string {
  return `phase:${transitionId}`;
}

function identityLabel(evidence: PhaseCapabilityEvidence): string {
  return evidence.identity.mode === 'legacy'
    ? 'legacy'
    : `${evidence.identity.profileId}@${evidence.identity.profileVersion}`;
}

function transitionConflict(
  reason?: 'stale-sequence' | 'stale-phase-evidence' | 'stale-manifest' | 'operation-reused',
  record?: PhaseTransitionRecord
): ConflictError {
  return new ConflictError('Phase transition compare-and-set failed.', {
    reason: reason ?? 'unknown',
    activeSequence: record?.sequence,
    activeEvidenceDigest: record?.effectiveEvidence.digest,
    activeManifestDigest: record?.manifestDigest,
  });
}

export function getPhaseTransitionService(): PhaseTransitionService {
  singleton ??= new PhaseTransitionService();
  return singleton;
}
