import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { TaskService } from '../services/task-service.js';
import { TelemetryService } from '../services/telemetry-service.js';
import {
  createTestSqliteDatabase,
  type TestSqliteDatabase,
} from '../storage/sqlite/test-helpers.js';

describe('TaskService SQLite mode', () => {
  let fixture: TestSqliteDatabase;
  let service: TaskService;
  let testRoot: string;
  let tasksDir: string;
  let archiveDir: string;

  beforeEach(async () => {
    fixture = createTestSqliteDatabase();
    testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'veritas-task-service-sqlite-'));
    tasksDir = path.join(testRoot, 'tasks', 'active');
    archiveDir = path.join(testRoot, 'tasks', 'archive');

    service = new TaskService({
      storageType: 'sqlite',
      sqliteDatabase: fixture.database,
      tasksDir,
      archiveDir,
      telemetryService: new TelemetryService({
        telemetryDir: path.join(testRoot, 'telemetry'),
        config: { enabled: false },
      }),
    });
  });

  afterEach(async () => {
    service.dispose();
    fixture.cleanup();
    await fs.rm(testRoot, { recursive: true, force: true }).catch(() => {});
  });

  it('creates, lists, updates, and reorders tasks through SQLite persistence', async () => {
    const first = await service.createTask({
      title: 'First SQLite task',
      description: 'Stored in sqlite',
      type: 'feature',
      priority: 'high',
      project: 'veritas',
      sprint: 'v5',
    });
    const second = await service.createTask({ title: 'Second SQLite task' });

    const updated = await service.updateTask(first.id, {
      title: 'Updated SQLite task',
      position: 9,
      comments: [
        {
          id: 'comment-1',
          author: 'tester',
          text: 'SQLite comment',
          timestamp: new Date().toISOString(),
        },
      ],
    });

    expect(updated?.title).toBe('Updated SQLite task');
    expect(updated?.comments?.[0]?.text).toBe('SQLite comment');

    const reordered = await service.reorderTasks([second.id, first.id]);
    expect(reordered).toHaveLength(2);

    const tasks = await service.listTasks();
    expect(tasks.map((task) => task.id).sort()).toEqual([first.id, second.id].sort());

    await expect(fs.readdir(tasksDir)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('archives, lists archived tasks, restores, and deletes without task files', async () => {
    const task = await service.createTask({ title: 'Archive SQLite task' });
    const deletedAt = new Date().toISOString();
    const purgeAfter = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    expect(
      await service.archiveTask(task.id, {
        deletedAt,
        deletedBy: 'service:test',
        purgeAfter,
      })
    ).toBe(true);
    expect(await service.getTask(task.id)).toBeNull();

    const archived = await service.listArchivedTasks();
    expect(archived.map((archivedTask) => archivedTask.id)).toEqual([task.id]);
    expect(archived[0]).toMatchObject({ deletedAt, deletedBy: 'service:test', purgeAfter });

    const restored = await service.restoreTask(task.id);
    expect(restored?.id).toBe(task.id);
    expect(restored?.status).toBe('done');
    expect(restored?.deletedAt).toBeUndefined();
    expect(restored?.deletedBy).toBeUndefined();
    expect(restored?.purgeAfter).toBeUndefined();
    expect(await service.listArchivedTasks()).toEqual([]);

    expect(await service.deleteTask(task.id)).toBe(true);
    expect(await service.getTask(task.id)).toBeNull();
    await expect(fs.readdir(archiveDir)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('enforces expired and invalid restore windows in SQLite mode', async () => {
    const expired = await service.createTask({ title: 'Expired SQLite restore' });
    expect(
      await service.archiveTask(expired.id, {
        deletedAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString(),
        deletedBy: 'service:test',
        purgeAfter: new Date(Date.now() - 1000).toISOString(),
      })
    ).toBe(true);
    expect(await service.restoreTask(expired.id)).toBeNull();

    const invalid = await service.createTask({ title: 'Invalid SQLite restore' });
    expect(
      await service.archiveTask(invalid.id, {
        deletedAt: new Date().toISOString(),
        deletedBy: 'service:test',
        purgeAfter: 'not-a-date',
      })
    ).toBe(true);
    expect(await service.restoreTask(invalid.id)).toBeNull();
  });
});
