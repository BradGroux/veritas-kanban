import { describe, expect, it } from 'vitest';
import type { Task } from '@veritas-kanban/shared';
import { createTestSqliteDatabase } from '../../storage/sqlite/test-helpers.js';
import { SqliteTaskRepository } from '../../storage/sqlite/task-repository.js';

function makeTask(overrides: Partial<Task> = {}): Task {
  const now = new Date().toISOString();
  return {
    id: `task_20260530_${Math.random().toString(36).slice(2, 8)}`,
    title: 'SQLite Task',
    description: 'Persisted in SQLite',
    type: 'code',
    status: 'todo',
    priority: 'medium',
    created: now,
    updated: now,
    ...overrides,
  };
}

describe('SqliteTaskRepository', () => {
  it('persists and reads full task JSON with indexed fields', async () => {
    const fixture = createTestSqliteDatabase();
    const task = makeTask({
      title: 'Full fidelity task',
      description: 'Includes nested task details',
      project: 'veritas',
      sprint: 'v5',
      github: { issueNumber: 330, repo: 'BradGroux/veritas-kanban' },
      subtasks: [
        {
          id: 'subtask-1',
          title: 'Wire repository',
          completed: false,
          created: new Date().toISOString(),
          acceptanceCriteria: ['CRUD works'],
          criteriaChecked: [false],
        },
      ],
      comments: [
        {
          id: 'comment-1',
          author: 'tester',
          text: 'Preserve comments',
          timestamp: new Date().toISOString(),
        },
      ],
      observations: [
        {
          id: 'observation-1',
          type: 'decision',
          content: 'Use JSON payload plus indexed columns',
          score: 8,
          timestamp: new Date().toISOString(),
        },
      ],
      deliverables: [
        {
          id: 'deliverable-1',
          title: 'Patch',
          type: 'code',
          status: 'attached',
          created: new Date().toISOString(),
        },
      ],
      verificationSteps: [
        {
          id: 'verify-1',
          description: 'Run tests',
          checked: false,
        },
      ],
      timeTracking: {
        entries: [],
        totalSeconds: 120,
        isRunning: false,
      },
      position: 3,
    });

    try {
      fixture.database.open();
      const repo = new SqliteTaskRepository(fixture.database);

      await repo.create(task);

      expect(await repo.findById(task.id)).toEqual(task);
      expect(await repo.findAll()).toEqual([task]);
    } finally {
      fixture.cleanup();
    }
  });

  it('updates, archives, restores, and deletes active tasks without file moves', async () => {
    const fixture = createTestSqliteDatabase();
    const task = makeTask({ title: 'Lifecycle task' });

    try {
      fixture.database.open();
      const repo = new SqliteTaskRepository(fixture.database);

      await repo.create(task);
      const updated = await repo.update(task.id, { title: 'Updated lifecycle task', position: 1 });

      expect(updated.title).toBe('Updated lifecycle task');
      expect(updated.position).toBe(1);

      expect(await repo.archive(task.id)).toBe(true);
      expect(await repo.findById(task.id)).toBeNull();
      expect((await repo.listArchived()).map((archived) => archived.id)).toEqual([task.id]);

      const restored = await repo.restore(task.id);
      expect(restored?.status).toBe('done');
      expect(await repo.findArchivedById(task.id)).toBeNull();
      expect(await repo.findById(task.id)).toEqual(restored);

      await repo.delete(task.id);
      expect(await repo.findById(task.id)).toBeNull();
    } finally {
      fixture.cleanup();
    }
  });

  it('uses FTS-backed search for active task title and description', async () => {
    const fixture = createTestSqliteDatabase();

    try {
      fixture.database.open();
      const repo = new SqliteTaskRepository(fixture.database);

      const matching = makeTask({
        title: 'FTS search target',
        description: 'Contains the uncommon persistence-token phrase',
      });
      const nonMatching = makeTask({
        title: 'Different task',
        description: 'No matching content',
      });

      await repo.create(matching);
      await repo.create(nonMatching);

      const results = await repo.search('persistence-token');

      expect(results.map((task) => task.id)).toEqual([matching.id]);
    } finally {
      fixture.cleanup();
    }
  });
});
