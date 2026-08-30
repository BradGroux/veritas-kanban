import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { WorkProductArtifactMetadata } from '@veritas-kanban/shared';
import { SqliteDatabase } from '../../storage/sqlite/database.js';
import { SqliteWorkProductArtifactRepository } from '../../storage/sqlite/work-product-artifact-repository.js';

const cleanupPaths: string[] = [];
const databases: SqliteDatabase[] = [];

afterEach(async () => {
  for (const database of databases.splice(0)) database.close();
  await Promise.all(cleanupPaths.splice(0).map((entry) => fs.rm(entry, { recursive: true })));
});

describe('SqliteWorkProductArtifactRepository', () => {
  it('round-trips immutable artifact bytes without duplicating an idempotent create', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'veritas-sqlite-work-product-artifact-'));
    cleanupPaths.push(root);
    const database = new SqliteDatabase({ databasePath: path.join(root, 'veritas.db') });
    databases.push(database);
    database.open();
    const repository = new SqliteWorkProductArtifactRepository(database);
    const content = Buffer.from('sqlite artifact bytes', 'utf8');
    const metadata: WorkProductArtifactMetadata = {
      schemaVersion: 'work-product-artifact/v1',
      id: 'wpa_123456789012345678901234',
      productId: 'wp_123456789012345678901234',
      version: 1,
      workspaceId: 'local',
      taskId: 'task_1247',
      runId: 'run_1247',
      attemptId: 'attempt_1247',
      producingEventId: 'runevt_provider_output',
      requestIdDigest: `sha256:${'a'.repeat(64)}`,
      launchManifestDigest: `sha256:${'b'.repeat(64)}`,
      mediaType: 'text/plain',
      byteSize: content.byteLength,
      sha256: '73dd725d04f742cddc3668c4175631ed330d27bbea6d7a3f871b0bf206cf6cc2',
      safeName: 'artifact.txt',
      state: 'available',
      redaction: { state: 'none' },
      createdAt: '2026-08-30T12:00:00.000Z',
    };

    const first = await repository.create(metadata, content);
    const retry = await repository.create(metadata, content);
    database.close();
    databases.splice(databases.indexOf(database), 1);
    const restartedDatabase = new SqliteDatabase({ databasePath: path.join(root, 'veritas.db') });
    restartedDatabase.open();
    databases.push(restartedDatabase);
    const restartedRepository = new SqliteWorkProductArtifactRepository(restartedDatabase);
    const lookup = {
      workspaceId: 'local',
      productId: metadata.productId,
      version: 1,
      artifactId: metadata.id,
    };
    const download = await restartedRepository.read(lookup);

    expect(first.created).toBe(true);
    expect(retry).toEqual({ metadata, created: false });
    expect(download).toEqual({ metadata, content });
    await expect(restartedRepository.deleteProduct('local', metadata.productId)).resolves.toEqual({
      artifactsDeleted: 1,
      bytesDeleted: content.byteLength,
    });
    await expect(restartedRepository.read(lookup)).resolves.toBeNull();
  });
});
