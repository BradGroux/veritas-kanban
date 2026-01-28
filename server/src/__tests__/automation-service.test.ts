/**
 * AutomationService Tests
 * Tests automation task filtering, validation, and lifecycle logic.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { AutomationService, getAutomationService } from '../services/automation-service.js';
import type { Task } from '@veritas-kanban/shared';

describe('AutomationService', () => {
  let service: AutomationService;

  beforeEach(() => {
    service = new AutomationService();
  });

  // Helper to create mock tasks
  function mockTask(overrides: Partial<Task>): Task {
    return {
      id: 'task_test',
      title: 'Test Task',
      description: '',
      status: 'todo',
      priority: 'medium',
      type: 'automation',
      created: '2024-01-01T00:00:00Z',
      updated: '2024-01-01T00:00:00Z',
      ...overrides,
    } as Task;
  }

  describe('getPendingTasks()', () => {
    it('should find automation tasks in todo status', () => {
      const tasks = [
        mockTask({ id: 't1', status: 'todo', type: 'automation' }),
        mockTask({ id: 't2', status: 'in-progress', type: 'automation' }),
        mockTask({ id: 't3', status: 'todo', type: 'code' }),
      ];

      const pending = service.getPendingTasks(tasks);
      expect(pending).toHaveLength(1);
      expect(pending[0].id).toBe('t1');
    });

    it('should find failed veritas attempts that need retry', () => {
      const tasks = [
        mockTask({
          id: 't1',
          status: 'blocked',
          type: 'automation',
          attempt: { id: 'a1', agent: 'veritas', status: 'failed' },
        }),
      ];

      const pending = service.getPendingTasks(tasks);
      expect(pending).toHaveLength(1);
    });

    it('should not include non-automation tasks', () => {
      const tasks = [
        mockTask({ id: 't1', status: 'todo', type: 'code' }),
        mockTask({ id: 't2', status: 'todo', type: 'research' }),
      ];

      expect(service.getPendingTasks(tasks)).toHaveLength(0);
    });
  });

  describe('getRunningTasks()', () => {
    it('should find running automation tasks', () => {
      const tasks = [
        mockTask({
          id: 't1',
          type: 'automation',
          attempt: { id: 'a1', agent: 'veritas', status: 'running' },
        }),
        mockTask({
          id: 't2',
          type: 'automation',
          attempt: { id: 'a2', agent: 'claude-code', status: 'running' },
        }),
      ];

      const running = service.getRunningTasks(tasks);
      expect(running).toHaveLength(1);
      expect(running[0].id).toBe('t1');
    });

    it('should return empty when no running tasks', () => {
      const tasks = [
        mockTask({ id: 't1', type: 'automation', status: 'todo' }),
      ];
      expect(service.getRunningTasks(tasks)).toHaveLength(0);
    });
  });

  describe('getFailedTasks()', () => {
    it('should find failed automation tasks', () => {
      const tasks = [
        mockTask({
          id: 't1',
          type: 'automation',
          status: 'blocked',
          attempt: { id: 'a1', agent: 'veritas', status: 'failed' },
        }),
        mockTask({
          id: 't2',
          type: 'automation',
          status: 'done',
          attempt: { id: 'a2', agent: 'veritas', status: 'failed' },
        }),
      ];

      const failed = service.getFailedTasks(tasks);
      expect(failed).toHaveLength(1);
      expect(failed[0].id).toBe('t1');
    });
  });

  describe('filterTasks()', () => {
    const tasks = [
      mockTask({ id: 'pending', status: 'todo', type: 'automation' }),
      mockTask({
        id: 'running',
        type: 'automation',
        attempt: { id: 'a1', agent: 'veritas', status: 'running' },
      }),
      mockTask({
        id: 'failed',
        type: 'automation',
        status: 'blocked',
        attempt: { id: 'a2', agent: 'veritas', status: 'failed' },
      }),
    ];

    it('should filter by pending', () => {
      const result = service.filterTasks(tasks, { pending: true });
      expect(result.some(t => t.id === 'pending')).toBe(true);
    });

    it('should filter by running', () => {
      const result = service.filterTasks(tasks, { running: true });
      expect(result.some(t => t.id === 'running')).toBe(true);
    });

    it('should filter by failed', () => {
      const result = service.filterTasks(tasks, { failed: true });
      expect(result.some(t => t.id === 'failed')).toBe(true);
    });

    it('should combine filters and deduplicate', () => {
      // failed task also appears in pending (blocked + veritas + failed)
      const result = service.filterTasks(tasks, { pending: true, failed: true });
      const ids = result.map(t => t.id);
      // Should not have duplicates
      expect(new Set(ids).size).toBe(ids.length);
    });
  });

  describe('validateCanStart()', () => {
    it('should validate automation tasks', () => {
      const task = mockTask({ type: 'automation' });
      expect(service.validateCanStart(task)).toEqual({ valid: true });
    });

    it('should reject non-automation tasks', () => {
      const task = mockTask({ type: 'code' });
      const result = service.validateCanStart(task);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('automation');
    });
  });

  describe('getStartPayload()', () => {
    it('should generate start payload with attempt and automation', () => {
      const payload = service.getStartPayload('session-key-123');
      expect(payload.status).toBe('in-progress');
      expect(payload.attempt).toBeDefined();
      expect(payload.attempt!.agent).toBe('veritas');
      expect(payload.attempt!.status).toBe('running');
      expect(payload.attempt!.id).toMatch(/^attempt_/);
      expect(payload.automation!.sessionKey).toBe('session-key-123');
      expect(payload.automation!.spawnedAt).toBeDefined();
    });

    it('should work without session key', () => {
      const payload = service.getStartPayload();
      expect(payload.automation!.sessionKey).toBeUndefined();
    });
  });

  describe('buildStartResult()', () => {
    it('should build result from task and attempt id', () => {
      const task = mockTask({
        id: 'task_123',
        title: 'Auto Task',
        description: 'desc',
        project: 'proj',
        automation: { sessionKey: 'sk', spawnedAt: '2024-01-01' },
      });

      const result = service.buildStartResult(task, 'attempt_abc');
      expect(result.taskId).toBe('task_123');
      expect(result.attemptId).toBe('attempt_abc');
      expect(result.title).toBe('Auto Task');
      expect(result.project).toBe('proj');
    });
  });

  describe('validateCanComplete()', () => {
    it('should validate tasks with active veritas attempt', () => {
      const task = mockTask({
        attempt: { id: 'a1', agent: 'veritas', status: 'running' },
      });
      expect(service.validateCanComplete(task)).toEqual({ valid: true });
    });

    it('should reject tasks without veritas attempt', () => {
      const task = mockTask({
        attempt: { id: 'a1', agent: 'claude-code', status: 'running' },
      });
      const result = service.validateCanComplete(task);
      expect(result.valid).toBe(false);
    });

    it('should reject tasks without any attempt', () => {
      const task = mockTask({});
      const result = service.validateCanComplete(task);
      expect(result.valid).toBe(false);
    });
  });

  describe('getCompletePayload()', () => {
    it('should generate success completion payload', () => {
      const attempt = { id: 'a1', agent: 'veritas' as const, status: 'running' as const };
      const automation = { sessionKey: 'sk', spawnedAt: '2024-01-01' };

      const payload = service.getCompletePayload(attempt, automation, 'All good', 'complete');
      expect(payload.status).toBe('done');
      expect(payload.attempt!.status).toBe('complete');
      expect(payload.attempt!.ended).toBeDefined();
      expect(payload.automation!.result).toBe('All good');
      expect(payload.automation!.completedAt).toBeDefined();
    });

    it('should generate failure completion payload', () => {
      const attempt = { id: 'a1', agent: 'veritas' as const, status: 'running' as const };
      const payload = service.getCompletePayload(attempt, undefined, 'Error occurred', 'failed');
      expect(payload.status).toBe('blocked');
      expect(payload.attempt!.status).toBe('failed');
    });
  });

  describe('buildCompleteResult()', () => {
    it('should build complete result', () => {
      const task = mockTask({ id: 'task_xyz', automation: { completedAt: '2024-01-01' } });
      const result = service.buildCompleteResult(task, 'complete');
      expect(result.taskId).toBe('task_xyz');
      expect(result.status).toBe('complete');
    });
  });

  describe('getAutomationService()', () => {
    it('should return singleton instance', () => {
      const s1 = getAutomationService();
      const s2 = getAutomationService();
      expect(s1).toBe(s2);
    });
  });
});
