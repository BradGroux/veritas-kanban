/**
 * Changes Service Tests
 * Tests the efficient polling endpoint for agents.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { ChangesService } from '../services/changes-service.js';
import { getTaskService } from '../services/task-service.js';
import { activityService } from '../services/activity-service.js';
import type { CreateTaskInput } from '@veritas-kanban/shared';

describe('ChangesService', () => {
  let service: ChangesService;
  let taskService: ReturnType<typeof getTaskService>;

  beforeEach(() => {
    service = new ChangesService();
    taskService = getTaskService();
  });

  describe('getChangesSince', () => {
    it('should return empty changes when no data exists', async () => {
      // Use a future timestamp - should return no tasks created/updated after now
      const futureDate = new Date(Date.now() + 3600 * 1000).toISOString(); // 1 hour in future
      const result = await service.getChangesSince({ since: futureDate });

      expect(result.since).toBe(futureDate);
      expect(result.until).toBeDefined();
      expect(result.changes.tasks.created).toEqual([]);
      expect(result.changes.tasks.updated).toEqual([]);
      expect(result.changes.comments).toEqual([]);
      expect(result.changes.broadcasts).toEqual([]);
      expect(result.summary.totalChanges).toBe(0);
    });

    it('should detect newly created tasks', async () => {
      const beforeCreate = new Date().toISOString();
      await new Promise((resolve) => setTimeout(resolve, 10)); // Small delay to ensure timestamp differs

      const input: CreateTaskInput = {
        title: 'Test Task',
        description: 'Test description',
        type: 'code',
        priority: 'high',
      };
      const task = await taskService.createTask(input);

      const result = await service.getChangesSince({ since: beforeCreate });

      expect(result.changes.tasks.created).toHaveLength(1);
      expect(result.changes.tasks.created[0].id).toBe(task.id);
      expect(result.changes.tasks.updated).toEqual([]);
      expect(result.summary.breakdown['tasks.created']).toBe(1);
      expect(result.summary.breakdown['tasks.updated']).toBe(0);
      expect(result.summary.totalChanges).toBeGreaterThan(0);
    });

    it('should detect updated tasks', async () => {
      // Create a task first
      const input: CreateTaskInput = {
        title: 'Test Task',
        description: 'Test description',
        type: 'code',
        priority: 'high',
      };
      const task = await taskService.createTask(input);

      // Wait and mark timestamp before update
      await new Promise((resolve) => setTimeout(resolve, 10));
      const beforeUpdate = new Date().toISOString();
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Update the task
      await taskService.updateTask(task.id, { status: 'in-progress' });

      const result = await service.getChangesSince({ since: beforeUpdate });

      expect(result.changes.tasks.created).toEqual([]);
      expect(result.changes.tasks.updated).toHaveLength(1);
      expect(result.changes.tasks.updated[0].id).toBe(task.id);
      expect(result.summary.breakdown['tasks.updated']).toBe(1);
    });

    it('should filter by requested types', async () => {
      const beforeCreate = new Date().toISOString();
      await new Promise((resolve) => setTimeout(resolve, 10));

      const input: CreateTaskInput = {
        title: 'Test Task',
        description: 'Test description',
        type: 'code',
        priority: 'high',
      };
      await taskService.createTask(input);

      // Request only activity changes
      const result = await service.getChangesSince({
        since: beforeCreate,
        types: 'activity',
      });

      // Tasks should not be included
      expect(result.changes.tasks.created).toEqual([]);
      expect(result.changes.tasks.updated).toEqual([]);
      expect(result.summary.breakdown['tasks.created']).toBeUndefined();
    });

    it('should detect activity changes', async () => {
      const beforeActivity = new Date().toISOString();
      await new Promise((resolve) => setTimeout(resolve, 10));

      await activityService.logActivity('task_created', 'task_test_123', 'Test Activity', {
        type: 'code',
      });

      const result = await service.getChangesSince({
        since: beforeActivity,
        types: 'activity',
      });

      expect(result.changes.activity.length).toBeGreaterThan(0);
      expect(result.summary.breakdown['activity']).toBeGreaterThan(0);
    });

    it('should return valid ISO timestamps', async () => {
      const sinceDate = new Date(Date.now() - 3600 * 1000).toISOString();
      const result = await service.getChangesSince({ since: sinceDate });

      expect(result.since).toBe(sinceDate);
      expect(() => new Date(result.until)).not.toThrow();
      expect(new Date(result.until).getTime()).toBeGreaterThanOrEqual(
        new Date(sinceDate).getTime()
      );
    });

    it('should handle multiple change types', async () => {
      const beforeChanges = new Date().toISOString();
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Create a task
      const input: CreateTaskInput = {
        title: 'Test Task',
        description: 'Test description',
        type: 'code',
        priority: 'high',
      };
      await taskService.createTask(input);

      // Log activity
      await activityService.logActivity('task_created', 'task_test_123', 'Test Activity');

      const result = await service.getChangesSince({
        since: beforeChanges,
        types: 'tasks,activity',
      });

      expect(result.changes.tasks.created.length).toBeGreaterThan(0);
      expect(result.changes.activity.length).toBeGreaterThan(0);
      expect(result.summary.totalChanges).toBeGreaterThan(1);
    });
  });
});
