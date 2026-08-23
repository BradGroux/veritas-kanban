import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Deliverable, DeliverableRun } from '../services/scheduled-deliverables-service.js';
import { FileScheduledDeliverablesStore } from '../storage/scheduled-deliverables-repository.js';

const deliverable: Deliverable = {
  id: 'del_1',
  name: 'Daily pulse',
  description: 'Produce the daily pulse.',
  schedule: 'daily',
  scheduleDescription: 'Every day',
  enabled: true,
  tags: ['operations'],
  createdAt: '2026-08-23T20:00:00.000Z',
  totalRuns: 0,
};

const run: DeliverableRun = {
  id: 'run_1',
  deliverableId: deliverable.id,
  status: 'success',
  runAt: '2026-08-23T21:00:00.000Z',
};

describe('FileScheduledDeliverablesStore', () => {
  let root: string;
  let deliverablesFile: string;
  let runsFile: string;
  let store: FileScheduledDeliverablesStore;

  beforeEach(async () => {
    root = await mkdtemp(path.join(process.cwd(), '.veritas-deliverables-store-'));
    deliverablesFile = path.join(root, 'state', 'deliverables.json');
    runsFile = path.join(root, 'state', 'runs.json');
    store = new FileScheduledDeliverablesStore(deliverablesFile, runsFile);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('loads missing files and atomically persists both collections', async () => {
    await expect(store.loadDeliverables()).resolves.toEqual([]);
    await expect(store.loadRuns()).resolves.toEqual([]);

    await store.saveDeliverables([deliverable]);
    await store.saveRuns([run]);

    await expect(store.loadDeliverables()).resolves.toEqual([deliverable]);
    await expect(store.loadRuns()).resolves.toEqual([run]);
  });

  it('treats malformed and non-array legacy content as empty state', async () => {
    await mkdir(path.dirname(deliverablesFile), { recursive: true });
    await writeFile(deliverablesFile, '{broken', 'utf8');
    await expect(store.loadDeliverables()).resolves.toEqual([]);

    await writeFile(deliverablesFile, '{}', 'utf8');
    await expect(store.loadDeliverables()).resolves.toEqual([]);
  });

  it('rejects symbolic links and non-file state paths', async () => {
    await mkdir(path.dirname(deliverablesFile), { recursive: true });
    const target = path.join(root, 'outside.json');
    await writeFile(target, '[]', 'utf8');
    await symlink(target, deliverablesFile);
    await expect(store.loadDeliverables()).rejects.toThrow(/symbolic link/i);

    await rm(deliverablesFile);
    await mkdir(deliverablesFile);
    await expect(store.loadDeliverables()).rejects.toThrow(/bounded regular file/i);
  });

  it('rejects symbolic-link parent directories and oversized state', async () => {
    const realDirectory = path.join(root, 'real-state');
    const linkedDirectory = path.join(root, 'linked-state');
    await mkdir(realDirectory);
    await symlink(realDirectory, linkedDirectory, 'dir');
    const linkedStore = new FileScheduledDeliverablesStore(
      path.join(linkedDirectory, 'deliverables.json'),
      path.join(linkedDirectory, 'runs.json')
    );
    await expect(linkedStore.saveDeliverables([deliverable])).rejects.toThrow(/regular directory/i);

    await expect(
      store.saveDeliverables([
        {
          ...deliverable,
          description: 'x'.repeat(16 * 1024 * 1024),
        },
      ])
    ).rejects.toThrow(/16 MiB/i);
  });
});
