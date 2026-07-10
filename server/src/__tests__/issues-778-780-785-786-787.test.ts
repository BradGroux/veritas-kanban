/**
 * Regression tests for audit issues #778, #780, #785, #786, #787.
 *
 * #778 — Human gate blocking/resume correctness
 * #780 — Bounded retry_step cycles
 * #785 — WorkflowRunService domain errors → HTTP AppError mapping
 * #786 — Shared workflow contracts: provider/command fields
 * #787 — depends_on enforcement during status transitions
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { BlockingService } from '../services/blocking-service.js';
import { HumanGateBlockError } from '../services/workflow-step-executor.js';
import type { Task, WorkflowAgent } from '@veritas-kanban/shared';
import type { WorkflowRunService } from '../services/workflow-run-service.js';

// ─────────────────────────────────────────────────────────────
// Module-level mock state shared across workflow service tests.
// Using module-level fns so vi.mock factory can close over them.
// ─────────────────────────────────────────────────────────────

const mockLoadWorkflow = vi.fn();
const mockExecuteStep = vi.fn();
const mockBroadcastWorkflowStatus = vi.fn();
const mockGetTask = vi.fn();

vi.mock('../services/workflow-service.js', () => ({
  getWorkflowService: () => ({
    loadWorkflow: mockLoadWorkflow,
    listWorkflowsMetadata: vi.fn().mockResolvedValue([]),
    auditChange: vi.fn(),
  }),
}));

vi.mock('../services/workflow-step-executor.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/workflow-step-executor.js')>();
  return {
    HumanGateBlockError: actual.HumanGateBlockError,
    WorkflowStepExecutor: class {
      executeStep = mockExecuteStep;
    },
  };
});

vi.mock('../services/broadcast-service.js', () => ({
  broadcastWorkflowStatus: mockBroadcastWorkflowStatus,
}));

vi.mock('../services/task-service.js', () => ({
  getTaskService: () => ({ getTask: mockGetTask }),
}));

vi.mock('../middleware/workflow-auth.js', () => ({
  checkWorkflowPermission: vi.fn().mockResolvedValue(true),
}));

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function agentWorkflow(id: string, steps: unknown[]) {
  return {
    id,
    version: 1,
    name: id,
    description: '',
    variables: {},
    agents: [{ id: 'a1', name: 'A1', role: 'dev', description: '' }],
    steps,
  };
}

/**
 * Default executeStep mock:
 * - Gate steps with on_false.escalate_to=human → throw HumanGateBlockError
 * - Other gate steps → throw plain Error
 * - Agent steps → succeed
 */
function gateAwareImpl(step: {
  id: string;
  type?: string;
  on_false?: { escalate_to: string; escalate_message?: string };
}) {
  if (step.type === 'gate') {
    if (step.on_false?.escalate_to === 'human') {
      return Promise.reject(
        new HumanGateBlockError(
          step.id,
          step.on_false as { escalate_to: 'human'; escalate_message?: string }
        )
      );
    }
    return Promise.reject(new Error(`Gate ${step.id} condition failed`));
  }
  return Promise.resolve({ output: { done: step.id }, outputPath: `/tmp/${step.id}.json` });
}

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task_test_001',
    title: 'Test Task',
    status: 'todo',
    priority: 'medium',
    created: '2026-01-01T00:00:00Z',
    updated: '2026-01-01T00:00:00Z',
    ...overrides,
  } as Task;
}

// ─────────────────────────────────────────────────────────────
// #778 — Human gate blocking/resume correctness
// ─────────────────────────────────────────────────────────────

