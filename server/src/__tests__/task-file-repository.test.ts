import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, symlink, truncate, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Task } from '@veritas-kanban/shared';
import { FileTaskRepository } from '../storage/task-file-repository.js';

function task(id = 'task_20260823_repo01', title = 'Repository task'): Task {
  return {
    id,
    title,
    description: 'initial',
    type: 'code',
    status: 'todo',
    priority: 'medium',
    created: '2026-08-23T00:00:00.000Z',
    updated: '2026-08-23T00:00:00.000Z',
    revision: 1,
  };
}

describe('FileTaskRepository', () => {
  let root: string;
  let activeDir: string;
  let archiveDir: string;
  let repository: FileTaskRepository;

  beforeEach(async () => {
    root = await mkdtemp(path.join(process.cwd(), '.veritas-task-repository-'));
    activeDir = path.join(root, 'active');
    archiveDir = path.join(root, 'archive');
    repository = new FileTaskRepository({ activeDir, archiveDir });
  });

  afterEach(async () => {
    repository.dispose();
    await rm(root, { recursive: true, force: true });
  });

  it('loads legacy Markdown and preserves tasks across repository restart', async () => {
    await repository.ensureReady();
    await writeFile(
      path.join(activeDir, 'task_legacy-legacy-title.md'),
      `---
id: task_legacy
title: Legacy Title
type: code
status: todo
priority: high
created: '2026-01-01T00:00:00.000Z'
updated: '2026-01-02T00:00:00.000Z'
---
Legacy description.
`,
      'utf8'
    );

    await expect(repository.listActive()).resolves.toMatchObject([
      { id: 'task_legacy', title: 'Legacy Title', description: 'Legacy description.' },
    ]);

    const created = task();
    await repository.createActive(created);
    const restarted = new FileTaskRepository({ activeDir, archiveDir });
    await expect(restarted.findActiveById(created.id)).resolves.toMatchObject(created);
    restarted.dispose();
  });

  it('serializes concurrent mutations and archive restoration without lost updates', async () => {
    const original = task();
    await repository.createActive(original);

    const append = (value: string) =>
      repository.withActiveMutation(original.id, async (current, persist) => {
        const updated = {
          ...current,
          description: `${current.description}:${value}`,
          revision: (current.revision ?? 1) + 1,
          updated: `2026-08-23T00:00:0${value}.000Z`,
        };
        await persist(updated);
        return updated;
      });

    await expect(Promise.all([append('1'), append('2')])).resolves.toHaveLength(2);
    const mutated = await repository.findActiveById(original.id);
    expect(mutated?.description).toBe('initial:1:2');

    const archived = { ...mutated!, deletedBy: 'operator' };
    await expect(repository.archiveActive(original.id, archived)).resolves.toBe(true);
    await expect(repository.findActiveById(original.id)).resolves.toBeNull();
    await expect(repository.findArchivedById(original.id)).resolves.toMatchObject({
      deletedBy: 'operator',
    });

    const restored = {
      ...archived,
      status: 'done' as const,
      deletedBy: undefined,
      updated: '2026-08-23T00:00:03.000Z',
    };
    await expect(repository.restoreArchived(original.id, restored)).resolves.toBe(true);
    await expect(repository.findActiveById(original.id)).resolves.toMatchObject(restored);
    await expect(repository.findArchivedById(original.id)).resolves.toBeNull();
  });

  it('fails closed for unsafe state and treats absent tasks as normal misses', async () => {
    await repository.ensureReady();
    await expect(repository.findActiveById('../outside')).rejects.toThrow(/lookup ID/);
    await expect(repository.deleteActive('missing')).resolves.toBe(false);
    await expect(
      repository.withActiveMutation('missing', async () => 'unexpected')
    ).resolves.toBeNull();
    await expect(repository.restoreArchived('missing', task('task_missing'))).resolves.toBe(false);

    const outside = path.join(root, 'outside.md');
    await writeFile(outside, 'outside', 'utf8');
    await symlink(outside, path.join(activeDir, 'task_symlink-linked.md'));
    await expect(repository.findActiveById('task_symlink')).resolves.toBeNull();

    const oversized = path.join(activeDir, 'task_oversized-large.md');
    await writeFile(oversized, '', 'utf8');
    await truncate(oversized, 16 * 1024 * 1024 + 1);
    await expect(repository.findActiveById('task_oversized')).rejects.toThrow(
      /bounded regular file/
    );
    await expect(repository.listActive()).resolves.toEqual([]);
  });
});
