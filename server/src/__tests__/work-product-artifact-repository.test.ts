import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorkProductArtifactMetadata } from '@veritas-kanban/shared';
import {
  FileWorkProductArtifactRepository,
  SecureWorkProductArtifactSourceReader,
} from '../storage/work-product-artifact-repository.js';

const cleanupPaths: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(cleanupPaths.splice(0).map((entry) => fs.rm(entry, { recursive: true })));
});

function digest(content: Uint8Array): string {
  return createHash('sha256').update(content).digest('hex');
}

function metadata(
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
    sha256: digest(content),
    safeName: 'artifact.txt',
    state: 'available',
    redaction: { state: 'none' },
    createdAt: '2026-08-30T12:00:00.000Z',
    ...overrides,
  };
}

async function repositoryFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'veritas-file-artifact-repository-'));
  cleanupPaths.push(root);
  return {
    root,
    repository: new FileWorkProductArtifactRepository(path.join(root, 'artifacts')),
  };
}

function lookup(value: WorkProductArtifactMetadata) {
  return {
    workspaceId: value.workspaceId,
    productId: value.productId,
    version: value.version,
    artifactId: value.id,
  };
}

function artifactDirectory(root: string, value: WorkProductArtifactMetadata): string {
  return path.join(
    root,
    'artifacts',
    value.workspaceId,
    value.productId,
    String(value.version),
    value.id
  );
}

describe('SecureWorkProductArtifactSourceReader', () => {
  it.each([
    ['', 1, /relative/],
    ['artifact.txt', 0, /positive safe integer/],
    ['./artifact.txt', 1, /invalid path segment/],
    ['nested/../artifact.txt', 1, /invalid path segment/],
    ['unsafe\nname.txt', 1, /control characters/],
  ] as const)('rejects invalid source request %#', async (relativePath, maxBytes, message) => {
    const reader = new SecureWorkProductArtifactSourceReader();
    await expect(reader.read('/tmp', relativePath, maxBytes)).rejects.toThrow(message);
  });

  it('reads a stable regular file and returns exact integrity metadata', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'veritas-artifact-source-reader-'));
    cleanupPaths.push(root);
    const content = Buffer.from('stable source bytes');
    await fs.writeFile(path.join(root, 'artifact.txt'), content);

    await expect(
      new SecureWorkProductArtifactSourceReader().read(root, 'artifact.txt', 1024)
    ).resolves.toEqual({
      content,
      byteSize: content.byteLength,
      sha256: digest(content),
      safeName: 'artifact.txt',
    });
  });
});

