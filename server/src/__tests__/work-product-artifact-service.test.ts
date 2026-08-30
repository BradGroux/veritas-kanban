import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
const taskServiceMocks = vi.hoisted(() => ({ getTask: vi.fn() }));
vi.mock('../services/task-service.js', () => ({
  getTaskService: () => taskServiceMocks,
}));
import { RunEventJournalService } from '../services/run-event-journal-service.js';
import {
  getWorkProductArtifactService,
  resetWorkProductArtifactServiceForTests,
  resolveWorkProductArtifactGrant,
  WorkProductArtifactService,
} from '../services/work-product-artifact-service.js';
import { WorkProductService } from '../services/work-product-service.js';
import { FileRunEventRepository } from '../storage/run-event-repository.js';
import {
  FileWorkProductArtifactRepository,
  type WorkProductArtifactSourceReader,
} from '../storage/work-product-artifact-repository.js';

const cleanupPaths: string[] = [];

afterEach(async () => {
  vi.clearAllMocks();
  resetWorkProductArtifactServiceForTests();
  await Promise.all(cleanupPaths.splice(0).map((entry) => fs.rm(entry, { recursive: true })));
});

async function fixture(
  options: {
    maxArtifactBytes?: number;
    granted?: boolean;
    sourceReader?: WorkProductArtifactSourceReader;
  } = {}
) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'veritas-work-product-artifact-'));
  cleanupPaths.push(root);
  const artifactRoot = path.join(root, 'sandbox', 'artifacts');
  await fs.mkdir(artifactRoot, { recursive: true });
  const workProducts = new WorkProductService({ dataDir: root, storageType: 'file' });
  const events = new RunEventJournalService(
    new FileRunEventRepository(path.join(root, 'run-events'))
  );
  const service = new WorkProductArtifactService({
    repository: new FileWorkProductArtifactRepository(path.join(root, 'stored-artifacts')),
    workProducts,
    events,
    resolveGrant: async () =>
      options.granted === false
        ? null
        : {
            artifactRoot,
            manifestDigest: `sha256:${'a'.repeat(64)}`,
          },
    maxArtifactBytes: options.maxArtifactBytes,
    sourceReader: options.sourceReader,
  });
  return { root, artifactRoot, events, service, workProducts };
}

