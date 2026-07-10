/**
 * Regression tests for issue #781:
 * ClawdbotAgentService.reconcileRunningAttempts() must detect persisted running
 * attempts after a server restart and mark them as failed with status 'todo'.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Task, TaskAttempt } from '@veritas-kanban/shared';

// ─── Mocks ────────────────────────────────────────────────────────────────

// Provide a stub for the shared package so transitive imports resolve
vi.mock('@veritas-kanban/shared', async (importOriginal) => {
  try {
    return await importOriginal();
  } catch {
    // Package not built — return minimal stubs used by clawdbot-agent-service
    return {
      evaluateTaskReadiness: vi.fn().mockReturnValue({ isReady: true, reasons: [] }),
      DEFAULT_ROUTING_CONFIG: { agents: [] },
      DEFAULT_FEATURE_SETTINGS: {},
      ZERO_AGENT_BUDGET_USAGE: { tokens: 0, cost: 0 },
    };
  }
});

const mockListTasks = vi.fn<[], Promise<Task[]>>();
const mockUpdateTask = vi.fn<[string, Partial<Task>], Promise<Task>>();

vi.mock('../../services/task-service.js', () => ({
  TaskService: class MockTaskService {
    listTasks = mockListTasks;
    updateTask = mockUpdateTask;
  },
}));

vi.mock('../../services/config-service.js', () => ({
  ConfigService: class MockConfigService {
    getConfig = vi.fn().mockResolvedValue({ agents: [], features: {} });
    getFeatureSettings = vi.fn().mockResolvedValue({});
    dispose = vi.fn();
  },
}));

vi.mock('../../services/agent-health-service.js', () => ({
  AgentHealthService: class MockAgentHealthService {
    checkHealth = vi.fn().mockResolvedValue(true);
  },
}));

vi.mock('../../utils/paths.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../utils/paths.js')>();
  return {
    ...actual,
    getRuntimeDir: () => '/tmp/test-veritas-kanban',
    getLogsDir: () => '/tmp/test-veritas-kanban/logs',
  };
});

vi.mock('../../storage/fs-helpers.js', () => ({
  existsSync: vi.fn().mockReturnValue(false),
  mkdir: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn().mockResolvedValue(''),
  writeFile: vi.fn().mockResolvedValue(undefined),
  rename: vi.fn().mockResolvedValue(undefined),
}));

// Import the service under test AFTER mocks are in place
const { ClawdbotAgentService } = await import('../../services/clawdbot-agent-service.js');

// ─── Helper ───────────────────────────────────────────────────────────────

function makeTask(id: string, attemptStatus: TaskAttempt['status'] | null): Task {
  return {
    id,
    title: `Task ${id}`,
    status: 'in-progress',
    type: 'code',
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
    attempt: attemptStatus
      ? ({
          id: `attempt_${id}`,
          agent: 'openclaw',
          status: attemptStatus,
          started: new Date().toISOString(),
          provider: 'openclaw',
        } as TaskAttempt)
      : undefined,
  } as Task;
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe('ClawdbotAgentService.reconcileRunningAttempts (issue #781)', () => {
  let service: InstanceType<typeof ClawdbotAgentService>;

  beforeEach(() => {
    vi.clearAllMocks();
    // Construct a new instance for each test (avoids shared state)
    service = new ClawdbotAgentService();
    mockUpdateTask.mockResolvedValue({} as Task);
  });

  it('marks orphaned running attempts as failed and reverts in-progress task to todo', async () => {
    const runningTask = makeTask('task-running-1', 'running'); // status: 'in-progress'
    mockListTasks.mockResolvedValue([runningTask]);

    await service.reconcileRunningAttempts();

    expect(mockUpdateTask).toHaveBeenCalledTimes(1);
    const [calledId, update] = mockUpdateTask.mock.calls[0];
    expect(calledId).toBe('task-running-1');
    expect(update.status).toBe('todo');
    expect(update.attempt?.status).toBe('failed');
    expect(update.attempt?.ended).toBeDefined();
    const ended = update.attempt?.ended;
    expect(ended).toBeDefined();
    // ended should be a valid ISO timestamp
    if (ended) {
      expect(Number.isNaN(new Date(ended).getTime())).toBe(false);
    }
  });

  it('does not reset task status for non-in-progress tasks with stale running attempts', async () => {
    // Task was moved to 'blocked' by a human but still has a stale running attempt
    const blockedTask: Task = {
      ...makeTask('task-blocked', 'running'),
      status: 'blocked',
    } as Task;
    mockListTasks.mockResolvedValue([blockedTask]);

    await service.reconcileRunningAttempts();

    expect(mockUpdateTask).toHaveBeenCalledTimes(1);
    const [, update] = mockUpdateTask.mock.calls[0];
    // Task status should NOT be overridden when already non-in-progress
    expect(update.status).toBeUndefined();
    expect(update.attempt?.status).toBe('failed');
  });

  it('does not touch tasks whose attempt status is not running', async () => {
    const tasks = [
      makeTask('task-done', 'complete'),
      makeTask('task-failed', 'failed'),
      makeTask('task-no-attempt', null),
    ];
    mockListTasks.mockResolvedValue(tasks);

    await service.reconcileRunningAttempts();

    expect(mockUpdateTask).not.toHaveBeenCalled();
  });

  it('reconciles multiple orphaned attempts in one pass', async () => {
    const tasks = [
      makeTask('task-running-a', 'running'),
      makeTask('task-running-b', 'running'),
      makeTask('task-done-c', 'complete'),
    ];
    mockListTasks.mockResolvedValue(tasks);

    await service.reconcileRunningAttempts();

    expect(mockUpdateTask).toHaveBeenCalledTimes(2);
    const updatedIds = mockUpdateTask.mock.calls.map(([id]) => id).sort();
    expect(updatedIds).toEqual(['task-running-a', 'task-running-b']);
  });

  it('does not fail if listTasks throws — logs and returns', async () => {
    mockListTasks.mockRejectedValue(new Error('storage unavailable'));

    await expect(service.reconcileRunningAttempts()).resolves.not.toThrow();
    expect(mockUpdateTask).not.toHaveBeenCalled();
  });

  it('continues reconciling remaining tasks when one updateTask fails', async () => {
    const tasks = [
      makeTask('task-fail-update', 'running'),
      makeTask('task-success-update', 'running'),
    ];
    mockListTasks.mockResolvedValue(tasks);
    mockUpdateTask
      .mockRejectedValueOnce(new Error('write failed'))
      .mockResolvedValueOnce({} as Task);

    await expect(service.reconcileRunningAttempts()).resolves.not.toThrow();
    expect(mockUpdateTask).toHaveBeenCalledTimes(2);
  });

  it('preserves all existing attempt fields when updating status to failed', async () => {
    const agent = 'openclaw';
    const model = 'gpt-5.3-codex';
    const task = {
      ...makeTask('task-with-model', 'running'),
    };
    (task.attempt as TaskAttempt).model = model;
    (task.attempt as TaskAttempt).agent = agent;
    mockListTasks.mockResolvedValue([task]);

    await service.reconcileRunningAttempts();

    const [, update] = mockUpdateTask.mock.calls[0];
    expect(update.attempt?.agent).toBe(agent);
    expect(update.attempt?.model).toBe(model);
    expect(update.attempt?.status).toBe('failed');
  });
});
