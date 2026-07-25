import { createHash, randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import type {
  AdmissionCapacityRequest,
  AdmissionDecision,
  AdmissionLaunchSource,
  AdmissionLimitPolicy,
  AdmissionProvider,
  AdmissionReservation,
  AdmissionReservationListQuery,
  AdmissionReservationRelease,
  AdmissionSettings,
  AgentBudgetUsage,
  ExecutionTreeBudgetPolicy,
  ExecutionTreeBudgetSummary,
  ExecutionTreeBudgetUsageEvent,
  ExecutionTreeIdentity,
} from '@veritas-kanban/shared';
import {
  ADMISSION_DECISION_SCHEMA_VERSION,
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
    return settings;
  }

  async admit(input: AdmissionRequestInput): Promise<AdmissionDecision> {
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
    const claimed = await this.repository.claim({ record, now: now.toISOString() });
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
    return this.mutate(id, (current, now) => {
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
    return this.repository.expireLeases(this.now().toISOString());
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

  dispose(): void {
    for (const id of this.heartbeatTimers.keys()) this.stopHeartbeat(id);
    this.heartbeatEligible.clear();
    this.configService.dispose();
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
    limitingBudgetPolicies?: ExecutionTreeBudgetPolicy[]
  ): AdmissionDecision {
    return AdmissionDecisionSchema.parse({
      schemaVersion: ADMISSION_DECISION_SCHEMA_VERSION,
      outcome,
      request,
      reservation,
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

  private startHeartbeat(record: AdmissionReservation, configuredHeartbeatMs: number): void {
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
      void this.renew(id)
        .then((renewed) => {
          if (renewed.state !== 'active') this.stopHeartbeat(id);
        })
        .catch(() => this.stopHeartbeat(id));
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
