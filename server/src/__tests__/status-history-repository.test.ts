import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { StatusHistoryEntry } from '../services/status-history-service.js';
import { FileStatusHistoryStore } from '../storage/status-history-repository.js';

function entry(id: string): StatusHistoryEntry {
  return {
    id,
    timestamp: '2026-08-23T20:00:00.000Z',
    previousStatus: 'idle',
    newStatus: 'working',
  };
}

describe('FileStatusHistoryStore', () => {
  let root: string;
  let historyFile: string;
  let store: FileStatusHistoryStore;

  beforeEach(async () => {
    root = await mkdtemp(path.join(process.cwd(), '.veritas-status-history-store-'));
    historyFile = path.join(root, 'state', 'status-history.json');
    store = new FileStatusHistoryStore(historyFile);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('atomically updates, reads, and clears status history', async () => {
    await expect(store.read()).resolves.toEqual([]);
    await store.update((entries) => [entry('status_1'), ...entries]);
    await store.update((entries) => [entry('status_2'), ...entries]);

    await expect(store.read()).resolves.toEqual([entry('status_2'), entry('status_1')]);
    await store.clear();
    await expect(store.read()).resolves.toEqual([]);
    await expect(readFile(historyFile, 'utf8')).resolves.toBe('[]');
  });

  it('serializes concurrent read-modify-write updates', async () => {
    await Promise.all([
      store.update((entries) => [entry('status_alpha'), ...entries]),
      store.update((entries) => [entry('status_beta'), ...entries]),
    ]);

    const ids = (await store.read()).map(({ id }) => id);
    expect(ids).toHaveLength(2);
    expect(ids).toEqual(expect.arrayContaining(['status_alpha', 'status_beta']));
  });

  it('treats malformed and non-array legacy content as empty history', async () => {
    await mkdir(path.dirname(historyFile), { recursive: true });
    await writeFile(historyFile, '{broken', 'utf8');
    await expect(store.read()).resolves.toEqual([]);

    await writeFile(historyFile, '{}', 'utf8');
    await expect(store.read()).resolves.toEqual([]);
  });

  it('rejects symbolic links and non-file history paths', async () => {
    await mkdir(path.dirname(historyFile), { recursive: true });
    const target = path.join(root, 'outside.json');
    await writeFile(target, '[]', 'utf8');
    await symlink(target, historyFile);
    await expect(store.read()).rejects.toThrow(/symbolic link/i);

    await rm(historyFile);
    await mkdir(historyFile);
    await expect(store.read()).rejects.toThrow(/bounded regular file/i);
  });

  it('rejects symbolic-link parent directories and oversized writes', async () => {
    const realDirectory = path.join(root, 'real-state');
    const linkedDirectory = path.join(root, 'linked-state');
    await mkdir(realDirectory);
    await symlink(realDirectory, linkedDirectory, 'dir');
    const linkedStore = new FileStatusHistoryStore(path.join(linkedDirectory, 'history.json'));
    await expect(linkedStore.update(() => [entry('unsafe')])).rejects.toThrow(/regular directory/i);

    await expect(
      store.update(() => [
        {
          ...entry('oversized'),
          taskTitle: 'x'.repeat(16 * 1024 * 1024),
        },
      ])
    ).rejects.toThrow(/16 MiB/i);
  });
});
