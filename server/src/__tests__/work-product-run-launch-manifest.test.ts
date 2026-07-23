import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Task } from '@veritas-kanban/shared';
import { WorkProductService } from '../services/work-product-service.js';

describe('completion packet launch evidence', () => {
  let tmpDir: string | undefined;

  afterEach(async () => {
    if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('links the run launch manifest and provider capability version', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'completion-launch-manifest-'));
    const task = {
      id: 'task_854',
      title: 'Compile launch evidence',
      type: 'code',
      status: 'done',
      priority: 'high',
      agent: 'codex',
      created: '2026-07-23T20:00:00.000Z',
      updated: '2026-07-23T20:05:00.000Z',
      attempt: {
        id: 'attempt_854',
        agent: 'codex',
        status: 'complete',
        runLaunchManifest: {
          schemaVersion: 'run-launch-manifest/v1',
          digest: `sha256:${'a'.repeat(64)}`,
        },
        runLaunchManifestTraceId: 'govtrace_launch_854',
        runLaunchParentAttemptId: 'attempt_parent',
        runLaunchManifestDrift: { material: true, changes: [] },
        providerRuntimeManifest: {
          digest: `sha256:${'b'.repeat(64)}`,
          probeRevision: 3,
          providerVersion: 'codex-cli 1.0.0',
          providerBuild: 'build-854',
        },
      },
    } as unknown as Task;
    const service = new WorkProductService({ dataDir: tmpDir, storageType: 'file' });

    const packet = await service.generateCompletionPacket(task);

    expect(packet.metadata).toMatchObject({
      runLaunchManifestSchemaVersion: 'run-launch-manifest/v1',
      runLaunchManifestDigest: `sha256:${'a'.repeat(64)}`,
      runLaunchManifestTraceId: 'govtrace_launch_854',
      runLaunchParentAttemptId: 'attempt_parent',
      runLaunchMaterialDrift: true,
      providerRuntimeManifestDigest: `sha256:${'b'.repeat(64)}`,
      providerRuntimeProbeRevision: 3,
      providerRuntimeVersion: 'codex-cli 1.0.0',
      providerRuntimeBuild: 'build-854',
    });
  });

  it('links historical completion evidence from the requested attempt', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'completion-launch-history-'));
    const historicalDigest = `sha256:${'c'.repeat(64)}`;
    const currentDigest = `sha256:${'d'.repeat(64)}`;
    const task = {
      id: 'task_854_history',
      title: 'Regenerate historical completion evidence',
      type: 'code',
      status: 'done',
      priority: 'high',
      agent: 'codex',
      created: '2026-07-23T20:00:00.000Z',
      updated: '2026-07-23T20:05:00.000Z',
      attempt: {
        id: 'attempt_current',
        agent: 'codex',
        status: 'complete',
        runLaunchManifest: {
          schemaVersion: 'run-launch-manifest/v1',
          digest: currentDigest,
        },
      },
      attempts: [
        {
          id: 'attempt_historical',
          agent: 'codex',
          status: 'complete',
          runLaunchManifest: {
            schemaVersion: 'run-launch-manifest/v1',
            digest: historicalDigest,
          },
          providerRuntimeManifest: {
            digest: `sha256:${'e'.repeat(64)}`,
            probeRevision: 4,
            providerVersion: 'codex-cli historical',
          },
        },
      ],
    } as unknown as Task;
    const service = new WorkProductService({ dataDir: tmpDir, storageType: 'file' });

    const packet = await service.generateCompletionPacket(task, {
      sourceRunId: 'attempt_historical',
    });

    expect(packet.metadata).toMatchObject({
      sourceRunId: 'attempt_historical',
      runLaunchManifestDigest: historicalDigest,
      providerRuntimeVersion: 'codex-cli historical',
    });
    expect(packet.metadata?.runLaunchManifestDigest).not.toBe(currentDigest);
  });
});
