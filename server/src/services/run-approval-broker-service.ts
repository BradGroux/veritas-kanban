import { createHash } from 'node:crypto';
import {
  RUN_APPROVAL_SCHEMA_VERSION,
  type ExecutableAgentProvider,
  type RunApprovalActionClass,
  type RunApprovalActor,
  type RunApprovalDecisionInput,
  type RunApprovalListQuery,
  type RunApprovalRequest,
  type RunApprovalRequestKind,
  type RunApprovalRiskClass,
  type RunEventJsonValue,
} from '@veritas-kanban/shared';
import { redactString } from '../lib/redact.js';
import { createLogger } from '../lib/logger.js';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../middleware/error-handler.js';
import { RunApprovalRequestSchema } from '../schemas/run-approval-schemas.js';
import type { RunApprovalRepository } from '../storage/interfaces.js';
import { FileRunApprovalRepository } from '../storage/run-approval-repository.js';
import { getStorage, getStorageTypeFromEnv } from '../storage/index.js';
import { broadcastRunApprovalChange } from './broadcast-service.js';
import { RunEventJournalService } from './run-event-journal-service.js';

const DEFAULT_APPROVAL_TTL_MS = 5 * 60 * 1_000;
const MIN_APPROVAL_TTL_MS = 1_000;
const MAX_APPROVAL_TTL_MS = 24 * 60 * 60 * 1_000;
const DEFAULT_POLL_INTERVAL_MS = 250;
const MAX_PRIVILEGED_AUTH_AGE_MS = 5 * 60 * 1_000;
const MAX_AUTH_CLOCK_SKEW_MS = 30 * 1_000;
const MAX_EXACT_ACTION_BYTES = 64 * 1024;
const MAX_EXACT_ACTION_DEPTH = 12;
const MAX_EXACT_ACTION_KEYS = 512;
const log = createLogger('run-approval-broker-service');

export interface CreateRunApprovalRequestInput {
  workspaceId?: string;
  taskId: string;
  attemptId: string;
  provider: ExecutableAgentProvider;
  agentId: string;
  requestKind: RunApprovalRequestKind;
  actionClass: RunApprovalActionClass;
  action: string;
  exactAction: unknown;
  details?: string;
  resourceScope?: string[];
  workingDirectory?: string;
  riskClass: RunApprovalRiskClass;
  policyReason?: string;
  evidenceRevision: string;
  providerRequestId: string;
  threadId?: string;
  turnId?: string;
  itemId?: string;
  mobileSafe?: boolean;
  ttlMs?: number;
}

export interface AwaitRunApprovalOptions {
  signal?: AbortSignal;
  pollIntervalMs?: number;
}

export interface RunApprovalDecisionResult {
  request: RunApprovalRequest;
  responseData?: Record<string, RunEventJsonValue>;
}

export interface RunApprovalBrokerServiceOptions {
  repository?: RunApprovalRepository;
  journal?: RunEventJournalService;
  now?: () => Date;
  broadcast?: (request: RunApprovalRequest) => void;
}

let fileRepository: FileRunApprovalRepository | undefined;

function defaultRepository(): RunApprovalRepository {
  if (getStorageTypeFromEnv() === 'sqlite') return getStorage().runApprovals;
  fileRepository ??= new FileRunApprovalRepository();
  return fileRepository;
}

export class RunApprovalBrokerService {
  private readonly journal: RunEventJournalService;
  private readonly now: () => Date;
  private readonly broadcast: (request: RunApprovalRequest) => void;
  private readonly listeners = new Map<string, Set<() => void>>();
  private readonly ephemeralResponses = new Map<
    string,
    Record<string, RunEventJsonValue> | undefined
  >();

  constructor(private readonly options: RunApprovalBrokerServiceOptions = {}) {
    this.journal = options.journal ?? new RunEventJournalService();
    this.now = options.now ?? (() => new Date());
    this.broadcast = options.broadcast ?? broadcastRunApprovalChange;
  }

