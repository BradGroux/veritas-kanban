export const REFLECTION_EXTRACTION_JOB_SCHEMA_VERSION = 'reflection-extraction-job/v1' as const;

export const REFLECTION_EXTRACTION_JOB_STATES = [
  'queued',
  'leased',
  'completed',
  'dead-letter',
] as const;

export type ReflectionExtractionJobState = (typeof REFLECTION_EXTRACTION_JOB_STATES)[number];

export interface ReflectionExtractionJobSource {
  taskId: string;
  attemptId: string;
  completionId: string;
  completionDigest: string;
  runEventId?: string;
}

export interface ReflectionExtractionJobLease {
  ownerId: string;
  acquiredAt: string;
  expiresAt: string;
}

export interface ReflectionExtractionJobFailure {
  attempt: number;
  code: string;
  summary: string;
  failedAt: string;
  retryAt?: string;
}

export interface ReflectionExtractionJob {
  schemaVersion: typeof REFLECTION_EXTRACTION_JOB_SCHEMA_VERSION;
  id: string;
  workspaceId: string;
  idempotencyKey: string;
  source: ReflectionExtractionJobSource;
  state: ReflectionExtractionJobState;
  revision: number;
  attemptCount: number;
  maxAttempts: number;
  availableAt: string;
  lease?: ReflectionExtractionJobLease;
  candidateIds: string[];
  failures: ReflectionExtractionJobFailure[];
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface ReflectionExtractionJobListQuery {
  workspaceId?: string;
  states?: ReflectionExtractionJobState[];
  limit?: number;
}

export interface ReflectionExtractionJobClaimInput {
  ownerId: string;
  now: string;
  leaseDurationMs: number;
  maxActiveGlobal: number;
  maxActivePerWorkspace: number;
  retryBaseDelayMs: number;
  retryMaxDelayMs: number;
  workspaceId?: string;
}

export type ReflectionExtractionJobClaimResult =
  | {
      claimed: true;
      job: ReflectionExtractionJob;
    }
  | {
      claimed: false;
      reason: 'empty' | 'global-limit' | 'workspace-limit';
    };

export interface ReflectionExtractionJobCompareAndSetInput {
  id: string;
  expectedRevision: number;
  next: ReflectionExtractionJob;
}

export interface ReflectionExtractionJobCompareAndSetResult {
  job?: ReflectionExtractionJob;
  updated: boolean;
  reason?: 'not-found' | 'stale-revision' | 'invalid-revision';
}

export interface ReflectionExtractionJobEnqueueResult {
  job: ReflectionExtractionJob;
  created: boolean;
}
