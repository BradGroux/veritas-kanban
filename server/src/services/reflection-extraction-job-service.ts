import { createHash } from 'node:crypto';
import type {
  ReflectionExtractionJob,
  ReflectionExtractionJobClaimResult,
  ReflectionExtractionJobListQuery,
  ReflectionExtractionJobSource,
} from '@veritas-kanban/shared';
import { REFLECTION_EXTRACTION_JOB_SCHEMA_VERSION } from '@veritas-kanban/shared';
import { ConflictError, NotFoundError, ValidationError } from '../middleware/error-handler.js';
import { ReflectionExtractionJobSchema } from '../schemas/reflection-extraction-job-schemas.js';
import { FileReflectionExtractionJobRepository } from '../storage/reflection-extraction-job-repository.js';
import { extractionRetryDelayMs } from '../storage/reflection-extraction-job-state.js';
import type { ReflectionExtractionJobRepository } from '../storage/interfaces.js';
import { getStorage, getStorageTypeFromEnv } from '../storage/index.js';

const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_LEASE_DURATION_MS = 2 * 60_000;
const DEFAULT_MAX_ACTIVE_GLOBAL = 4;
const DEFAULT_MAX_ACTIVE_PER_WORKSPACE = 1;
const DEFAULT_RETRY_BASE_DELAY_MS = 5_000;
const DEFAULT_RETRY_MAX_DELAY_MS = 5 * 60_000;

export interface EnqueueReflectionExtractionJobInput {
  workspaceId: string;
  idempotencyKey: string;
  source: ReflectionExtractionJobSource;
  maxAttempts?: number;
  availableAt?: string;
}

export interface ReflectionExtractionJobMutationInput {
  expectedRevision: number;
  ownerId: string;
}

export interface CompleteReflectionExtractionJobInput extends ReflectionExtractionJobMutationInput {
  candidateIds: string[];
}

export interface FailReflectionExtractionJobInput extends ReflectionExtractionJobMutationInput {
  code: string;
  summary: string;
}

export interface ReflectionExtractionJobServiceOptions {
  repository?: ReflectionExtractionJobRepository;
  now?: () => Date;
  leaseDurationMs?: number;
  maxActiveGlobal?: number;
  maxActivePerWorkspace?: number;
  retryBaseDelayMs?: number;
  retryMaxDelayMs?: number;
}

let fileRepository: FileReflectionExtractionJobRepository | undefined;

function defaultRepository(): ReflectionExtractionJobRepository {
  if (getStorageTypeFromEnv() === 'sqlite') return getStorage().reflectionExtractionJobs;
  fileRepository ??= new FileReflectionExtractionJobRepository();
  return fileRepository;
}

export class ReflectionExtractionJobService {
  private readonly repositoryOverride?: ReflectionExtractionJobRepository;
  private readonly now: () => Date;
  private readonly leaseDurationMs: number;
  private readonly maxActiveGlobal: number;
  private readonly maxActivePerWorkspace: number;
  private readonly retryBaseDelayMs: number;
  private readonly retryMaxDelayMs: number;

  constructor(options: ReflectionExtractionJobServiceOptions = {}) {
    this.repositoryOverride = options.repository;
    this.now = options.now ?? (() => new Date());
    this.leaseDurationMs = options.leaseDurationMs ?? DEFAULT_LEASE_DURATION_MS;
    this.maxActiveGlobal = options.maxActiveGlobal ?? DEFAULT_MAX_ACTIVE_GLOBAL;
    this.maxActivePerWorkspace = options.maxActivePerWorkspace ?? DEFAULT_MAX_ACTIVE_PER_WORKSPACE;
    this.retryBaseDelayMs = options.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS;
    this.retryMaxDelayMs = options.retryMaxDelayMs ?? DEFAULT_RETRY_MAX_DELAY_MS;
  }

  private get repository(): ReflectionExtractionJobRepository {
    return this.repositoryOverride ?? defaultRepository();
  }

