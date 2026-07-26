import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ReflectionExtractionJobService } from '../services/reflection-extraction-job-service.js';
import { FileReflectionExtractionJobRepository } from '../storage/reflection-extraction-job-repository.js';
import type { ReflectionExtractionJobRepository } from '../storage/interfaces.js';
import { SqliteDatabase } from '../storage/sqlite/database.js';
import { SqliteReflectionExtractionJobRepository } from '../storage/sqlite/reflection-extraction-job-repository.js';

const roots: string[] = [];
const databases: SqliteDatabase[] = [];

afterEach(async () => {
  for (const database of databases.splice(0)) database.close();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe.each(['file', 'sqlite'] as const)(
  'ReflectionExtractionJobService %s repository',
  (storage) => {
    it('enqueues idempotently and survives a repository restart', async () => {
      const harness = await createHarness(storage);
      const first = await harness.service.enqueue(jobInput('workspace-a', 'completion-1'));
      const duplicate = await harness.service.enqueue(jobInput('workspace-a', 'completion-1'));

      expect(first.created).toBe(true);
      expect(duplicate).toEqual({ job: first.job, created: false });

      const restarted = await harness.reopen();
      expect(await restarted.get(first.job.id)).toEqual(first.job);

      await expect(
        restarted.enqueue({
          ...jobInput('workspace-a', 'completion-1'),
          source: {
            ...jobInput('workspace-a', 'completion-1').source,
            completionDigest: 'sha256:different',
          },
        })
      ).rejects.toMatchObject({ statusCode: 409, code: 'CONFLICT' });
    });

    it('enforces global and workspace concurrency with deterministic retry backoff', async () => {
      const harness = await createHarness(storage, {
        maxActiveGlobal: 2,
        maxActivePerWorkspace: 1,
      });
      const firstA = await harness.service.enqueue(jobInput('workspace-a', 'completion-a1'));
      harness.advance(1);
      await harness.service.enqueue(jobInput('workspace-a', 'completion-a2'));
      harness.advance(1);
      await harness.service.enqueue(jobInput('workspace-b', 'completion-b1'));
      harness.advance(1);

      const claimA = await harness.service.claim('worker-a');
      const claimB = await harness.service.claim('worker-b');
      const atGlobalLimit = await harness.service.claim('worker-c');

      expect(claimA).toMatchObject({
        claimed: true,
        job: { id: firstA.job.id, workspaceId: 'workspace-a', attemptCount: 1 },
      });
      expect(claimB).toMatchObject({
        claimed: true,
        job: { workspaceId: 'workspace-b', attemptCount: 1 },
      });
      expect(atGlobalLimit).toEqual({ claimed: false, reason: 'global-limit' });
      if (!claimA.claimed || !claimB.claimed) throw new Error('Expected both claims.');

      await expect(
        harness.service.fail(claimA.job.id, {
          expectedRevision: claimA.job.revision,
          ownerId: 'other-worker',
          code: 'EXTRACTION_FAILED',
          summary: 'Wrong owner must not mutate the job.',
        })
      ).rejects.toMatchObject({ statusCode: 409, code: 'CONFLICT' });

      const renewedB = await harness.service.renew(claimB.job.id, {
        expectedRevision: claimB.job.revision,
        ownerId: 'worker-b',
      });
      expect(renewedB).toMatchObject({
        state: 'leased',
        revision: claimB.job.revision + 1,
        lease: { ownerId: 'worker-b' },
      });

      const completedB = await harness.service.complete(claimB.job.id, {
        expectedRevision: renewedB.revision,
        ownerId: 'worker-b',
        candidateIds: ['reflection-candidate-b1'],
      });
      expect(completedB).toMatchObject({
        state: 'completed',
        candidateIds: ['reflection-candidate-b1'],
        lease: undefined,
      });

      const failedA = await harness.service.fail(claimA.job.id, {
        expectedRevision: claimA.job.revision,
        ownerId: 'worker-a',
        code: 'MODEL_TIMEOUT',
        summary: 'The bounded extractor timed out.',
      });
      expect(failedA).toMatchObject({
        state: 'queued',
        attemptCount: 1,
        failures: [{ attempt: 1, code: 'MODEL_TIMEOUT' }],
      });
      expect(Date.parse(failedA.availableAt) - harness.now().getTime()).toBe(1_000);

      const next = await harness.service.claim('worker-c');
      expect(next).toMatchObject({
        claimed: true,
        job: { workspaceId: 'workspace-a', attemptCount: 1 },
      });
      if (!next.claimed) throw new Error('Expected the second workspace-a job.');
      expect(next.job.id).not.toBe(failedA.id);
    });

    it('dead-letters an exhausted expired lease instead of duplicating work', async () => {
      const harness = await createHarness(storage);
      const enqueued = await harness.service.enqueue({
        ...jobInput('workspace-a', 'completion-expired'),
        maxAttempts: 1,
      });
      const claimed = await harness.service.claim('worker-a');
      expect(claimed).toMatchObject({ claimed: true, job: { id: enqueued.job.id } });
      if (!claimed.claimed) throw new Error('Expected an extraction claim.');

      harness.advance(60_001);
      const afterExpiry = await harness.service.claim('worker-b');
      expect(afterExpiry).toEqual({ claimed: false, reason: 'empty' });
      const expired = await harness.service.get(enqueued.job.id);
      expect(expired).toMatchObject({
        state: 'dead-letter',
        attemptCount: 1,
        failures: [{ attempt: 1, code: 'LEASE_EXPIRED' }],
      });
      expect(expired.lease).toBeUndefined();
    });
  }
);

function jobInput(workspaceId: string, completionId: string) {
  return {
    workspaceId,
    idempotencyKey: `extract:${completionId}`,
    source: {
      taskId: `task-${workspaceId}`,
      attemptId: `attempt-${completionId}`,
      completionId,
      completionDigest: `sha256:${completionId}`,
      runEventId: `event-${completionId}`,
    },
  };
}

async function createHarness(
  storage: 'file' | 'sqlite',
  limits: { maxActiveGlobal?: number; maxActivePerWorkspace?: number } = {}
) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'veritas-reflection-jobs-'));
  roots.push(root);
  let currentTime = Date.parse('2026-07-26T04:00:00.000Z');
  let repository: ReflectionExtractionJobRepository;
  let reopenRepository: () => Promise<ReflectionExtractionJobRepository>;

  if (storage === 'file') {
    const filePath = path.join(root, 'jobs.jsonl');
    repository = new FileReflectionExtractionJobRepository(filePath);
    reopenRepository = async () => new FileReflectionExtractionJobRepository(filePath);
  } else {
    const databasePath = path.join(root, 'veritas.db');
    let database = new SqliteDatabase({ databasePath });
    databases.push(database);
    database.open();
    repository = new SqliteReflectionExtractionJobRepository(database);
    reopenRepository = async () => {
      database.close();
      databases.splice(databases.indexOf(database), 1);
      database = new SqliteDatabase({ databasePath });
      databases.push(database);
      database.open();
      return new SqliteReflectionExtractionJobRepository(database);
    };
  }

  const options = {
    now: () => new Date(currentTime),
    leaseDurationMs: 60_000,
    retryBaseDelayMs: 1_000,
    retryMaxDelayMs: 4_000,
    maxActiveGlobal: limits.maxActiveGlobal ?? 4,
    maxActivePerWorkspace: limits.maxActivePerWorkspace ?? 1,
  };
  return {
    service: new ReflectionExtractionJobService({ ...options, repository }),
    advance(milliseconds: number) {
      currentTime += milliseconds;
    },
    now: () => new Date(currentTime),
    async reopen() {
      return new ReflectionExtractionJobService({
        ...options,
        repository: await reopenRepository(),
      });
    },
  };
}
