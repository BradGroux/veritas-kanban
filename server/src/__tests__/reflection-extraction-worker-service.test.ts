import { describe, expect, it, vi } from 'vitest';
import type {
  CompletionResult,
  ReflectionCandidate,
  ReflectionExtractionJob,
} from '@veritas-kanban/shared';
import {
  DeterministicReflectionCandidateExtractor,
  ReflectionExtractionWorkerService,
  scheduleReflectionExtractionJob,
  type ReflectionExtractionSourceMaterial,
} from '../services/reflection-extraction-worker-service.js';

function job(): ReflectionExtractionJob {
  return {
    schemaVersion: 'reflection-extraction-job/v1',
    id: 'reflection_job_1',
    workspaceId: 'workspace_1',
    idempotencyKey: 'completion:completion_1',
    source: {
      taskId: 'task_1',
      attemptId: 'attempt_1',
      completionId: 'completion_1',
      completionDigest: `sha256:${'a'.repeat(64)}`,
      runEventId: 'event_1',
    },
    state: 'leased',
    revision: 2,
    attemptCount: 1,
    maxAttempts: 5,
    availableAt: '2026-07-25T12:00:00.000Z',
    lease: {
      ownerId: 'worker_1',
      acquiredAt: '2026-07-25T12:00:00.000Z',
      expiresAt: '2026-07-25T12:02:00.000Z',
    },
    candidateIds: [],
    failures: [],
    createdAt: '2026-07-25T12:00:00.000Z',
    updatedAt: '2026-07-25T12:00:00.000Z',
  };
}

function source(
  overrides: Partial<ReflectionExtractionSourceMaterial> = {}
): ReflectionExtractionSourceMaterial {
  return {
    workspaceId: 'workspace_1',
    taskId: 'task_1',
    taskTitle: 'Fix durable completion',
    attemptId: 'attempt_1',
    completionId: 'completion_1',
    completionDigest: `sha256:${'a'.repeat(64)}`,
    runEventId: 'event_1',
    status: 'blocked',
    summary: 'The run could not prove the required release.',
    blockers: [
      {
        code: 'RELEASE_NOT_VERIFIED',
        summary: 'Release is not verified',
        detail: 'Confirm the published version before retrying.',
        retryable: true,
      },
    ],
    evidence: [{ id: 'evidence_1', summary: 'Build passed.', verified: true }],
    verification: [{ gateId: 'release', status: 'failed', summary: 'No release evidence.' }],
    ...overrides,
  };
}

function completion(overrides: Partial<CompletionResult> = {}): CompletionResult {
  return {
    schemaVersion: 'completion-result/v1',
    digest: `sha256:${'a'.repeat(64)}`,
    idempotencyKey: `sha256:${'b'.repeat(64)}`,
    completedAt: '2026-07-25T12:00:00.000Z',
    terminalSource: 'process',
    taskEnvelopeSchemaVersion: 'task-envelope/v1',
    taskEnvelopeDigest: `sha256:${'c'.repeat(64)}`,
    taskId: 'task_1',
    attemptId: 'attempt_1',
    providerRuntimeManifestDigest: `sha256:${'d'.repeat(64)}`,
    status: 'blocked',
    summary: 'Blocked on release evidence.',
    error: null,
    blockers: [],
    evidence: [],
    changedFiles: [],
    artifacts: [],
    verification: [],
    sideEffects: [],
    continuation: null,
    ...overrides,
  };
}

describe('ReflectionExtractionWorkerService', () => {
  it('queues eligible completion identities on a later microtask', async () => {
    const enqueue = vi.fn().mockResolvedValue({ created: true, job: job() });
    const result = scheduleReflectionExtractionJob({
      jobs: { enqueue },
      workspaceId: 'workspace_1',
      completion: completion(),
      runEventId: 'event_1',
    });

    expect(result).toBe(true);
    expect(enqueue).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(enqueue).toHaveBeenCalledWith({
      workspaceId: 'workspace_1',
      idempotencyKey: `completion:sha256:${'b'.repeat(64)}`,
      source: {
        taskId: 'task_1',
        attemptId: 'attempt_1',
        completionId: `sha256:${'b'.repeat(64)}`,
        completionDigest: `sha256:${'a'.repeat(64)}`,
        runEventId: 'event_1',
      },
    });
  });

  it('does not queue interrupted completions', async () => {
    const enqueue = vi.fn();
    expect(
      scheduleReflectionExtractionJob({
        jobs: { enqueue },
        workspaceId: 'workspace_1',
        completion: completion({ status: 'interrupted' }),
      })
    ).toBe(false);
    await Promise.resolve();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('extracts bounded pending candidates and completes the leased job', async () => {
    const claimed = job();
    const complete = vi.fn().mockResolvedValue({ ...claimed, state: 'completed' });
    const fail = vi.fn();
    const create = vi.fn().mockResolvedValue({ id: 'reflection_1' } as ReflectionCandidate);
    const extractor = new DeterministicReflectionCandidateExtractor();
    const jobs = {
      claim: vi.fn().mockResolvedValue({ claimed: true, job: claimed }),
      complete,
      fail,
    };
    const worker = new ReflectionExtractionWorkerService({
      jobs,
      reflections: { create },
      sourceLoader: { load: vi.fn().mockResolvedValue(source()) },
      extractor,
      ownerId: 'worker_1',
    });

    await expect(worker.runOnce()).resolves.toBe('processed');

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: 'reflection_job_1:candidate:0',
        promotionTarget: 'task-lesson',
        proposedScope: 'task',
        source: expect.objectContaining({
          taskId: 'task_1',
          runId: 'attempt_1',
          eventIds: ['event_1'],
        }),
      })
    );
    expect(complete).toHaveBeenCalledWith('reflection_job_1', {
      expectedRevision: 2,
      ownerId: 'worker_1',
      candidateIds: ['reflection_1'],
    });
    expect(fail).not.toHaveBeenCalled();
  });

  it('records a bounded retry failure without completing the job', async () => {
    const claimed = job();
    const fail = vi.fn().mockResolvedValue({ ...claimed, state: 'queued' });
    const worker = new ReflectionExtractionWorkerService({
      jobs: {
        claim: vi.fn().mockResolvedValue({ claimed: true, job: claimed }),
        complete: vi.fn(),
        fail,
      },
      sourceLoader: {
        load: vi.fn().mockRejectedValue(
          Object.assign(
            new Error(
              'Authoritative completion disappeared with token=secret123 at /Users/brad/private.'
            ),
            {
              code: 'SOURCE_COMPLETION_NOT_FOUND',
            }
          )
        ),
      },
      reflections: { create: vi.fn() },
      ownerId: 'worker_1',
    });

    await expect(worker.runOnce()).resolves.toBe('processed');
    expect(fail).toHaveBeenCalledWith('reflection_job_1', {
      expectedRevision: 2,
      ownerId: 'worker_1',
      code: 'SOURCE_COMPLETION_NOT_FOUND',
      summary: 'Authoritative completion disappeared with token=[REDACTED] at [REDACTED_PATH]',
    });
  });

  it('does not invent a lesson for a successful completion', async () => {
    const extractor = new DeterministicReflectionCandidateExtractor();
    await expect(extractor.extract(source({ status: 'success', blockers: [] }))).resolves.toEqual(
      []
    );
  });
});
