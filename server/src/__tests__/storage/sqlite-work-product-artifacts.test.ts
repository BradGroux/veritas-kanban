import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import type { WorkProductArtifactMetadata } from '@veritas-kanban/shared';
import { SqliteDatabase } from '../../storage/sqlite/database.js';
import { SqliteWorkProductArtifactRepository } from '../../storage/sqlite/work-product-artifact-repository.js';

const cleanupPaths: string[] = [];
const databases: SqliteDatabase[] = [];

function sha256(content: Uint8Array): string {
  return createHash('sha256').update(content).digest('hex');
}

function artifactMetadata(
  content: Uint8Array,
  overrides: Partial<WorkProductArtifactMetadata> = {}
): WorkProductArtifactMetadata {
  return {
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
    sha256: sha256(content),
    safeName: 'artifact.txt',
    state: 'available',
    redaction: { state: 'none' },
    createdAt: '2026-08-30T12:00:00.000Z',
    ...overrides,
  };
}

async function repositoryFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'veritas-sqlite-work-product-artifact-'));
  cleanupPaths.push(root);
  const database = new SqliteDatabase({ databasePath: path.join(root, 'veritas.db') });
  databases.push(database);
  database.open();
  return { database, repository: new SqliteWorkProductArtifactRepository(database) };
}

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

  it('fails closed for invalid create state, conflicting retries, and lost payloads', async () => {
    const { database, repository } = await repositoryFixture();
    const content = Buffer.from('sqlite artifact bytes', 'utf8');
    const available = artifactMetadata(content, {
      requestIdDigest: `sha256:${'c'.repeat(64)}`,
      version: 2,
    });
    const quarantined = artifactMetadata(content, {
      id: 'wpa_quarantined12345678901234',
      state: 'quarantined',
      quarantineReason: 'content-policy',
      redaction: { state: 'quarantined', reason: 'content-policy' },
    });

    await expect(repository.create(available, null)).rejects.toThrow(/require persisted/);
    await expect(repository.create(quarantined, content)).rejects.toThrow(/cannot persist/);
    await expect(repository.create(available, Buffer.from('wrong bytes'))).rejects.toThrow(
      /integrity metadata/
    );
    await repository.create(available, content);
    await expect(
      repository.create({ ...available, mediaType: 'application/pdf' }, content)
    ).rejects.toThrow(/conflicting identity/);

    database
      .getConnection()
      .prepare('UPDATE work_product_artifacts SET content = NULL WHERE id = ?')
      .run(available.id);
    await expect(repository.create(available, content)).rejects.toThrow(
      /lost its immutable payload/
    );
  });

  it('returns no download for quarantined data and rejects corrupt available payloads', async () => {
    const { database, repository } = await repositoryFixture();
    const content = Buffer.from('sqlite artifact bytes', 'utf8');
    const quarantined = artifactMetadata(content, {
      id: 'wpa_quarantined12345678901234',
      state: 'quarantined',
      quarantineReason: 'content-policy',
      redaction: { state: 'quarantined', reason: 'content-policy' },
    });
    const available = artifactMetadata(content, {
      requestIdDigest: `sha256:${'c'.repeat(64)}`,
      version: 2,
    });

    await repository.create(quarantined, null);
    await expect(
      repository.read({
        workspaceId: quarantined.workspaceId,
        productId: quarantined.productId,
        version: quarantined.version,
        artifactId: quarantined.id,
      })
    ).resolves.toBeNull();

    await repository.create(available, content);
    database
      .getConnection()
      .prepare('UPDATE work_product_artifacts SET content = ? WHERE id = ?')
      .run(Buffer.alloc(content.byteLength, 0x78), available.id);
    await expect(
      repository.read({
        workspaceId: available.workspaceId,
        productId: available.productId,
        version: available.version,
        artifactId: available.id,
      })
    ).rejects.toThrow(/integrity check/);
  });

  it('rolls back a failed product artifact deletion', async () => {
    const { database, repository } = await repositoryFixture();
    const content = Buffer.from('sqlite artifact bytes', 'utf8');
    const metadata = artifactMetadata(content);
    await repository.create(metadata, content);
    const connection = database.getConnection();
    connection.exec(`
      CREATE TRIGGER block_artifact_delete
      BEFORE DELETE ON work_product_artifacts
      BEGIN
        SELECT RAISE(ABORT, 'blocked');
      END;
    `);

    await expect(
      repository.deleteProduct(metadata.workspaceId, metadata.productId)
    ).rejects.toThrow(/blocked/);
    expect(
      connection.prepare('SELECT COUNT(*) AS count FROM work_product_artifacts').get()
    ).toMatchObject({ count: 1 });
    connection.exec('DROP TRIGGER block_artifact_delete;');
  });
});