  async request(input: CreateRunApprovalRequestInput): Promise<RunApprovalRequest> {
    const workspaceId = input.workspaceId?.trim() || 'local';
    const exactAction = canonicalizeExactAction(input.exactAction);
    const actionHash = sha256(
      stableStringify(
        canonicalizeExactAction({
          workspaceId,
          taskId: input.taskId,
          attemptId: input.attemptId,
          provider: input.provider,
          agentId: input.agentId,
          providerRequestId: input.providerRequestId,
          requestKind: input.requestKind,
          actionClass: input.actionClass,
          action: input.action,
          details: input.details,
          workingDirectory: input.workingDirectory,
          resourceScope: [...new Set(input.resourceScope ?? [])].sort(),
          riskClass: input.riskClass,
          policyReason: input.policyReason,
          evidenceRevision: input.evidenceRevision,
          mobileSafe: input.mobileSafe ?? false,
          exactAction,
        })
      )
    );
    const id = approvalIdFor(
      `${workspaceId}:${input.taskId}:${input.attemptId}:${input.provider}:${input.providerRequestId}`
    );
    const repository = this.options.repository ?? defaultRepository();
    const existing = await repository.get(id);
    if (existing) {
      if (existing.actionHash !== actionHash) {
        throw new ConflictError(
          'Provider approval request identity was reused for a changed action.',
          {
            approvalId: existing.id,
            expectedActionHash: existing.actionHash,
            receivedActionHash: actionHash,
          }
        );
      }
      return existing;
    }

    const now = this.now();
    const ttlMs = boundedTtl(input.ttlMs);
    const request = RunApprovalRequestSchema.parse({
      schemaVersion: RUN_APPROVAL_SCHEMA_VERSION,
      id,
      workspaceId,
      taskId: input.taskId,
      attemptId: input.attemptId,
      provider: input.provider,
      agentId: input.agentId,
      requestKind: input.requestKind,
      actionClass: input.actionClass,
      action: redactString(input.action),
      actionHash,
      details: input.details ? redactString(input.details) : undefined,
      resourceScope: [...new Set(input.resourceScope ?? [])],
      workingDirectory: input.workingDirectory,
      riskClass: input.riskClass,
      policyReason: input.policyReason ? redactString(input.policyReason) : undefined,
      evidenceRevision: input.evidenceRevision,
      providerRequestId: input.providerRequestId,
      threadId: input.threadId,
      turnId: input.turnId,
      itemId: input.itemId,
      mobileSafe: input.mobileSafe ?? false,
      status: 'pending',
      revision: 1,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
    });
    let persisted: RunApprovalRequest;
    try {
      persisted = await repository.create(request);
    } catch (error) {
      const concurrent = await repository.get(id);
      if (!concurrent) throw error;
      if (concurrent.actionHash !== actionHash) {
        throw new ConflictError(
          'Provider approval request identity was reused for a changed action.',
          {
            approvalId: concurrent.id,
            expectedActionHash: concurrent.actionHash,
            receivedActionHash: actionHash,
          }
        );
      }
      return concurrent;
    }
    await this.appendEvent(persisted, 'approval.requested');
    this.broadcast(persisted);
    this.notify(persisted.id);
    return persisted;
  }

  async get(id: string, workspaceId = 'local'): Promise<RunApprovalRequest> {
    const request = await (this.options.repository ?? defaultRepository()).get(id);
    if (!request || request.workspaceId !== workspaceId) {
      throw new NotFoundError('Run approval request not found.');
    }
    return this.expireIfNeeded(request);
  }

  async list(query: RunApprovalListQuery): Promise<RunApprovalRequest[]> {
    const repository = this.options.repository ?? defaultRepository();
    const pending =
      query.status === 'pending'
        ? await repository.list(query)
        : await repository.list({ ...query, status: undefined });
    await Promise.all(
      pending
        .filter((request) => request.status === 'pending')
        .map((request) => this.expireIfNeeded(request))
    );
    return repository.list(query);
  }

  async decide(
    id: string,
    input: RunApprovalDecisionInput,
    actor: RunApprovalActor
  ): Promise<RunApprovalRequest> {
    const current = await this.get(id, actor.workspaceId);
    if (current.status !== 'pending') {
      throw new ConflictError('Run approval request is no longer pending.', {
        approvalId: current.id,
        status: current.status,
        revision: current.revision,
      });
    }
    if (current.riskClass === 'critical' && !hasFreshAuthentication(actor, this.now())) {
      throw new ForbiddenError(
        'Critical approvals require authentication from the last five minutes.',
        {
          approvalId: current.id,
          riskClass: current.riskClass,
          maximumAgeMs: MAX_PRIVILEGED_AUTH_AGE_MS,
        }
      );
    }
    if (actor.clientMode === 'mobile-pwa' && !current.mobileSafe) {
      throw new ForbiddenError('This approval is not marked mobile-safe.', {
        approvalId: current.id,
        actionClass: current.actionClass,
      });
    }

    const decidedAt = this.now().toISOString();
    const persistedResponse = input.responseData ? { _provided: true } : undefined;
    const result = await (this.options.repository ?? defaultRepository()).transition({
      id: current.id,
      expectedRevision: input.expectedRevision,
      expectedActionHash: input.expectedActionHash,
      status: input.decision,
      resolution: {
        decision: input.decision,
        actor,
        decidedAt,
        note: input.note ? redactString(input.note) : undefined,
        responseData: persistedResponse,
      },
    });
    if (!result.transitioned || !result.request) {
      throw transitionConflict(current.id, result.reason, result.request);
    }

    this.ephemeralResponses.set(current.id, input.responseData);
    await this.appendEvent(result.request, 'approval.resolved');
    this.broadcast(result.request);
    this.notify(result.request.id);
    return result.request;
  }

