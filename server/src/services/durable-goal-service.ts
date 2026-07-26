import { createHash, randomUUID } from 'node:crypto';
import type {
  AgentBudgetLimits,
  AgentBudgetUsage,
  DurableGoalBlocker,
  DurableGoalCompletionEvidence,
  DurableGoalCompletionRequirement,
  DurableGoalContinuationAttempt,
  DurableGoalContinuationPolicy,
  DurableGoalListQuery,
  DurableGoalRecord,
  DurableGoalRoot,
  DurableGoalRunLink,
  DurableGoalState,
  DurableGoalUsageEvent,
} from '@veritas-kanban/shared';
import { DURABLE_GOAL_SCHEMA_VERSION, ZERO_AGENT_BUDGET_USAGE } from '@veritas-kanban/shared';
import { ConflictError, NotFoundError, ValidationError } from '../middleware/error-handler.js';
import { DurableGoalRecordSchema } from '../schemas/durable-goal-schemas.js';
import type { DurableGoalRepository } from '../storage/interfaces.js';
import { FileDurableGoalRepository } from '../storage/durable-goal-repository.js';
import { getStorage, getStorageTypeFromEnv } from '../storage/index.js';

const TERMINAL_STATES = new Set<DurableGoalState>(['complete', 'cancelled', 'failed']);

const ALLOWED_TRANSITIONS: Readonly<Record<DurableGoalState, readonly DurableGoalState[]>> = {
  active: [
    'paused',
    'blocked',
    'awaiting-approval',
    'usage-limited',
    'budget-limited',
    'complete',
    'cancelled',
    'failed',
  ],
  paused: [
    'active',
    'blocked',
    'awaiting-approval',
    'usage-limited',
    'budget-limited',
    'complete',
    'cancelled',
    'failed',
  ],
  blocked: [
    'active',
    'paused',
    'awaiting-approval',
    'usage-limited',
    'budget-limited',
    'complete',
    'cancelled',
    'failed',
  ],
  'awaiting-approval': [
    'active',
    'paused',
    'blocked',
    'usage-limited',
    'budget-limited',
    'complete',
    'cancelled',
    'failed',
  ],
  'usage-limited': [
    'active',
    'paused',
    'blocked',
    'awaiting-approval',
    'budget-limited',
    'complete',
    'cancelled',
    'failed',
  ],
  'budget-limited': [
    'active',
    'paused',
    'blocked',
    'awaiting-approval',
    'usage-limited',
    'complete',
    'cancelled',
    'failed',
  ],
  complete: [],
  cancelled: [],
  failed: [],
};

export interface CreateDurableGoalInput {
  id?: string;
  workspaceId?: string;
  objective: string;
  constraints?: string[];
  acceptanceCriteria: string[];
  root: DurableGoalRoot;
  continuation: DurableGoalContinuationPolicy;
  budgets?: AgentBudgetLimits;
  completionRequirements?: DurableGoalCompletionRequirement[];
}

export interface TransitionDurableGoalInput {
  expectedRevision: number;
  to: DurableGoalState;
  actorId: string;
  reason: string;
  blocker?: DurableGoalBlocker;
  completionEvidence?: DurableGoalCompletionEvidence[];
}

export interface LinkDurableGoalRunInput {
  expectedRevision: number;
  run: Omit<DurableGoalRunLink, 'linkedAt'> & { linkedAt?: string };
}

export interface RecordDurableGoalRunOutcomeInput {
  expectedRevision: number;
  run: Omit<DurableGoalRunLink, 'linkedAt'> & { linkedAt?: string };
  usageEvent?: Omit<DurableGoalUsageEvent, 'recordedAt'> & { recordedAt?: string };
  completionEvidence?: DurableGoalCompletionEvidence[];
}

export interface PlanDurableGoalContinuationInput {
  expectedRevision: number;
  sourceTaskId: string;
  sourceAttemptId: string;
  message: string;
}

