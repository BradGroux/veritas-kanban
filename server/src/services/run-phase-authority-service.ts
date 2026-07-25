import {
  type PhaseAuthorityDimension,
  type RunApprovalPhaseBinding,
  type RunPhaseAuthoritySnapshot,
  type Task,
  type TaskAttempt,
} from '@veritas-kanban/shared';
import { ConflictError, ForbiddenError, NotFoundError } from '../middleware/error-handler.js';
import type { TaskRepository } from '../storage/interfaces.js';
import { getStorage } from '../storage/index.js';
import { verifyPhaseCapabilityEvidenceDigest } from './phase-capability-service.js';
import {
  getPhaseTransitionService,
  type PhaseTransitionService,
} from './phase-transition-service.js';

export interface RunPhaseAuthorityServiceOptions {
  tasks?: Pick<TaskRepository, 'findById'>;
  transitions?: Pick<PhaseTransitionService, 'getCurrent' | 'list'>;
}

/**
 * Resolves the one server-owned phase projection used by execution and reader
 * surfaces. It never infers a phase for legacy attempts.
 */
export class RunPhaseAuthorityService {
  constructor(private readonly options: RunPhaseAuthorityServiceOptions = {}) {}

  async get(
    workspaceId: string,
    taskId: string,
    attemptId: string,
    historyLimit = 100
  ): Promise<RunPhaseAuthoritySnapshot | null> {
    const task = await (this.options.tasks ?? getStorage().tasks).findById(taskId);
    if (!task) throw new NotFoundError('Task not found.');
    return this.project(workspaceId, task, attemptId, historyLimit);
  }

  async getActive(
    workspaceId: string,
    taskId: string,
    attemptId: string,
    historyLimit = 100
  ): Promise<RunPhaseAuthoritySnapshot | null> {
    const task = await (this.options.tasks ?? getStorage().tasks).findById(taskId);
    if (!task) throw new NotFoundError('Task not found.');
    if (task.attempt?.id !== attemptId || task.attempt.status !== 'running') {
      throw new ConflictError('Phase authority does not match the active running attempt.', {
        taskId,
        attemptId,
        activeAttemptId: task.attempt?.id,
        activeStatus: task.attempt?.status,
      });
    }
    return this.project(workspaceId, task, attemptId, historyLimit);
  }

  private async project(
    workspaceId: string,
    task: Task,
    attemptId: string,
    historyLimit: number
  ): Promise<RunPhaseAuthoritySnapshot | null> {
    const taskId = task.id;
    const attempt = findAttempt(task.attempt, task.attempts, attemptId);
    if (!attempt) throw new NotFoundError('Run attempt not found.');
    const manifest = attempt.runLaunchManifest;
    if (!manifest?.phase) return null;
    if (!verifyPhaseCapabilityEvidenceDigest(manifest.phase.evidence)) {
      throw new ConflictError('Launch phase evidence failed integrity validation.', {
        taskId,
        attemptId,
        manifestDigest: manifest.digest,
      });
    }

    const transitions = this.options.transitions ?? getPhaseTransitionService();
    const current = await transitions.getCurrent(workspaceId, taskId, attemptId);
    const history = await transitions.list(workspaceId, taskId, attemptId, historyLimit);
    if (current?.manifestDigest && current.manifestDigest !== manifest.digest) {
      throw new ConflictError('Active phase transition does not match launch evidence.', {
        taskId,
        attemptId,
        transitionManifestDigest: current.manifestDigest,
        launchManifestDigest: manifest.digest,
      });
    }
    const effectiveEvidence = current?.effectiveEvidence ?? manifest.phase.evidence;
    if (!verifyPhaseCapabilityEvidenceDigest(effectiveEvidence)) {
      throw new ConflictError('Effective phase evidence failed integrity validation.', {
        taskId,
        attemptId,
        evidenceDigest: effectiveEvidence.digest,
      });
    }
    return {
      taskId,
      attemptId,
      manifestDigest: manifest.digest,
      launch: structuredClone(manifest.phase),
      effectiveEvidence: structuredClone(effectiveEvidence),
      transitionSequence: current?.sequence ?? 0,
      current: current ? structuredClone(current) : null,
      history: structuredClone(history),
    };
  }

  assertScopes(
    snapshot: RunPhaseAuthoritySnapshot,
    dimension: PhaseAuthorityDimension,
    requestedScopes: string[]
  ): void {
    const requested = [...new Set(requestedScopes)].sort();
    const allowed = snapshot.effectiveEvidence.effectiveAuthority[dimension];
    const denied = requested.filter((scope) => !allowed.includes('*') && !allowed.includes(scope));
    if (requested.length === 0 || denied.length > 0) {
      throw new ForbiddenError('Active phase authority denies this action.', {
        phase: snapshot.effectiveEvidence.identity,
        phaseEvidenceDigest: snapshot.effectiveEvidence.digest,
        dimension,
        requestedScopes: requested,
        effectiveScopes: allowed,
        deniedScopes: denied,
      });
    }
  }

  binding(
    snapshot: RunPhaseAuthoritySnapshot,
    requirements: Array<{
      dimension: PhaseAuthorityDimension;
      requestedScopes: string[];
    }>
  ): RunApprovalPhaseBinding {
    for (const requirement of requirements) {
      this.assertScopes(snapshot, requirement.dimension, requirement.requestedScopes);
    }
    return {
      evidenceDigest: snapshot.effectiveEvidence.digest,
      manifestDigest: snapshot.manifestDigest,
      identity: structuredClone(snapshot.effectiveEvidence.identity),
      transitionSequence: snapshot.transitionSequence,
      requirements: requirements.map((requirement) => ({
        dimension: requirement.dimension,
        requestedScopes: [...new Set(requirement.requestedScopes)].sort(),
      })),
    };
  }
}

function findAttempt(
  current: TaskAttempt | undefined,
  history: TaskAttempt[] | undefined,
  attemptId: string
): TaskAttempt | undefined {
  if (current?.id === attemptId) return current;
  return history?.find((attempt) => attempt.id === attemptId);
}

let singleton: RunPhaseAuthorityService | undefined;

export function getRunPhaseAuthorityService(): RunPhaseAuthorityService {
  singleton ??= new RunPhaseAuthorityService();
  return singleton;
}
