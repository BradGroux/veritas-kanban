/**
 * Blocking Service Tests
 * Tests task blocking/dependency logic including circular dependency detection.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { BlockingService } from '../services/blocking-service.js';
import type { Task } from '@veritas-kanban/shared';

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task_20260128_test01',
    title: 'Test Task',
    status: 'todo',
    priority: 'medium',
    created: '2026-01-28T00:00:00Z',
    updated: '2026-01-28T00:00:00Z',
    ...overrides,
  } as Task;
}

describe('BlockingService', () => {
  let service: BlockingService;

  beforeEach(() => {
    service = new BlockingService();
  });

  describe('getBlockingStatus', () => {
    it('should return not blocked when task has no blockers', () => {
      const task = makeTask();
      const result = service.getBlockingStatus(task, []);
      expect(result.isBlocked).toBe(false);
      expect(result.blockers).toEqual([]);
      expect(result.completedBlockers).toEqual([]);
    });

    it('should return blocked when blockers are incomplete', () => {
      const blocker = makeTask({ id: 'task_20260128_block1', title: 'Blocker', status: 'in-progress' });
      const task = makeTask({ blockedBy: ['task_20260128_block1'] });
      const result = service.getBlockingStatus(task, [blocker, task]);
      expect(result.isBlocked).toBe(true);
      expect(result.blockers).toHaveLength(1);
      expect(result.blockers[0].id).toBe('task_20260128_block1');
      expect(result.blockers[0].status).toBe('in-progress');
    });

    it('should return not blocked when all blockers are done', () => {
      const blocker = makeTask({ id: 'task_20260128_block1', title: 'Blocker', status: 'done' });
      const task = makeTask({ blockedBy: ['task_20260128_block1'] });
      const result = service.getBlockingStatus(task, [blocker, task]);
      expect(result.isBlocked).toBe(false);
      expect(result.completedBlockers).toHaveLength(1);
    });

    it('should separate incomplete and completed blockers', () => {
      const done = makeTask({ id: 'task_20260128_done1', title: 'Done', status: 'done' });
      const wip = makeTask({ id: 'task_20260128_wip1', title: 'WIP', status: 'in-progress' });
      const task = makeTask({ blockedBy: ['task_20260128_done1', 'task_20260128_wip1'] });
      const result = service.getBlockingStatus(task, [done, wip, task]);
      expect(result.isBlocked).toBe(true);
      expect(result.blockers).toHaveLength(1);
      expect(result.completedBlockers).toHaveLength(1);
    });
  });

  describe('canMoveToInProgress', () => {
    it('should allow when no blockers', () => {
      const task = makeTask();
      const result = service.canMoveToInProgress(task, []);
      expect(result.allowed).toBe(true);
    });

    it('should allow when all blockers are done', () => {
      const blocker = makeTask({ id: 'task_20260128_b1', status: 'done' });
      const task = makeTask({ blockedBy: ['task_20260128_b1'] });
      const result = service.canMoveToInProgress(task, [blocker]);
      expect(result.allowed).toBe(true);
    });

    it('should deny when blockers are incomplete', () => {
      const blocker = makeTask({ id: 'task_20260128_b1', title: 'Blocker', status: 'todo' });
      const task = makeTask({ blockedBy: ['task_20260128_b1'] });
      const result = service.canMoveToInProgress(task, [blocker]);
      expect(result.allowed).toBe(false);
      expect(result.blockers).toHaveLength(1);
    });
  });

  describe('getDependentTasks', () => {
    it('should return tasks that depend on a given task', () => {
      const task1 = makeTask({ id: 'task_20260128_t1' });
      const task2 = makeTask({ id: 'task_20260128_t2', blockedBy: ['task_20260128_t1'] });
      const task3 = makeTask({ id: 'task_20260128_t3', blockedBy: ['task_20260128_t1'] });
      const task4 = makeTask({ id: 'task_20260128_t4' });

      const result = service.getDependentTasks('task_20260128_t1', [task1, task2, task3, task4]);
      expect(result).toHaveLength(2);
      expect(result.map(t => t.id)).toContain('task_20260128_t2');
      expect(result.map(t => t.id)).toContain('task_20260128_t3');
    });

    it('should return empty array when no dependents', () => {
      const task = makeTask({ id: 'task_20260128_t1' });
      const result = service.getDependentTasks('task_20260128_t1', [task]);
      expect(result).toEqual([]);
    });
  });

  describe('getTasksThatWouldBeUnblocked', () => {
    it('should return tasks that would be unblocked', () => {
      const t1 = makeTask({ id: 'task_20260128_t1', status: 'in-progress' });
      const t2 = makeTask({ id: 'task_20260128_t2', blockedBy: ['task_20260128_t1'] });
      const result = service.getTasksThatWouldBeUnblocked('task_20260128_t1', [t1, t2]);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('task_20260128_t2');
    });

    it('should not return tasks with other incomplete blockers', () => {
      const t1 = makeTask({ id: 'task_20260128_t1', status: 'in-progress' });
      const t2 = makeTask({ id: 'task_20260128_t2', status: 'todo' });
      const t3 = makeTask({ id: 'task_20260128_t3', blockedBy: ['task_20260128_t1', 'task_20260128_t2'] });
      const result = service.getTasksThatWouldBeUnblocked('task_20260128_t1', [t1, t2, t3]);
      expect(result).toHaveLength(0);
    });

    it('should return tasks when remaining blockers are all done', () => {
      const t1 = makeTask({ id: 'task_20260128_t1', status: 'in-progress' });
      const t2 = makeTask({ id: 'task_20260128_t2', status: 'done' });
      const t3 = makeTask({ id: 'task_20260128_t3', blockedBy: ['task_20260128_t1', 'task_20260128_t2'] });
      const result = service.getTasksThatWouldBeUnblocked('task_20260128_t1', [t1, t2, t3]);
      expect(result).toHaveLength(1);
    });
  });

  describe('wouldCreateCircularDependency', () => {
    it('should detect direct circular dependency', () => {
      const t1 = makeTask({ id: 'task_20260128_t1', blockedBy: ['task_20260128_t2'] });
      const t2 = makeTask({ id: 'task_20260128_t2' });
      // Adding t1 as blocker to t2 would create: t1 -> t2 -> t1
      const result = service.wouldCreateCircularDependency('task_20260128_t2', 'task_20260128_t1', [t1, t2]);
      expect(result).toBe(true);
    });

    it('should detect transitive circular dependency', () => {
      const t1 = makeTask({ id: 'task_20260128_t1', blockedBy: ['task_20260128_t3'] });
      const t2 = makeTask({ id: 'task_20260128_t2', blockedBy: ['task_20260128_t1'] });
      const t3 = makeTask({ id: 'task_20260128_t3' });
      // Adding t2 as blocker to t3 would create: t1 -> t3 -> t2 -> t1
      const result = service.wouldCreateCircularDependency('task_20260128_t3', 'task_20260128_t2', [t1, t2, t3]);
      expect(result).toBe(true);
    });

    it('should return false when no circular dependency', () => {
      const t1 = makeTask({ id: 'task_20260128_t1' });
      const t2 = makeTask({ id: 'task_20260128_t2' });
      const t3 = makeTask({ id: 'task_20260128_t3' });
      const result = service.wouldCreateCircularDependency('task_20260128_t1', 'task_20260128_t2', [t1, t2, t3]);
      expect(result).toBe(false);
    });

    it('should handle self-reference', () => {
      const t1 = makeTask({ id: 'task_20260128_t1' });
      const result = service.wouldCreateCircularDependency('task_20260128_t1', 'task_20260128_t1', [t1]);
      expect(result).toBe(true);
    });
  });
});
