import { createHash, randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import type {
  AdmissionCapacityRequest,
  AdmissionDecision,
  AdmissionLaunchSource,
  AdmissionLimitPolicy,
  AdmissionProvider,
  AdmissionQueueClaim,
  AdmissionQueueEntry,
  AdmissionQueueListQuery,
  AdmissionQueuePriority,
  AdmissionQueueSelectionEvidence,
  AdmissionQueueTarget,
  AdmissionReservation,
  AdmissionReservationClaimOrQueueResult,
  AdmissionReservationListQuery,
  AdmissionReservationRelease,
  AdmissionSettings,
  AgentBudgetUsage,
  ExecutionTreeBudgetPolicy,
  ExecutionTreeBudgetSummary,
  ExecutionTreeBudgetUsageEvent,
  ExecutionTreeIdentity,
  AgentType,
} from '@veritas-kanban/shared';
import {
  ADMISSION_DECISION_SCHEMA_VERSION,
  ADMISSION_QUEUE_SCHEDULER_POLICY_VERSION,
  ADMISSION_QUEUE_SELECTION_SCHEMA_VERSION,
  ADMISSION_REQUEST_SCHEMA_VERSION,
  ADMISSION_RESERVATION_SCHEMA_VERSION,
  DEFAULT_FEATURE_SETTINGS,
  ZERO_AGENT_BUDGET_USAGE,
} from '@veritas-kanban/shared';
import {
  AdmissionDecisionSchema,
  AdmissionReservationSchema,
} from '../schemas/admission-control-schemas.js';
import type { AdmissionReservationRepository } from '../storage/interfaces.js';
import { FileAdmissionReservationRepository } from '../storage/admission-reservation-repository.js';
import { requestExceedsPolicies } from '../storage/admission-capacity.js';
import {
  applyExecutionTreeBudgetEvent,
  initializeExecutionTreeBudget,
  releaseExecutionTreeBudget,
  summarizeExecutionTreeBudget,
} from '../storage/execution-tree-budget.js';
import { getStorage, getStorageTypeFromEnv } from '../storage/index.js';
import { ConfigService } from './config-service.js';
import { ConflictError, NotFoundError } from '../middleware/error-handler.js';
import {
  admissionScopeKey,
  assertSchedulerSettings,
  rankAdmissionQueueEntries,
  resolveAdmissionQueuePriority,
} from './admission-queue-scheduler.js';

const MAX_CAS_ATTEMPTS = 8;

export interface AdmissionRequestInput {
  taskId: string;
  rootTaskId?: string;
  workspaceId: string;
  provider: AdmissionProvider;
  hostId: string;
  workflowRunId?: string;
  workflowStepId?: string;
  rootReservationId?: string;
  executionTree?: ExecutionTreeIdentity;
  budgetPolicies?: ExecutionTreeBudgetPolicy[];
  budgetRequest?: Partial<AgentBudgetUsage>;
  source?: AdmissionLaunchSource;
  idempotencyKey?: string;
  requested?: Partial<AdmissionCapacityRequest>;
}

export interface DirectAdmissionQueueInput {
  agent: AgentType;
  attemptId: string;
  priority?: AdmissionQueuePriority;
}

export interface WorkflowAdmissionQueueInput {
  target: Exclude<AdmissionQueueTarget, { kind: 'direct' }>;
  attemptId: string;
  priority?: AdmissionQueuePriority;
}

export type AdmissionQueueInput = DirectAdmissionQueueInput | WorkflowAdmissionQueueInput;

export interface RecoverAdmissionInput {
  workspaceId: string;
  taskId: string;
  attemptId: string;
}

export interface AdmissionControlServiceOptions {
  repository?: AdmissionReservationRepository;
  settings?: () => Promise<AdmissionSettings>;
  now?: () => Date;
  ownerId?: string;
  hostId?: string;
  processId?: number;
}

let fileRepository: FileAdmissionReservationRepository | undefined;
let singleton: AdmissionControlService | undefined;

function defaultRepository(): AdmissionReservationRepository {
  if (getStorageTypeFromEnv() === 'sqlite') return getStorage().admissionReservations;
  fileRepository ??= new FileAdmissionReservationRepository();
  return fileRepository;
}

function defaultExecutionHostId(): string {
  return `host-${createHash('sha256').update(hostname()).digest('hex').slice(0, 24)}`;
}

function reservationId(idempotencyKey: string): string {
  return `admission_${createHash('sha256').update(idempotencyKey).digest('hex').slice(0, 32)}`;
}

function queueEntryId(idempotencyKey: string): string {
  return `admission_queue_${createHash('sha256').update(idempotencyKey).digest('hex').slice(0, 32)}`;
}

function idempotencyIdentity(idempotencyKey: string): string {
  return `sha256:${createHash('sha256').update(idempotencyKey).digest('hex')}`;
}

export class AdmissionControlService {
  private readonly repositoryOverride?: AdmissionReservationRepository;
  private readonly settingsOverride?: () => Promise<AdmissionSettings>;
  private readonly configService = new ConfigService();
  private readonly now: () => Date;
  private readonly ownerId: string;
  private readonly executionHostId: string;
  private readonly processId: number;
  private readonly heartbeatTimers = new Map<string, NodeJS.Timeout>();
  private readonly heartbeatEligible = new Set<string>();
  private readonly queueHeartbeatTimers = new Map<string, NodeJS.Timeout>();
  private readonly heartbeatTasks = new Set<Promise<void>>();
  private readonly capacityListeners = new Set<() => void>();
  private disposed = false;

  constructor(options: AdmissionControlServiceOptions = {}) {
    this.repositoryOverride = options.repository;
    this.settingsOverride = options.settings;
    this.now = options.now ?? (() => new Date());
    this.processId = options.processId ?? process.pid;
    this.executionHostId = options.hostId ?? defaultExecutionHostId();
    this.ownerId =
      options.ownerId ?? `admission-${this.processId}-${randomUUID().replaceAll('-', '')}`;
  }

  private get repository(): AdmissionReservationRepository {
    return this.repositoryOverride ?? defaultRepository();
  }

  private async settings(): Promise<AdmissionSettings> {
    const settings = this.settingsOverride
      ? await this.settingsOverride()
      : ((await this.configService.getFeatureSettings()).admission ??
        DEFAULT_FEATURE_SETTINGS.admission);
    if (settings.heartbeatMs >= settings.leaseMs) {
      throw new ConflictError('Admission heartbeat must be shorter than its lease.', {
        heartbeatMs: settings.heartbeatMs,
        leaseMs: settings.leaseMs,
      });
    }
    if (settings.heartbeatMs >= settings.queue.leaseMs) {
      throw new ConflictError('Admission heartbeat must be shorter than the queue lease.', {
        heartbeatMs: settings.heartbeatMs,
        queueLeaseMs: settings.queue.leaseMs,
      });
    }
    assertSchedulerSettings(settings.queue.scheduler);
    return settings;
  }

  async admit(input: AdmissionRequestInput): Promise<AdmissionDecision> {
    return this.admitInternal(input);
  }

  async admitOrQueue(
    input: AdmissionRequestInput,
    queue: AdmissionQueueInput
  ): Promise<AdmissionDecision> {
    return this.admitInternal(input, queue);
  }

  private async admitInternal(
    input: AdmissionRequestInput,
    queue?: AdmissionQueueInput
  ): Promise<AdmissionDecision> {
    const settings = await this.settings();
    const now = this.now();
    const idempotencyKey = idempotencyIdentity(
      input.idempotencyKey?.trim() || `direct:${input.taskId}:${randomUUID()}`
    );
    const requested = {
      ...settings.defaultRequest,
      ...input.requested,
    };
    const request = {
      schemaVersion: ADMISSION_REQUEST_SCHEMA_VERSION,
      idempotencyKey,
      source: input.source ?? 'direct',
      taskId: input.taskId,
      rootTaskId: input.rootTaskId?.trim() || input.taskId,
      workspaceId: input.workspaceId,
      provider: input.provider,
      hostId: input.hostId,
      ...(input.workflowRunId ? { workflowRunId: input.workflowRunId } : {}),
      ...(input.workflowStepId ? { workflowStepId: input.workflowStepId } : {}),
      ...(input.rootReservationId ? { rootReservationId: input.rootReservationId } : {}),
      ...(input.executionTree ? { executionTree: input.executionTree } : {}),
      ...(input.budgetPolicies ? { budgetPolicies: input.budgetPolicies } : {}),
      ...(input.executionTree
        ? {
            budgetRequest: {
              ...ZERO_AGENT_BUDGET_USAGE,
              ...input.budgetRequest,
            },
          }
        : {}),
      requested: {
        ...requested,
        runSlots: Math.max(1, requested.runSlots),
      },
      requestedAt: now.toISOString(),
    } as const;
    const policies = this.policiesFor(request, settings);
    const impossible = requestExceedsPolicies(request.requested, policies);
    if (impossible.length > 0) {
      return this.decision(
        'terminal-policy-denial',
        request,
        impossible,
        'The launch request exceeds a configured capacity ceiling.',
        now
      );
    }
    const record = AdmissionReservationSchema.parse({
      schemaVersion: ADMISSION_RESERVATION_SCHEMA_VERSION,
      id: reservationId(idempotencyKey),
      revision: 1,
      state: 'active',
      request,
      policies,
      ...(request.executionTree
        ? {
            executionBudget: initializeExecutionTreeBudget(
              request.budgetRequest ?? { ...ZERO_AGENT_BUDGET_USAGE }
            ),
          }
        : {}),
      lease: this.newLease(now, settings.leaseMs),
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    });
    const queueTarget: AdmissionQueueTarget | null =
      queue && 'target' in queue
        ? queue.target
        : queue
          ? { kind: 'direct', agent: queue.agent }
          : null;
    const queueable = Boolean(
      queue &&
      queueTarget &&
      settings.queue.enabled &&
      ((queueTarget.kind === 'direct' && request.source === 'direct') ||
        (queueTarget.kind === 'workflow-root' &&
          request.source === 'workflow' &&
          request.workflowRunId === queueTarget.workflowRunId &&
          !request.workflowStepId) ||
        (queueTarget.kind === 'workflow-step' &&
          ['workflow', 'recovery', 'fallback'].includes(request.source) &&
          request.workflowRunId === queueTarget.workflowRunId &&
          request.workflowStepId === queueTarget.workflowStepId))
    );
    const claimed: AdmissionReservationClaimOrQueueResult = queueable
      ? await this.repository.claimOrEnqueue({
          record,
          queue: {
            id: queueEntryId(idempotencyKey),
            ...(queueTarget?.kind === 'direct' ? { agent: queueTarget.agent } : {}),
            target: queueTarget as AdmissionQueueTarget,
            attemptId: queue?.attemptId as string,
            priority: resolveAdmissionQueuePriority(queue?.priority, settings.queue.scheduler),
            request,
            policies,
            limitingPolicies: [],
            retryAfterMs: settings.queue.retryBackoffMs,
            maxRetries: settings.queue.maxRetries,
            availableAt: now.toISOString(),
            createdAt: now.toISOString(),
          },
          now: now.toISOString(),
          globalQueueLimit: settings.queue.globalLimit,
          workspaceQueueLimit: settings.queue.workspaceLimit,
        })
      : await this.repository.claim({ record, now: now.toISOString() });
    if (claimed.queueConflict) {
      return this.decision(
        'terminal-policy-denial',
        request,
        claimed.limitingPolicies,
        'The task already has a queued launch with a different agent selection.',
        now
      );
    }
    if (claimed.queueOverflow) {
      return this.decision(
        'queue-overflow',
        request,
        claimed.limitingPolicies,
        `The ${claimed.queueOverflow} admission queue reached its configured bound.`,
        now,
        settings.retryAfterMs
      );
    }
    if (claimed.queueEntry) {
      return this.decision(
        'queued',
        request,
        claimed.queueEntry.limitingPolicies,
        'The launch is durably queued until admission capacity becomes available.',
        now,
        claimed.queueEntry.retryAfterMs,
        undefined,
        claimed.queueEntry.limitingBudgetPolicies,
        claimed.queueEntry
      );
    }
    if (claimed.limitingBudgetPolicies?.length) {
      return this.decision(
        claimed.budgetRetryable ? 'retryable-overload' : 'terminal-policy-denial',
        request,
        [],
        claimed.budgetRetryable
          ? 'Active execution-tree reservations currently consume the configured budget.'
          : 'Committed execution-tree usage exhausts a configured budget.',
        now,
        claimed.budgetRetryable ? settings.retryAfterMs : undefined,
        undefined,
        claimed.limitingBudgetPolicies
      );
    }
    if (claimed.limitingPolicies.length > 0) {
      return this.decision(
        'retryable-overload',
        request,
        claimed.limitingPolicies,
        'Active reservations currently consume the configured capacity.',
        now,
        settings.retryAfterMs
      );
    }
    if (!claimed.record) {
      throw new Error('Admission repository returned no reservation or limiting policy.');
    }
    if (!sameRequestIdentity(claimed.record.request, request)) {
      return this.decision(
        'terminal-policy-denial',
        request,
        [],
        'The idempotency key is already bound to a different launch request.',
        now
      );
    }
    if (claimed.record.state !== 'active') {
      return this.decision(
        'terminal-policy-denial',
        request,
        [],
        `The idempotency key already belongs to a ${claimed.record.state} reservation.`,
        now
      );
    }
    return this.decision(
      'admitted',
      request,
      [],
      claimed.created ? 'Capacity reserved.' : 'Existing active reservation reused.',
      now,
      undefined,
      claimed.record
    );
  }

  async claimNextQueued(): Promise<AdmissionQueueClaim | null> {
    const settings = await this.settings();
    for (let attempt = 1; attempt <= MAX_CAS_ATTEMPTS; attempt++) {
      const now = this.now();
      await this.repository.expireLeases(now.toISOString());
      await this.repository.expireQueueLeases(now.toISOString());
      const entries = await this.repository.listQueue({
        states: ['queued', 'requeued'],
        eligibleAt: now.toISOString(),
        limit: Math.max(settings.queue.globalLimit, 1),
      });
      if (entries.length === 0) return null;
      const history = (
        await this.repository.listQueue({
          limit: Math.max(settings.queue.scheduler.workspaceBurstLimit, 1),
          order: 'updated-desc',
          withSelectionEvidence: true,
        })
      )
        .map((entry) => entry.selectionEvidence)
        .filter((evidence): evidence is AdmissionQueueSelectionEvidence => Boolean(evidence));
      const ranking = rankAdmissionQueueEntries({
        entries,
        history,
        now: now.toISOString(),
        settings: settings.queue.scheduler,
      });
      const skipped: AdmissionQueueSelectionEvidence['skipped'] = [];
      let snapshotChanged = false;

      for (const [candidateIndex, candidate] of ranking.candidates.entries()) {
        const entry = candidate.entry;
        const policies = this.policiesFor(entry.request, settings);
        const impossible = requestExceedsPolicies(entry.request.requested, policies);
        if (impossible.length > 0) {
          await this.terminateQueueEntry(
            entry.id,
            'ADMISSION_POLICY_DRIFT',
            'The queued launch exceeds the current admission policy.'
          );
          snapshotChanged = true;
          continue;
        }
        const record = AdmissionReservationSchema.parse({
          schemaVersion: ADMISSION_RESERVATION_SCHEMA_VERSION,
          id: reservationId(entry.request.idempotencyKey),
          revision: 1,
          state: 'active',
          request: entry.request,
          policies,
          ...(entry.request.executionTree
            ? {
                executionBudget: initializeExecutionTreeBudget(
                  entry.request.budgetRequest ?? { ...ZERO_AGENT_BUDGET_USAGE }
                ),
              }
            : {}),
          lease: this.newLease(now, Math.min(settings.leaseMs, settings.queue.leaseMs)),
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
        });
        const selectionEvidence: AdmissionQueueSelectionEvidence = {
          schemaVersion: ADMISSION_QUEUE_SELECTION_SCHEMA_VERSION,
          policyVersion: ADMISSION_QUEUE_SCHEDULER_POLICY_VERSION,
          selectedAt: now.toISOString(),
          selectedQueueEntryId: entry.id,
          workspaceKey: candidate.workspaceKey,
          rawPriority: candidate.rawPriority,
          effectivePriority: candidate.effectivePriority,
          agePromotion: candidate.agePromotion,
          ageMs: candidate.ageMs,
          workspaceTurn: candidate.workspaceTurn,
          capacityReadiness: 'ready',
          limitingScopes: [],
          conditionalStartFactors: [
            'queue-eligibility',
            'capacity-available',
            ...(skipped.length > 0 ? (['active-reservation-release'] as const) : []),
          ],
          snapshotSize: ranking.snapshotSize,
          evaluatedCount: ranking.evaluatedCount,
          skipped: [
            ...skipped,
            ...ranking.candidates.slice(candidateIndex + 1).map((notSelected) => ({
              queueEntryId: notSelected.entry.id,
              workspaceKey: notSelected.workspaceKey,
              rawPriority: notSelected.rawPriority,
              effectivePriority: notSelected.effectivePriority,
              agePromotion: notSelected.agePromotion,
              capacityReadiness: 'not-evaluated' as const,
              limitingScopes: [],
              reason:
                ranking.deferredWorkspaceKey === notSelected.workspaceKey &&
                candidate.workspaceKey !== ranking.deferredWorkspaceKey
                  ? ('workspace-burst' as const)
                  : ('lower-rank' as const),
            })),
          ],
        };
        const claimed = await this.repository.claimQueued({
          queueId: entry.id,
          expectedRevision: entry.revision,
          record,
          now: now.toISOString(),
          selectionEvidence,
        });
        if (claimed.stale) {
          snapshotChanged = true;
          break;
        }
        if (claimed.limitingBudgetPolicies?.length && claimed.budgetRetryable === false) {
          await this.terminateQueueEntry(
            entry.id,
            'ADMISSION_BUDGET_EXHAUSTED',
            'Committed execution-tree usage exhausts the current budget.'
          );
          snapshotChanged = true;
          continue;
        }
        if (claimed.limitingPolicies.length > 0 || claimed.limitingBudgetPolicies?.length) {
          skipped.push({
            queueEntryId: entry.id,
            workspaceKey: candidate.workspaceKey,
            rawPriority: candidate.rawPriority,
            effectivePriority: candidate.effectivePriority,
            agePromotion: candidate.agePromotion,
            capacityReadiness: 'blocked',
            limitingScopes: claimed.limitingPolicies.map(({ scope, scopeId }) => ({
              scope,
              scopeKey: admissionScopeKey(scope, scopeId),
            })),
            reason: 'capacity-blocked',
          });
          continue;
        }
        if (!claimed.entry || !claimed.reservation) return null;
        const queueClaim = { entry: claimed.entry, reservation: claimed.reservation };
        this.startQueueHeartbeat(queueClaim, settings.heartbeatMs);
        return queueClaim;
      }
      if (!snapshotChanged) return null;
    }
    return null;
  }

  async getQueueEntry(id: string): Promise<AdmissionQueueEntry> {
    const entry = await this.repository.getQueueEntry(id);
    if (!entry) throw new NotFoundError('Admission queue entry not found.');
    return entry;
  }

  async listQueue(query: AdmissionQueueListQuery = {}): Promise<AdmissionQueueEntry[]> {
    await this.repository.expireQueueLeases(this.now().toISOString());
    return this.repository.listQueue(query);
  }

  async markQueueDispatched(id: string, attemptId: string): Promise<AdmissionQueueEntry> {
    this.stopQueueHeartbeat(id);
    return this.mutateQueue(id, (current, now) => {
      if (current.state === 'dispatched' && current.dispatchedAttemptId === attemptId) {
        return current;
      }
      if (current.state !== 'leased' || current.attemptId !== attemptId) {
        throw new ConflictError('Queue dispatch no longer matches its leased launch.', {
          queueId: id,
          queueState: current.state,
          queuedAttemptId: current.attemptId,
          attemptId,
        });
      }
      return {
        ...current,
        state: 'dispatched',
        dispatchedAttemptId: attemptId,
        updatedAt: now.toISOString(),
      };
    });
  }

  async requeueQueueEntry(id: string, code: string, reason: string): Promise<AdmissionQueueEntry> {
    this.stopQueueHeartbeat(id);
    const settings = await this.settings();
    return this.mutateQueue(id, (current, now) => {
      if (current.state !== 'leased') return current;
      const retryCount = current.retryCount + 1;
      if (retryCount > current.maxRetries) {
        return {
          ...current,
          state: 'terminal',
          retryCount,
          lease: undefined,
          reservationId: undefined,
          terminal: {
            code: code.trim().slice(0, 160) || 'QUEUE_RETRY_EXHAUSTED',
            reason:
              `Queue retry limit exhausted. ${reason}`.trim().slice(0, 1_000) ||
              'Queue retry limit exhausted.',
            recordedAt: now.toISOString(),
          },
          updatedAt: now.toISOString(),
        };
      }
      return {
        ...current,
        state: 'requeued',
        retryCount,
        availableAt: new Date(now.getTime() + settings.queue.retryBackoffMs).toISOString(),
        lease: undefined,
        reservationId: undefined,
        updatedAt: now.toISOString(),
      };
    });
  }

  async terminateQueueEntry(
    id: string,
    code: string,
    reason: string
  ): Promise<AdmissionQueueEntry> {
    this.stopQueueHeartbeat(id);
    return this.mutateQueue(id, (current, now) => {
      if (current.state === 'terminal') return current;
      if (current.state === 'dispatched') {
        throw new ConflictError('Dispatched queue entries are owned by run recovery.', {
          queueId: id,
          dispatchedAttemptId: current.dispatchedAttemptId,
        });
      }
      return {
        ...current,
        state: 'terminal',
        lease: undefined,
        reservationId: undefined,
        terminal: {
          code: code.trim().slice(0, 160) || 'QUEUE_TERMINAL',
          reason: reason.trim().slice(0, 1_000) || 'Queued launch terminated.',
          recordedAt: now.toISOString(),
        },
        updatedAt: now.toISOString(),
      };
    });
  }

  async bindAttempt(id: string, attemptId: string): Promise<AdmissionReservation> {
    const settings = await this.settings();
    const bound = await this.mutate(id, (current, now) => {
      if (current.state !== 'active') {
        throw new ConflictError('Cannot bind an attempt to an inactive admission reservation.', {
          reservationId: id,
          state: current.state,
        });
      }
      if (current.attemptId && current.attemptId !== attemptId) {
        throw new ConflictError('Admission reservation already belongs to another attempt.', {
          reservationId: id,
          currentAttemptId: current.attemptId,
          requestedAttemptId: attemptId,
        });
      }
      return {
        ...current,
        attemptId,
        lease: this.refreshLease(current, now),
        updatedAt: now.toISOString(),
      };
    });
    this.startHeartbeat(bound, settings.heartbeatMs);
    return bound;
  }

  async bindQueuedAttempt(
    _queueId: string,
    reservationId: string,
    attemptId: string
  ): Promise<AdmissionReservation> {
    return this.bindAttempt(reservationId, attemptId);
  }

  async renew(id: string): Promise<AdmissionReservation> {
    return this.mutate(id, (current, now) => {
      if (current.state !== 'active') return current;
      return {
        ...current,
        lease: this.refreshLease(current, now),
        updatedAt: now.toISOString(),
      };
    });
  }

  async release(
    id: string,
    reason: AdmissionReservationRelease['reason'],
    idempotencyKey: string
  ): Promise<AdmissionReservation> {
    this.stopHeartbeat(id);
    const released = await this.mutate(id, (current, now) => {
      if (current.state === 'released') return current;
      return {
        ...current,
        state: 'released',
        executionBudget: releaseExecutionTreeBudget(current.executionBudget),
        release: {
          reason,
          idempotencyKey,
          releasedAt: now.toISOString(),
        },
        updatedAt: now.toISOString(),
      };
    });
    this.notifyCapacityAvailable();
    return released;
  }

  async releaseIfUnbound(
    id: string,
    reason: AdmissionReservationRelease['reason'],
    idempotencyKey: string
  ): Promise<AdmissionReservation> {
    const record = await this.mutate(id, (current, now) => {
      if (current.state !== 'active' || current.attemptId) return current;
      return {
        ...current,
        state: 'released',
        executionBudget: releaseExecutionTreeBudget(current.executionBudget),
        release: {
          reason,
          idempotencyKey,
          releasedAt: now.toISOString(),
        },
        updatedAt: now.toISOString(),
      };
    });
    if (record.state !== 'active') this.stopHeartbeat(id);
    return record;
  }

  async releaseByAttempt(
    workspaceId: string,
    taskId: string,
    attemptId: string,
    reason: AdmissionReservationRelease['reason'],
    idempotencyKey: string
  ): Promise<AdmissionReservation | null> {
    const reservation = await this.findByAttempt(workspaceId, taskId, attemptId);
    return reservation ? this.release(reservation.id, reason, idempotencyKey) : null;
  }

  async recoverVerifiedRun(input: RecoverAdmissionInput): Promise<AdmissionReservation | null> {
    const existing = await this.findByAttempt(input.workspaceId, input.taskId, input.attemptId);
    if (!existing) return null;
    const settings = await this.settings();
    const now = this.now();
    const refreshed = AdmissionReservationSchema.parse({
      ...existing,
      revision: 1,
      state: 'active',
      release: undefined,
      policies: this.policiesFor(existing.request, settings),
      lease: this.newLease(now, settings.leaseMs),
      updatedAt: now.toISOString(),
    });
    const claimed = await this.repository.claim({
      record: refreshed,
      now: now.toISOString(),
      reclaimExpired: true,
    });
    if (
      claimed.limitingPolicies.length > 0 ||
      claimed.limitingBudgetPolicies?.length ||
      !claimed.record
    ) {
      throw new ConflictError('Verified live run could not reclaim admission capacity.', {
        taskId: input.taskId,
        attemptId: input.attemptId,
        limitingPolicies: claimed.limitingPolicies,
        limitingBudgetPolicies: claimed.limitingBudgetPolicies,
        budgetRetryable: claimed.budgetRetryable,
      });
    }
    if (claimed.record.state !== 'active') {
      throw new ConflictError('Verified live run has a terminal admission reservation.', {
        taskId: input.taskId,
        attemptId: input.attemptId,
        reservationId: claimed.record.id,
        reservationState: claimed.record.state,
      });
    }
    const recovered = await this.renew(claimed.record.id);
    this.startHeartbeat(recovered, settings.heartbeatMs);
    return recovered;
  }

  async expireAbandoned(): Promise<AdmissionReservation[]> {
    const now = this.now().toISOString();
    const expired = await this.repository.expireLeases(now);
    await this.repository.expireQueueLeases(now);
    if (expired.length > 0) this.notifyCapacityAvailable();
    return expired;
  }

  onCapacityAvailable(listener: () => void): () => void {
    this.capacityListeners.add(listener);
    return () => this.capacityListeners.delete(listener);
  }

  getExecutionHostId(): string {
    return this.executionHostId;
  }

  async get(id: string): Promise<AdmissionReservation> {
    await this.expireAbandoned();
    const record = await this.repository.get(id);
    if (!record) throw new NotFoundError('Admission reservation not found.');
    return record;
  }

  async list(query: AdmissionReservationListQuery = {}): Promise<AdmissionReservation[]> {
    await this.expireAbandoned();
    return this.repository.list(query);
  }

  async recordBudgetUsage(
    reservationId: string,
    event: ExecutionTreeBudgetUsageEvent
  ): Promise<AdmissionReservation> {
    return this.mutate(reservationId, (current, now) => {
      if (!current.executionBudget) {
        throw new ConflictError('Admission reservation does not track an execution-tree budget.', {
          reservationId,
        });
      }
      const isReplay = current.executionBudget.events.some(
        (candidate) => candidate.id === event.id
      );
      if (
        isReplay &&
        !current.executionBudget.events.some(
          (candidate) =>
            candidate.id === event.id && JSON.stringify(candidate) === JSON.stringify(event)
        )
      ) {
        throw new ConflictError('Execution-tree budget event conflicts with recorded evidence.', {
          reservationId,
          eventId: event.id,
        });
      }
      if (current.state !== 'active' && !isReplay) {
        throw new ConflictError(
          'Terminal admission reservations reject new execution-tree budget evidence.',
          {
            reservationId,
            reservationState: current.state,
            eventId: event.id,
          }
        );
      }
      const executionBudget = applyExecutionTreeBudgetEvent(current.executionBudget, event);
      if (executionBudget === current.executionBudget) return current;
      return {
        ...current,
        executionBudget,
        updatedAt: now.toISOString(),
      };
    });
  }

  async getExecutionTreeSummary(
    rootObjectiveId: string,
    limit = 100
  ): Promise<ExecutionTreeBudgetSummary> {
    await this.expireAbandoned();
    const records = await this.repository.list({
      rootObjectiveId,
      limit: 10_000,
    });
    return summarizeExecutionTreeBudget(
      rootObjectiveId,
      records,
      Math.min(Math.max(1, limit), 1_000),
      this.now().toISOString()
    );
  }

  async findByAttempt(
    workspaceId: string,
    taskId: string,
    attemptId: string
  ): Promise<AdmissionReservation | null> {
    const records = await this.repository.list({
      workspaceId,
      taskId,
      limit: 1_000,
    });
    return records.find((record) => record.attemptId === attemptId) ?? null;
  }

  async dispose(): Promise<void> {
    if (this.disposed) {
      await Promise.allSettled([...this.heartbeatTasks]);
      return;
    }
    this.disposed = true;
    for (const id of this.heartbeatTimers.keys()) this.stopHeartbeat(id);
    for (const id of this.queueHeartbeatTimers.keys()) this.stopQueueHeartbeat(id);
    this.heartbeatEligible.clear();
    this.capacityListeners.clear();
    await Promise.allSettled([...this.heartbeatTasks]);
    this.configService.dispose();
  }

  private notifyCapacityAvailable(): void {
    for (const listener of this.capacityListeners) {
      queueMicrotask(() => {
        try {
          listener();
        } catch {
          // Capacity notifications are best-effort wakeups; durable queue state remains authoritative.
        }
      });
    }
  }

  private policiesFor(
    request: Pick<
      AdmissionReservation['request'],
      'taskId' | 'workspaceId' | 'rootTaskId' | 'provider' | 'hostId'
    >,
    settings: AdmissionSettings
  ): AdmissionLimitPolicy[] {
    const taskExclusivity: AdmissionLimitPolicy = {
      id: `task:${request.taskId}`,
      scope: 'task',
      scopeId: request.taskId,
      limits: { concurrentRuns: 1 },
    };
    if (!settings.enabled) return [taskExclusivity];
    const candidates: Array<
      [AdmissionLimitPolicy['scope'], string, AdmissionLimitPolicy['limits'] | undefined]
    > = [
      ['global', 'global', settings.global],
      ['workspace', request.workspaceId, settings.workspaces[request.workspaceId]],
      ['root-task', request.rootTaskId, settings.rootTasks[request.rootTaskId]],
      ['provider', request.provider, settings.providers[request.provider]],
      ['host', request.hostId, settings.hosts[request.hostId]],
    ];
    return [
      taskExclusivity,
      ...candidates.flatMap(([scope, scopeId, limits]) =>
        limits && Object.keys(limits).length > 0
          ? [{ id: `${scope}:${scopeId}`, scope, scopeId, limits }]
          : []
      ),
    ];
  }

  private decision(
    outcome: AdmissionDecision['outcome'],
    request: AdmissionDecision['request'],
    limitingPolicies: AdmissionLimitPolicy[],
    reason: string,
    now: Date,
    retryAfterMs?: number,
    reservation?: AdmissionReservation,
    limitingBudgetPolicies?: ExecutionTreeBudgetPolicy[],
    queueEntry?: AdmissionQueueEntry
  ): AdmissionDecision {
    return AdmissionDecisionSchema.parse({
      schemaVersion: ADMISSION_DECISION_SCHEMA_VERSION,
      outcome,
      request,
      reservation,
      queueEntry,
      limitingPolicies,
      limitingBudgetPolicies,
      retryAfterMs,
      reason,
      decidedAt: now.toISOString(),
    });
  }

  private newLease(now: Date, leaseMs: number): AdmissionReservation['lease'] {
    return {
      ownerId: this.ownerId,
      hostId: this.executionHostId,
      processId: this.processId,
      acquiredAt: now.toISOString(),
      heartbeatAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + leaseMs).toISOString(),
    };
  }

  private refreshLease(current: AdmissionReservation, now: Date): AdmissionReservation['lease'] {
    return {
      ...current.lease,
      ownerId: this.ownerId,
      hostId: this.executionHostId,
      processId: this.processId,
      heartbeatAt: now.toISOString(),
      expiresAt: new Date(
        now.getTime() +
          Math.max(1, Date.parse(current.lease.expiresAt) - Date.parse(current.lease.heartbeatAt))
      ).toISOString(),
    };
  }

  private async mutate(
    id: string,
    update: (current: AdmissionReservation, now: Date) => AdmissionReservation
  ): Promise<AdmissionReservation> {
    for (let attempt = 1; attempt <= MAX_CAS_ATTEMPTS; attempt++) {
      const current = await this.repository.get(id);
      if (!current) throw new NotFoundError('Admission reservation not found.');
      const candidate = update(current, this.now());
      if (candidate === current) return current;
      const next = AdmissionReservationSchema.parse({
        ...candidate,
        revision: current.revision + 1,
      });
      const result = await this.repository.compareAndSet({
        id,
        expectedRevision: current.revision,
        next,
      });
      if (result.updated && result.record) return result.record;
      if (result.reason !== 'stale-revision') {
        throw new ConflictError('Admission reservation update failed.', {
          reservationId: id,
          reason: result.reason,
        });
      }
    }
    throw new ConflictError('Admission reservation changed too many times.', {
      reservationId: id,
    });
  }

  private async mutateQueue(
    id: string,
    update: (current: AdmissionQueueEntry, now: Date) => AdmissionQueueEntry
  ): Promise<AdmissionQueueEntry> {
    for (let attempt = 1; attempt <= MAX_CAS_ATTEMPTS; attempt++) {
      const current = await this.repository.getQueueEntry(id);
      if (!current) throw new NotFoundError('Admission queue entry not found.');
      const candidate = update(current, this.now());
      if (candidate === current) return current;
      const next = {
        ...candidate,
        revision: current.revision + 1,
      };
      const result = await this.repository.compareAndSetQueue({
        id,
        expectedRevision: current.revision,
        next,
      });
      if (result.updated && result.record) return result.record;
      if (result.reason !== 'stale-revision') {
        throw new ConflictError('Admission queue update failed.', {
          queueId: id,
          reason: result.reason,
        });
      }
    }
    throw new ConflictError('Admission queue entry changed too many times.', { queueId: id });
  }

  private startQueueHeartbeat(claim: AdmissionQueueClaim, configuredHeartbeatMs: number): void {
    if (this.disposed) return;
    const queueId = claim.entry.id;
    if (this.queueHeartbeatTimers.has(queueId)) return;
    const leaseDurationMs =
      Date.parse(claim.entry.lease?.expiresAt ?? '') -
      Date.parse(claim.entry.lease?.heartbeatAt ?? '');
    const heartbeatMs = Math.min(
      configuredHeartbeatMs,
      Math.max(250, Math.floor(leaseDurationMs / 3))
    );
    const timer = setInterval(() => {
      if (this.disposed) return;
      this.trackHeartbeatTask(
        this.renewQueueClaim(queueId, claim.reservation.id)
          .then(() => undefined)
          .catch(() => {
            this.stopQueueHeartbeat(queueId);
          })
      );
    }, heartbeatMs);
    timer.unref();
    this.queueHeartbeatTimers.set(queueId, timer);
  }

  private async renewQueueClaim(
    queueId: string,
    reservationId: string
  ): Promise<AdmissionQueueEntry> {
    const entry = await this.mutateQueue(queueId, (current, now) => {
      if (
        current.state !== 'leased' ||
        current.reservationId !== reservationId ||
        current.lease?.ownerId !== this.ownerId
      ) {
        throw new ConflictError('Admission queue lease ownership changed.', {
          queueId,
          reservationId,
          queueState: current.state,
          queueReservationId: current.reservationId,
        });
      }
      const leaseDurationMs =
        Date.parse(current.lease.expiresAt) - Date.parse(current.lease.heartbeatAt);
      return {
        ...current,
        lease: {
          ...current.lease,
          heartbeatAt: now.toISOString(),
          expiresAt: new Date(now.getTime() + Math.max(1, leaseDurationMs)).toISOString(),
        },
        updatedAt: now.toISOString(),
      };
    });
    await this.renew(reservationId);
    return entry;
  }

  private stopQueueHeartbeat(queueId: string): void {
    const timer = this.queueHeartbeatTimers.get(queueId);
    if (timer) clearInterval(timer);
    this.queueHeartbeatTimers.delete(queueId);
  }

  private startHeartbeat(record: AdmissionReservation, configuredHeartbeatMs: number): void {
    if (this.disposed) return;
    const id = record.id;
    this.heartbeatEligible.add(id);
    if (this.heartbeatTimers.has(id)) return;
    const leaseDurationMs =
      Date.parse(record.lease.expiresAt) - Date.parse(record.lease.heartbeatAt);
    const heartbeatMs = Math.min(
      configuredHeartbeatMs,
      Math.max(1_000, Math.floor(leaseDurationMs / 2))
    );
    const timer = setInterval(() => {
      if (this.disposed) return;
      this.trackHeartbeatTask(
        this.renew(id)
          .then((renewed) => {
            if (renewed.state !== 'active') this.stopHeartbeat(id);
          })
          .catch(() => this.stopHeartbeat(id))
      );
    }, heartbeatMs);
    timer.unref();
    this.heartbeatTimers.set(id, timer);
  }

  private stopHeartbeat(id: string): void {
    this.heartbeatEligible.delete(id);
    const timer = this.heartbeatTimers.get(id);
    if (timer) clearInterval(timer);
    this.heartbeatTimers.delete(id);
  }

  private trackHeartbeatTask(task: Promise<void>): void {
    this.heartbeatTasks.add(task);
    void task.finally(() => this.heartbeatTasks.delete(task));
  }
}

function sameRequestIdentity(
  left: AdmissionReservation['request'],
  right: AdmissionReservation['request']
): boolean {
  return (
    left.idempotencyKey === right.idempotencyKey &&
    left.source === right.source &&
    left.taskId === right.taskId &&
    left.rootTaskId === right.rootTaskId &&
    left.workspaceId === right.workspaceId &&
    left.provider === right.provider &&
    left.hostId === right.hostId &&
    left.workflowRunId === right.workflowRunId &&
    left.workflowStepId === right.workflowStepId &&
    left.rootReservationId === right.rootReservationId &&
    JSON.stringify(left.executionTree) === JSON.stringify(right.executionTree) &&
    JSON.stringify(left.budgetPolicies) === JSON.stringify(right.budgetPolicies) &&
    JSON.stringify(left.budgetRequest) === JSON.stringify(right.budgetRequest) &&
    JSON.stringify(left.requested) === JSON.stringify(right.requested)
  );
}

export function getAdmissionControlService(): AdmissionControlService {
  singleton ??= new AdmissionControlService();
  return singleton;
}
