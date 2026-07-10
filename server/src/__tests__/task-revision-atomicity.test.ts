/**
 * Tests for atomic revision validation in updateTask (#777)
 *
 * Verifies that:
 * - Two concurrent requests with the same revision produce one success and one conflict.
 * - Revision comparison happens inside the mutation lock (not just at route level).
 * - Non-conflicting updates with no revision precondition succeed normally.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { TaskService } from '../services/task-service.js';
import { DEFAULT_FEATURE_SETTINGS } from '@veritas-kanban/shared';

describe('updateTask – revision atomicity (#777)', () => {
  let service: TaskService;
  let testRoot: string;
  let tasksDir: string;
  let archiveDir: string;

  beforeEach(async () => {
    const suffix = Math.random().toString(36).substring(7);
    testRoot = path.join(os.tmpdir(), `vk-revision-test-${suffix}`);
    tasksDir = path.join(testRoot, 'active');
    archiveDir = path.join(testRoot, 'archive');
    await fs.mkdir(tasksDir, { recursive: true });
    await fs.mkdir(archiveDir, { recursive: true });

    service = new TaskService({
      tasksDir,
      archiveDir,
      configService: { getFeatureSettings: async () => DEFAULT_FEATURE_SETTINGS },
    });
  });

  afterEach(async () => {
    service.dispose();
    await fs.rm(testRoot, { recursive: true, force: true }).catch(() => {});
  });

  it('concurrent updates with the same revision: one succeeds, one throws ConflictError', async () => {
    const task = await service.createTask({
      title: 'Concurrent Update Target',
      type: 'code',
      priority: 'medium',
    });

    const initialRevision = task.revision ?? 1;

    // Launch two concurrent updates both supplying the same expectedRevision
    const [result1, result2] = await Promise.allSettled([
      service.updateTask(task.id, {
        title: 'Update from A',
        expectedRevision: initialRevision,
      }),
      service.updateTask(task.id, {
        title: 'Update from B',
        expectedRevision: initialRevision,
      }),
    ]);

    const succeeded = [result1, result2].filter((r) => r.status === 'fulfilled');
    const failed = [result1, result2].filter((r) => r.status === 'rejected');

    // Exactly one must succeed
    expect(succeeded).toHaveLength(1);
    // Exactly one must fail with a conflict
    expect(failed).toHaveLength(1);
    const rejection = failed[0] as PromiseRejectedResult;
    expect(rejection.reason?.message).toMatch(/has changed since it was loaded/);
  });

  it('update without expectedRevision always succeeds (no precondition)', async () => {
    const task = await service.createTask({
      title: 'Unconditional Update Target',
      type: 'code',
      priority: 'low',
    });

    // No expectedRevision — should succeed regardless of concurrent writes
    const updated = await service.updateTask(task.id, { title: 'Renamed' });
    expect(updated?.title).toBe('Renamed');
  });

  it('update with correct revision succeeds and increments revision', async () => {
    const task = await service.createTask({
      title: 'Versioned Task',
      type: 'code',
      priority: 'high',
    });

    const updated = await service.updateTask(task.id, {
      title: 'Versioned Task v2',
      expectedRevision: task.revision ?? 1,
    });

    expect(updated?.title).toBe('Versioned Task v2');
    expect(updated?.revision).toBe((task.revision ?? 1) + 1);
  });

  it('update with stale revision rejects even when not concurrent', async () => {
    const task = await service.createTask({
      title: 'Stale Revision Target',
      type: 'code',
      priority: 'medium',
    });

    // First update moves the revision forward
    await service.updateTask(task.id, { title: 'First Update' });

    // Second update uses the original (now stale) revision
    await expect(
      service.updateTask(task.id, {
        title: 'Should Conflict',
        expectedRevision: task.revision ?? 1,
      })
    ).rejects.toThrow(/has changed since it was loaded/);
  });

  it('serializes same-task updates across slug changes without leaving stale files', async () => {
    const task = await service.createTask({
      title: 'Slug Queue Root',
      type: 'code',
      priority: 'medium',
    });

    await Promise.all([
      service.updateTask(task.id, { title: 'Slug Queue First' }),
      service.updateTask(task.id, { title: 'Slug Queue Final' }),
      service.updateTask(task.id, { status: 'in-progress' }),
    ]);

    const finalTask = await service.getTask(task.id);
    expect(finalTask?.title).toBe('Slug Queue Final');
    expect(finalTask?.status).toBe('in-progress');

    const taskFiles = (await fs.readdir(tasksDir)).filter((name) => name.startsWith(`${task.id}-`));
    expect(taskFiles).toHaveLength(1);
    expect(taskFiles[0]).toContain('slug-queue-final');
  });

  it('does not let an older finisher clear a newer queued waiter', async () => {
    const serviceAny = service as unknown as {
      withTaskMutex: (id: string, fn: () => Promise<void>) => Promise<void>;
    };
    const order: string[] = [];
    let releaseFirst!: () => void;
    let releaseSecond!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const secondGate = new Promise<void>((resolve) => {
      releaseSecond = resolve;
    });

    const first = serviceAny.withTaskMutex('task_waiter_cleanup', async () => {
      order.push('start-1');
      await firstGate;
      order.push('end-1');
    });
    const second = serviceAny.withTaskMutex('task_waiter_cleanup', async () => {
      order.push('start-2');
      await secondGate;
      order.push('end-2');
    });

    releaseFirst();

    for (let i = 0; i < 50 && !order.includes('start-2'); i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(order).toContain('start-2');

    const third = serviceAny.withTaskMutex('task_waiter_cleanup', async () => {
      order.push('start-3');
      order.push('end-3');
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(order).not.toContain('start-3');

    releaseSecond();
    await Promise.all([first, second, third]);

    expect(order).toEqual(['start-1', 'end-1', 'start-2', 'end-2', 'start-3', 'end-3']);
  });

  it.each(['deleteTask', 'archiveTask'] as const)(
    'serializes %s behind an existing task mutation',
    async (method) => {
      const task = await service.createTask({
        title: `Queued ${method}`,
        type: 'code',
        priority: 'medium',
      });
      const serviceAny = service as unknown as {
        withTaskMutex: (id: string, fn: () => Promise<void>) => Promise<void>;
      };
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const blocker = serviceAny.withTaskMutex(task.id, () => gate);
      let settled = false;

      const mutation = service[method](task.id).finally(() => {
        settled = true;
      });
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(settled).toBe(false);

      release();
      await blocker;
      await expect(mutation).resolves.toBe(true);
    }
  );

  it('serializes restoreTask behind an existing task mutation', async () => {
    const task = await service.createTask({
      title: 'Queued restore',
      type: 'code',
      priority: 'medium',
    });
    await service.archiveTask(task.id);

    const serviceAny = service as unknown as {
      withTaskMutex: (id: string, fn: () => Promise<void>) => Promise<void>;
    };
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const blocker = serviceAny.withTaskMutex(task.id, () => gate);
    let settled = false;

    const mutation = service.restoreTask(task.id).finally(() => {
      settled = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(settled).toBe(false);

    release();
    await blocker;
    await expect(mutation).resolves.toMatchObject({ id: task.id, status: 'done' });
  });

  it('preserves call order when archive and restore queue for the same task', async () => {
    const task = await service.createTask({
      title: 'Archive then restore',
      type: 'code',
      priority: 'medium',
    });
    const serviceAny = service as unknown as {
      withTaskMutex: (id: string, fn: () => Promise<void>) => Promise<void>;
    };
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const blocker = serviceAny.withTaskMutex(task.id, () => gate);

    const archive = service.archiveTask(task.id);
    const restore = service.restoreTask(task.id);
    release();
    await blocker;

    await expect(archive).resolves.toBe(true);
    await expect(restore).resolves.toMatchObject({ id: task.id, status: 'done' });
  });
});
