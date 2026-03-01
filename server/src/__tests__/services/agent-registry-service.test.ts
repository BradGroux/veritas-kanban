/**
 * Agent Registry Service Unit Tests
 *
 * @see https://github.com/BradGroux/veritas-kanban/issues/52
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock fs-helpers before importing the service
vi.mock('../../storage/fs-helpers.js', () => ({
  existsSync: vi.fn().mockReturnValue(false),
  readFileSync: vi.fn().mockReturnValue('{}'),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

// Must import after mock
const { getAgentRegistryService, disposeAgentRegistryService } =
  await import('../../services/agent-registry-service.js');
import type { RegisteredAgent, TaskSyncContext } from '../../services/agent-registry-service.js';

const TASK_SYNC_CONTEXT: TaskSyncContext = { source: 'task-service' };
const TASK_RECONCILE_CONTEXT: TaskSyncContext = { source: 'task-reconciler' };

describe('AgentRegistryService', () => {
  beforeEach(() => {
    // Ensure fresh instance for each test
    disposeAgentRegistryService();
  });

  afterEach(() => {
    disposeAgentRegistryService();
  });

  // ── Registration ─────────────────────────────────────────────

  describe('register()', () => {
    it('should register a new agent', () => {
      const service = getAgentRegistryService();
      const result = service.register({
        id: 'test-agent',
        name: 'Test Agent',
        model: 'claude-sonnet-4',
        provider: 'anthropic',
        capabilities: [{ name: 'code' }, { name: 'test' }],
      });

      expect(result.id).toBe('test-agent');
      expect(result.name).toBe('Test Agent');
      expect(result.model).toBe('claude-sonnet-4');
      expect(result.provider).toBe('anthropic');
      expect(result.capabilities).toHaveLength(2);
      expect(result.status).toBe('online');
      expect(result.registeredAt).toBeDefined();
      expect(result.lastHeartbeat).toBeDefined();
    });

    it('should update an existing agent on re-register', () => {
      const service = getAgentRegistryService();

      const first = service.register({
        id: 'test-agent',
        name: 'Test Agent',
        capabilities: [{ name: 'code' }],
      });

      const second = service.register({
        id: 'test-agent',
        name: 'Test Agent Updated',
        model: 'claude-sonnet-4',
        capabilities: [{ name: 'code' }, { name: 'test' }, { name: 'review' }],
      });

      expect(second.id).toBe(first.id);
      expect(second.name).toBe('Test Agent Updated');
      expect(second.capabilities).toHaveLength(3);
      expect(second.model).toBe('claude-sonnet-4');
      expect(second.registeredAt).toBe(first.registeredAt); // Should preserve original registration time
      expect(second.status).toBe('online');
    });

    it('should register multiple agents with different IDs', () => {
      const service = getAgentRegistryService();

      service.register({ id: 'agent-1', name: 'Agent 1', capabilities: [{ name: 'code' }] });
      service.register({
        id: 'agent-2',
        name: 'Agent 2',
        capabilities: [{ name: 'code' }, { name: 'review' }],
      });

      const agents = service.list();
      expect(agents).toHaveLength(2);
    });

    it('should use new metadata on re-register when provided', () => {
      const service = getAgentRegistryService();

      service.register({
        id: 'test-agent',
        name: 'Test Agent',
        capabilities: [{ name: 'code' }],
        metadata: { host: 'mac-mini', session: 'abc' },
      });

      const result = service.register({
        id: 'test-agent',
        name: 'Test Agent',
        capabilities: [{ name: 'code' }],
        metadata: { session: 'def', newField: true },
      });

      // Service uses new metadata when provided (doesn't merge with old)
      expect(result.metadata).toEqual({
        session: 'def',
        newField: true,
      });
    });
  });

  // ── Heartbeat ────────────────────────────────────────────────

  describe('heartbeat()', () => {
    it('should update agent status', () => {
      const service = getAgentRegistryService();

      const agent = service.register({
        id: 'test-agent',
        name: 'Test Agent',
        capabilities: [{ name: 'code' }],
      });

      const updated = service.heartbeat(agent.id, {
        status: 'busy',
        currentTaskId: 'TASK-1',
        currentTaskTitle: 'Fix the bug',
      });

      expect(updated).not.toBeNull();
      expect(updated!.status).toBe('busy');
      expect(updated!.currentTaskId).toBe('TASK-1');
      expect(updated!.currentTaskTitle).toBe('Fix the bug');
    });

    it('should return null for unknown agent', () => {
      const service = getAgentRegistryService();
      const result = service.heartbeat('nonexistent', { status: 'online' });
      expect(result).toBeNull();
    });

    it('should update lastHeartbeat timestamp', () => {
      const service = getAgentRegistryService();

      const agent = service.register({
        id: 'test-agent',
        name: 'Test Agent',
        capabilities: [{ name: 'code' }],
      });

      const originalHeartbeat = agent.lastHeartbeat;

      // Wait a tiny bit to ensure timestamp changes
      vi.useFakeTimers();
      vi.advanceTimersByTime(100);

      const updated = service.heartbeat(agent.id, { status: 'busy' });

      vi.useRealTimers();

      expect(updated!.lastHeartbeat).not.toBe(originalHeartbeat);
    });

    it('should update task information', () => {
      const service = getAgentRegistryService();

      const agent = service.register({
        id: 'test-agent',
        name: 'Test Agent',
        capabilities: [{ name: 'code' }],
      });

      service.heartbeat(agent.id, {
        status: 'busy',
        currentTaskId: 'TASK-1',
        currentTaskTitle: 'First task',
      });
      const updated = service.heartbeat(agent.id, {
        status: 'busy',
        currentTaskId: 'TASK-2',
        currentTaskTitle: 'Second task',
      });

      expect(updated!.currentTaskId).toBe('TASK-2');
      expect(updated!.currentTaskTitle).toBe('Second task');
    });

    it('should clear task on idle status', () => {
      const service = getAgentRegistryService();

      const agent = service.register({
        id: 'test-agent',
        name: 'Test Agent',
        capabilities: [{ name: 'code' }],
      });

      service.heartbeat(agent.id, { status: 'busy', currentTaskId: 'TASK-1' });
      const updated = service.heartbeat(agent.id, {
        status: 'idle',
        currentTaskId: '',
        currentTaskTitle: '',
      });

      expect(updated!.status).toBe('idle');
      expect(updated!.currentTaskId).toBeUndefined();
      expect(updated!.currentTaskTitle).toBeUndefined();
    });

    it('should merge metadata on heartbeat', () => {
      const service = getAgentRegistryService();

      const agent = service.register({
        id: 'test-agent',
        name: 'Test Agent',
        capabilities: [{ name: 'code' }],
        metadata: { host: 'mac-mini' },
      });

      service.heartbeat(agent.id, { metadata: { session: 'abc', ping: Date.now() } });

      const updated = service.get(agent.id);
      expect(updated!.metadata).toEqual({
        host: 'mac-mini',
        session: 'abc',
        ping: expect.any(Number),
      });
    });
  });

  // ── Listing ──────────────────────────────────────────────────

  describe('list()', () => {
    it('should list all registered agents', () => {
      const service = getAgentRegistryService();

      service.register({ id: 'a1', name: 'Agent 1', capabilities: [{ name: 'code' }] });
      service.register({
        id: 'a2',
        name: 'Agent 2',
        capabilities: [{ name: 'code' }, { name: 'review' }],
      });

      const agents = service.list();
      expect(agents).toHaveLength(2);
    });

    it('should filter by status', () => {
      const service = getAgentRegistryService();

      const a1 = service.register({ id: 'a1', name: 'Agent 1', capabilities: [{ name: 'code' }] });
      service.register({ id: 'a2', name: 'Agent 2', capabilities: [{ name: 'code' }] });

      service.heartbeat(a1.id, { status: 'busy', currentTaskId: 'T1' });

      const busy = service.list({ status: 'busy' });
      expect(busy).toHaveLength(1);
      expect(busy[0].name).toBe('Agent 1');
    });

    it('should filter by capability', () => {
      const service = getAgentRegistryService();

      service.register({
        id: 'a1',
        name: 'Agent 1',
        capabilities: [{ name: 'code' }, { name: 'test' }],
      });
      service.register({ id: 'a2', name: 'Agent 2', capabilities: [{ name: 'code' }] });

      const testers = service.list({ capability: 'test' });
      expect(testers).toHaveLength(1);
      expect(testers[0].name).toBe('Agent 1');
    });

    it('should handle case-insensitive capability matching', () => {
      const service = getAgentRegistryService();

      service.register({
        id: 'a1',
        name: 'Agent 1',
        capabilities: [{ name: 'Code' }, { name: 'Test' }],
      });

      const testers = service.list({ capability: 'test' });
      expect(testers).toHaveLength(1);
    });
  });

  // ── Lookup ───────────────────────────────────────────────────

  describe('get()', () => {
    it('should get agent by ID', () => {
      const service = getAgentRegistryService();

      const agent = service.register({
        id: 'test',
        name: 'Test Agent',
        capabilities: [{ name: 'code' }],
      });
      const found = service.get(agent.id);

      expect(found).not.toBeNull();
      expect(found!.name).toBe('Test Agent');
    });

    it('should return null for unknown ID', () => {
      const service = getAgentRegistryService();
      expect(service.get('nope')).toBeNull();
    });
  });

  // ── Find by Capability ───────────────────────────────────────

  describe('findByCapability()', () => {
    it('should find agents by capability', () => {
      const service = getAgentRegistryService();

      service.register({
        id: 'a1',
        name: 'Agent 1',
        capabilities: [{ name: 'code' }, { name: 'deploy' }],
      });
      service.register({ id: 'a2', name: 'Agent 2', capabilities: [{ name: 'code' }] });
      service.register({ id: 'a3', name: 'Agent 3', capabilities: [{ name: 'research' }] });

      const deployers = service.findByCapability('deploy');
      expect(deployers).toHaveLength(1);
      expect(deployers[0].name).toBe('Agent 1');
    });

    it('should exclude offline agents', () => {
      const service = getAgentRegistryService();

      const a1 = service.register({
        id: 'a1',
        name: 'Agent 1',
        capabilities: [{ name: 'deploy' }],
      });
      service.register({ id: 'a2', name: 'Agent 2', capabilities: [{ name: 'deploy' }] });

      service.heartbeat(a1.id, { status: 'offline' });

      const deployers = service.findByCapability('deploy');
      expect(deployers).toHaveLength(1);
      expect(deployers[0].name).toBe('Agent 2');
    });
  });

  // ── Stats ────────────────────────────────────────────────────

  describe('stats()', () => {
    it('should return registry statistics', () => {
      const service = getAgentRegistryService();

      const a1 = service.register({ id: 'a1', name: 'Agent 1', capabilities: [{ name: 'code' }] });
      const a2 = service.register({
        id: 'a2',
        name: 'Agent 2',
        capabilities: [{ name: 'deploy' }],
      });
      service.register({ id: 'a3', name: 'Agent 3', capabilities: [{ name: 'research' }] });

      service.heartbeat(a1.id, { status: 'busy' });
      service.heartbeat(a2.id, { status: 'idle' });

      const stats = service.stats();

      expect(stats.total).toBe(3);
      expect(stats.online).toBe(1); // a3
      expect(stats.busy).toBe(1); // a1
      expect(stats.idle).toBe(1); // a2
      expect(stats.offline).toBe(0);
      expect(stats.capabilities).toEqual(['code', 'deploy', 'research']);
    });

    it('should count offline agents', () => {
      const service = getAgentRegistryService();

      const a1 = service.register({ id: 'a1', name: 'Agent 1', capabilities: [{ name: 'code' }] });

      service.heartbeat(a1.id, { status: 'offline' });

      const stats = service.stats();
      expect(stats.offline).toBe(1);
      expect(stats.online).toBe(0);
    });
  });

  // ── Deregister ───────────────────────────────────────────────

  describe('syncFromTask()', () => {
    it('should set agent busy and attach task when task moves in-progress', () => {
      const service = getAgentRegistryService();
      service.register({ id: 'coder-1', name: 'Coder 1', capabilities: [{ name: 'code' }] });

      const updated = service.syncFromTask(
        {
          agentRef: 'coder-1',
          taskId: 'task_20260228_syncA',
          taskTitle: 'Wire backend sync',
          taskStatus: 'in-progress',
        },
        TASK_SYNC_CONTEXT
      );

      expect(updated).not.toBeNull();
      expect(updated!.status).toBe('busy');
      expect(updated!.currentTaskId).toBe('task_20260228_syncA');
      expect(updated!.currentTaskTitle).toBe('Wire backend sync');
    });

    it('should set agent idle and clear task on terminal status for same task', () => {
      const service = getAgentRegistryService();
      service.register({ id: 'coder-1', name: 'Coder 1', capabilities: [{ name: 'code' }] });

      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-02-28T12:00:00.000Z'));

      service.syncFromTask(
        {
          agentRef: 'coder-1',
          taskId: 'task_20260228_syncA',
          taskTitle: 'Wire backend sync',
          taskStatus: 'in-progress',
        },
        TASK_SYNC_CONTEXT
      );

      vi.setSystemTime(new Date('2026-02-28T12:00:15.000Z'));
      const updated = service.syncFromTask(
        {
          agentRef: 'coder-1',
          taskId: 'task_20260228_syncA',
          taskStatus: 'done',
        },
        TASK_SYNC_CONTEXT
      );

      expect(updated).not.toBeNull();
      expect(updated!.status).toBe('idle');
      expect(updated!.currentTaskId).toBeUndefined();
      expect(updated!.currentTaskTitle).toBeUndefined();

      vi.useRealTimers();
    });

    it('should not clobber current task when terminal update is for a different task', () => {
      const service = getAgentRegistryService();
      service.register({ id: 'coder-1', name: 'Coder 1', capabilities: [{ name: 'code' }] });

      service.syncFromTask(
        {
          agentRef: 'coder-1',
          taskId: 'task_20260228_syncA',
          taskTitle: 'Current task',
          taskStatus: 'in-progress',
        },
        TASK_SYNC_CONTEXT
      );

      const updated = service.syncFromTask(
        {
          agentRef: 'coder-1',
          taskId: 'task_20260228_syncB',
          taskStatus: 'done',
        },
        TASK_SYNC_CONTEXT
      );

      expect(updated).not.toBeNull();
      expect(updated!.status).toBe('busy');
      expect(updated!.currentTaskId).toBe('task_20260228_syncA');
      expect(updated!.currentTaskTitle).toBe('Current task');
    });

    it('should resolve agent by name when task.agent stores display name', () => {
      const service = getAgentRegistryService();
      service.register({ id: 'coder-1', name: 'Codex Primary', capabilities: [{ name: 'code' }] });

      const updated = service.syncFromTask(
        {
          agentRef: 'codex primary',
          taskId: 'task_20260228_syncA',
          taskStatus: 'in-progress',
        },
        TASK_SYNC_CONTEXT
      );

      expect(updated).not.toBeNull();
      expect(updated!.id).toBe('coder-1');
      expect(updated!.status).toBe('busy');
    });

    it('should prevent rapid busy-to-idle flapping within guard window', () => {
      const service = getAgentRegistryService();
      service.register({ id: 'coder-1', name: 'Coder 1', capabilities: [{ name: 'code' }] });

      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-02-28T12:00:00.000Z'));

      service.syncFromTask(
        {
          agentRef: 'coder-1',
          taskId: 'task_20260228_syncA',
          taskStatus: 'in-progress',
        },
        TASK_SYNC_CONTEXT
      );

      // Within 10s flap window => should remain busy
      vi.setSystemTime(new Date('2026-02-28T12:00:05.000Z'));
      const updated = service.syncFromTask(
        {
          agentRef: 'coder-1',
          taskId: 'task_20260228_syncA',
          taskStatus: 'done',
        },
        TASK_SYNC_CONTEXT
      );

      expect(updated?.status).toBe('busy');
      expect(updated?.currentTaskId).toBe('task_20260228_syncA');

      vi.useRealTimers();
    });

    it('should reject unauthorized sync context', () => {
      const service = getAgentRegistryService();
      service.register({ id: 'coder-1', name: 'Coder 1', capabilities: [{ name: 'code' }] });

      expect(() =>
        service.syncFromTask(
          {
            agentRef: 'coder-1',
            taskId: 'task_20260228_syncA',
            taskStatus: 'in-progress',
          },
          { source: 'task-service-untrusted' as any }
        )
      ).toThrow('Unauthorized task sync context');
    });

    it('should ignore malformed agentRef in sync operations', () => {
      const service = getAgentRegistryService();
      service.register({ id: 'coder-1', name: 'Coder 1', capabilities: [{ name: 'code' }] });

      const updated = service.syncFromTask(
        {
          agentRef: 'bad/ref',
          taskId: 'task_20260228_syncA',
          taskStatus: 'in-progress',
        },
        TASK_SYNC_CONTEXT
      );

      expect(updated).toBeNull();
      expect(service.get('coder-1')?.status).toBe('online');
    });
  });

  describe('reconcileFromTasks()', () => {
    it('should correct drift to busy when task is in-progress', () => {
      const service = getAgentRegistryService();
      service.register({ id: 'coder-1', name: 'Coder 1', capabilities: [{ name: 'code' }] });

      const changed = service.reconcileFromTasks(
        [
          {
            id: 'task_20260228_syncA',
            title: 'Backend hook',
            status: 'in-progress',
            agent: 'coder-1',
          },
        ],
        TASK_RECONCILE_CONTEXT
      );

      const agent = service.get('coder-1');
      expect(changed).toBe(1);
      expect(agent?.status).toBe('busy');
      expect(agent?.currentTaskId).toBe('task_20260228_syncA');
    });

    it('should clear busy agent when assigned task is terminal', () => {
      const service = getAgentRegistryService();
      service.register({ id: 'coder-1', name: 'Coder 1', capabilities: [{ name: 'code' }] });

      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-02-28T12:00:00.000Z'));

      service.syncFromTask(
        {
          agentRef: 'coder-1',
          taskId: 'task_20260228_syncA',
          taskStatus: 'in-progress',
        },
        TASK_SYNC_CONTEXT
      );

      vi.setSystemTime(new Date('2026-02-28T12:00:15.000Z'));
      const changed = service.reconcileFromTasks(
        [
          {
            id: 'task_20260228_syncA',
            status: 'done',
            agent: 'coder-1',
          },
        ],
        TASK_RECONCILE_CONTEXT
      );

      const agent = service.get('coder-1');
      expect(changed).toBe(1);
      expect(agent?.status).toBe('idle');
      expect(agent?.currentTaskId).toBeUndefined();

      vi.useRealTimers();
    });

    it('should reject unauthorized reconcile context', () => {
      const service = getAgentRegistryService();
      service.register({ id: 'coder-1', name: 'Coder 1', capabilities: [{ name: 'code' }] });

      expect(() =>
        service.reconcileFromTasks([{ id: 'task_1', status: 'in-progress', agent: 'coder-1' }], {
          source: 'task-service-untrusted' as any,
        })
      ).toThrow('Unauthorized task reconcile context');
    });

    it('should enforce reconciliation batch bounds', () => {
      const service = getAgentRegistryService();
      const tooLarge = Array.from({ length: 10001 }, (_, i) => ({
        id: `task_${i}`,
        status: 'todo' as const,
        agent: 'coder-1',
      }));

      expect(() => service.reconcileFromTasks(tooLarge, TASK_RECONCILE_CONTEXT)).toThrow(
        'Reconciliation batch too large'
      );
    });
  });

  describe('deregister()', () => {
    it('should remove an agent', () => {
      const service = getAgentRegistryService();

      const agent = service.register({
        id: 'test',
        name: 'Test Agent',
        capabilities: [{ name: 'code' }],
      });
      const removed = service.deregister(agent.id);

      expect(removed).toBe(true);
      expect(service.get(agent.id)).toBeNull();
    });

    it('should return false for unknown agent', () => {
      const service = getAgentRegistryService();
      expect(service.deregister('nonexistent')).toBe(false);
    });

    it('should clear flap-guard state on deregister', () => {
      const service = getAgentRegistryService();
      service.register({ id: 'coder-1', name: 'Coder 1', capabilities: [{ name: 'code' }] });

      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-02-28T12:00:00.000Z'));

      service.syncFromTask(
        {
          agentRef: 'coder-1',
          taskId: 'task_20260228_syncA',
          taskStatus: 'in-progress',
        },
        TASK_SYNC_CONTEXT
      );

      service.deregister('coder-1');
      service.register({ id: 'coder-1', name: 'Coder 1', capabilities: [{ name: 'code' }] });

      const updated = service.syncFromTask(
        {
          agentRef: 'coder-1',
          taskId: 'task_20260228_syncA',
          taskStatus: 'done',
        },
        TASK_SYNC_CONTEXT
      );

      // If flap state was not cleared, this can incorrectly remain busy.
      expect(updated?.status).toBe('idle');

      vi.useRealTimers();
    });
  });
});
