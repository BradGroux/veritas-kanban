/**
 * Security hardening tests for #157 (agent ref validation) and #158 (unforgeable sync tokens)
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { TaskService } from '../services/task-service.js';
import {
  getAgentRegistryService,
  createTaskSyncToken,
  isValidSyncToken,
  type TaskSyncContext,
} from '../services/agent-registry-service.js';

describe('Security Hardening (#157 #158)', () => {
  let service: TaskService;
  let testRoot: string;
  let tasksDir: string;
  let archiveDir: string;

  beforeEach(async () => {
    const uniqueSuffix = Math.random().toString(36).substring(7);
    testRoot = path.join(os.tmpdir(), `veritas-test-security-${uniqueSuffix}`);
    tasksDir = path.join(testRoot, 'active');
    archiveDir = path.join(testRoot, 'archive');

    await fs.mkdir(tasksDir, { recursive: true });
    await fs.mkdir(archiveDir, { recursive: true });

    service = new TaskService({ tasksDir, archiveDir });

    // Register a valid agent for testing
    const registry = getAgentRegistryService();
    registry.register({
      id: 'test-agent',
      name: 'Test Agent',
      capabilities: [{ name: 'code' }],
    });
  });

  afterEach(async () => {
    service.dispose();
    const registry = getAgentRegistryService();
    registry.deregister('test-agent');
    await fs.rm(testRoot, { recursive: true, force: true }).catch(() => {});
  });

  // ─── #157: Validate task.agent against registry ───

  describe('#157 - agent ref validation on create/update', () => {
    it('should accept a valid registered agent ref on create', async () => {
      const task = await service.createTask({
        title: 'Valid agent task',
        agent: 'test-agent',
      } as any);
      expect(task.agent).toBe('test-agent');
    });

    it('should reject an unknown agent ref on create', async () => {
      await expect(
        service.createTask({
          title: 'Bad agent task',
          agent: 'nonexistent-agent',
        } as any)
      ).rejects.toThrow(/not found in registry/);
    });

    it('should reject a malformed agent ref on create', async () => {
      await expect(
        service.createTask({
          title: 'Malformed agent',
          agent: '<script>alert(1)</script>',
        } as any)
      ).rejects.toThrow(/Malformed agent ref/);
    });

    it('should allow task creation with no agent', async () => {
      const task = await service.createTask({ title: 'No agent task' });
      expect(task.id).toBeTruthy();
    });

    it('should reject unknown agent ref on update', async () => {
      const task = await service.createTask({ title: 'Update test' });
      await expect(service.updateTask(task.id, { agent: 'fake-agent' } as any)).rejects.toThrow(
        /not found in registry/
      );
    });

    it('should accept valid agent ref on update', async () => {
      const task = await service.createTask({ title: 'Update test valid' });
      const updated = await service.updateTask(task.id, { agent: 'test-agent' } as any);
      expect(updated?.agent).toBe('test-agent');
    });
  });

  // ─── #158: Unforgeable capability tokens ───

  describe('#158 - unforgeable sync capability tokens', () => {
    it('createTaskSyncToken produces a valid token', () => {
      const token = createTaskSyncToken('task-service');
      expect(isValidSyncToken(token)).toBe(true);
    });

    it('createTaskSyncToken is frozen (immutable)', () => {
      const token = createTaskSyncToken('task-service');
      expect(Object.isFrozen(token)).toBe(true);
    });

    it('hand-crafted string context is rejected', () => {
      const forged: TaskSyncContext = { source: 'task-service' };
      expect(isValidSyncToken(forged)).toBe(false);
    });

    it('context with wrong symbol is rejected', () => {
      const forged = {
        source: 'task-service' as const,
        __capabilityToken: Symbol('agent-registry-sync-capability'),
      };
      expect(isValidSyncToken(forged)).toBe(false);
    });

    it('syncFromTask rejects forged string context', () => {
      const registry = getAgentRegistryService();
      const forgedContext: TaskSyncContext = { source: 'task-service' };

      expect(() =>
        registry.syncFromTask(
          {
            agentRef: 'test-agent',
            taskId: 'task_20250101_abc123',
            taskStatus: 'in-progress',
          },
          forgedContext
        )
      ).toThrow(/Unauthorized/);
    });

    it('syncFromTask accepts valid capability token', () => {
      const registry = getAgentRegistryService();
      const validContext = createTaskSyncToken('task-service');

      const result = registry.syncFromTask(
        {
          agentRef: 'test-agent',
          taskId: 'task_20250101_abc123',
          taskStatus: 'in-progress',
        },
        validContext
      );

      expect(result).not.toBeNull();
      expect(result?.status).toBe('busy');
    });

    it('reconcileFromTasks rejects forged context', () => {
      const registry = getAgentRegistryService();
      const forgedContext: TaskSyncContext = { source: 'task-reconciler' };

      expect(() => registry.reconcileFromTasks([], forgedContext)).toThrow(/Unauthorized/);
    });

    it('reconcileFromTasks accepts valid capability token', () => {
      const registry = getAgentRegistryService();
      const validContext = createTaskSyncToken('task-reconciler');

      const changes = registry.reconcileFromTasks([], validContext);
      expect(changes).toBe(0);
    });
  });
});