describe('WorkProductArtifactService', () => {
  it('constructs the file-backed singleton without the SQLite storage registry', () => {
    const originalStorage = process.env.VERITAS_STORAGE;
    process.env.VERITAS_STORAGE = 'file';
    try {
      expect(getWorkProductArtifactService()).toBeInstanceOf(WorkProductArtifactService);
    } finally {
      if (originalStorage === undefined) delete process.env.VERITAS_STORAGE;
      else process.env.VERITAS_STORAGE = originalStorage;
    }
  });

  it('rejects an expired attempt before trusting its prior launch manifest', async () => {
    taskServiceMocks.getTask.mockResolvedValue({
      id: 'task_1247',
      attempt: {
        id: 'attempt_expired',
        status: 'complete',
        runLaunchManifest: { schemaVersion: 'run-launch-manifest/v1' },
      },
    });

    await expect(
      resolveWorkProductArtifactGrant({
        workspaceId: 'local',
        taskId: 'task_1247',
        runId: 'run_expired',
        attemptId: 'attempt_expired',
      })
    ).resolves.toBeNull();
  });

  it('registers immutable run output once and preserves causal provenance', async () => {
    const { artifactRoot, events, service } = await fixture();
    const content = Buffer.from('%PDF-1.7\nverified deliverable\n', 'utf8');
    await fs.writeFile(path.join(artifactRoot, 'release-report.pdf'), content);
    const input = {
      workspaceId: 'local',
      taskId: 'task_1247',
      runId: 'run_1247',
      attemptId: 'attempt_1247',
      requestId: 'request_release_report',
      producingEventId: 'runevt_provider_output',
      relativePath: 'release-report.pdf',
      title: 'Release report',
      mediaType: 'application/pdf',
    };

    const [first, retry] = await Promise.all([service.register(input), service.register(input)]);

    expect(retry).toEqual(first);
    expect(first.product).toMatchObject({
      id: expect.stringMatching(/^wp_/),
      workspaceId: 'local',
      taskId: 'task_1247',
      sourceRunId: 'run_1247',
      kind: 'file',
      version: 1,
      render: {
        schemaVersion: 1,
        kind: 'file',
        artifact: {
          schemaVersion: 'work-product-artifact/v1',
          id: expect.stringMatching(/^wpa_/),
          version: 1,
          mediaType: 'application/pdf',
          byteSize: content.byteLength,
          sha256: 'e440c4de8bd283b7419578bbfea049e685cbf7c42a4745695fd28d5d4909e9a6',
          safeName: 'release-report.pdf',
          taskId: 'task_1247',
          runId: 'run_1247',
          attemptId: 'attempt_1247',
          producingEventId: 'runevt_provider_output',
          state: 'available',
          redaction: { state: 'none' },
        },
      },
    });
    expect(JSON.stringify(first.product)).not.toContain(artifactRoot);

    const download = await service.download({
      workspaceId: 'local',
      productId: first.product.id,
      version: 1,
    });
    expect(download?.content).toEqual(content);
    expect(download?.metadata.sha256).toBe(
      'e440c4de8bd283b7419578bbfea049e685cbf7c42a4745695fd28d5d4909e9a6'
    );

    const versions = await service.listVersions({
      workspaceId: 'local',
      productId: first.product.id,
    });
    expect(versions).toHaveLength(1);
    await expect(
      service.inspect({ workspaceId: 'local', productId: first.product.id })
    ).resolves.toEqual(first.product);
    await expect(
      service.list({ workspaceId: 'local', taskId: 'task_1247', includeArchived: true })
    ).resolves.toEqual([first.product]);
    await expect(
      service.inspect({ workspaceId: 'another-workspace', productId: first.product.id })
    ).rejects.toThrow('another workspace');
    const journal = await events.list({ taskId: 'task_1247', attemptId: 'attempt_1247' });
    expect(journal.events).toHaveLength(1);
    expect(journal.events[0]).toMatchObject({
      kind: 'artifact.created',
      causalEventId: 'runevt_provider_output',
      payload: {
        artifactId: first.metadata.id,
        workProductId: first.product.id,
        version: 1,
      },
    });
  });

  it('keeps a stable request idempotent after a newer immutable version exists', async () => {
    const { artifactRoot, events, service } = await fixture();
    await fs.writeFile(path.join(artifactRoot, 'report.txt'), 'version one');
    const original = {
      workspaceId: 'local',
      taskId: 'task_1247',
      runId: 'run_1247',
      attemptId: 'attempt_1247',
      requestId: 'request_version_one',
      producingEventId: 'runevt_version_one',
      relativePath: 'report.txt',
      title: 'Version one',
      mediaType: 'text/plain',
    };
    const first = await service.register(original);

    await fs.writeFile(path.join(artifactRoot, 'report.txt'), 'version two');
    const second = await service.register({
      ...original,
      requestId: 'request_version_two',
      producingEventId: 'runevt_version_two',
      title: 'Version two',
      workProductId: first.product.id,
    });
    const retry = await service.register({ ...original, workProductId: first.product.id });

    expect(second.product.version).toBe(2);
    expect(retry.product.version).toBe(1);
    expect(retry.metadata.id).toBe(first.metadata.id);
    await expect(
      service.listVersions({ workspaceId: 'local', productId: first.product.id })
    ).resolves.toHaveLength(2);
    await expect(
      events.list({ taskId: 'task_1247', attemptId: 'attempt_1247' })
    ).resolves.toMatchObject({
      events: expect.arrayContaining([expect.any(Object), expect.any(Object)]),
    });
    expect(
      (await events.list({ taskId: 'task_1247', attemptId: 'attempt_1247' })).events
    ).toHaveLength(2);
  });

  it('rejects a stable request ID reused with different registration inputs', async () => {
    const { artifactRoot, service } = await fixture();
    await fs.writeFile(path.join(artifactRoot, 'stable.txt'), 'stable bytes');
    const input = {
      workspaceId: 'local',
      taskId: 'task_1247',
      runId: 'run_1247',
      attemptId: 'attempt_1247',
      requestId: 'request_stable_binding',
      producingEventId: 'runevt_stable_binding',
      relativePath: 'stable.txt',
      title: 'Stable artifact',
      mediaType: 'text/plain',
    };
    const registered = await service.register(input);

    await expect(
      service.register({
        ...input,
        workProductId: registered.product.id,
        relativePath: '../stable.txt',
      })
    ).rejects.toThrow(/artifact path/i);
    await expect(
      service.register({
        ...input,
        workProductId: registered.product.id,
        title: 'Changed request body',
      })
    ).rejects.toThrow(/already bound/i);
  });

  it('retains one immutable downloadable artifact after the Work Product is archived', async () => {
    const { artifactRoot, service, workProducts } = await fixture();
    await fs.writeFile(path.join(artifactRoot, 'archive-proof.txt'), 'retained after archive');
    const registered = await service.register({
      workspaceId: 'local',
      taskId: 'task_1247',
      runId: 'run_1247',
      attemptId: 'attempt_1247',
      requestId: 'request_archive_proof',
      producingEventId: 'runevt_archive_proof',
      relativePath: 'archive-proof.txt',
      title: 'Archive proof',
      mediaType: 'text/plain',
    });

    const archived = await workProducts.archive(registered.product.id);
    const download = await service.download({
      workspaceId: 'local',
      productId: registered.product.id,
    });

    expect(archived).toMatchObject({ status: 'archived', version: 2 });
    expect(Buffer.from(download?.content ?? []).toString('utf8')).toBe('retained after archive');
    await expect(
      service.listVersions({ workspaceId: 'local', productId: registered.product.id })
    ).resolves.toEqual([registered.metadata]);
    const maintenance = await workProducts.maintenancePreview();
    expect(
      maintenance.cleanupCandidates.find((item) => item.id === registered.product.id)
        ?.estimatedBytes
    ).toBeGreaterThanOrEqual(registered.metadata.byteSize);
    expect(maintenance.notes.join(' ')).toContain('file-backed artifact bodies');
  });

  it('physically purges only an archived file product with exact confirmation', async () => {
    const { artifactRoot, service, workProducts } = await fixture();
    const content = Buffer.from('purge these bytes', 'utf8');
    await fs.writeFile(path.join(artifactRoot, 'purge.txt'), content);
    const registered = await service.register({
      workspaceId: 'local',
      taskId: 'task_1247',
      runId: 'run_1247',
      attemptId: 'attempt_1247',
      requestId: 'request_purge',
      producingEventId: 'runevt_purge',
      relativePath: 'purge.txt',
      title: 'Purge proof',
      mediaType: 'text/plain',
    });

    await expect(
      service.purge({
        workspaceId: 'local',
        productId: registered.product.id,
        confirmation: registered.product.id,
      })
    ).rejects.toThrow(/only archived/i);
    await workProducts.archive(registered.product.id);
    await expect(
      service.purge({
        workspaceId: 'local',
        productId: registered.product.id,
        confirmation: 'wp_wrong_confirmation_1234',
      })
    ).rejects.toThrow(/confirmation/i);

    await expect(
      service.purge({
        workspaceId: 'local',
        productId: registered.product.id,
        confirmation: registered.product.id,
      })
    ).resolves.toEqual({
      productId: registered.product.id,
      artifactsDeleted: 1,
      bytesDeleted: content.byteLength,
    });
    await expect(workProducts.get(registered.product.id)).resolves.toBeNull();
    await expect(
      service.download({ workspaceId: 'local', productId: registered.product.id })
    ).resolves.toBeNull();
  });

  it('reads registered file-backend bytes after service restart', async () => {
    const { root, artifactRoot, service, workProducts } = await fixture();
    await fs.writeFile(path.join(artifactRoot, 'restart-proof.txt'), 'restart proof');
    const registered = await service.register({
      workspaceId: 'local',
      taskId: 'task_1247',
      runId: 'run_1247',
      attemptId: 'attempt_1247',
      requestId: 'request_restart_proof',
      producingEventId: 'runevt_restart_proof',
      relativePath: 'restart-proof.txt',
      title: 'Restart proof',
      mediaType: 'text/plain',
    });
    workProducts.dispose();

    const restartedProducts = new WorkProductService({ dataDir: root, storageType: 'file' });
    const restarted = new WorkProductArtifactService({
      repository: new FileWorkProductArtifactRepository(path.join(root, 'stored-artifacts')),
      workProducts: restartedProducts,
      events: new RunEventJournalService(new FileRunEventRepository(path.join(root, 'run-events'))),
      resolveGrant: async () => null,
    });
    const download = await restarted.download({
      workspaceId: 'local',
      productId: registered.product.id,
      version: 1,
    });

    expect(Buffer.from(download?.content ?? []).toString('utf8')).toBe('restart proof');
    expect(download?.metadata.sha256).toBe(registered.metadata.sha256);
  });

  it.each([
    ['traversal', '../outside.txt'],
    ['absolute path', '/tmp/outside.txt'],
  ])('rejects %s outside the granted root', async (_caseName, relativePath) => {
    const { service } = await fixture();
    await expect(
      service.register({
        workspaceId: 'local',
        taskId: 'task_1247',
        runId: 'run_1247',
        attemptId: 'attempt_1247',
        requestId: `request_${_caseName}`,
        producingEventId: 'runevt_provider_output',
        relativePath,
        title: 'Unsafe artifact',
        mediaType: 'text/plain',
      })
    ).rejects.toThrow(/artifact (path|root)/i);
  });

  it('rejects symlinks, special files, and oversized files', async () => {
    const { artifactRoot, service } = await fixture({ maxArtifactBytes: 8 });
    const outside = path.join(path.dirname(artifactRoot), 'outside.txt');
    await fs.writeFile(outside, 'outside');
    await fs.symlink(outside, path.join(artifactRoot, 'linked.txt'));
    await fs.link(outside, path.join(artifactRoot, 'hard-linked.txt'));
    await fs.mkdir(path.join(artifactRoot, 'directory'));
    await fs.writeFile(path.join(artifactRoot, 'oversized.txt'), '123456789');
    const base = {
      workspaceId: 'local',
      taskId: 'task_1247',
      runId: 'run_1247',
      attemptId: 'attempt_1247',
      producingEventId: 'runevt_provider_output',
      title: 'Rejected artifact',
      mediaType: 'text/plain',
    };

    await expect(
      service.register({ ...base, requestId: 'request_symlink', relativePath: 'linked.txt' })
    ).rejects.toThrow(/regular file|symbolic link/i);
    await expect(
      service.register({ ...base, requestId: 'request_directory', relativePath: 'directory' })
    ).rejects.toThrow(/regular file/i);
    await expect(
      service.register({
        ...base,
        requestId: 'request_hard_link',
        relativePath: 'hard-linked.txt',
      })
    ).rejects.toThrow(/hard-link|identity/i);
    await expect(
      service.register({
        ...base,
        requestId: 'request_control_character',
        relativePath: 'unsafe\nname.txt',
      })
    ).rejects.toThrow(/control characters/i);
    await expect(
      service.register({
        ...base,
        requestId: 'request_oversized',
        relativePath: 'oversized.txt',
      })
    ).rejects.toThrow(/size limit/i);
  });

  it('fails closed when the run has no manifest-bound artifact grant', async () => {
    const { artifactRoot, service } = await fixture({ granted: false });
    await fs.writeFile(path.join(artifactRoot, 'report.txt'), 'safe');

    await expect(
      service.register({
        workspaceId: 'local',
        taskId: 'task_1247',
        runId: 'run_1247',
        attemptId: 'attempt_1247',
        requestId: 'request_ungranted',
        producingEventId: 'runevt_provider_output',
        relativePath: 'report.txt',
        title: 'Ungoverned artifact',
        mediaType: 'text/plain',
      })
    ).rejects.toThrow(/not granted/i);
  });

  it('does not publish metadata or events when an incomplete source write is detected', async () => {
    const { events, service, workProducts } = await fixture({
      sourceReader: {
        read: async () => {
          throw new Error('Artifact source changed while it was being registered.');
        },
      },
    });

    await expect(
      service.register({
        workspaceId: 'local',
        taskId: 'task_1247',
        runId: 'run_1247',
        attemptId: 'attempt_1247',
        requestId: 'request_incomplete',
        producingEventId: 'runevt_incomplete',
        relativePath: 'incomplete.pdf',
        title: 'Incomplete artifact',
        mediaType: 'application/pdf',
      })
    ).rejects.toThrow(/changed while/i);
    await expect(workProducts.list({ includeArchived: true })).resolves.toEqual([]);
    await expect(
      events.list({ taskId: 'task_1247', attemptId: 'attempt_1247' })
    ).resolves.toMatchObject({ events: [] });
  });

  it.each([
    ['application/x-executable', Buffer.from('binary executable')],
    ['application/pdf', Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x00])],
    ['application/octet-stream', Buffer.from('api_key=sk_example_12345678901234567890')],
  ])(
    'quarantines unsafe %s content without exposing download bytes',
    async (mediaType, content) => {
      const { artifactRoot, service } = await fixture();
      await fs.writeFile(path.join(artifactRoot, 'unsafe.bin'), content);

      const registration = await service.register({
        workspaceId: 'local',
        taskId: 'task_1247',
        runId: 'run_1247',
        attemptId: 'attempt_1247',
        requestId: `request_${mediaType}`,
        producingEventId: 'runevt_provider_output',
        relativePath: 'unsafe.bin',
        title: 'Unsafe artifact',
        mediaType,
      });

      expect(registration.metadata).toMatchObject({
        state: 'quarantined',
        redaction: { state: 'quarantined' },
      });
      await expect(
        service.download({
          workspaceId: 'local',
          productId: registration.product.id,
        })
      ).resolves.toBeNull();
    }
  );
});
