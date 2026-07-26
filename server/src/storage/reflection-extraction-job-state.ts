import type {
  ReflectionExtractionJob,
  ReflectionExtractionJobClaimInput,
  ReflectionExtractionJobClaimResult,
} from '@veritas-kanban/shared';
import { ReflectionExtractionJobSchema } from '../schemas/reflection-extraction-job-schemas.js';

export function normalizeExpiredExtractionJob(
  job: ReflectionExtractionJob,
  input: ReflectionExtractionJobClaimInput
): ReflectionExtractionJob {
  if (
    job.state !== 'leased' ||
    !job.lease ||
    Date.parse(job.lease.expiresAt) > Date.parse(input.now)
  ) {
    return job;
  }
  const terminal = job.attemptCount >= job.maxAttempts;
  const retryAt = terminal
    ? undefined
    : new Date(
        Date.parse(input.now) +
          extractionRetryDelayMs(job.attemptCount, input.retryBaseDelayMs, input.retryMaxDelayMs)
      ).toISOString();
  return ReflectionExtractionJobSchema.parse({
    ...job,
    state: terminal ? 'dead-letter' : 'queued',
    revision: job.revision + 1,
    availableAt: retryAt ?? input.now,
    lease: undefined,
    failures: [
      ...job.failures,
      {
        attempt: job.attemptCount,
        code: 'LEASE_EXPIRED',
        summary: 'The extraction worker lease expired before completion.',
        failedAt: input.now,
        retryAt,
      },
    ].slice(-20),
    updatedAt: input.now,
  });
}

export function selectExtractionJob(
  jobs: ReflectionExtractionJob[],
  input: ReflectionExtractionJobClaimInput
):
  | { job: ReflectionExtractionJob }
  | { reason: Extract<ReflectionExtractionJobClaimResult, { claimed: false }>['reason'] } {
  validateClaimInput(input);
  const active = jobs.filter(
    (job) =>
      job.state === 'leased' && job.lease && Date.parse(job.lease.expiresAt) > Date.parse(input.now)
  );
  if (active.length >= input.maxActiveGlobal) return { reason: 'global-limit' };

  const candidates = jobs
    .filter((job) => job.state === 'queued')
    .filter((job) => job.attemptCount < job.maxAttempts)
    .filter((job) => Date.parse(job.availableAt) <= Date.parse(input.now))
    .filter((job) => !input.workspaceId || job.workspaceId === input.workspaceId)
    .sort(
      (left, right) =>
        Date.parse(left.availableAt) - Date.parse(right.availableAt) ||
        Date.parse(left.createdAt) - Date.parse(right.createdAt) ||
        left.id.localeCompare(right.id)
    );
  if (candidates.length === 0) return { reason: 'empty' };

  const activeByWorkspace = new Map<string, number>();
  for (const job of active) {
    activeByWorkspace.set(job.workspaceId, (activeByWorkspace.get(job.workspaceId) ?? 0) + 1);
  }
  const job = candidates.find(
    (candidate) => (activeByWorkspace.get(candidate.workspaceId) ?? 0) < input.maxActivePerWorkspace
  );
  return job ? { job } : { reason: 'workspace-limit' };
}

export function leaseExtractionJob(
  job: ReflectionExtractionJob,
  input: ReflectionExtractionJobClaimInput
): ReflectionExtractionJob {
  return ReflectionExtractionJobSchema.parse({
    ...job,
    state: 'leased',
    revision: job.revision + 1,
    attemptCount: job.attemptCount + 1,
    lease: {
      ownerId: input.ownerId,
      acquiredAt: input.now,
      expiresAt: new Date(Date.parse(input.now) + input.leaseDurationMs).toISOString(),
    },
    updatedAt: input.now,
  });
}

export function extractionRetryDelayMs(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number
): number {
  const exponent = Math.max(0, attempt - 1);
  return Math.min(maxDelayMs, baseDelayMs * 2 ** Math.min(exponent, 30));
}

function validateClaimInput(input: ReflectionExtractionJobClaimInput): void {
  if (!input.ownerId.trim() || !Number.isFinite(Date.parse(input.now))) {
    throw new Error('Extraction claim requires a valid owner and timestamp.');
  }
  for (const [field, value] of Object.entries({
    leaseDurationMs: input.leaseDurationMs,
    maxActiveGlobal: input.maxActiveGlobal,
    maxActivePerWorkspace: input.maxActivePerWorkspace,
    retryBaseDelayMs: input.retryBaseDelayMs,
    retryMaxDelayMs: input.retryMaxDelayMs,
  })) {
    if (!Number.isInteger(value) || value <= 0) {
      throw new Error(`Extraction claim ${field} must be a positive integer.`);
    }
  }
  if (input.retryMaxDelayMs < input.retryBaseDelayMs) {
    throw new Error('Extraction retry maximum must be at least the base delay.');
  }
}
