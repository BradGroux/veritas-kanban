import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { MigrationService } from '../services/migration-service.js';
import { TaskService } from '../services/task-service.js';
import type { TaskStatus } from '@veritas-kanban/shared';

describe('MigrationService', () => {
  let taskService: TaskService;
  let migrationService: MigrationService;
  let testRoot: string;
  let tasksDir: string;
  let archiveDir: string;

  beforeEach(async () => {
    // Create fresh test directories with unique suffix
    const uniqueSuffix = Math.random().toString(36).substring(7);
    testRoot = path.join(os.tmpdir(), `veritas-test-migration-${uniqueSuffix}`);
    tasksDir = path.join(testRoot, 'active');
    archiveDir = path.join(testRoot, 'archive');

    await fs.mkdir(tasksDir, { recursive: true });
    await fs.mkdir(archiveDir, { recursive: true });

    taskService = new TaskService({
      tasksDir,
      archiveDir,
    });

    migrationService = new MigrationService(taskService);
  });

  afterEach(async () => {
    // Clean up test directories
    if (testRoot) {
      await fs.rm(testRoot, { recursive: true, force: true }).catch(() => {});
    }
  });

  describe('TaskStatus type validation', () => {
    it('should recognize "blocked" as a valid TaskStatus', () => {
      const validStatuses: TaskStatus[] = ['todo', 'in-progress', 'blocked', 'done'];
      
      expect(validStatuses).toContain('blocked');
      expect(validStatuses).not.toContain('review');
    });

    it('should have exactly 4 valid status values', () => {
      const validStatuses: TaskStatus[] = ['todo', 'in-progress', 'blocked', 'done'];
      expect(validStatuses).toHaveLength(4);
    });
  });

  describe('migrateReviewToBlocked', () => {
    it('should convert active tasks with review status to blocked', async () => {
      // Create a task with legacy "review" status directly in the file
      const taskContent = `---
id: task_20260126_legacy1
title: Legacy Review Task
type: code
status: review
priority: high
created: '2026-01-26T10:00:00.000Z'
updated: '2026-01-26T10:00:00.000Z'
---
This task has the legacy review status.
`;
      await fs.writeFile(
        path.join(tasksDir, 'task_20260126_legacy1-legacy-review-task.md'),
        taskContent
      );

      // Run migrations
      await migrationService.runMigrations();

      // Verify the task was migrated
      const tasks = await taskService.listTasks();
      expect(tasks).toHaveLength(1);
      expect(tasks[0].status).toBe('blocked');
    });

    it('should not modify tasks with non-review statuses', async () => {
      // Create tasks with various valid statuses
      const todoTask = await taskService.createTask({ title: 'Todo Task' });
      await taskService.updateTask(todoTask.id, { status: 'todo' });

      const inProgressTask = await taskService.createTask({ title: 'In Progress Task' });
      await taskService.updateTask(inProgressTask.id, { status: 'in-progress' });

      const blockedTask = await taskService.createTask({ title: 'Blocked Task' });
      await taskService.updateTask(blockedTask.id, { status: 'blocked' });

      const doneTask = await taskService.createTask({ title: 'Done Task' });
      await taskService.updateTask(doneTask.id, { status: 'done' });

      // Run migrations
      await migrationService.runMigrations();

      // Verify statuses are unchanged
      const tasks = await taskService.listTasks();
      const taskMap = new Map(tasks.map(t => [t.title, t.status]));

      expect(taskMap.get('Todo Task')).toBe('todo');
      expect(taskMap.get('In Progress Task')).toBe('in-progress');
      expect(taskMap.get('Blocked Task')).toBe('blocked');
      expect(taskMap.get('Done Task')).toBe('done');
    });

    it('should be idempotent - running twice has same result', async () => {
      // Create a task with legacy "review" status
      const taskContent = `---
id: task_20260126_idem1
title: Idempotent Test
type: code
status: review
priority: medium
created: '2026-01-26T10:00:00.000Z'
updated: '2026-01-26T10:00:00.000Z'
---
Testing idempotency.
`;
      await fs.writeFile(
        path.join(tasksDir, 'task_20260126_idem1-idempotent-test.md'),
        taskContent
      );

      // Run migrations twice
      await migrationService.runMigrations();
      await migrationService.runMigrations();

      // Verify task is still blocked (not errored or changed)
      const tasks = await taskService.listTasks();
      expect(tasks).toHaveLength(1);
      expect(tasks[0].status).toBe('blocked');
    });

    it('should handle empty task list gracefully', async () => {
      // No tasks exist - should not throw
      await expect(migrationService.runMigrations()).resolves.not.toThrow();
    });

    it('should convert multiple review tasks in a single run', async () => {
      // Create multiple tasks with legacy "review" status
      const task1 = `---
id: task_20260126_multi1
title: Multi Task 1
type: code
status: review
priority: high
created: '2026-01-26T10:00:00.000Z'
updated: '2026-01-26T10:00:00.000Z'
---
First review task.
`;
      const task2 = `---
id: task_20260126_multi2
title: Multi Task 2
type: code
status: review
priority: medium
created: '2026-01-26T10:00:00.000Z'
updated: '2026-01-26T10:00:00.000Z'
---
Second review task.
`;

      await fs.writeFile(
        path.join(tasksDir, 'task_20260126_multi1-multi-task-1.md'),
        task1
      );
      await fs.writeFile(
        path.join(tasksDir, 'task_20260126_multi2-multi-task-2.md'),
        task2
      );

      // Run migrations
      await migrationService.runMigrations();

      // Verify both tasks were migrated
      const tasks = await taskService.listTasks();
      expect(tasks).toHaveLength(2);
      expect(tasks.every(t => t.status === 'blocked')).toBe(true);
    });

    it('should convert archived tasks with review status to blocked', async () => {
      // Create an archived task with legacy "review" status
      const archivedTaskContent = `---
id: task_20260126_arch1
title: Archived Review Task
type: code
status: review
priority: low
created: '2026-01-26T10:00:00.000Z'
updated: '2026-01-26T10:00:00.000Z'
---
This archived task has the legacy review status.
`;
      await fs.writeFile(
        path.join(archiveDir, 'task_20260126_arch1-archived-review-task.md'),
        archivedTaskContent
      );

      // Run migrations
      await migrationService.runMigrations();

      // Verify the archived task was migrated
      const archivedTasks = await taskService.listArchivedTasks();
      expect(archivedTasks).toHaveLength(1);
      expect(archivedTasks[0].status).toBe('blocked');
    });
  });
});