describe('FileWorkProductArtifactRepository', () => {
  it('enforces content state, integrity, identity, and immutable payload presence', async () => {
    const { root, repository } = await repositoryFixture();
    const content = Buffer.from('artifact bytes');
    const available = metadata(content);
    const quarantined = metadata(content, {
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
    await expect(repository.create(available, content)).resolves.toMatchObject({ created: true });
    await expect(repository.create(available, content)).resolves.toEqual({
      metadata: available,
      created: false,
    });
    await expect(
      repository.create({ ...available, mediaType: 'application/pdf' }, content)
    ).rejects.toThrow(/conflicting identity/);

    await fs.rm(path.join(artifactDirectory(root, available), 'payload.bin'));
    await expect(repository.create(available, content)).rejects.toThrow(/ENOENT/);
  });

  it('fails closed for malformed metadata and payload integrity changes', async () => {
    const { root, repository } = await repositoryFixture();
    const content = Buffer.from('artifact bytes');
    const available = metadata(content);
    await repository.create(available, content);
    const directory = artifactDirectory(root, available);

    await fs.writeFile(path.join(directory, 'payload.bin'), Buffer.from('short'));
    await expect(repository.read(lookup(available))).rejects.toThrow(/size integrity/);
    await fs.writeFile(path.join(directory, 'payload.bin'), Buffer.alloc(content.byteLength, 0x78));
    await expect(repository.read(lookup(available))).rejects.toThrow(/digest integrity/);

    await fs.writeFile(path.join(directory, 'metadata.json'), '{invalid-json');
    await expect(repository.get(lookup(available))).rejects.toThrow();
    await fs.rm(path.join(directory, 'metadata.json'));
    await fs.mkdir(path.join(directory, 'metadata.json'));
    await expect(repository.get(lookup(available))).rejects.toThrow(/bounded regular file/);
  });

  it('returns no download for quarantined metadata and rejects invalid versions', async () => {
    const { repository } = await repositoryFixture();
    const content = Buffer.from('artifact bytes');
    const quarantined = metadata(content, {
      id: 'wpa_quarantined12345678901234',
      state: 'quarantined',
      quarantineReason: 'content-policy',
      redaction: { state: 'quarantined', reason: 'content-policy' },
    });
    await repository.create(quarantined, null);

    await expect(repository.read(lookup(quarantined))).resolves.toBeNull();
    await expect(repository.get({ ...lookup(quarantined), version: 0 })).rejects.toThrow(
      /positive safe integer/
    );
  });

  it('counts only artifact directories and handles missing or invalid product storage', async () => {
    const { root, repository } = await repositoryFixture();
    const content = Buffer.from('artifact bytes');
    const available = metadata(content);
    await expect(repository.deleteProduct('local', available.productId)).resolves.toEqual({
      artifactsDeleted: 0,
      bytesDeleted: 0,
    });

    const productDirectory = path.dirname(path.dirname(artifactDirectory(root, available)));
    await fs.mkdir(path.dirname(productDirectory), { recursive: true });
    await fs.writeFile(productDirectory, 'not a directory');
    await expect(repository.deleteProduct('local', available.productId)).rejects.toThrow(
      /private regular directory/
    );
    await fs.rm(productDirectory);

    await repository.create(available, content);
    await fs.writeFile(path.join(productDirectory, 'stray-version'), 'ignored');
    await fs.writeFile(path.join(productDirectory, '1', 'stray-artifact'), 'ignored');
    await expect(repository.deleteProduct('local', available.productId)).resolves.toEqual({
      artifactsDeleted: 1,
      bytesDeleted: content.byteLength,
    });
  });

  it('fails closed when bounded reads make no progress or observe mutation', async () => {
    const { repository } = await repositoryFixture();
    const internals = repository as unknown as {
      readStableFile(
        handle: {
          read(...args: unknown[]): Promise<{ bytesRead: number }>;
          stat(): Promise<{
            size: number;
            ino: number;
            dev: number;
            mtimeMs: number;
            ctimeMs: number;
          }>;
        },
        before: { size: number; ino: number; dev: number; mtimeMs: number; ctimeMs: number },
        label: string
      ): Promise<Buffer>;
    };
    const before = { size: 1, ino: 1, dev: 1, mtimeMs: 1, ctimeMs: 1 };

    await expect(
      internals.readStableFile(
        { read: async () => ({ bytesRead: 0 }), stat: async () => before },
        before,
        'payload'
      )
    ).rejects.toThrow(/changed during its integrity read/);

    let reads = 0;
    await expect(
      internals.readStableFile(
        {
          read: async () => ({ bytesRead: reads++ === 0 ? 1 : 0 }),
          stat: async () => ({ ...before, mtimeMs: 2 }),
        },
        before,
        'payload'
      )
    ).rejects.toThrow(/changed during its integrity read/);
  });

  it('fails closed or returns the immutable winner when create races with another writer', async () => {
    const content = Buffer.from('artifact bytes');
    const available = metadata(content);
    const failure = new Error('simulated write race');

    const lostPayload = (await repositoryFixture()).repository;
    vi.spyOn(lostPayload, 'get').mockResolvedValue(available);
    vi.spyOn(lostPayload, 'read').mockResolvedValue(null);
    await expect(lostPayload.create(available, content)).rejects.toThrow(
      /lost its immutable payload/
    );

    const winner = (await repositoryFixture()).repository;
    vi.spyOn(winner, 'get').mockResolvedValueOnce(null).mockResolvedValueOnce(available);
    vi.spyOn(winner, 'read').mockResolvedValue({ metadata: available, content });
    const winnerInternals = winner as unknown as {
      writeExclusive(): Promise<void>;
    };
    winnerInternals.writeExclusive = async () => {
      throw failure;
    };
    await expect(winner.create(available, content)).resolves.toEqual({
      metadata: available,
      created: false,
    });

    const missingPayload = (await repositoryFixture()).repository;
    vi.spyOn(missingPayload, 'get').mockResolvedValueOnce(null).mockResolvedValueOnce(available);
    vi.spyOn(missingPayload, 'read').mockResolvedValue(null);
    (missingPayload as unknown as { writeExclusive(): Promise<void> }).writeExclusive =
      async () => {
        throw failure;
      };
    await expect(missingPayload.create(available, content)).rejects.toBe(failure);

    const noWinner = (await repositoryFixture()).repository;
    vi.spyOn(noWinner, 'get').mockResolvedValue(null);
    (noWinner as unknown as { writeExclusive(): Promise<void> }).writeExclusive = async () => {
      throw failure;
    };
    await expect(noWinner.create(available, content)).rejects.toBe(failure);
  });

  it('treats directory synchronization as a no-op on Windows', async () => {
    const { repository } = await repositoryFixture();
    const platform = Object.getOwnPropertyDescriptor(process, 'platform');
    try {
      Object.defineProperty(process, 'platform', { value: 'win32' });
      await expect(
        (
          repository as unknown as {
            syncDirectory(directoryPath: string): Promise<void>;
          }
        ).syncDirectory('/not-opened-on-windows')
      ).resolves.toBeUndefined();
    } finally {
      if (platform) Object.defineProperty(process, 'platform', platform);
    }
  });
});
