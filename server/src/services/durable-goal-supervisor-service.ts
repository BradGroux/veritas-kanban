import { createHash } from 'node:crypto';
import type {
  AgentBudgetMetric,
  AgentBudgetLimits,
  AgentBudgetUsage,
  CompletionResult,
  DurableGoalBlocker,
  DurableGoalCompletionEvidence,
  DurableGoalContinuationAttempt,
  DurableGoalRecord,
} from '@veritas-kanban/shared';
import { ZERO_AGENT_BUDGET_USAGE } from '@veritas-kanban/shared';
import { DurableGoalService, getDurableGoalService } from './durable-goal-service.js';

const NON_TERMINAL_STATES = [
  'active',
  'paused',
  'blocked',
  'awaiting-approval',
  'usage-limited',
  'budget-limited',
] as const;

const BUDGET_METRICS: AgentBudgetMetric[] = [
  'inputTokens',
  'outputTokens',
  'totalTokens',
  'costUsd',
  'toolCalls',
  'runtimeSeconds',
  'idleRuntimeSeconds',
  'retries',
  'fanOut',
];

export interface DurableGoalContinuationDispatchRequest {
  goal: DurableGoalRecord;
  sourceTaskId: string;
  sourceAttemptId: string;
  message: string;
  admissionIdempotencyKey: string;
  remainingBudget?: AgentBudgetLimits;
}

export interface DurableGoalContinuationDispatchResult {
  attemptId: string;
  queueId?: string;
}

export type DurableGoalContinuationDispatcher = (
  request: DurableGoalContinuationDispatchRequest
) => Promise<DurableGoalContinuationDispatchResult>;

export interface DurableGoalCompletionInput {
  workspaceId: string;
  taskId: string;
  attemptId: string;
  parentAttemptId?: string;
  conversationId?: string;
  completion: CompletionResult;
  usage?: AgentBudgetUsage;
}

export interface DurableGoalReconcileTaskInput {
  workspaceId: string;
  taskId: string;
  currentAttemptId?: string;
  parentAttemptId?: string;
  currentAttemptRunning?: boolean;
}

export interface DurableGoalSupervisionResult {
  action:
    | 'not-found'
    | 'ambiguous'
    | 'already-handled'
    | 'complete'
    | 'blocked'
    | 'paused'
    | 'usage-limited'
    | 'budget-limited'
    | 'dispatched'
    | 'reconciled';
  goal?: DurableGoalRecord;
  continuation?: DurableGoalContinuationAttempt;
}

export class DurableGoalSupervisorService {
  constructor(private readonly goals: DurableGoalService = getDurableGoalService()) {}