  async awaitDecision(
    id: string,
    options: AwaitRunApprovalOptions = {}
  ): Promise<RunApprovalDecisionResult> {
    for (;;) {
      if (options.signal?.aborted) {
        throw options.signal.reason instanceof Error
          ? options.signal.reason
          : new Error('Approval wait was aborted.');
      }
      const request = await (this.options.repository ?? defaultRepository()).get(id);
      if (!request) throw new NotFoundError('Run approval request not found.');
      const current = await this.expireIfNeeded(request);
      if (current.status !== 'pending') {
        const responseData =
          this.ephemeralResponses.get(current.id) ?? current.resolution?.responseData;
        this.ephemeralResponses.delete(current.id);
        return { request: current, responseData };
      }
      await this.waitForChange(
        current.id,
        Math.min(
          options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
          Math.max(1, Date.parse(current.expiresAt) - this.now().getTime())
        ),
        options.signal
      );
    }
  }

  async cancelAttempt(
    workspaceId: string,
    taskId: string,
    attemptId: string,
    reason: string
  ): Promise<RunApprovalRequest[]> {
    const repository = this.options.repository ?? defaultRepository();
    const pending = await repository.list({ workspaceId, taskId, attemptId, status: 'pending' });
    const cancelled: RunApprovalRequest[] = [];
    for (const request of pending) {
      const decidedAt = this.now().toISOString();
      const result = await repository.transition({
        id: request.id,
        expectedRevision: request.revision,
        expectedActionHash: request.actionHash,
        status: 'cancelled',
        resolution: {
          decision: 'cancelled',
          actor: systemActor(workspaceId),
          decidedAt,
          note: redactString(reason),
        },
      });
      if (!result.transitioned || !result.request) continue;
      cancelled.push(result.request);
      await this.appendEvent(result.request, 'approval.resolved');
      this.broadcast(result.request);
      this.notify(result.request.id);
    }
    return cancelled;
  }

  private async expireIfNeeded(request: RunApprovalRequest): Promise<RunApprovalRequest> {
    if (request.status !== 'pending' || Date.parse(request.expiresAt) > this.now().getTime()) {
      return request;
    }
    const result = await (this.options.repository ?? defaultRepository()).transition({
      id: request.id,
      expectedRevision: request.revision,
      expectedActionHash: request.actionHash,
      status: 'expired',
      resolution: {
        decision: 'expired',
        actor: systemActor(request.workspaceId),
        decidedAt: this.now().toISOString(),
        note: 'Approval request expired before a reviewer decision.',
      },
    });
    const current = result.request ?? request;
    if (result.transitioned) {
      await this.appendEvent(current, 'approval.resolved');
      this.broadcast(current);
      this.notify(current.id);
    }
    return current;
  }

  private async appendEvent(
    request: RunApprovalRequest,
    kind: 'approval.requested' | 'approval.resolved'
  ): Promise<void> {
    await this.journal.append({
      taskId: request.taskId,
      attemptId: request.attemptId,
      sessionId: request.threadId,
      turnId: request.turnId,
      itemId: request.itemId,
      providerEventId: request.providerRequestId,
      kind,
      source: {
        provider: request.provider,
        adapter: request.provider,
        agent: request.agentId,
      },
      payload: {
        approvalId: request.id,
        requestKind: request.requestKind,
        actionClass: request.actionClass,
        action: request.action,
        actionHash: request.actionHash,
        details: request.details,
        resourceScope: request.resourceScope,
        workingDirectory: request.workingDirectory,
        riskClass: request.riskClass,
        policyReason: request.policyReason,
        evidenceRevision: request.evidenceRevision,
        mobileSafe: request.mobileSafe,
        status: request.status,
        revision: request.revision,
        expiresAt: request.expiresAt,
        resolution: request.resolution,
      },
      dedupeKey: `${request.id}:${request.revision}`,
    });
  }

