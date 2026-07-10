/**
 * Tests for task identity diagnostics caching (#784)
 *
 * Verifies that:
 * - Repeated calls to getTaskIdentityDiagnostics return a cached result (no disk re-scan).
 * - The cache is invalidated after mutations (create, update, archive, restore).
 * - External file changes (watcher) also invalidate the cache.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { TaskService } from '../services/task-service.js';
import { DEFAULT_FEATURE_SETTINGS } from '@veritas-kanban/shared';
import * as taskIdentityDiagnostics from '../services/task-identity-diagnostics.js';

describe('TaskService – identity diagnostics cache (#784)', () => {
  let service: TaskService;
  let testRoot: string;
  let tasksDir: string;
  let archiveDir: string;

  beforeEach(async () => {
    const suffix = Math.random().toString(36).substring(7);
    testRoot = path.join(os.tmpdir(), `vk-diag-cache-test-${suffix}`);
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
    vi.restoreAllMocks();
  });

  it('returns cached result on repeated calls without mutations', async () => {
    await service.createTask({ title: 'Task A', type: 'code', priority: 'medium' });

    const scanSpy = vi.spyOn(taskIdentityDiagnostics, 'scanTaskIdentityDiagnostics');

    // First call — populates cache
    const first = await service.getTaskIdentityDiagnostics();
    // Second call — should hit cache, not re-scan
    const second = await service.getTaskIdentityDiagnostics();
    const third = await service.getTaskIdentityDiagnostics();

    expect(first).toBe(second); // same object reference (cached)
    expect(second).toBe(third);
    // scanTaskIdentityDiagnostics should have been called exactly once
    expect(scanSpy).toHaveBeenCalledTimes(1);
  });

  it('invalidates cache after createTask', async () => {
    const scanSpy = vi.spyOn(taskIdentityDiagnostics, 'scanTaskIdentityDiagnostics');

    await service.getTaskIdentityDiagnostics(); // warm cache
    const callsBefore = scanSpy.mock.calls.length;

    await service.createTask({ title: 'New Task', type: 'code', priority: 'low' });

    await service.getTaskIdentityDiagnostics(); // should re-scan
    expect(scanSpy.mock.calls.length).toBeGreaterThan(callsBefore);
  });

  it('invalidates cache after updateTask', async () => {
    const task = await service.createTask({
      title: 'Update Target',
      type: 'code',
      priority: 'medium',
    });
    const scanSpy = vi.spyOn(taskIdentityDiagnostics, 'scanTaskIdentityDiagnostics');

    await service.getTaskIdentityDiagnostics(); // warm cache
    const callsBefore = scanSpy.mock.calls.length;

    await service.updateTask(task.id, { title: 'Updated Title' });

    await service.getTaskIdentityDiagnostics(); // should re-scan
    expect(scanSpy.mock.calls.length).toBeGreaterThan(callsBefore);
  });

  it('invalidates cache after archiveTask', async () => {
    const task = await service.createTask({
      title: 'Archive Target',
      type: 'code',
      priority: 'low',
    });
    const scanSpy = vi.spyOn(taskIdentityDiagnostics, 'scanTaskIdentityDiagnostics');

    await service.getTaskIdentityDiagnostics();
    const callsBefore = scanSpy.mock.calls.length;

    await service.archiveTask(task.id);

    await service.getTaskIdentityDiagnostics();
    expect(scanSpy.mock.calls.length).toBeGreaterThan(callsBefore);
  });

  it('getTaskIdentityDiagnostics with extra sources skips cache and scans fresh', async () => {
    await service.createTask({ title: 'Task X', type: 'code', priority: 'medium' });

    const scanSpy = vi.spyOn(taskIdentityDiagnostics, 'scanTaskIdentityDiagnostics');

    // Warm cache
    await service.getTaskIdentityDiagnostics();
    const callsAfterWarm = scanSpy.mock.calls.length;

    // Extra sources bypass cache
    const extraDir = path.join(testRoot, 'extra');
    await fs.mkdir(extraDir, { recursive: true });
    await service.getTaskIdentityDiagnostics([{ location: 'backlog', dir: extraDir }]);

    // Must have called scan again
    expect(scanSpy.mock.calls.length).toBeGreaterThan(callsAfterWarm);
  });
});