  async handleRunCompletion(
    input: DurableGoalCompletionInput,
    dispatch: DurableGoalContinuationDispatcher
  ): Promise<DurableGoalSupervisionResult> {
    const owner = await this.findOwningGoal(input.workspaceId, input.taskId, input.attemptId);
    if (owner.kind !== 'goal') return { action: owner.kind };

    const evidence = completionEvidence(owner.goal, input.completion);
    let goal = await this.goals.recordRunOutcome(owner.goal.id, {
      expectedRevision: owner.goal.revision,
      run: {
        taskId: input.taskId,
        attemptId: input.attemptId,
        parentAttemptId: input.parentAttemptId,
        conversationId: input.conversationId,
      },
      usageEvent: {
        id: `completion:${input.completion.idempotencyKey}`,
        taskId: input.taskId,
        attemptId: input.attemptId,
        usage: input.usage ?? { ...ZERO_AGENT_BUDGET_USAGE },
        recordedAt: input.completion.completedAt,
      },
      completionEvidence: evidence,
    });

    if (goal.state !== 'active') {
      return { action: 'already-handled', goal };
    }

    if (input.completion.status === 'blocked') {
      goal = await this.blockGoal(goal, blockerFromCompletion(input.completion));
      return { action: 'blocked', goal };
    }
    if (input.completion.status === 'failed' || input.completion.status === 'interrupted') {
      goal = await this.blockGoal(goal, failedRunBlocker(input.completion));
      return { action: 'blocked', goal };
    }

    if (input.completion.status === 'success' && requiredEvidenceComplete(goal)) {
      goal = await this.goals.transition(goal.id, {
        expectedRevision: goal.revision,
        to: 'complete',
        actorId: 'durable-goal-supervisor',
        reason: 'All required durable goal completion evidence is verified.',
      });
      return { action: 'complete', goal };
    }

    if (goal.continuation.mode === 'manual') {
      goal = await this.goals.transition(goal.id, {
        expectedRevision: goal.revision,
        to: 'paused',
        actorId: 'durable-goal-supervisor',
        reason: 'The durable goal requires an operator-triggered continuation.',
      });
      return { action: 'paused', goal };
    }

    if (
      goal.continuation.maxTurns !== undefined &&
      goal.continuationChain.length >= goal.continuation.maxTurns
    ) {
      goal = await this.goals.transition(goal.id, {
        expectedRevision: goal.revision,
        to: 'usage-limited',
        actorId: 'durable-goal-supervisor',
        reason: `The durable goal reached its ${goal.continuation.maxTurns}-turn limit.`,
      });
      return { action: 'usage-limited', goal };
    }

    if (budgetLimitReached(goal)) {
      goal = await this.goals.transition(goal.id, {
        expectedRevision: goal.revision,
        to: 'budget-limited',
        actorId: 'durable-goal-supervisor',
        reason: 'The durable goal reached a configured aggregate budget limit.',
      });
      return { action: 'budget-limited', goal };
    }

    if (!input.completion.continuation) {
      goal = await this.blockGoal(goal, {
        id: stableId('blocker', goal.id, input.attemptId, 'continuation-handle'),
        code: 'CONTINUATION_HANDLE_MISSING',
        summary: 'The provider did not return a verified continuation handle.',
        attempts: 1,
        nextSafeAction:
          'Start an operator-approved rollover or use a provider with resume support.',
        recordedAt: input.completion.completedAt,
      });
      return { action: 'blocked', goal };
    }

    const existing = goal.continuationAttempts.find(
      (attempt) => attempt.sourceAttemptId === input.attemptId
    );
    if (existing?.state === 'dispatched' || existing?.state === 'failed') {
      return { action: 'already-handled', goal, continuation: existing };
    }
    if (!existing) {
      goal = await this.goals.planContinuation(goal.id, {
        expectedRevision: goal.revision,
        sourceTaskId: input.taskId,
        sourceAttemptId: input.attemptId,
        message: continuationMessage(goal, input.completion),
      });
    }
    return this.dispatchPlanned(goal, input.attemptId, dispatch);
  }

  async reconcilePlannedForTask(
    input: DurableGoalReconcileTaskInput,
    dispatch: DurableGoalContinuationDispatcher
  ): Promise<DurableGoalSupervisionResult> {
    const owner = await this.findOwningGoal(
      input.workspaceId,
      input.taskId,
      input.parentAttemptId ?? input.currentAttemptId
    );
    if (owner.kind !== 'goal') return { action: owner.kind };
    let goal = owner.goal;
    const planned = [...goal.continuationAttempts]
      .reverse()
      .find((attempt) => attempt.state === 'planned');
    if (!planned) return { action: 'already-handled', goal };

    if (
      input.currentAttemptId &&
      input.currentAttemptId !== planned.sourceAttemptId &&
      input.parentAttemptId === planned.sourceAttemptId
    ) {
      goal = await this.goals.resolveContinuation(goal.id, {
        expectedRevision: goal.revision,
        continuationId: planned.id,
        state: 'dispatched',
        resultAttemptId: input.currentAttemptId,
      });
      goal = await this.goals.linkRun(goal.id, {
        expectedRevision: goal.revision,
        run: {
          taskId: planned.sourceTaskId,
          attemptId: input.currentAttemptId,
          parentAttemptId: planned.sourceAttemptId,
        },
      });
      return {
        action: 'reconciled',
        goal,
        continuation: goal.continuationAttempts.find((attempt) => attempt.id === planned.id),
      };
    }
    if (input.currentAttemptRunning) {
      return { action: 'already-handled', goal, continuation: planned };
    }
    return this.dispatchPlanned(goal, planned.sourceAttemptId, dispatch);
  }

