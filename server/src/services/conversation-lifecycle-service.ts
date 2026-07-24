import {
  CONVERSATION_LIFECYCLE_SCHEMA_VERSION,
  type ConversationContextWindow,
  type ConversationLaunchIntent,
  type ConversationLaunchMode,
  type ConversationLifecycleRecord,
  type ConversationState,
  type RunLaunchManifest,
  type TaskAttempt,
  type TaskEnvelope,
} from '@veritas-kanban/shared';
import { ConflictError } from '../middleware/error-handler.js';
import { digestRunLaunchValue } from '../utils/run-launch-manifest-digest.js';

export interface ConversationSource {
  attempt: TaskAttempt;
  conversationId: string;
}

export class ConversationLifecycleService {
  constructor(private readonly now: () => Date = () => new Date()) {}

  recover(attempt: TaskAttempt, providerConversationId?: string): ConversationLifecycleRecord {
    if (attempt.conversation) return attempt.conversation;
    return this.bind(this.create('fresh'), {
      conversationId: attempt.threadId ?? providerConversationId,
    });
  }

  source(attempt: TaskAttempt | undefined, mode: Exclude<ConversationLaunchMode, 'fresh'>) {
    if (!attempt) {
      throw new ConflictError(`Conversation ${mode} source attempt was not found.`);
    }
    if (!['complete', 'failed'].includes(attempt.status)) {
      throw new ConflictError(
        `Conversation ${mode} requires a terminal source attempt; interrupt or finish it first.`,
        { sourceAttemptId: attempt.id, sourceStatus: attempt.status }
      );
    }
    const conversationId = attempt.conversation?.conversationId ?? attempt.threadId;
    if (!conversationId) {
      throw new ConflictError(`Conversation ${mode} source has no durable provider identity.`, {
        sourceAttemptId: attempt.id,
      });
    }
    if (!attempt.providerRuntimeManifest || !attempt.runLaunchManifest || !attempt.taskEnvelope) {
      throw new ConflictError(
        `Conversation ${mode} source has no complete runtime, task, and launch evidence.`,
        { sourceAttemptId: attempt.id }
      );
    }
    if (
      attempt.conversation?.state &&
      ['archived', 'closed'].includes(attempt.conversation.state)
    ) {
      throw new ConflictError(`Conversation ${mode} source is ${attempt.conversation.state}.`, {
        sourceAttemptId: attempt.id,
      });
    }
    return { attempt, conversationId };
  }

  create(
    mode: ConversationLaunchMode,
    source?: ConversationSource,
    forkTurnId?: string,
    intent: ConversationLaunchIntent = mode
  ) {
    if (
      (intent === 'follow-up' && mode !== 'resume') ||
      (intent !== 'follow-up' && intent !== mode)
    ) {
      throw new ConflictError(`Conversation ${intent} is incompatible with ${mode} launch mode.`);
    }
    const timestamp = this.now().toISOString();
    return {
      schemaVersion: CONVERSATION_LIFECYCLE_SCHEMA_VERSION,
      mode,
      intent,
      ...(mode === 'resume' && source ? { conversationId: source.conversationId } : {}),
      ...(source
        ? {
            parentConversationId: source.conversationId,
            parentAttemptId: source.attempt.id,
          }
        : {}),
      ...(forkTurnId ? { forkTurnId } : {}),
      state: 'active',
      contextWindow: unknownContextWindow(timestamp),
      createdAt: timestamp,
      updatedAt: timestamp,
    } satisfies ConversationLifecycleRecord;
  }