  async enqueue(input: EnqueueReflectionExtractionJobInput) {
    const timestamp = this.now().toISOString();
    const workspaceId = input.workspaceId.trim();
    const idempotencyKey = input.idempotencyKey.trim();
    const record = ReflectionExtractionJobSchema.parse({
      schemaVersion: REFLECTION_EXTRACTION_JOB_SCHEMA_VERSION,
      id: stableJobId(workspaceId, idempotencyKey),
      workspaceId,
      idempotencyKey,
      source: input.source,
      state: 'queued',
      revision: 1,
      attemptCount: 0,
      maxAttempts: input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
      availableAt: input.availableAt ?? timestamp,
      candidateIds: [],
      failures: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    const result = await this.repository.enqueue(record);
    if (
      !result.created &&
      (result.job.workspaceId !== record.workspaceId ||
        !sameExtractionSource(result.job.source, record.source))
    ) {
      throw new ConflictError('Extraction job idempotency key references different evidence.', {
        idempotencyKey,
        existingJobId: result.job.id,
      });
    }
    return result;
  }

  async get(id: string): Promise<ReflectionExtractionJob> {
    const job = await this.repository.get(id);
    if (!job) throw new NotFoundError('Reflection extraction job not found.');
    return job;
  }

  list(query: ReflectionExtractionJobListQuery = {}): Promise<ReflectionExtractionJob[]> {
    return this.repository.list(query);
  }

  claim(ownerId: string, workspaceId?: string): Promise<ReflectionExtractionJobClaimResult> {
    return this.repository.claim({
      ownerId,
      now: this.now().toISOString(),
      leaseDurationMs: this.leaseDurationMs,
      maxActiveGlobal: this.maxActiveGlobal,
      maxActivePerWorkspace: this.maxActivePerWorkspace,
      retryBaseDelayMs: this.retryBaseDelayMs,
      retryMaxDelayMs: this.retryMaxDelayMs,
      workspaceId,
    });
  }

  async renew(
    id: string,
    input: ReflectionExtractionJobMutationInput
  ): Promise<ReflectionExtractionJob> {
    const current = await this.requireOwnedLease(id, input);
    const timestamp = this.now().toISOString();
    const next = ReflectionExtractionJobSchema.parse({
      ...current,
      revision: current.revision + 1,
      lease: {
        ...current.lease,
        expiresAt: new Date(Date.parse(timestamp) + this.leaseDurationMs).toISOString(),
      },
      updatedAt: timestamp,
    });
    return this.compareAndSet(current, next);
  }

  async complete(
    id: string,
    input: CompleteReflectionExtractionJobInput
  ): Promise<ReflectionExtractionJob> {
    const current = await this.requireOwnedLease(id, input);
    const timestamp = this.now().toISOString();
    const next = ReflectionExtractionJobSchema.parse({
      ...current,
      state: 'completed',
      revision: current.revision + 1,
      lease: undefined,
      candidateIds: input.candidateIds,
      completedAt: timestamp,
      updatedAt: timestamp,
    });
    return this.compareAndSet(current, next);
  }

  async fail(
    id: string,
    input: FailReflectionExtractionJobInput
  ): Promise<ReflectionExtractionJob> {
    const current = await this.requireOwnedLease(id, input);
    const timestamp = this.now().toISOString();
    const terminal = current.attemptCount >= current.maxAttempts;
    const retryAt = terminal
      ? undefined
      : new Date(
          Date.parse(timestamp) +
            extractionRetryDelayMs(
              current.attemptCount,
              this.retryBaseDelayMs,
              this.retryMaxDelayMs
            )
        ).toISOString();
    const next = ReflectionExtractionJobSchema.parse({
      ...current,
      state: terminal ? 'dead-letter' : 'queued',
      revision: current.revision + 1,
      availableAt: retryAt ?? timestamp,
      lease: undefined,
      failures: [
        ...current.failures,
        {
          attempt: current.attemptCount,
          code: input.code,
          summary: input.summary,
          failedAt: timestamp,
          retryAt,
        },
      ].slice(-20),
      updatedAt: timestamp,
    });
    return this.compareAndSet(current, next);
  }

  private async requireOwnedLease(
    id: string,
    input: ReflectionExtractionJobMutationInput
  ): Promise<ReflectionExtractionJob> {
    const current = await this.get(id);
    if (current.revision !== input.expectedRevision) {
      throw new ConflictError('Extraction job compare-and-set revision is stale.', {
        jobId: id,
        expectedRevision: input.expectedRevision,
        currentRevision: current.revision,
      });
    }
    if (current.state !== 'leased' || !current.lease) {
      throw new ValidationError('Extraction job does not have an active lease.', {
        jobId: id,
        state: current.state,
      });
    }
    if (current.lease.ownerId !== input.ownerId) {
      throw new ConflictError('Extraction job lease belongs to another worker.', {
        jobId: id,
      });
    }
    if (Date.parse(current.lease.expiresAt) <= this.now().getTime()) {
      throw new ConflictError('Extraction job lease has expired.', { jobId: id });
    }
    return current;
  }

  private async compareAndSet(
    current: ReflectionExtractionJob,
    next: ReflectionExtractionJob
  ): Promise<ReflectionExtractionJob> {
    const result = await this.repository.compareAndSet({
      id: current.id,
      expectedRevision: current.revision,
      next,
    });
    if (result.updated && result.job) return result.job;
    if (result.reason === 'not-found') {
      throw new NotFoundError('Reflection extraction job not found.');
    }
    throw new ConflictError('Extraction job compare-and-set update was rejected.', {
      jobId: current.id,
      expectedRevision: current.revision,
      currentRevision: result.job?.revision,
      reason: result.reason,
    });
  }
}

function stableJobId(workspaceId: string, idempotencyKey: string): string {
  const digest = createHash('sha256')
    .update(workspaceId)
    .update('\0')
    .update(idempotencyKey)
    .digest('hex')
    .slice(0, 32);
  return `reflection_job_${digest}`;
}

function sameExtractionSource(
  left: ReflectionExtractionJobSource,
  right: ReflectionExtractionJobSource
): boolean {
  return (
    left.taskId === right.taskId &&
    left.attemptId === right.attemptId &&
    left.completionId === right.completionId &&
    left.completionDigest === right.completionDigest &&
    left.runEventId === right.runEventId
  );
}

let reflectionExtractionJobService: ReflectionExtractionJobService | undefined;

export function getReflectionExtractionJobService(): ReflectionExtractionJobService {
  reflectionExtractionJobService ??= new ReflectionExtractionJobService();
  return reflectionExtractionJobService;
}