  private async dispatchPlanned(
    goal: DurableGoalRecord,
    sourceAttemptId: string,
    dispatch: DurableGoalContinuationDispatcher
  ): Promise<DurableGoalSupervisionResult> {
    const planned = goal.continuationAttempts.find(
      (attempt) => attempt.sourceAttemptId === sourceAttemptId && attempt.state === 'planned'
    );
    if (!planned) return { action: 'already-handled', goal };

    let result: DurableGoalContinuationDispatchResult;
    try {
      result = await dispatch({
        goal,
        sourceTaskId: planned.sourceTaskId,
        sourceAttemptId: planned.sourceAttemptId,
        message: planned.message,
        admissionIdempotencyKey: planned.admissionIdempotencyKey,
        remainingBudget: remainingBudget(goal),
      });
    } catch (error) {
      const errorCode = dispatchErrorCode(error);
      goal = await this.goals.resolveContinuation(goal.id, {
        expectedRevision: goal.revision,
        continuationId: planned.id,
        state: 'failed',
        errorCode,
        errorSummary: `Continuation dispatch failed with ${errorName(error)}.`,
      });
      goal = await this.blockGoal(goal, {
        id: stableId('blocker', goal.id, planned.id, 'dispatch'),
        code: errorCode,
        summary: 'The planned durable goal continuation could not be admitted.',
        attempts: 1,
        nextSafeAction:
          'Inspect admission and provider readiness, then resume the goal explicitly.',
        recordedAt: new Date().toISOString(),
      });
      return {
        action: 'blocked',
        goal,
        continuation: goal.continuationAttempts.find((attempt) => attempt.id === planned.id),
      };
    }

    goal = await this.goals.resolveContinuation(goal.id, {
      expectedRevision: goal.revision,
      continuationId: planned.id,
      state: 'dispatched',
      resultAttemptId: result.attemptId,
      queueId: result.queueId,
    });
    goal = await this.goals.linkRun(goal.id, {
      expectedRevision: goal.revision,
      run: {
        taskId: planned.sourceTaskId,
        attemptId: result.attemptId,
        parentAttemptId: planned.sourceAttemptId,
      },
    });
    return {
      action: 'dispatched',
      goal,
      continuation: goal.continuationAttempts.find((attempt) => attempt.id === planned.id),
    };
  }

  private async findOwningGoal(
    workspaceId: string,
    taskId: string,
    attemptId?: string
  ): Promise<{ kind: 'goal'; goal: DurableGoalRecord } | { kind: 'not-found' | 'ambiguous' }> {
    const candidates = await this.goals.list({
      workspaceId,
      rootTaskId: taskId,
      states: [...NON_TERMINAL_STATES],
      limit: 100,
    });
    if (candidates.length === 0) return { kind: 'not-found' };
    if (attemptId) {
      const exact = candidates.filter(
        (goal) =>
          goal.currentRun?.attemptId === attemptId ||
          goal.continuationChain.some((run) => run.attemptId === attemptId) ||
          goal.continuationAttempts.some(
            (attempt) =>
              attempt.sourceAttemptId === attemptId || attempt.resultAttemptId === attemptId
          )
      );
      if (exact.length === 1) return { kind: 'goal', goal: exact[0] };
      if (exact.length > 1) return { kind: 'ambiguous' };
    }
    return candidates.length === 1 ? { kind: 'goal', goal: candidates[0] } : { kind: 'ambiguous' };
  }

  private blockGoal(
    goal: DurableGoalRecord,
    blocker: DurableGoalBlocker
  ): Promise<DurableGoalRecord> {
    return this.goals.transition(goal.id, {
      expectedRevision: goal.revision,
      to: 'blocked',
      actorId: 'durable-goal-supervisor',
      reason: blocker.summary,
      blocker,
    });
  }
}

function completionEvidence(
  goal: DurableGoalRecord,
  completion: CompletionResult
): DurableGoalCompletionEvidence[] {
  const requirementIds = new Set(goal.completionRequirements.map((requirement) => requirement.id));
  return completion.evidence.flatMap((evidence) => {
    if (!evidence.verified) return [];
    return evidence.requirementIds
      .filter((requirementId) => requirementIds.has(requirementId))
      .map((requirementId) => ({
        requirementId,
        evidenceId: stableId('evidence', completion.attemptId, evidence.id, requirementId),
        summary: evidence.summary,
        verifier: `completion:${evidence.source}`,
        verifiedAt: completion.completedAt,
      }));
  });
}