  private waitForChange(id: string, delayMs: number, signal?: AbortSignal): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const listeners = this.listeners.get(id) ?? new Set<() => void>();
      let timer: NodeJS.Timeout;
      const cleanup = () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        listeners.delete(onChange);
        if (listeners.size === 0) this.listeners.delete(id);
      };
      const onChange = () => {
        cleanup();
        resolve();
      };
      const onAbort = () => {
        cleanup();
        reject(
          signal?.reason instanceof Error ? signal.reason : new Error('Approval wait was aborted.')
        );
      };
      listeners.add(onChange);
      this.listeners.set(id, listeners);
      timer = setTimeout(onChange, Math.max(1, delayMs));
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  private notify(id: string): void {
    for (const listener of this.listeners.get(id) ?? []) {
      try {
        listener();
      } catch (error) {
        log.warn({ err: error, approvalId: id }, 'Run approval listener failed.');
      }
    }
  }
}

function boundedTtl(value?: number): number {
  const ttl = value ?? DEFAULT_APPROVAL_TTL_MS;
  if (!Number.isSafeInteger(ttl) || ttl < MIN_APPROVAL_TTL_MS || ttl > MAX_APPROVAL_TTL_MS) {
    throw new ValidationError('Approval TTL is outside the supported range.', {
      minimumMs: MIN_APPROVAL_TTL_MS,
      maximumMs: MAX_APPROVAL_TTL_MS,
    });
  }
  return ttl;
}

function approvalIdFor(value: string): string {
  return `runapproval_${createHash('sha256').update(value).digest('base64url').slice(0, 20)}`;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function canonicalizeExactAction(value: unknown): RunEventJsonValue {
  let keys = 0;
  const seen = new WeakSet<object>();
  const visit = (candidate: unknown, depth: number): RunEventJsonValue => {
    if (depth > MAX_EXACT_ACTION_DEPTH) {
      throw new ValidationError('Approval action exceeded the supported nesting depth.');
    }
    if (candidate === null) return null;
    if (typeof candidate === 'string' || typeof candidate === 'boolean') return candidate;
    if (typeof candidate === 'number' && Number.isFinite(candidate)) return candidate;
    if (Array.isArray(candidate)) return candidate.map((entry) => visit(entry, depth + 1));
    if (!candidate || typeof candidate !== 'object') {
      throw new ValidationError('Approval action must be JSON-compatible.');
    }
    if (seen.has(candidate)) throw new ValidationError('Approval action cannot be circular.');
    seen.add(candidate);
    const result = Object.create(null) as Record<string, RunEventJsonValue>;
    for (const key of Object.keys(candidate as Record<string, unknown>).sort()) {
      keys += 1;
      if (keys > MAX_EXACT_ACTION_KEYS) {
        throw new ValidationError('Approval action exceeded the supported key limit.');
      }
      const entry = (candidate as Record<string, unknown>)[key];
      if (entry !== undefined) result[key] = visit(entry, depth + 1);
    }
    seen.delete(candidate);
    return result;
  };
  const normalized = visit(value, 0);
  if (Buffer.byteLength(stableStringify(normalized), 'utf8') > MAX_EXACT_ACTION_BYTES) {
    throw new ValidationError('Approval action exceeded the supported byte limit.');
  }
  return normalized;
}

function stableStringify(value: RunEventJsonValue): string {
  if (!value || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
    .join(',')}}`;
}

function systemActor(workspaceId: string): RunApprovalActor {
  return {
    id: 'veritas-system',
    label: 'Veritas Kanban',
    type: 'service',
    authMethod: 'internal',
    workspaceId,
  };
}

function hasFreshAuthentication(actor: RunApprovalActor, now: Date): boolean {
  if (!actor.authenticatedAt) return false;
  const authenticatedAt = Date.parse(actor.authenticatedAt);
  if (!Number.isFinite(authenticatedAt)) return false;
  const age = now.getTime() - authenticatedAt;
  return age >= -MAX_AUTH_CLOCK_SKEW_MS && age <= MAX_PRIVILEGED_AUTH_AGE_MS;
}

function transitionConflict(
  approvalId: string,
  reason: string | undefined,
  current?: RunApprovalRequest
): ConflictError | NotFoundError {
  if (reason === 'not-found') return new NotFoundError('Run approval request not found.');
  return new ConflictError('Run approval compare-and-set was rejected.', {
    approvalId,
    reason,
    currentStatus: current?.status,
    currentRevision: current?.revision,
    currentActionHash: current?.actionHash,
  });
}

let instance: RunApprovalBrokerService | undefined;

export function getRunApprovalBrokerService(): RunApprovalBrokerService {
  instance ??= new RunApprovalBrokerService();
  return instance;
}

export function resetRunApprovalBrokerServiceForTests(): void {
  instance = undefined;
  fileRepository = undefined;
}