  assertCompatible(
    source: ConversationSource,
    target: RunLaunchManifest,
    targetTaskEnvelope: TaskEnvelope,
    mode: Exclude<ConversationLaunchMode, 'fresh'>
  ): void {
    const parent = source.attempt.runLaunchManifest as RunLaunchManifest;
    const parentTaskEnvelope = source.attempt.taskEnvelope as TaskEnvelope;
    const mismatches: string[] = [];
    if (parent.providerRuntime.provider !== target.providerRuntime.provider) {
      mismatches.push('provider');
    }
    if (parent.providerRuntime.adapter !== target.providerRuntime.adapter) {
      mismatches.push('adapter');
    }
    if (parent.providerRuntime.protocolVersion !== target.providerRuntime.protocolVersion) {
      mismatches.push('protocolVersion');
    }
    if (parent.providerRuntime.materialDigest !== target.providerRuntime.materialDigest) {
      mismatches.push('runtimeEvidence');
    }
    if ((parent.runtime.model ?? '') !== (target.runtime.model ?? '')) {
      mismatches.push('model');
    }
    if (parent.runtime.command !== target.runtime.command) mismatches.push('command');
    if (parent.runtime.workingDirectory !== target.runtime.workingDirectory) {
      mismatches.push('workingDirectory');
    }
    if (!sameJson(parent.runtime.environmentKeys, target.runtime.environmentKeys)) {
      mismatches.push('environment');
    }
    if (!sameJson(parent.runtime.credentialReferences, target.runtime.credentialReferences)) {
      mismatches.push('credentials');
    }
    if (
      !sameJson(
        {
          profileId: parent.harnessSupport.profileId,
          adapterId: parent.harnessSupport.adapterId,
          transport: parent.harnessSupport.transport,
        },
        {
          profileId: target.harnessSupport.profileId,
          adapterId: target.harnessSupport.adapterId,
          transport: target.harnessSupport.transport,
        }
      )
    ) {
      mismatches.push('harnessSupport');
    }
    if (!sameJson(parent.profile, target.profile)) mismatches.push('profile');
    if (parent.routing.selectedHost !== target.routing.selectedHost) mismatches.push('host');
    if (!sameJson(parent.sandbox.effective, target.sandbox.effective)) {
      mismatches.push('sandbox');
    }
    if (!sameJson(parent.tools, target.tools)) mismatches.push('tools');
    if (!sameJson(parent.permissions, target.permissions)) mismatches.push('permissions');
    if (!sameJson(parent.resources, target.resources)) mismatches.push('resources');
    if (!sameJson(parent.requiredHealthChecks, target.requiredHealthChecks)) {
      mismatches.push('healthChecks');
    }
    if (!sameJson(parent.budget, target.budget)) mismatches.push('budget');
    if (!sameJson(parent.workspaceTrust, target.workspaceTrust)) mismatches.push('workspaceTrust');
    if (!sameJson(persistentInstructionDigests(parent), persistentInstructionDigests(target))) {
      mismatches.push('instructions');
    }
    if (parentTaskEnvelope.commitPolicy !== targetTaskEnvelope.commitPolicy) {
      mismatches.push('commitPolicy');
    }
    if (!sameJson(parentTaskEnvelope.allowedSideEffects, targetTaskEnvelope.allowedSideEffects)) {
      mismatches.push('allowedSideEffects');
    }
    const parentWorkspace = parent.workspace;
    const targetWorkspace = target.workspace;
    if (!parentWorkspace || !targetWorkspace) {
      mismatches.push('workspaceEvidence');
    } else {
      if (parentWorkspace.repo !== targetWorkspace.repo) mismatches.push('workspaceRepo');
      if (parentWorkspace.baseBranch !== targetWorkspace.baseBranch) {
        mismatches.push('workspaceBaseBranch');
      }
      if (parentWorkspace.resolvedBaseCommit !== targetWorkspace.resolvedBaseCommit) {
        mismatches.push('workspaceBaseCommit');
      }
      if (
        mode === 'resume' &&
        (parentWorkspace.worktreeManifestId ?? parentWorkspace.worktreeId) !==
          (targetWorkspace.worktreeManifestId ?? targetWorkspace.worktreeId)
      ) {
        mismatches.push('worktree');
      }
    }

    if (mismatches.length > 0) {
      throw new ConflictError(`Conversation ${mode} is incompatible with the requested launch.`, {
        sourceAttemptId: source.attempt.id,
        mismatches,
        remediation:
          'Use a fresh conversation or restore the source provider, model, policy, and worktree baseline.',
      });
    }
  }

  bind(
    record: ConversationLifecycleRecord,
    identity: { conversationId?: string; turnId?: string; itemId?: string }
  ): ConversationLifecycleRecord {
    const timestamp = this.now().toISOString();
    return {
      ...record,
      ...(identity.conversationId ? { conversationId: identity.conversationId } : {}),
      ...(identity.turnId ? { currentTurnId: identity.turnId } : {}),
      ...(identity.itemId ? { lastItemId: identity.itemId } : {}),
      updatedAt: timestamp,
    };
  }

  recordContext(
    record: ConversationLifecycleRecord,
    usedTokens: number,
    limitTokens?: number
  ): ConversationLifecycleRecord {
    const timestamp = this.now().toISOString();
    const boundedUsed = positiveInteger(usedTokens);
    const boundedLimit = limitTokens === undefined ? undefined : positiveInteger(limitTokens);
    const utilization =
      boundedLimit && boundedLimit > 0 ? Math.min(1, boundedUsed / boundedLimit) : undefined;
    const posture =
      utilization === undefined
        ? 'unknown'
        : utilization >= 0.9
          ? 'critical'
          : utilization >= 0.75
            ? 'nearing-limit'
            : 'healthy';
    return {
      ...record,
      contextWindow: {
        usedTokens: boundedUsed,
        ...(boundedLimit
          ? {
              limitTokens: boundedLimit,
              remainingTokens: Math.max(0, boundedLimit - boundedUsed),
              utilization,
            }
          : {}),
        posture,
        measuredAt: timestamp,
      },
      updatedAt: timestamp,
    };
  }

  transition(
    record: ConversationLifecycleRecord,
    state: Exclude<ConversationState, 'active'>
  ): ConversationLifecycleRecord {
    const timestamp = this.now().toISOString();
    return {
      ...record,
      state,
      updatedAt: timestamp,
      ...(state === 'compacted'
        ? { compactedAt: timestamp }
        : state === 'archived'
          ? { archivedAt: timestamp }
          : { closedAt: timestamp }),
    };
  }
}

function unknownContextWindow(measuredAt: string): ConversationContextWindow {
  return { posture: 'unknown', measuredAt };
}

function positiveInteger(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.floor(value);
}

function sameJson(left: unknown, right: unknown): boolean {
  return digestRunLaunchValue(left) === digestRunLaunchValue(right);
}

function persistentInstructionDigests(manifest: RunLaunchManifest): string[] {
  return manifest.instructions
    .filter((instruction) => instruction.kind !== 'task')
    .map((instruction) => instruction.materialDigest)
    .sort();
}