function requiredEvidenceComplete(goal: DurableGoalRecord): boolean {
  const evidenced = new Set(goal.completionEvidence.map((evidence) => evidence.requirementId));
  return goal.completionRequirements.every(
    (requirement) => !requirement.required || evidenced.has(requirement.id)
  );
}

function budgetLimitReached(goal: DurableGoalRecord): boolean {
  if (!goal.budgets) return false;
  return BUDGET_METRICS.some((metric) => {
    const limit = goal.budgets?.[metric];
    return limit !== undefined && goal.usage[metric] >= limit;
  });
}

function remainingBudget(goal: DurableGoalRecord): AgentBudgetLimits | undefined {
  if (!goal.budgets) return undefined;
  const remaining: AgentBudgetLimits = {};
  for (const metric of BUDGET_METRICS) {
    const limit = goal.budgets[metric];
    if (limit !== undefined) remaining[metric] = Math.max(0, limit - goal.usage[metric]);
  }
  return Object.keys(remaining).length > 0 ? remaining : undefined;
}

function blockerFromCompletion(completion: CompletionResult): DurableGoalBlocker {
  const blocker = completion.blockers[0];
  return {
    id: stableId('blocker', completion.attemptId, blocker?.code ?? 'blocked'),
    code: blocker?.code ?? 'PROVIDER_BLOCKED',
    summary: blocker?.summary ?? 'The provider reported a blocked run.',
    attempts: 1,
    nextSafeAction: blocker?.detail || 'Inspect the run completion and resume when safe.',
    externalStateChange: blocker?.retryable
      ? 'The reported blocking condition must change before retry.'
      : undefined,
    recordedAt: completion.completedAt,
  };
}

function failedRunBlocker(completion: CompletionResult): DurableGoalBlocker {
  return {
    id: stableId('blocker', completion.attemptId, completion.status),
    code: `RUN_${completion.status.toUpperCase()}`,
    summary: `The durable goal run ended with status ${completion.status}.`,
    attempts: 1,
    nextSafeAction: 'Inspect the verified completion record and resume or cancel the goal.',
    recordedAt: completion.completedAt,
  };
}

function continuationMessage(goal: DurableGoalRecord, completion: CompletionResult): string {
  const evidenced = new Set(goal.completionEvidence.map((evidence) => evidence.requirementId));
  const remaining = goal.completionRequirements
    .filter((requirement) => requirement.required && !evidenced.has(requirement.id))
    .map((requirement) => `- ${requirement.id}: ${requirement.description}`);
  return [
    `Continue durable goal ${goal.id}.`,
    '',
    `Objective: ${goal.objective}`,
    '',
    `Last run: ${completion.summary}`,
    '',
    'Remaining required evidence:',
    ...(remaining.length > 0
      ? remaining
      : ['- Re-evaluate the acceptance criteria before completion.']),
    '',
    'Keep the existing constraints and authority boundaries. Do not mark the goal complete without verified evidence.',
  ].join('\n');
}

function dispatchErrorCode(error: unknown): string {
  const details =
    error && typeof error === 'object' && 'details' in error
      ? (error as { details?: unknown }).details
      : undefined;
  if (details && typeof details === 'object' && 'code' in details) {
    const code = (details as { code?: unknown }).code;
    if (typeof code === 'string' && code.trim()) return code.trim().slice(0, 240);
  }
  return 'CONTINUATION_DISPATCH_FAILED';
}

function errorName(error: unknown): string {
  if (error instanceof Error && error.name.trim()) return error.name.trim().slice(0, 120);
  return 'unknown error';
}

function stableId(prefix: string, ...parts: string[]): string {
  const digest = createHash('sha256').update(parts.join('\0')).digest('hex').slice(0, 32);
  return `${prefix}_${digest}`;
}

let durableGoalSupervisorService: DurableGoalSupervisorService | undefined;

export function getDurableGoalSupervisorService(): DurableGoalSupervisorService {
  durableGoalSupervisorService ??= new DurableGoalSupervisorService();
  return durableGoalSupervisorService;
}