export interface ResolveDurableGoalContinuationInput {
  expectedRevision: number;
  continuationId: string;
  state: Extract<DurableGoalContinuationAttempt['state'], 'dispatched' | 'failed'>;
  resultAttemptId?: string;
  queueId?: string;
  errorCode?: string;
  errorSummary?: string;
}

export interface DurableGoalServiceOptions {
  repository?: DurableGoalRepository;
  now?: () => Date;
}

let fileRepository: FileDurableGoalRepository | undefined;

function defaultRepository(): DurableGoalRepository {
  if (getStorageTypeFromEnv() === 'sqlite') return getStorage().durableGoals;
  fileRepository ??= new FileDurableGoalRepository();
  return fileRepository;
}

export class DurableGoalService {
  private readonly repositoryOverride?: DurableGoalRepository;
  private readonly now: () => Date;

  constructor(options: DurableGoalServiceOptions = {}) {
    this.repositoryOverride = options.repository;
    this.now = options.now ?? (() => new Date());
  }

  private get repository(): DurableGoalRepository {
    return this.repositoryOverride ?? defaultRepository();
  }

  async create(input: CreateDurableGoalInput): Promise<DurableGoalRecord> {
    const timestamp = this.now().toISOString();
    const record = DurableGoalRecordSchema.parse({
      schemaVersion: DURABLE_GOAL_SCHEMA_VERSION,
      id: input.id ?? `goal_${randomUUID().replaceAll('-', '')}`,
      workspaceId: input.workspaceId?.trim() || 'local',
      objective: input.objective,
      constraints: input.constraints ?? [],
      acceptanceCriteria: input.acceptanceCriteria,
      root: input.root,
      state: 'active',
      revision: 1,
      continuation: input.continuation,
      budgets: input.budgets,
      usage: { ...ZERO_AGENT_BUDGET_USAGE },
      usageEvents: [],
      continuationChain: [],
      continuationAttempts: [],
      blockers: [],
      completionRequirements: input.completionRequirements ?? [],
      completionEvidence: [],
      transitions: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    return this.repository.create(record);
  }

  async get(id: string): Promise<DurableGoalRecord> {
    const record = await this.repository.get(id);
    if (!record) throw new NotFoundError('Durable goal not found.');
    return record;
  }

  async list(query: DurableGoalListQuery): Promise<DurableGoalRecord[]> {
    return this.repository.list(query);
  }

  async transition(id: string, input: TransitionDurableGoalInput): Promise<DurableGoalRecord> {
    const current = await this.get(id);
    this.requireRevision(current, input.expectedRevision);
    if (!ALLOWED_TRANSITIONS[current.state].includes(input.to)) {
      throw new ValidationError('Durable goal state transition is not allowed.', {
        goalId: id,
        from: current.state,
        to: input.to,
      });
    }
    if (input.to === 'blocked' && !input.blocker) {
      throw new ValidationError('Blocked goals require an actionable blocker.');
    }
    if (input.blocker && input.to !== 'blocked') {
      throw new ValidationError('A blocker can only be recorded by a blocked transition.');
    }
    if (input.to === 'complete') {
      const evidenced = new Set([
        ...current.completionEvidence.map((evidence) => evidence.requirementId),
        ...(input.completionEvidence ?? []).map((evidence) => evidence.requirementId),
      ]);
      const missing = current.completionRequirements
        .filter((requirement) => requirement.required && !evidenced.has(requirement.id))
        .map((requirement) => requirement.id);
      if (missing.length > 0) {
        throw new ValidationError('Durable goal completion evidence is incomplete.', {
          goalId: id,
          missingRequirementIds: missing,
        });
      }
    }

    const timestamp = this.now().toISOString();
    const revision = current.revision + 1;
    const next = DurableGoalRecordSchema.parse({
      ...current,
      state: input.to,
      revision,
      blockers: input.blocker ? [...current.blockers, input.blocker] : current.blockers,
      completionEvidence: [...current.completionEvidence, ...(input.completionEvidence ?? [])],
      transitions: [
        ...current.transitions,
        {
          revision,
          from: current.state,
          to: input.to,
          actorId: input.actorId,
          reason: input.reason,
          recordedAt: timestamp,
        },
      ],
      terminalReason: TERMINAL_STATES.has(input.to) ? input.reason : undefined,
      updatedAt: timestamp,
    });
    return this.compareAndSet(current, next);
  }

  async linkRun(id: string, input: LinkDurableGoalRunInput): Promise<DurableGoalRecord> {
    const current = await this.get(id);
    this.requireRevision(current, input.expectedRevision);
    if (TERMINAL_STATES.has(current.state)) {
      throw new ValidationError('Terminal goals cannot accept another run.', {
        goalId: id,
        state: current.state,
      });
    }
    const linkedAt = input.run.linkedAt ?? this.now().toISOString();
    const run = { ...input.run, linkedAt };
    const duplicate = current.continuationChain.some(
      (candidate) =>
        candidate.taskId === run.taskId &&
        candidate.attemptId === run.attemptId &&
        candidate.workflowRunId === run.workflowRunId
    );
    if (duplicate) return current;

    const next = DurableGoalRecordSchema.parse({
      ...current,
      revision: current.revision + 1,
      currentRun: run,
      continuationChain: [...current.continuationChain, run],
      updatedAt: this.now().toISOString(),
    });
    return this.compareAndSet(current, next);
  }

  async recordRunOutcome(
    id: string,
    input: RecordDurableGoalRunOutcomeInput
  ): Promise<DurableGoalRecord> {
    const current = await this.get(id);
    this.requireRevision(current, input.expectedRevision);
    if (TERMINAL_STATES.has(current.state)) {
      throw new ValidationError('Terminal goals cannot accept another run outcome.', {
        goalId: id,
        state: current.state,
      });
    }

    const timestamp = this.now().toISOString();
    const run = { ...input.run, linkedAt: input.run.linkedAt ?? timestamp };
    const hasRun = current.continuationChain.some(
      (candidate) =>
        candidate.taskId === run.taskId &&
        candidate.attemptId === run.attemptId &&
        candidate.workflowRunId === run.workflowRunId
    );
    const usageEvent = input.usageEvent
      ? {
          ...input.usageEvent,
          recordedAt: input.usageEvent.recordedAt ?? timestamp,
        }
      : undefined;
    const hasUsageEvent = usageEvent
      ? current.usageEvents.some((candidate) => candidate.id === usageEvent.id)
      : false;
    const evidenceIds = new Set(current.completionEvidence.map((evidence) => evidence.evidenceId));
    const newEvidence = (input.completionEvidence ?? []).filter(
      (evidence) => !evidenceIds.has(evidence.evidenceId)
    );
    if (hasRun && (!usageEvent || hasUsageEvent) && newEvidence.length === 0) return current;

    const next = DurableGoalRecordSchema.parse({
      ...current,
      revision: current.revision + 1,
      usage:
        usageEvent && !hasUsageEvent
          ? addGoalUsage(current.usage, usageEvent.usage)
          : current.usage,
      usageEvents:
        usageEvent && !hasUsageEvent ? [...current.usageEvents, usageEvent] : current.usageEvents,
      currentRun: hasRun ? current.currentRun : run,
      continuationChain: hasRun ? current.continuationChain : [...current.continuationChain, run],
      completionEvidence: [...current.completionEvidence, ...newEvidence],
      updatedAt: timestamp,
    });
    return this.compareAndSet(current, next);
  }

  async planContinuation(
    id: string,
    input: PlanDurableGoalContinuationInput
  ): Promise<DurableGoalRecord> {
    const current = await this.get(id);
    this.requireRevision(current, input.expectedRevision);
    if (current.state !== 'active') {
      throw new ValidationError('Only active durable goals can plan a continuation.', {
        goalId: id,
        state: current.state,
      });
    }
    const existing = current.continuationAttempts.find(
      (attempt) => attempt.sourceAttemptId === input.sourceAttemptId
    );
    if (existing) return current;

    const timestamp = this.now().toISOString();
    const suffix = stableContinuationSuffix(id, input.sourceAttemptId);
    const continuation: DurableGoalContinuationAttempt = {
      id: `continuation_${suffix}`,
      sourceTaskId: input.sourceTaskId,
      sourceAttemptId: input.sourceAttemptId,
      state: 'planned',
      admissionIdempotencyKey: `durable-goal:${id}:${input.sourceAttemptId}`,
      message: input.message,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const next = DurableGoalRecordSchema.parse({
      ...current,
      revision: current.revision + 1,
      continuationAttempts: [...current.continuationAttempts, continuation],
      updatedAt: timestamp,
    });
    return this.compareAndSet(current, next);
  }

  async resolveContinuation(
    id: string,
    input: ResolveDurableGoalContinuationInput
  ): Promise<DurableGoalRecord> {
    const current = await this.get(id);
    this.requireRevision(current, input.expectedRevision);
    const index = current.continuationAttempts.findIndex(
      (attempt) => attempt.id === input.continuationId
    );
    if (index < 0) throw new NotFoundError('Durable goal continuation attempt not found.');
    const existing = current.continuationAttempts[index];
    if (existing.state === input.state) return current;
    if (existing.state !== 'planned') {
      throw new ValidationError('Resolved durable goal continuations are immutable.', {
        goalId: id,
        continuationId: input.continuationId,
        state: existing.state,
      });
    }
    if (input.state === 'dispatched' && !input.resultAttemptId) {
      throw new ValidationError('Dispatched durable goal continuations require a result attempt.');
    }
    if (input.state === 'failed' && !input.errorSummary) {
      throw new ValidationError('Failed durable goal continuations require an error summary.');
    }

    const timestamp = this.now().toISOString();
    const continuationAttempts = [...current.continuationAttempts];
    continuationAttempts[index] = {
      ...existing,
      state: input.state,
      resultAttemptId: input.resultAttemptId,
      queueId: input.queueId,
      errorCode: input.errorCode,
      errorSummary: input.errorSummary,
      updatedAt: timestamp,
    };
    const next = DurableGoalRecordSchema.parse({
      ...current,
      revision: current.revision + 1,
      continuationAttempts,
      updatedAt: timestamp,
    });
    return this.compareAndSet(current, next);
  }

  private requireRevision(record: DurableGoalRecord, expectedRevision: number): void {
    if (record.revision !== expectedRevision) {
      throw new ConflictError('Durable goal compare-and-set revision is stale.', {
        goalId: record.id,
        expectedRevision,
        currentRevision: record.revision,
      });
    }
  }

  private async compareAndSet(
    current: DurableGoalRecord,
    next: DurableGoalRecord
  ): Promise<DurableGoalRecord> {
    const result = await this.repository.compareAndSet({
      id: current.id,
      expectedRevision: current.revision,
      next,
    });
    if (result.updated && result.record) return result.record;
    if (result.reason === 'not-found') throw new NotFoundError('Durable goal not found.');
    throw new ConflictError('Durable goal compare-and-set update was rejected.', {
      goalId: current.id,
      expectedRevision: current.revision,
      currentRevision: result.record?.revision,
      reason: result.reason,
    });
  }
}

function stableContinuationSuffix(goalId: string, sourceAttemptId: string): string {
  return createHash('sha256')
    .update(goalId)
    .update('\0')
    .update(sourceAttemptId)
    .digest('hex')
    .slice(0, 32);
}

function addGoalUsage(left: AgentBudgetUsage, right: AgentBudgetUsage): AgentBudgetUsage {
  return {
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    totalTokens: left.totalTokens + right.totalTokens,
    costUsd: left.costUsd + right.costUsd,
    toolCalls: left.toolCalls + right.toolCalls,
    runtimeSeconds: left.runtimeSeconds + right.runtimeSeconds,
    idleRuntimeSeconds: left.idleRuntimeSeconds + right.idleRuntimeSeconds,
    retries: left.retries + right.retries,
    fanOut: left.fanOut + right.fanOut,
  };
}

let durableGoalService: DurableGoalService | undefined;

export function getDurableGoalService(): DurableGoalService {
  durableGoalService ??= new DurableGoalService();
  return durableGoalService;
}