describe('#778 — Human gate blocking', () => {
  let tmpDir: string;
  let service: WorkflowRunService;

  beforeEach(async () => {
    vi.resetModules();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wf-778-'));
    mockGetTask.mockResolvedValue(null);
    mockLoadWorkflow.mockResolvedValue(
      agentWorkflow('wf-gate', [
        { id: 'prep', type: 'agent', agent: 'a1', name: 'Prep' },
        {
          id: 'gate',
          type: 'gate',
          name: 'Human Gate',
          condition: 'false',
          on_false: { escalate_to: 'human', escalate_message: 'Awaiting human approval' },
        },
        { id: 'finish', type: 'agent', agent: 'a1', name: 'Finish' },
      ])
    );
    mockExecuteStep.mockImplementation(gateAwareImpl);
    const mod = await import('../services/workflow-run-service.js');
    service = new mod.WorkflowRunService(tmpDir);
  });

  afterEach(async () => {
    vi.clearAllMocks();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('transitions to blocked (not failed) when gate on_false escalates to human', async () => {
    const run = await service.startRun('wf-gate');

    await vi.waitFor(async () => {
      const saved = await service.getRun(run.id);
      expect(saved.status).toBe('blocked');
    });

    const blocked = await service.getRun(run.id);
    expect(blocked.status).toBe('blocked');
    expect(blocked.error).toBe('Awaiting human approval');

    const gateStep = blocked.steps.find((s: { stepId: string }) => s.stepId === 'gate');
    expect(gateStep.status).toBe('failed');

    const prepStep = blocked.steps.find((s: { stepId: string }) => s.stepId === 'prep');
    expect(prepStep.status).toBe('completed');

    expect(blocked.context._gateBlock).toMatchObject({
      stepId: 'gate',
      escalationMessage: 'Awaiting human approval',
    });
  });

  it('approveGateStep marks gate completed, clears block context, resumes from finish', async () => {
    const run = await service.startRun('wf-gate');
    await vi.waitFor(async () => expect((await service.getRun(run.id)).status).toBe('blocked'));

    const resumed = await service.approveGateStep(run.id, 'gate', 'user-brad');

    expect(resumed.status).toBe('running');
    const gateStep = resumed.steps.find((s: { stepId: string }) => s.stepId === 'gate');
    expect(gateStep.status).toBe('completed');
    expect(resumed.context._gateBlock).toBeUndefined();

    await vi.waitFor(async () => expect((await service.getRun(run.id)).status).toBe('completed'));

    const calls = mockExecuteStep.mock.calls.map((c: unknown[]) => (c[0] as { id: string }).id);
    expect(calls).toContain('finish');
    // prep should not be re-run
    expect(calls.filter((id: string) => id === 'prep')).toHaveLength(1);
  });

  it('rejectGateStep marks run failed and persists to storage', async () => {
    const run = await service.startRun('wf-gate');
    await vi.waitFor(async () => expect((await service.getRun(run.id)).status).toBe('blocked'));

    const rejected = await service.rejectGateStep(run.id, 'gate', 'user-brad');

    expect(rejected.status).toBe('failed');
    expect(rejected.error).toMatch(/rejected by user-brad/);

    const persisted = await service.getRun(run.id);
    expect(persisted.status).toBe('failed');
  });

  it('approveGateStep throws when run is not blocked', async () => {
    mockLoadWorkflow.mockResolvedValue(
      agentWorkflow('wf-plain', [{ id: 'step', type: 'agent', agent: 'a1', name: 'S' }])
    );
    mockExecuteStep.mockResolvedValue({ output: {}, outputPath: '/tmp/x.json' });
    const run = await service.startRun('wf-plain');
    await vi.waitFor(async () => expect((await service.getRun(run.id)).status).toBe('completed'));

    await expect(service.approveGateStep(run.id, 'step', 'user')).rejects.toThrow(/not blocked/);
  });

  it('approveGateStep rejects when stepId does not match the blocking gate', async () => {
    const run = await service.startRun('wf-gate');
    await vi.waitFor(async () => expect((await service.getRun(run.id)).status).toBe('blocked'));

    await expect(service.approveGateStep(run.id, 'prep', 'user')).rejects.toThrow(
      /blocked at gate "gate"/
    );
  });

  it('rejectGateStep rejects when stepId does not match the blocking gate', async () => {
    const run = await service.startRun('wf-gate');
    await vi.waitFor(async () => expect((await service.getRun(run.id)).status).toBe('blocked'));

    await expect(service.rejectGateStep(run.id, 'prep', 'user')).rejects.toThrow(
      /blocked at gate "gate"/
    );
  });

  it('completed run has no stale error from prior blocked phase', async () => {
    const run = await service.startRun('wf-gate');
    await vi.waitFor(async () => expect((await service.getRun(run.id)).status).toBe('blocked'));

    await service.approveGateStep(run.id, 'gate', 'user-brad');
    await vi.waitFor(async () => expect((await service.getRun(run.id)).status).toBe('completed'));

    const completed = await service.getRun(run.id);
    expect(completed.error).toBeUndefined();
  });

  it('approved gate synthesizes step context output', async () => {
    const run = await service.startRun('wf-gate');
    await vi.waitFor(async () => expect((await service.getRun(run.id)).status).toBe('blocked'));

    await service.approveGateStep(run.id, 'gate', 'user-brad');
    await vi.waitFor(async () => expect((await service.getRun(run.id)).status).toBe('completed'));

    const completed = await service.getRun(run.id);
    expect(completed.context.gate).toMatchObject({
      passed: true,
      humanApproved: true,
      approvedBy: 'user-brad',
    });
  });

  it('ordinary false gate (no human escalation) still fails the run', async () => {
    mockLoadWorkflow.mockResolvedValue(
      agentWorkflow('wf-plaingate', [
        { id: 'gate2', type: 'gate', name: 'Plain Gate', condition: 'false' },
      ])
    );

    const run = await service.startRun('wf-plaingate');
    await vi.waitFor(async () => expect((await service.getRun(run.id)).status).toBe('failed'));

    const failed = await service.getRun(run.id);
    expect(failed.status).toBe('failed');
    expect(failed.status).not.toBe('blocked');
  });
});

// ─────────────────────────────────────────────────────────────
// #780 — Bounded retry_step cycles
// ─────────────────────────────────────────────────────────────

describe('#780 — Bounded retry_step cycles', () => {
  let tmpDir: string;
  let service: WorkflowRunService;

  beforeEach(async () => {
    vi.resetModules();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wf-780-'));
    mockGetTask.mockResolvedValue(null);
    const mod = await import('../services/workflow-run-service.js');
    service = new mod.WorkflowRunService(tmpDir);
  });

  afterEach(async () => {
    vi.clearAllMocks();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  function retryWorkflow(maxReroutes?: number, onExhausted?: Record<string, unknown>) {
    return agentWorkflow('wf-retry', [
      { id: 'stepA', type: 'agent', agent: 'a1', name: 'Step A' },
      {
        id: 'stepB',
        type: 'agent',
        agent: 'a1',
        name: 'Step B',
        on_fail: {
          retry_step: 'stepA',
          ...(maxReroutes !== undefined ? { max_reroutes: maxReroutes } : {}),
          ...(onExhausted ? { on_exhausted: onExhausted } : {}),
        },
      },
    ]);
  }

  it('terminates retry_step loop at max_reroutes=2 and marks run failed', async () => {
    mockLoadWorkflow.mockResolvedValue(retryWorkflow(2));
    mockExecuteStep.mockImplementation(async (step: { id: string }) => {
      if (step.id === 'stepB') throw new Error('stepB always fails');
      return { output: {}, outputPath: '/tmp/x.json' };
    });

    const run = await service.startRun('wf-retry');
    await vi.waitFor(
      async () => {
        const saved = await service.getRun(run.id);
        expect(['failed', 'blocked'].includes(saved.status)).toBe(true);
      },
      { timeout: 5000 }
    );

    const final = await service.getRun(run.id);
    expect(final.status).toBe('failed');
    expect(final.error).toMatch(/retry_step budget exhausted/);
    expect(final.retryRouteCount).toBeGreaterThan(2);
  });

  it('retryRouteCount is persisted across saves', async () => {
    mockLoadWorkflow.mockResolvedValue(retryWorkflow(1));
    mockExecuteStep.mockImplementation(async (step: { id: string }) => {
      if (step.id === 'stepB') throw new Error('always fails');
      return { output: {}, outputPath: '/tmp/x.json' };
    });

    const run = await service.startRun('wf-retry');
    await vi.waitFor(async () => {
      const saved = await service.getRun(run.id);
      expect(['failed', 'blocked'].includes(saved.status)).toBe(true);
    });

    const mod = await import('../services/workflow-run-service.js');
    const service2 = new mod.WorkflowRunService(tmpDir);
    const persisted = await service2.getRun(run.id);
    expect(persisted?.retryRouteCount).toBeGreaterThan(0);
  });

  it('on_exhausted escalate_to:human blocks instead of failing', async () => {
    mockLoadWorkflow.mockResolvedValue(
      retryWorkflow(1, { escalate_to: 'human', escalate_message: 'Manual retry needed' })
    );
    mockExecuteStep.mockImplementation(async (step: { id: string }) => {
      if (step.id === 'stepB') throw new Error('always fails');
      return { output: {}, outputPath: '/tmp/x.json' };
    });

    const run = await service.startRun('wf-retry');
    await vi.waitFor(async () => {
      const saved = await service.getRun(run.id);
      expect(['failed', 'blocked'].includes(saved.status)).toBe(true);
    });

    const final = await service.getRun(run.id);
    expect(final.status).toBe('blocked');
    expect(final.error).toMatch(/Manual retry needed/);
  });

  it('same-step retry counter still works independently (no retryRouteCount used)', async () => {
    mockLoadWorkflow.mockResolvedValue(
      agentWorkflow('wf-samestep', [
        {
          id: 'step',
          type: 'agent',
          agent: 'a1',
          name: 'Step',
          on_fail: { retry: 2 },
        },
      ])
    );
    let calls = 0;
    mockExecuteStep.mockImplementation(async () => {
      calls++;
      if (calls <= 2) throw new Error('transient');
      return { output: {}, outputPath: '/tmp/x.json' };
    });

    const run = await service.startRun('wf-samestep');
    await vi.waitFor(async () => expect((await service.getRun(run.id)).status).toBe('completed'));

    const final = await service.getRun(run.id);
    expect(final.status).toBe('completed');
    expect(final.retryRouteCount ?? 0).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────
// #785 — WorkflowRunService domain errors → AppError hierarchy
// ─────────────────────────────────────────────────────────────

describe('#785 — WorkflowRunService errors extend AppError', () => {
  let tmpDir: string;
  let service: WorkflowRunService;

  beforeEach(async () => {
    vi.resetModules();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wf-785-'));
    mockGetTask.mockResolvedValue(null);
    mockLoadWorkflow.mockResolvedValue(null);
    const mod = await import('../services/workflow-run-service.js');
    service = new mod.WorkflowRunService(tmpDir);
  });

  afterEach(async () => {
    vi.clearAllMocks();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('startRun throws NotFoundError (404) for missing workflow', async () => {
    const { NotFoundError } = await import('../middleware/error-handler.js');
    await expect(service.startRun('missing-wf')).rejects.toBeInstanceOf(NotFoundError);

    try {
      await service.startRun('missing-wf');
    } catch (err: unknown) {
      const error = err as { statusCode: number; code: string };
      expect(error.statusCode).toBe(404);
      expect(error.code).toBe('NOT_FOUND');
    }
  });

  it('resumeRun throws NotFoundError (404) for unknown run ID', async () => {
    const { NotFoundError } = await import('../middleware/error-handler.js');
    const fakeRunId = `run_${Date.now()}_abcdef12`;
    await expect(service.resumeRun(fakeRunId)).rejects.toBeInstanceOf(NotFoundError);

    try {
      await service.resumeRun(fakeRunId);
    } catch (err: unknown) {
      const error = err as { statusCode: number };
      expect(error.statusCode).toBe(404);
    }
  });

  it('resumeRun throws ValidationError (400) when run is not blocked', async () => {
    mockLoadWorkflow.mockResolvedValue(
      agentWorkflow('wf-done', [{ id: 's', type: 'agent', agent: 'a1', name: 'S' }])
    );
    mockExecuteStep.mockResolvedValue({ output: {}, outputPath: '/tmp/x.json' });
    const run = await service.startRun('wf-done');
    await vi.waitFor(async () => expect((await service.getRun(run.id)).status).toBe('completed'));

    const { ValidationError } = await import('../middleware/error-handler.js');
    await expect(service.resumeRun(run.id)).rejects.toBeInstanceOf(ValidationError);

    try {
      await service.resumeRun(run.id);
    } catch (err: unknown) {
      const error = err as { statusCode: number; code: string };
      expect(error.statusCode).toBe(400);
      expect(error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('startRun throws ValidationError (400) for reserved context keys', async () => {
    mockLoadWorkflow.mockResolvedValue(
      agentWorkflow('wf-ctx', [{ id: 's', type: 'agent', agent: 'a1', name: 'S' }])
    );
    const { ValidationError } = await import('../middleware/error-handler.js');
    await expect(service.startRun('wf-ctx', undefined, { task: 'hijack' })).rejects.toBeInstanceOf(
      ValidationError
    );

    try {
      await service.startRun('wf-ctx', undefined, { workflow: 'hijack' });
    } catch (err: unknown) {
      const error = err as { statusCode: number };
      expect(error.statusCode).toBe(400);
    }
  });
});

// ─────────────────────────────────────────────────────────────
// #786 — Shared workflow contracts: provider/command fields
// ─────────────────────────────────────────────────────────────

describe('#786 — Shared WorkflowAgent includes provider and command', () => {
  it('shared WorkflowAgent type accepts provider and command', () => {
    const agent: WorkflowAgent = {
      id: 'codex-agent',
      name: 'Codex',
      role: 'coder',
      description: 'A codex agent',
      provider: 'codex-cli',
      command: 'codex --model o4-mini',
    };
    expect(agent.provider).toBe('codex-cli');
    expect(agent.command).toBe('codex --model o4-mini');
  });

  it('shared WorkflowAgent accepts openclaw provider without command', () => {
    const agent: WorkflowAgent = {
      id: 'oc-agent',
      name: 'OpenClaw',
      role: 'coder',
      description: '',
      provider: 'openclaw',
    };
    expect(agent.provider).toBe('openclaw');
    expect(agent.command).toBeUndefined();
  });

  it('shared WorkflowAgent is assignment-compatible with server WorkflowAgent', () => {
    // Compile-time check: if server's type has fields shared doesn't, this fails at tsc.
    type ServerAgent = import('../types/workflow.js').WorkflowAgent;
    const serverAgent: ServerAgent = {
      id: 'sa',
      name: 'Server Agent',
      role: 'r',
      description: 'd',
      provider: 'codex-cloud',
      command: 'codex',
    };
    const sharedAgent: WorkflowAgent = serverAgent;
    expect(sharedAgent.provider).toBe('codex-cloud');
    expect(sharedAgent.command).toBe('codex');
  });
});

// ─────────────────────────────────────────────────────────────
// #787 — depends_on enforcement during status transitions
// ─────────────────────────────────────────────────────────────

describe('#787 — BlockingService enforces depends_on', () => {
  let svc: BlockingService;

  beforeEach(() => {
    svc = new BlockingService();
  });

  // getBlockingStatus

  it('returns not blocked when task has no dependencies', () => {
    const task = makeTask({ id: 'A' });
    expect(svc.getBlockingStatus(task, [task]).isBlocked).toBe(false);
  });

  it('reports blocked when depends_on dep is incomplete', () => {
    const dep = makeTask({ id: 'B', status: 'in-progress' });
    const task = makeTask({ id: 'A', dependencies: { depends_on: ['B'] } });
    const result = svc.getBlockingStatus(task, [dep, task]);
    expect(result.isBlocked).toBe(true);
    expect(result.blockers.map((b) => b.id)).toContain('B');
  });

  it('reports not blocked when all depends_on deps are done', () => {
    const dep = makeTask({ id: 'B', status: 'done' });
    const task = makeTask({ id: 'A', dependencies: { depends_on: ['B'] } });
    const result = svc.getBlockingStatus(task, [dep, task]);
    expect(result.isBlocked).toBe(false);
    expect(result.completedBlockers.map((b) => b.id)).toContain('B');
  });

  it('deduplicates same ID appearing in both blockedBy and depends_on', () => {
    const dep = makeTask({ id: 'B', status: 'in-progress' });
    const task = makeTask({
      id: 'A',
      blockedBy: ['B'],
      dependencies: { depends_on: ['B'] },
    });
    const result = svc.getBlockingStatus(task, [dep, task]);
    expect(result.isBlocked).toBe(true);
    expect(result.blockers).toHaveLength(1);
  });

  it('merges distinct IDs from blockedBy and depends_on', () => {
    const b1 = makeTask({ id: 'B1', status: 'in-progress' });
    const b2 = makeTask({ id: 'B2', status: 'todo' });
    const task = makeTask({
      id: 'A',
      blockedBy: ['B1'],
      dependencies: { depends_on: ['B2'] },
    });
    const result = svc.getBlockingStatus(task, [b1, b2, task]);
    expect(result.isBlocked).toBe(true);
    expect(result.blockers).toHaveLength(2);
  });

  // canMoveToInProgress

  it('canMoveToInProgress returns false when depends_on dep is incomplete', () => {
    const dep = makeTask({ id: 'B', status: 'todo' });
    const task = makeTask({ id: 'A', dependencies: { depends_on: ['B'] } });
    const { allowed, blockers } = svc.canMoveToInProgress(task, [dep, task]);
    expect(allowed).toBe(false);
    expect(blockers?.map((b) => b.id)).toContain('B');
  });

  it('canMoveToInProgress returns true when all depends_on deps are done', () => {
    const dep = makeTask({ id: 'B', status: 'done' });
    const task = makeTask({ id: 'A', dependencies: { depends_on: ['B'] } });
    expect(svc.canMoveToInProgress(task, [dep, task]).allowed).toBe(true);
  });

  it('canMoveToInProgress returns false when legacy blockedBy dep is incomplete', () => {
    const dep = makeTask({ id: 'B', status: 'in-progress' });
    const task = makeTask({ id: 'A', blockedBy: ['B'] });
    expect(svc.canMoveToInProgress(task, [dep, task]).allowed).toBe(false);
  });

  it('canMoveToInProgress returns true when task has no dependencies at all', () => {
    const task = makeTask({ id: 'A' });
    expect(svc.canMoveToInProgress(task, [task]).allowed).toBe(true);
  });

  // getDependentTasks

  it('getDependentTasks finds tasks that depend via depends_on', () => {
    const taskA = makeTask({ id: 'A' });
    const taskB = makeTask({ id: 'B', dependencies: { depends_on: ['A'] } });
    const taskC = makeTask({ id: 'C', blockedBy: ['A'] });
    const deps = svc.getDependentTasks('A', [taskA, taskB, taskC]);
    expect(deps.map((t) => t.id)).toContain('B');
    expect(deps.map((t) => t.id)).toContain('C');
  });

  // wouldCreateCircularDependency

  it('detects circular dependency through depends_on chain', () => {
    const taskA = makeTask({ id: 'A', dependencies: { depends_on: ['B'] } });
    const taskB = makeTask({ id: 'B', dependencies: { depends_on: ['C'] } });
    const taskC = makeTask({ id: 'C' });
    // Adding A as dep of C: C → A → B → C
    expect(svc.wouldCreateCircularDependency('C', 'A', [taskA, taskB, taskC])).toBe(true);
  });

  it('does not flag non-circular depends_on chain', () => {
    const taskA = makeTask({ id: 'A' });
    const taskB = makeTask({ id: 'B', dependencies: { depends_on: ['A'] } });
    // C → B → A: no cycle
    expect(svc.wouldCreateCircularDependency('C', 'B', [taskA, taskB])).toBe(false);
  });

  // getTasksThatWouldBeUnblocked

  it('getTasksThatWouldBeUnblocked includes tasks blocked via depends_on', () => {
    const taskA = makeTask({ id: 'A', status: 'in-progress' });
    const taskB = makeTask({ id: 'B', dependencies: { depends_on: ['A'] } });
    const unblocked = svc.getTasksThatWouldBeUnblocked('A', [taskA, taskB]);
    expect(unblocked.map((t) => t.id)).toContain('B');
  });

  it('does not unblock when task has other incomplete deps', () => {
    const taskA = makeTask({ id: 'A', status: 'in-progress' });
    const taskC = makeTask({ id: 'C', status: 'todo' });
    const taskB = makeTask({ id: 'B', dependencies: { depends_on: ['A', 'C'] } });
    // Completing A does not unblock B because C is still todo
    const unblocked = svc.getTasksThatWouldBeUnblocked('A', [taskA, taskB, taskC]);
    expect(unblocked.map((t) => t.id)).not.toContain('B');
  });
});
