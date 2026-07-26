import { mkdtemp, mkdir, readdir, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type {
  RunOutputArtifactLookup,
  RunOutputArtifactMetadata,
} from '@veritas-kanban/shared';
import { RunOutputSpillService } from '../services/run-output-spill-service.js';
import {
  FileRunOutputArtifactRepository,
  type FileRunOutputArtifactRepositoryHooks,
} from '../storage/run-output-artifact-repository.js';
import type { RunOutputArtifactRepository } from '../storage/interfaces.js';
import { SqliteDatabase } from '../storage/sqlite/database.js';
import { SqliteRunOutputArtifactRepository } from '../storage/sqlite/run-output-artifact-repository.js';

const cleanupPaths: string[] = [];
const databases: SqliteDatabase[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'veritas-run-output-'));
  cleanupPaths.push(directory);
  return directory;
}

function prepared(
  content = `${'bounded output line\n'.repeat(30)}`,
  now = new Date('2026-07-25T12:00:00.000Z')
) {
  const result = new RunOutputSpillService({
    schemaVersion: 'run-output-spill-policy/v1',
    inlineBytes: 256,
    maxQueryBytes: 1_024,
    maxJsonDepth: 8,
    retentionSeconds: 60,
    activeLeaseSeconds: 120,
    allowBinaryPersistence: false,
    allowCompressedPersistence: false,
  }).prepare({
    scope: {
      workspaceId: 'workspace_1',
      taskId: 'task_1',
      runId: 'run_1',
      attemptId: 'attempt_1',
      turnId: 'turn_1',
    },
    source: {
      kind: 'tool-result',
      name: 'example',
      eventId: 'event_1',
      toolCallId: 'tool_1',
    },
    content,
    mediaType: 'text/plain',
    now,
  });
  if (!result.artifact) throw new Error('Test fixture must create an artifact.');
  return result.artifact;
}

function lookup(metadata: RunOutputArtifactMetadata): RunOutputArtifactLookup {
  return { ...metadata.scope, artifactId: metadata.id };
}

async function fileRepository(
  hooks: FileRunOutputArtifactRepositoryHooks = {}
): Promise<RunOutputArtifactRepository> {
  return new FileRunOutputArtifactRepository(await temporaryDirectory(), hooks);
}

function sqliteRepository(): RunOutputArtifactRepository {
  const database = new SqliteDatabase({ databasePath: ':memory:' });
  database.open();
  databases.push(database);
  return new SqliteRunOutputArtifactRepository(database);
}

afterEach(async () => {
  for (const database of databases.splice(0)) database.close();
  await Promise.all(cleanupPaths.splice(0).map((entry) => rm(entry, { recursive: true })));
});

describe.each([
  ['file', fileRepository],
  ['sqlite', async () => sqliteRepository()],
] as const)('RunOutputArtifactRepository (%s)', (_name, repositoryFactory) => {
  it('persists one artifact idempotently and serves bounded ranges', async () => {
    const repository = await repositoryFactory();
    const artifact = prepared();

    const first = await repository.create(artifact.metadata, artifact.content);
    const duplicate = await repository.create(artifact.metadata, artifact.content);
    const range = await repository.readRange({
      ...lookup(artifact.metadata),
      offset: 8,
      length: 24,
    });

    expect(first.created).toBe(true);
    expect(duplicate).toEqual({ metadata: artifact.metadata, created: false });
    expect(range).toMatchObject({
      metadata: artifact.metadata,
      offset: 8,
      length: 24,
    });
    expect(Buffer.from(range?.content ?? []).toString('utf-8')).toBe(
      Buffer.from(artifact.content ?? []).subarray(8, 32).toString('utf-8')
    );
  });

  it('requires the exact workspace and run scope for retrieval', async () => {
    const repository = await repositoryFactory();
    const artifact = prepared();
    await repository.create(artifact.metadata, artifact.content);

    expect(
      await repository.get({
        ...lookup(artifact.metadata),
        workspaceId: 'workspace_2',
      })
    ).toBeNull();
    expect(
      await repository.get({
        ...lookup(artifact.metadata),
        runId: 'run_2',
      })
    ).toBeNull();
    expect(
      await repository.get({
        ...lookup(artifact.metadata),
        turnId: undefined,
      })
    ).toEqual(artifact.metadata);
  });

  it('rejects an artifact ID reused for different content', async () => {
    const repository = await repositoryFactory();
    const first = prepared();
    const other = prepared(`${'different output line\n'.repeat(30)}`);
    await repository.create(first.metadata, first.content);

    await expect(
      repository.create(
        {
          ...other.metadata,
          id: first.metadata.id,
        },
        other.content
      )
    ).rejects.toThrow('conflicting identity');
  });

  it('keeps expired metadata as a tombstone and honors active-run leases', async () => {
    const repository = await repositoryFactory();
    const artifact = prepared();
    await repository.create(artifact.metadata, artifact.content);

    const leased = await repository.cleanup({
      now: '2026-07-25T12:01:01.000Z',
      workspaceId: 'workspace_1',
    });
    expect(leased).toEqual({
      expiredArtifactIds: [],
      reclaimedBytes: 0,
      retainedByLease: 1,
      hasMore: false,
    });

    const expired = await repository.cleanup({
      now: '2026-07-25T12:02:01.000Z',
      workspaceId: 'workspace_1',
    });
    expect(expired).toEqual({
      expiredArtifactIds: [artifact.metadata.id],
      reclaimedBytes: artifact.metadata.storedBytes,
      retainedByLease: 0,
      hasMore: false,
    });
    expect(await repository.get(lookup(artifact.metadata))).toMatchObject({ state: 'expired' });
    expect(
      await repository.readRange({ ...lookup(artifact.metadata), offset: 0, length: 32 })
    ).toBeNull();
  });
});

describe('FileRunOutputArtifactRepository safety', () => {
  it('does not publish a partial artifact when interrupted before the atomic rename', async () => {
    const baseDir = await temporaryDirectory();
    const repository = new FileRunOutputArtifactRepository(baseDir, {
      beforePublish: () => {
        throw new Error('simulated crash');
      },
    });
    const artifact = prepared();

    await expect(repository.create(artifact.metadata, artifact.content)).rejects.toThrow(
      'simulated crash'
    );
    expect(await repository.get(lookup(artifact.metadata))).toBeNull();
    const attemptDirectory = path.join(
      baseDir,
      'workspace_1',
      'task_1',
      'run_1',
      'attempt_1'
    );
    expect(await readdir(attemptDirectory)).toEqual([]);
  });

  it.runIf(process.platform !== 'win32')('refuses a symlinked scope directory', async () => {
    const baseDir = await temporaryDirectory();
    const outside = await temporaryDirectory();
    await mkdir(baseDir, { recursive: true });
    await symlink(outside, path.join(baseDir, 'workspace_1'));
    const repository = new FileRunOutputArtifactRepository(baseDir);
    const artifact = prepared();

    await expect(repository.create(artifact.metadata, artifact.content)).rejects.toThrow(
      'not a private regular directory'
    );
  });
});
