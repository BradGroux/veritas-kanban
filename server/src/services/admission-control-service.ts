import { createHash, randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import type {
  AdmissionCapacityRequest,
  AdmissionCancellationInput,
  AdmissionDecision,
  AdmissionExecutionTreeCancellationResult,
  AdmissionLaunchSource,
  AdmissionLimitPolicy,
  AdmissionProvider,
  AdmissionQueueClaim,
  AdmissionQueueDepth,
  AdmissionQueueEntry,
  AdmissionQueueGetResponse,
  AdmissionQueueInspectionEntry,
  AdmissionQueueInspectionQuery,
  AdmissionQueueListQuery,
  AdmissionQueueListResponse,
  AdmissionQueuePriority,
  AdmissionQueueSelectionEvidence,
  AdmissionQueueTarget,
  AdmissionQueuedCancellationResult,
  AdmissionRequest,
  AdmissionReservation,
  AdmissionReservationClaimOrQueueResult,
  AdmissionReservationListQuery,
  AdmissionReservationRelease,
  AdmissionSettings,
  AgentBudgetUsage,
  ExecutionTreeBudgetPolicy,
  ExecutionTreeBudgetSummary,
  ExecutionTreeBudgetUsageEvent,
  ExecutionTreeBreakerEvidence,
  ExecutionTreeBreakerSignal,
  ExecutionTreeIdentity,
  ExecutionTreeControl,
  AgentType,
} from '@veritas-kanban/shared';
import {
  ADMISSION_DECISION_SCHEMA_VERSION,
  ADMISSION_QUEUE_INSPECTION_SCHEMA_VERSION,
  ADMISSION_QUEUE_LIST_SCHEMA_VERSION,
  ADMISSION_QUEUE_SCHEDULER_POLICY_VERSION,
  ADMISSION_QUEUE_SELECTION_SCHEMA_VERSION,
  ADMISSION_REQUEST_SCHEMA_VERSION,
  ADMISSION_RESERVATION_SCHEMA_VERSION,
  DEFAULT_FEATURE_SETTINGS,
  EXECUTION_TREE_BREAKER_EVIDENCE_SCHEMA_VERSION,
  EXECUTION_TREE_CANCELLATION_SCHEMA_VERSION,
  EXECUTION_TREE_CONTROL_SCHEMA_VERSION,
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
  orderAdmissionQueueEntries,
  rankAdmissionQueueEntries,
  resolveAdmissionQueuePriority,
  scoreAdmissionQueueEntry,
  workspaceKey,
} from './admission-queue-scheduler.js';

const MAX_CAS_ATTEMPTS = 8;
const ACTIVE_INSPECTION_SNAPSHOT_LIMIT = 100_000;
const TERMINAL_INSPECTION_SNAPSHOT_LIMIT = 1_000;
const ACTIVE_QUEUE_STATES = ['queued', 'leased', 'requeued', 'dispatched'] as const;

interface AdmissionQueueInspectionContext {
  settings: AdmissionSettings;
  now: Date;
  activeEntries: AdmissionQueueEntry[];
  positions: Map<string, number>;
  depth: AdmissionQueueDepth;
}

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

export interface AgentAdmissionQueueInput {
  target: Extract<AdmissionQueueTarget, { kind: 'agent-launch' }>;
  attemptId: string;
  priority?: AdmissionQueuePriority;
}

export interface WorkflowAdmissionQueueInput {
  target: Extract<AdmissionQueueTarget, { kind: 'workflow-root' | 'workflow-step' }>;
  attemptId: string;
  priority?: AdmissionQueuePriority;
}

export type AdmissionQueueInput =
  DirectAdmissionQueueInput | AgentAdmissionQueueInput | WorkflowAdmissionQueueInput;

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

function percentage(used: number, limit: number | undefined): number {
  if (limit === undefined || limit <= 0) return 0;
  return Math.round((used / limit) * 10_000) / 100;
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
  private readonly heartbeatTasks = new Map<string, Promise<void>>();
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
    const loaded = this.settingsOverride
      ? await this.settingsOverride()
      : ((await this.configService.getFeatureSettings()).admission ??
        DEFAULT_FEATURE_SETTINGS.admission);
    const settings: AdmissionSettings = {
      ...loaded,
      fanOutBreaker: {
        ...DEFAULT_FEATURE_SETTINGS.admission.fanOutBreaker,
        ...(loaded as Partial<AdmissionSettings>).fanOutBreaker,
      },
    };
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

  private async executionTreeRootReservation(
    rootObjectiveId: string
  ): Promise<AdmissionReservation | null> {
    const records = await this.repository.list({
      rootObjectiveId,
      limit: 10_000,
    });
    return (
      records.find(
        (record) =>
          record.request.executionTree?.rootObjectiveId === rootObjectiveId &&
          record.request.executionTree.edge === 'root'
      ) ?? null
    );
  }

  async getExecutionTreeControl(rootObjectiveId: string): Promise<ExecutionTreeControl | null> {
    return (await this.executionTreeRootReservation(rootObjectiveId))?.executionTreeControl ?? null;
  }

  private blocksExecutionTree(control: ExecutionTreeControl | null): control is ExecutionTreeControl {
    return control?.state === 'paused' || control?.state === 'cancelled';
  }

  async assertExecutionTreeLaunchAllowed(rootObjectiveId: string): Promise<void> {
    const control = await this.getExecutionTreeControl(rootObjectiveId);
    if (!this.blocksExecutionTree(control)) return;
    throw new ConflictError(
      control.state === 'cancelled'
        ? 'Execution tree was cancelled before provider dispatch.'
        : 'Execution tree expansion is paused by its fan-out circuit breaker.',
      {
        code:
          control.state === 'cancelled'
            ? 'EXECUTION_TREE_CANCELLED'
            : 'EXECUTION_TREE_EXPANSION_PAUSED',
        executionTreeControl: control,
      }
    );
  }

  private fanOutBreakerPolicy(
    rootObjectiveId: string,
    settings: AdmissionSettings
  ): ExecutionTreeBudgetPolicy {
    return {
      id: `fan-out-breaker:${createHash('sha256').update(rootObjectiveId).digest('hex').slice(0, 32)}`,
      scope: 'root-objective',
      scopeId: rootObjectiveId,
      name: 'Execution-tree fan-out circuit breaker',
      limits: { fanOut: settings.fanOutBreaker.maxDescendants + 1 },
      hardAction: 'pause',
    };
  }

  private withFanOutBreakerPolicy(
    input: AdmissionRequestInput,
    settings: AdmissionSettings
  ): ExecutionTreeBudgetPolicy[] | undefined {
    if (!settings.fanOutBreaker.enabled || !input.executionTree) return input.budgetPolicies;
    const breaker = this.fanOutBreakerPolicy(input.executionTree.rootObjectiveId, settings);
    return [...(input.budgetPolicies ?? []).filter((policy) => policy.id !== breaker.id), breaker];
  }

  private async executionTreeBreakerEvidence(
    request: AdmissionRequest,
    settings: AdmissionSettings,
    prospective: 'active' | 'queued' | 'none'
  ): Promise<ExecutionTreeBreakerEvidence> {
    const identity = request.executionTree;
    if (!identity) throw new Error('Execution-tree breaker evidence requires a tree identity.');
    const [treeRecords, activeRecords, queueEntries] = await Promise.all([
      this.repository.list({ rootObjectiveId: identity.rootObjectiveId, limit: 10_000 }),
      this.repository.list({ states: ['active'], limit: 10_000 }),
      this.repository.listQueue({
        states: [...ACTIVE_QUEUE_STATES],
        limit: ACTIVE_INSPECTION_SNAPSHOT_LIMIT,
      }),
    ]);
    const treeQueueEntries = queueEntries.filter(
      (entry) =>
        entry.request.executionTree?.rootObjectiveId === identity.rootObjectiveId &&
        entry.request.executionTree.edge !== 'root'
    );
    const existingNode = treeRecords.some(
      (record) => record.request.executionTree?.nodeId === identity.nodeId
    );
    const existingQueueNode = treeQueueEntries.some(
      (entry) => entry.request.executionTree?.nodeId === identity.nodeId
    );
    const includeCandidate =
      prospective !== 'none' && !existingNode && !existingQueueNode && identity.edge !== 'root';
    const prospectiveUsage =
      includeCandidate
        ? { ...ZERO_AGENT_BUDGET_USAGE, ...request.budgetRequest }
        : ZERO_AGENT_BUDGET_USAGE;
    const descendants =
      treeRecords
        .filter((record) => record.request.executionTree?.edge !== 'root')
        .reduce(
          (total, record) => total + Math.max(1, record.executionBudget?.requested.fanOut ?? 1),
          0
        ) +
      treeQueueEntries
        .filter(
          (entry) =>
            !treeRecords.some(
              (record) =>
                record.request.executionTree?.nodeId === entry.request.executionTree?.nodeId
            )
        )
        .reduce(
          (total, entry) => total + Math.max(1, entry.request.budgetRequest?.fanOut ?? 1),
          0
        ) +
      (includeCandidate ? Math.max(1, prospectiveUsage.fanOut) : 0);
    const maxDepth = Math.max(
      identity.depth,
      ...treeRecords.map((record) => record.request.executionTree?.depth ?? 0),
      ...treeQueueEntries.map((entry) => entry.request.executionTree?.depth ?? 0)
    );
    const activeReservations =
      treeRecords.filter((record) => record.state === 'active').length +
      (prospective === 'active' && !existingNode ? 1 : 0);
    const queuedDescendants =
      treeQueueEntries.filter((entry) => entry.state !== 'dispatched').length +
      (prospective === 'queued' && !existingQueueNode ? 1 : 0);

    const candidatePolicies = this.policiesFor(request, settings).filter(
      (policy) => policy.scope !== 'task'
    );
    let capacityPressurePercent = 0;
    for (const policy of candidatePolicies) {
      const matching = activeRecords.filter((record) =>
        record.policies.some((candidate) => candidate.id === policy.id)
      );
      const used = matching.reduce(
        (total, record) => ({
          runSlots: total.runSlots + record.request.requested.runSlots,
          processSlots: total.processSlots + record.request.requested.processSlots,
          estimatedMemoryMb:
            total.estimatedMemoryMb + record.request.requested.estimatedMemoryMb,
        }),
        { runSlots: 0, processSlots: 0, estimatedMemoryMb: 0 }
      );
      if (prospective === 'active' && !existingNode) {
        used.runSlots += request.requested.runSlots;
        used.processSlots += request.requested.processSlots;
        used.estimatedMemoryMb += request.requested.estimatedMemoryMb;
      }
      capacityPressurePercent = Math.max(
        capacityPressurePercent,
        percentage(used.runSlots, policy.limits.concurrentRuns),
        percentage(used.processSlots, policy.limits.processSlots),
        percentage(used.estimatedMemoryMb, policy.limits.estimatedMemoryMb)
      );
    }

    const summary = summarizeExecutionTreeBudget(
      identity.rootObjectiveId,
      treeRecords,
      1,
      this.now().toISOString()
    );
    let budgetPressurePercent = 0;
    for (const status of summary.policies) {
      for (const metric of [
        'inputTokens',
        'outputTokens',
        'totalTokens',
        'costUsd',
        'toolCalls',
        'runtimeSeconds',
        'idleRuntimeSeconds',
        'retries',
        'fanOut',
      ] as const) {
        const limit = status.policy.limits[metric];
        budgetPressurePercent = Math.max(
          budgetPressurePercent,
          percentage(status.used[metric] + status.reserved[metric] + prospectiveUsage[metric], limit)
        );
      }
    }

    const thresholds = settings.fanOutBreaker;
    const pressureActive = descendants >= thresholds.pressureActivationDescendants;
    const signals: ExecutionTreeBreakerSignal[] = [];
    if (descendants > thresholds.maxDescendants) signals.push('descendant-limit');
    if (maxDepth > thresholds.maxDepth) signals.push('depth-limit');
    if (activeReservations > thresholds.maxActiveReservations) {
      signals.push('active-reservation-limit');
    }
    if (queuedDescendants > thresholds.maxQueuedDescendants) {
      signals.push('queued-descendant-limit');
    }
    if (pressureActive && capacityPressurePercent >= thresholds.capacityPressurePercent) {
      signals.push('capacity-pressure');
    }
    if (pressureActive && budgetPressurePercent >= thresholds.budgetPressurePercent) {
      signals.push('budget-pressure');
    }
    const recoveryGuidance = [
      ...(signals.some((signal) =>
        ['active-reservation-limit', 'capacity-pressure'].includes(signal)
      )
        ? ['Wait for verified running descendants to finish or cancel the execution tree.']
        : []),
      ...(signals.some((signal) =>
        ['queued-descendant-limit', 'budget-pressure'].includes(signal)
      )
        ? ['Drain or cancel queued descendants, then inspect the tree before resuming.']
        : []),
      ...(signals.some((signal) => ['descendant-limit', 'depth-limit'].includes(signal))
        ? ['Raise the configured tree limit only after reviewing the expansion plan.']
        : []),
      'Resume explicitly after the triggering evidence is below configured thresholds.',
    ].slice(0, 5);
    return {
      schemaVersion: EXECUTION_TREE_BREAKER_EVIDENCE_SCHEMA_VERSION,
      rootObjectiveId: identity.rootObjectiveId,
      evaluatedAt: this.now().toISOString(),
      signals,
      observed: {
        descendants,
        maxDepth,
        activeReservations,
        queuedDescendants,
        capacityPressurePercent,
        budgetPressurePercent,
      },
      thresholds: {
        maxDescendants: thresholds.maxDescendants,
        maxDepth: thresholds.maxDepth,
        maxActiveReservations: thresholds.maxActiveReservations,
        maxQueuedDescendants: thresholds.maxQueuedDescendants,
        pressureActivationDescendants: thresholds.pressureActivationDescendants,
        capacityPressurePercent: thresholds.capacityPressurePercent,
        budgetPressurePercent: thresholds.budgetPressurePercent,
      },
      recoveryGuidance,
    };
  }

  private async pauseExecutionTree(
    rootObjectiveId: string,
    evidence: ExecutionTreeBreakerEvidence
  ): Promise<ExecutionTreeControl> {
    const root = await this.executionTreeRootReservation(rootObjectiveId);
    if (!root) throw new NotFoundError('Execution tree root reservation not found.');
    const evidenceIdentity = idempotencyIdentity(
      `fan-out-breaker:${rootObjectiveId}:${JSON.stringify(evidence.observed)}`
    );
    const updated = await this.mutate(root.id, (current, now) => {
      const control = current.executionTreeControl;
      if (control?.state === 'cancelled' || control?.state === 'paused') return current;
      return {
        ...current,
        executionTreeControl: {
          schemaVersion: EXECUTION_TREE_CONTROL_SCHEMA_VERSION,
          rootObjectiveId,
          state: 'paused',
          trigger: 'fan-out-breaker',
          reason: `Fan-out circuit breaker tripped: ${evidence.signals.join(', ')}.`,
          idempotencyKey: evidenceIdentity,
          recordedAt: now.toISOString(),
          evidence,
        },
        updatedAt: now.toISOString(),
      };
    });
    if (!updated.executionTreeControl) {
      throw new Error('Execution-tree breaker state was not persisted.');
    }
    return updated.executionTreeControl;
  }

  async resumeExecutionTree(
    rootObjectiveId: string,
    input: AdmissionCancellationInput
  ): Promise<ExecutionTreeControl> {
    const root = await this.executionTreeRootReservation(rootObjectiveId);
    if (!root) throw new NotFoundError('Execution tree root reservation not found.');
    const resumeIdempotencyKey = idempotencyIdentity(input.idempotencyKey.trim());
    const existing = root.executionTreeControl;
    if (!existing) {
      throw new ConflictError('Execution tree does not have a paused circuit breaker.', {
        rootObjectiveId,
      });
    }
    if (existing.state === 'cancelled') {
      throw new ConflictError('Cancelled execution trees cannot be resumed.', {
        rootObjectiveId,
        executionTreeControl: existing,
      });
    }
    if (existing.state === 'resumed') {
      if (existing.resumeIdempotencyKey !== resumeIdempotencyKey) {
        throw new ConflictError('Execution tree resume already has different ownership.', {
          rootObjectiveId,
          executionTreeControl: existing,
        });
      }
      return existing;
    }
    const settings = await this.settings();
    const evidence = settings.fanOutBreaker.enabled
      ? await this.executionTreeBreakerEvidence(root.request, settings, 'none')
      : null;
    if (evidence?.signals.length) {
      throw new ConflictError(
        'Execution tree still exceeds configured fan-out breaker thresholds.',
        {
          code: 'EXECUTION_TREE_RESUME_BLOCKED',
          evidence,
        }
      );
    }
    const resumed = await this.mutate(root.id, (current, now) => {
      const control = current.executionTreeControl;
      if (!control) {
        throw new ConflictError('Execution tree control disappeared during resume.', {
          rootObjectiveId,
        });
      }
      if (control.state === 'cancelled') {
        throw new ConflictError('Cancelled execution trees cannot be resumed.', {
          rootObjectiveId,
          executionTreeControl: control,
        });
      }
      if (control.state === 'resumed') {
        if (control.resumeIdempotencyKey !== resumeIdempotencyKey) {
          throw new ConflictError('Execution tree resume already has different ownership.', {
            rootObjectiveId,
            executionTreeControl: control,
          });
        }
        return current;
      }
      return {
        ...current,
        executionTreeControl: {
          ...control,
          state: 'resumed',
          resumedAt: now.toISOString(),
          resumeReason: input.reason.trim().slice(0, 1_000),
          resumeIdempotencyKey,
        },
        updatedAt: now.toISOString(),
      };
    });
    if (!resumed.executionTreeControl) {
      throw new Error('Execution-tree resume evidence was not persisted.');
    }
    return resumed.executionTreeControl;
  }

  private blockedTreeDecision(
    request: AdmissionDecision['request'],
    control: ExecutionTreeControl,
    settings: AdmissionSettings,
    now: Date
  ): AdmissionDecision {
    return this.decision(
      control.state === 'cancelled' ? 'terminal-policy-denial' : 'retryable-overload',
      request,
      [],
      control.state === 'cancelled'
        ? 'The root execution tree was cancelled before this launch.'
        : 'The root execution tree is paused by its fan-out circuit breaker.',
      now,
      control.state === 'paused' ? settings.retryAfterMs : undefined,
      undefined,
      undefined,
      undefined,
      control
    );
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
    const budgetPolicies = this.withFanOutBreakerPolicy(input, settings);
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
      ...(budgetPolicies ? { budgetPolicies } : {}),
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
    const initialTreeControl = request.executionTree
      ? await this.getExecutionTreeControl(request.executionTree.rootObjectiveId)
      : null;
    if (this.blocksExecutionTree(initialTreeControl)) {
      return this.blockedTreeDecision(request, initialTreeControl, settings, now);
    }
    if (
      settings.fanOutBreaker.enabled &&
      request.executionTree &&
      request.executionTree.edge !== 'root'
    ) {
      const evidence = await this.executionTreeBreakerEvidence(request, settings, 'active');
      if (evidence.signals.length > 0) {
        const control = await this.pauseExecutionTree(
          request.executionTree.rootObjectiveId,
          evidence
        );
        return this.blockedTreeDecision(request, control, settings, now);
      }
    }
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
        (queueTarget.kind === 'agent-launch' &&
          request.source === queueTarget.source &&
          !request.workflowRunId &&
          !request.workflowStepId) ||
        (queueTarget.kind === 'workflow-root' &&
          ['workflow', 'scheduled', 'watcher'].includes(request.source) &&
          request.workflowRunId === queueTarget.workflowRunId &&
          !request.workflowStepId) ||
        (queueTarget.kind === 'workflow-step' &&
          ['workflow', 'scheduled', 'watcher', 'recovery', 'fallback'].includes(request.source) &&
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
    const currentTreeControl = request.executionTree
      ? await this.getExecutionTreeControl(request.executionTree.rootObjectiveId)
      : null;
    if (this.blocksExecutionTree(currentTreeControl)) {
      if (claimed.queueEntry && claimed.queueEntry.state !== 'terminal') {
        const reservationId = claimed.queueEntry.reservationId;
        await this.terminateQueueEntry(
          claimed.queueEntry.id,
          currentTreeControl.state === 'cancelled'
            ? 'EXECUTION_TREE_CANCELLED'
            : 'EXECUTION_TREE_EXPANSION_PAUSED',
          currentTreeControl.reason,
          currentTreeControl.idempotencyKey
        );
        if (reservationId) {
          await this.release(
            reservationId,
            currentTreeControl.state === 'cancelled' ? 'cancelled' : 'reconciled',
            `tree-control:${currentTreeControl.idempotencyKey}:${reservationId}`
          );
        }
      }
      if (claimed.record?.state === 'active') {
        await this.release(
          claimed.record.id,
          currentTreeControl.state === 'cancelled' ? 'cancelled' : 'reconciled',
          `tree-control:${currentTreeControl.idempotencyKey}:${claimed.record.id}`
        );
      }
      return this.blockedTreeDecision(request, currentTreeControl, settings, now);
    }
    const breakerPolicyId = request.executionTree
      ? this.fanOutBreakerPolicy(request.executionTree.rootObjectiveId, settings).id
      : undefined;
    if (
      settings.fanOutBreaker.enabled &&
      request.executionTree?.edge !== 'root' &&
      breakerPolicyId &&
      claimed.limitingBudgetPolicies?.some((policy) => policy.id === breakerPolicyId)
    ) {
      const evidence = await this.executionTreeBreakerEvidence(
        request,
        settings,
        claimed.queueEntry ? 'queued' : 'active'
      );
      if (!evidence.signals.includes('descendant-limit')) {
        evidence.signals.unshift('descendant-limit');
      }
      const control = await this.pauseExecutionTree(
        request.executionTree.rootObjectiveId,
        evidence
      );
      if (claimed.queueEntry && claimed.queueEntry.state !== 'terminal') {
        await this.terminateQueueEntry(
          claimed.queueEntry.id,
          'EXECUTION_TREE_EXPANSION_PAUSED',
          control.reason,
          control.idempotencyKey
        );
      }
      if (claimed.record?.state === 'active') {
        await this.release(
          claimed.record.id,
          'reconciled',
          `fan-out-breaker:${control.idempotencyKey}:${claimed.record.id}`
        );
      }
      return this.blockedTreeDecision(request, control, settings, now);
    }
    if (claimed.queueConflict) {
      return this.decision(
        'terminal-policy-denial',
        request,
        claimed.limitingPolicies,
        'The task already has a queued launch with a different durable target.',
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

  async inspectQueue(
    query: AdmissionQueueInspectionQuery = {}
  ): Promise<AdmissionQueueListResponse> {
    const context = await this.queueInspectionContext();
    const requestedStates = new Set(query.states ?? ACTIVE_QUEUE_STATES);
    const includeTerminal = requestedStates.has('terminal');
    const terminalSnapshot = includeTerminal
      ? await this.repository.listQueue({
          states: ['terminal'],
          order: 'updated-desc',
          limit: TERMINAL_INSPECTION_SNAPSHOT_LIMIT + 1,
        })
      : [];
    const snapshotTruncated = terminalSnapshot.length > TERMINAL_INSPECTION_SNAPSHOT_LIMIT;
    const records = [
      ...context.activeEntries,
      ...terminalSnapshot.slice(0, TERMINAL_INSPECTION_SNAPSHOT_LIMIT),
    ];
    const filtered = records
      .map((entry) => ({
        entry,
        inspection: this.projectQueueInspection(entry, context),
      }))
      .filter(({ entry }) => requestedStates.has(entry.state))
      .filter(({ entry }) => !query.workspaceId || entry.request.workspaceId === query.workspaceId)
      .filter(
        ({ entry }) =>
          !query.rootObjectiveId ||
          entry.request.executionTree?.rootObjectiveId === query.rootObjectiveId
      )
      .filter(({ entry }) => !query.nodeId || entry.request.executionTree?.nodeId === query.nodeId)
      .filter(({ entry }) => !query.sources?.length || query.sources.includes(entry.request.source))
      .filter(
        ({ inspection }) =>
          query.priority === undefined || inspection.rawPriority === query.priority
      )
      .filter(
        ({ entry }) =>
          !query.limitingScopes?.length ||
          entry.limitingPolicies.some((policy) => query.limitingScopes?.includes(policy.scope))
      )
      .filter(
        ({ inspection }) => query.minAgeMs === undefined || inspection.ageMs >= query.minAgeMs
      )
      .filter(
        ({ inspection }) => query.maxAgeMs === undefined || inspection.ageMs <= query.maxAgeMs
      )
      .sort(
        (left, right) =>
          (left.inspection.position ?? Number.MAX_SAFE_INTEGER) -
            (right.inspection.position ?? Number.MAX_SAFE_INTEGER) ||
          left.entry.enqueueSequence - right.entry.enqueueSequence ||
          left.entry.id.localeCompare(right.entry.id)
      );
    const page = Math.max(1, Math.floor(query.page ?? 1));
    const limit = Math.min(200, Math.max(1, Math.floor(query.limit ?? 100)));
    const offset = (page - 1) * limit;

    return {
      schemaVersion: ADMISSION_QUEUE_LIST_SCHEMA_VERSION,
      generatedAt: context.now.toISOString(),
      conditional: true,
      depth: context.depth,
      pagination: {
        page,
        limit,
        total: filtered.length,
        hasMore: offset + limit < filtered.length,
        snapshotTruncated,
      },
      entries: filtered.slice(offset, offset + limit).map(({ inspection }) => inspection),
    };
  }

  async inspectQueueEntry(id: string): Promise<AdmissionQueueGetResponse> {
    const context = await this.queueInspectionContext();
    const entry =
      context.activeEntries.find((candidate) => candidate.id === id) ??
      (await this.repository.getQueueEntry(id));
    if (!entry) throw new NotFoundError('Admission queue entry not found.');
    return {
      schemaVersion: ADMISSION_QUEUE_INSPECTION_SCHEMA_VERSION,
      generatedAt: context.now.toISOString(),
      conditional: true,
      depth: context.depth,
      entry: this.projectQueueInspection(entry, context),
    };
  }

  private async queueInspectionContext(): Promise<AdmissionQueueInspectionContext> {
    const settings = await this.settings();
    const now = this.now();
    await this.repository.expireQueueLeases(now.toISOString());
    const activeEntries = await this.repository.listQueue({
      states: [...ACTIVE_QUEUE_STATES],
      limit: ACTIVE_INSPECTION_SNAPSHOT_LIMIT,
    });
    const history = (
      await this.repository.listQueue({
        limit: Math.max(settings.queue.scheduler.workspaceBurstLimit, 1),
        order: 'updated-desc',
        withSelectionEvidence: true,
      })
    )
      .map((entry) => entry.selectionEvidence)
      .filter((evidence): evidence is AdmissionQueueSelectionEvidence => Boolean(evidence));
    const pending = activeEntries.filter((entry) => ['queued', 'requeued'].includes(entry.state));
    const ordering = orderAdmissionQueueEntries({
      entries: pending,
      history,
      now: now.toISOString(),
      settings: settings.queue.scheduler,
    });
    const positioned = new Set(ordering.candidates.map(({ entry }) => entry.id));
    const delayed = pending
      .filter((entry) => !positioned.has(entry.id))
      .sort(
        (left, right) =>
          left.enqueueSequence - right.enqueueSequence || left.id.localeCompare(right.id)
      );
    const positions = new Map(
      [...ordering.candidates.map(({ entry }) => entry), ...delayed].map((entry, index) => [
        entry.id,
        index + 1,
      ])
    );
    const workspaceDepth = new Map<string, number>();
    for (const entry of activeEntries) {
      workspaceDepth.set(
        entry.request.workspaceId,
        (workspaceDepth.get(entry.request.workspaceId) ?? 0) + 1
      );
    }
    const depth: AdmissionQueueDepth = {
      global: {
        current: activeEntries.length,
        limit: settings.queue.globalLimit,
      },
      workspaces: [...workspaceDepth.entries()]
        .map(([workspaceId, current]) => ({
          workspaceId,
          workspaceKey: workspaceKey(workspaceId),
          current,
          limit: settings.queue.workspaceLimit,
        }))
        .sort((left, right) => left.workspaceKey.localeCompare(right.workspaceKey)),
    };
    return { settings, now, activeEntries, positions, depth };
  }

  private projectQueueInspection(
    entry: AdmissionQueueEntry,
    context: AdmissionQueueInspectionContext
  ): AdmissionQueueInspectionEntry {
    const score = scoreAdmissionQueueEntry(
      entry,
      context.now.toISOString(),
      context.settings.queue.scheduler
    );
    const available = Date.parse(entry.availableAt) <= context.now.getTime();
    const readiness: AdmissionQueueInspectionEntry['readiness'] =
      entry.state === 'leased'
        ? 'reserved'
        : entry.state === 'dispatched'
          ? 'dispatched'
          : entry.state === 'terminal'
            ? 'terminal'
            : available
              ? 'conditional'
              : 'delayed';
    const leasePosture: AdmissionQueueInspectionEntry['lease']['posture'] =
      entry.state === 'dispatched'
        ? 'dispatched'
        : entry.state === 'terminal'
          ? 'terminal'
          : entry.lease
            ? Date.parse(entry.lease.expiresAt) > context.now.getTime()
              ? 'active'
              : 'expired'
            : 'none';
    const conditionalStartFactors = new Set<
      AdmissionQueueInspectionEntry['conditionalStartFactors'][number]
    >(entry.selectionEvidence?.conditionalStartFactors ?? []);
    if (entry.state === 'queued' || entry.state === 'requeued') {
      conditionalStartFactors.add('queue-eligibility');
      conditionalStartFactors.add(available ? 'capacity-recheck' : 'retry-backoff');
      conditionalStartFactors.add('policy-recheck');
      if (entry.limitingPolicies.length > 0) {
        conditionalStartFactors.add('active-reservation-release');
      }
    }
    if (entry.state === 'leased') conditionalStartFactors.add('lease-expiry');
    const target = entry.target?.kind ?? 'legacy-direct';
    const taskId =
      entry.target?.kind === 'workflow-root'
        ? entry.target.associatedTaskId
        : entry.target?.kind === 'workflow-step'
          ? undefined
          : entry.request.taskId;
    const workflowRunId =
      entry.request.workflowRunId ??
      (entry.target?.kind === 'workflow-root' || entry.target?.kind === 'workflow-step'
        ? entry.target.workflowRunId
        : undefined);
    const workflowStepId =
      entry.request.workflowStepId ??
      (entry.target?.kind === 'workflow-step' ? entry.target.workflowStepId : undefined);

    return {
      schemaVersion: ADMISSION_QUEUE_INSPECTION_SCHEMA_VERSION,
      id: entry.id,
      state: entry.state,
      ...(context.positions.has(entry.id) ? { position: context.positions.get(entry.id) } : {}),
      rawPriority: score.rawPriority,
      effectivePriority: score.effectivePriority,
      agePromotion: score.agePromotion,
      ageMs: score.ageMs,
      readiness,
      lease: {
        posture: leasePosture,
        ...(entry.lease ? { expiresAt: entry.lease.expiresAt } : {}),
      },
      limitingPolicies: entry.limitingPolicies.map((policy) => ({
        scope: policy.scope,
        scopeKey: admissionScopeKey(policy.scope, policy.scopeId),
        limits: policy.limits,
      })),
      conditionalStartFactors: [...conditionalStartFactors],
      launch: {
        source: entry.request.source,
        target,
        workspaceId: entry.request.workspaceId,
        taskKey: queueInspectionKey('task', entry.request.taskId),
        rootTaskKey: queueInspectionKey('root-task', entry.request.rootTaskId),
        workspaceKey: workspaceKey(entry.request.workspaceId),
        provider: entry.request.provider,
        hostKey: queueInspectionKey('host', entry.request.hostId),
        ...(entry.request.workflowRunId
          ? { workflowRunKey: queueInspectionKey('workflow-run', entry.request.workflowRunId) }
          : {}),
        ...(entry.request.workflowStepId
          ? { workflowStepKey: queueInspectionKey('workflow-step', entry.request.workflowStepId) }
          : {}),
        ...(entry.request.executionTree
          ? {
              rootObjectiveKey: queueInspectionKey(
                'root-objective',
                entry.request.executionTree.rootObjectiveId
              ),
              nodeKey: queueInspectionKey('node', entry.request.executionTree.nodeId),
            }
          : {}),
      },
      navigation: {
        ...(taskId ? { taskId } : {}),
        attemptId: entry.attemptId,
        ...(entry.target?.kind === 'workflow-root' || entry.target?.kind === 'workflow-step'
          ? { workflowId: entry.target.workflowId }
          : {}),
        ...(workflowRunId ? { workflowRunId } : {}),
        ...(workflowStepId ? { workflowStepId } : {}),
        ...(entry.request.executionTree ? { executionTree: entry.request.executionTree } : {}),
      },
      ...(entry.selectionEvidence ? { selectionEvidence: entry.selectionEvidence } : {}),
      retry: {
        count: entry.retryCount,
        maximum: entry.maxRetries,
        availableAt: entry.availableAt,
      },
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
    };
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
    reason: string,
    idempotencyKey?: string
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
          ...(idempotencyKey ? { idempotencyKey } : {}),
          recordedAt: now.toISOString(),
        },
        updatedAt: now.toISOString(),
      };
    });
  }

  async cancelQueuedLaunch(
    id: string,
    input: AdmissionCancellationInput
  ): Promise<AdmissionQueuedCancellationResult> {
    const idempotencyKey = idempotencyIdentity(input.idempotencyKey.trim());
    const current = await this.getQueueEntry(id);
    if (current.state === 'terminal') {
      if (
        current.terminal?.code !== 'QUEUE_CANCELLED' ||
        current.terminal.idempotencyKey !== idempotencyKey
      ) {
        throw new ConflictError('Queue entry already has different terminal ownership.', {
          queueId: id,
          terminal: current.terminal,
        });
      }
      return {
        schemaVersion: EXECUTION_TREE_CANCELLATION_SCHEMA_VERSION,
        scope: 'queued-launch',
        idempotencyKey,
        queueEntry: current,
        reservationReleased: false,
      };
    }
    if (current.state === 'dispatched') {
      throw new ConflictError('Dispatched work must be interrupted through its verified run.', {
        queueId: id,
        dispatchedAttemptId: current.dispatchedAttemptId,
      });
    }

    const reservationId = current.reservationId;
    const queueEntry = await this.terminateQueueEntry(
      id,
      'QUEUE_CANCELLED',
      input.reason,
      idempotencyKey
    );
    let reservationReleased = false;
    if (reservationId) {
      const reservation = await this.repository.get(reservationId);
      if (reservation?.state === 'active') {
        await this.release(
          reservationId,
          'cancelled',
          `queue-cancel:${idempotencyKey}:${reservationId}`
        );
        reservationReleased = true;
      }
    }
    return {
      schemaVersion: EXECUTION_TREE_CANCELLATION_SCHEMA_VERSION,
      scope: 'queued-launch',
      idempotencyKey,
      queueEntry,
      reservationReleased,
    };
  }

  async cancelExecutionTree(
    rootObjectiveId: string,
    input: AdmissionCancellationInput
  ): Promise<AdmissionExecutionTreeCancellationResult> {
    const idempotencyKey = idempotencyIdentity(input.idempotencyKey.trim());
    const root = await this.executionTreeRootReservation(rootObjectiveId);
    if (!root) throw new NotFoundError('Execution tree root reservation not found.');
    const existing = root.executionTreeControl;
    if (existing?.state === 'cancelled' && existing.idempotencyKey !== idempotencyKey) {
      throw new ConflictError('Execution tree cancellation already has different ownership.', {
        rootObjectiveId,
        executionTreeControl: existing,
      });
    }

    const control =
      existing?.state === 'cancelled'
        ? existing
        : (
            await this.mutate(root.id, (current, now) => {
              const currentControl = current.executionTreeControl;
              if (currentControl?.state === 'cancelled') {
                if (currentControl.idempotencyKey !== idempotencyKey) {
                  throw new ConflictError(
                    'Execution tree cancellation already has different ownership.',
                    {
                      rootObjectiveId,
                      executionTreeControl: currentControl,
                    }
                  );
                }
                return current;
              }
              return {
                ...current,
                executionTreeControl: {
                  schemaVersion: EXECUTION_TREE_CONTROL_SCHEMA_VERSION,
                  rootObjectiveId,
                  state: 'cancelled',
                  trigger: 'operator',
                  reason: input.reason.trim().slice(0, 1_000),
                  idempotencyKey,
                  recordedAt: now.toISOString(),
                },
                updatedAt: now.toISOString(),
              };
            })
          ).executionTreeControl;
    if (!control) throw new Error('Execution tree cancellation was not persisted.');

    const queued = await this.repository.listQueue({
      states: [...ACTIVE_QUEUE_STATES],
      limit: ACTIVE_INSPECTION_SNAPSHOT_LIMIT,
    });
    let queueEntriesCancelled = 0;
    for (const entry of queued) {
      if (
        entry.request.executionTree?.rootObjectiveId !== rootObjectiveId ||
        entry.state === 'dispatched'
      ) {
        continue;
      }
      try {
        await this.cancelQueuedLaunch(entry.id, {
          idempotencyKey: input.idempotencyKey,
          reason: input.reason,
        });
        queueEntriesCancelled += 1;
      } catch (error) {
        const latest =
          error instanceof ConflictError ? await this.repository.getQueueEntry(entry.id) : null;
        if (latest?.state !== 'dispatched') throw error;
      }
    }

    const reservations = await this.repository.list({
      rootObjectiveId,
      states: ['active'],
      limit: 10_000,
    });
    const runningAttempts: AdmissionExecutionTreeCancellationResult['runningAttempts'] = [];
    let reservationsReleased = 0;
    for (const reservation of reservations) {
      if (reservation.attemptId) {
        runningAttempts.push({
          taskId: reservation.request.taskId,
          attemptId: reservation.attemptId,
          reservationId: reservation.id,
        });
        continue;
      }
      await this.release(
        reservation.id,
        'cancelled',
        `tree-cancel:${idempotencyKey}:${reservation.id}`
      );
      reservationsReleased += 1;
    }

    return {
      schemaVersion: EXECUTION_TREE_CANCELLATION_SCHEMA_VERSION,
      scope: 'execution-tree',
      idempotencyKey,
      rootObjectiveId,
      control,
      queueEntriesCancelled,
      reservationsReleased,
      interruptedAttempts: 0,
      runningAttempts,
    };
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
    const summary = summarizeExecutionTreeBudget(
      rootObjectiveId,
      records,
      Math.min(Math.max(1, limit), 1_000),
      this.now().toISOString()
    );
    const control = records.find(
      (record) =>
        record.request.executionTree?.rootObjectiveId === rootObjectiveId &&
        record.request.executionTree.edge === 'root'
    )?.executionTreeControl;
    return control ? { ...summary, control } : summary;
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
      await Promise.allSettled([...this.heartbeatTasks.values()]);
      return;
    }
    this.disposed = true;
    for (const id of this.heartbeatTimers.keys()) this.stopHeartbeat(id);
    for (const id of this.queueHeartbeatTimers.keys()) this.stopQueueHeartbeat(id);
    this.heartbeatEligible.clear();
    this.capacityListeners.clear();
    await Promise.allSettled([...this.heartbeatTasks.values()]);
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
    queueEntry?: AdmissionQueueEntry,
    executionTreeControl?: ExecutionTreeControl
  ): AdmissionDecision {
    return AdmissionDecisionSchema.parse({
      schemaVersion: ADMISSION_DECISION_SCHEMA_VERSION,
      outcome,
      request,
      reservation,
      queueEntry,
      executionTreeControl,
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
      this.trackHeartbeatTask(`queue:${queueId}`, () =>
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
      this.trackHeartbeatTask(`reservation:${id}`, () =>
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

  private trackHeartbeatTask(key: string, start: () => Promise<void>): void {
    if (this.disposed || this.heartbeatTasks.has(key)) return;
    const task = start();
    this.heartbeatTasks.set(key, task);
    void task.finally(() => {
      if (this.heartbeatTasks.get(key) === task) this.heartbeatTasks.delete(key);
    });
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

function queueInspectionKey(kind: string, value: string): string {
  return `sha256:${createHash('sha256').update(`${kind}:${value}`).digest('hex')}`;
}

export function getAdmissionControlService(): AdmissionControlService {
  singleton ??= new AdmissionControlService();
  return singleton;
}
