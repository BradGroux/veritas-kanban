import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

const mockLoadWorkflow = vi.fn();
const mockListWorkflowsMetadata = vi.fn();
const mockExecuteStep = vi.fn();
const mockBroadcastWorkflowStatus = vi.fn();
const mockGetTask = vi.fn();
const mockCheckWorkflowPermission = vi.fn();

vi.mock('../services/workflow-service.js', () => ({
  getWorkflowService: () => ({
    loadWorkflow: mockLoadWorkflow,
    listWorkflowsMetadata: mockListWorkflowsMetadata,
  }),
}));

vi.mock('../services/workflow-step-executor.js', () => ({
  WorkflowStepExecutor: class {
    executeStep = mockExecuteStep;
  },
}));

vi.mock('../services/broadcast-service.js', () => ({
  broadcastWorkflowStatus: mockBroadcastWorkflowStatus,
}));

vi.mock('../services/task-service.js', () => ({
  getTaskService: () => ({ getTask: mockGetTask }),
}));

vi.mock('../middleware/workflow-auth.js', () => ({
  checkWorkflowPermission: mockCheckWorkflowPermission,
}));

function makeWorkflow(overrides: Record<string, any> = {}) {
  return {
    id: 'wf-1',
    version: 3,
    name: 'Workflow One',
    variables: { global: 'value' },
    agents: [{ id: 'agent-1', name: 'Agent 1' }],
    steps: [
      { id: 'step-1', type: 'agent', agent: 'agent-1', prompt: 'one' },
      { id: 'step-2', type: 'agent', agent: 'agent-1', prompt: 'two' },
    ],
    ...overrides,
  };
}

describe('WorkflowRunService', () => {
  let tmpDir: string;
  let service: any;

  beforeEach(async () => {
    vi.resetModules();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'workflow-run-'));
    await fs.mkdir(path.join(tmpDir, '.veritas-kanban', 'workflows'), { recursive: true });
    mockLoadWorkflow.mockResolvedValue(makeWorkflow());
    mockListWorkflowsMetadata.mockResolvedValue([
      { id: 'wf-1', name: 'Workflow One' },
      { id: 'wf-2', name: 'Workflow Two' },
    ]);
    mockGetTask.mockResolvedValue({ id: 'task-1', title: 'Task 1' });
    mockCheckWorkflowPermission.mockResolvedValue(true);
    mockExecuteStep.mockImplementation(async (step: any) => ({
      output: { done: step.id },
      outputPath: `/tmp/${step.id}.json`,
    }));
    const mod = await import('../services/workflow-run-service.js');
    service = new mod.WorkflowRunService(tmpDir);
  });

  afterEach(async () => {
    vi.clearAllMocks();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('starts a run, snapshots workflow, merges context, and completes asynchronously', async () => {
    const run = await service.startRun('wf-1', 'task-1', { custom: 42 });
    expect(run.id).toMatch(/^run_\d+_/);
    expect(run.context.task).toMatchObject({ id: 'task-1' });
    expect(run.context.custom).toBe(42);

    await vi.waitFor(async () => {
      const saved = await service.getRun(run.id);
      expect(saved.status).toBe('completed');
      expect(saved.steps.every((s: any) => s.status === 'completed')).toBe(true);
    });

    const snapshot = await fs.readFile(path.join(tmpDir, run.id, 'workflow.yml'), 'utf8');
    expect(snapshot).toContain('wf-1');
    expect(mockBroadcastWorkflowStatus).toHaveBeenCalled();
  });

  it('handles retry, retry_step, skip, block, and workflow failure', async () => {
    const delaySpy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: any) => {
      fn();
      return 0 as any;
    }) as any);

    mockLoadWorkflow.mockResolvedValue(
      makeWorkflow({
        steps: [
          { id: 'prep', type: 'agent', agent: 'agent-1', prompt: 'prep' },
          {
            id: 'retryable',
            type: 'agent',
            agent: 'agent-1',
            prompt: 'x',
            on_fail: { retry: 1, retry_delay_ms: 1 },
          },
          {
            id: 'reroute',
            type: 'agent',
            agent: 'agent-1',
            prompt: 'x',
            on_fail: { retry_step: 'prep' },
          },
          {
            id: 'skippable',
            type: 'agent',
            agent: 'agent-1',
            prompt: 'x',
            on_fail: { escalate_to: 'skip' },
          },
          {
            id: 'blocking',
            type: 'agent',
            agent: 'agent-1',
            prompt: 'x',
            on_fail: { escalate_to: 'human', escalate_message: 'Need help' },
          },
        ],
      })
    );

    const counts: Record<string, number> = {};
    mockExecuteStep.mockImplementation(async (step: any) => {
      counts[step.id] = (counts[step.id] || 0) + 1;
      if (step.id === 'retryable' && counts[step.id] === 1) throw new Error('fail once');
      if (step.id === 'reroute' && counts[step.id] === 1) throw new Error('reroute me');
      if (step.id === 'skippable') throw new Error('skip me');
      if (step.id === 'blocking') throw new Error('block me');
      return { output: { done: step.id }, outputPath: `/tmp/${step.id}.json` };
    });

    const run = await service.startRun('wf-1');
    await vi.waitFor(async () => {
      const saved = await service.getRun(run.id);
      expect(saved.status).toBe('blocked');
      expect(saved.error).toBe('Need help');
      expect(saved.steps.find((s: any) => s.stepId === 'retryable').retries).toBe(1);
      expect(saved.steps.find((s: any) => s.stepId === 'skippable').status).toBe('skipped');
      expect(saved.context._retryContext.failedStep).toBe('reroute');
    });
    delaySpy.mockRestore();
  });

  it('resumes blocked runs and validates invalid resume requests', async () => {
    mockLoadWorkflow.mockResolvedValue(
      makeWorkflow({
        steps: [
          {
            id: 'step-1',
            type: 'agent',
            agent: 'agent-1',
            prompt: 'x',
            on_fail: { escalate_to: 'human', escalate_message: 'blocked' },
          },
        ],
      })
    );
    mockExecuteStep
      .mockRejectedValueOnce(new Error('blocked'))
      .mockResolvedValueOnce({ output: { ok: true }, outputPath: '/tmp/out.json' });

    const run = await service.startRun('wf-1');
    await vi.waitFor(async () => expect((await service.getRun(run.id)).status).toBe('blocked'));

    const resumed = await service.resumeRun(run.id, { approved: true });
    expect(resumed.context.approved).toBe(true);
    await vi.waitFor(async () => expect((await service.getRun(run.id)).status).toBe('completed'));

    await expect(service.resumeRun('run_1234567890_abcdef', {})).rejects.toThrow(/not found/);
    await expect(service.resumeRun(run.id, {})).rejects.toThrow(/not blocked/);
  });

  it('lists runs and metadata with filters while skipping invalid or broken entries', async () => {
    const run1 = await service.startRun('wf-1', 'task-1');
    const run2 = await service.startRun('wf-1', 'task-2');
    await vi.waitFor(async () => expect((await service.getRun(run2.id)).status).toBe('completed'));

    await fs.mkdir(path.join(tmpDir, 'run_9999999999_brokenxx'), { recursive: true });
    await fs.writeFile(path.join(tmpDir, 'run_9999999999_brokenxx', 'run.json'), '{bad', 'utf8');

    await expect(service.listRuns({ taskId: 'task-1' })).rejects.toThrow();
    const meta = await service.listRunsMetadata({ workflowId: 'wf-1' });
    expect(meta.map((m: any) => m.id)).toEqual([run2.id, run1.id]);
  });

  it('calculates stats using workflow permissions', async () => {
    const now = Date.now();
    const old = new Date(now - 40 * 24 * 60 * 60 * 1000).toISOString();
    const recent = new Date(now - 60 * 60 * 1000).toISOString();
    const recentEnd = new Date(now - 30 * 60 * 1000).toISOString();

    await fs.mkdir(path.join(tmpDir, 'run_1111111111_aaaaaa'), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, 'run_1111111111_aaaaaa', 'run.json'),
      JSON.stringify(
        {
          id: 'run_1111111111_aaaaaa',
          workflowId: 'wf-1',
          workflowVersion: 1,
          taskId: 't1',
          status: 'completed',
          startedAt: recent,
          completedAt: recentEnd,
        },
        null,
        2
      )
    );
    await fs.mkdir(path.join(tmpDir, 'run_2222222222_bbbbbb'), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, 'run_2222222222_bbbbbb', 'run.json'),
      JSON.stringify(
        {
          id: 'run_2222222222_bbbbbb',
          workflowId: 'wf-1',
          workflowVersion: 1,
          taskId: 't2',
          status: 'failed',
          startedAt: recent,
        },
        null,
        2
      )
    );
    await fs.mkdir(path.join(tmpDir, 'run_notvalid'), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, 'run_notvalid', 'run.json'),
      JSON.stringify(
        {
          id: 'run_notvalid',
          workflowId: 'wf-x',
          workflowVersion: 1,
          taskId: 'tX',
          status: 'completed',
          startedAt: recent,
        },
        null,
        2
      )
    );
    await fs.mkdir(path.join(tmpDir, 'run_3333333333_cccccc'), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, 'run_3333333333_cccccc', 'run.json'),
      JSON.stringify(
        {
          id: 'run_3333333333_cccccc',
          workflowId: 'wf-2',
          workflowVersion: 1,
          taskId: 't3',
          status: 'running',
          startedAt: old,
        },
        null,
        2
      )
    );

    mockCheckWorkflowPermission.mockImplementation(
      async (workflowId: string) => workflowId === 'wf-1'
    );

    const stats = await service.getStats('30d', 'brad');
    expect(stats).toMatchObject({
      totalWorkflows: 1,
      activeRuns: 0,
      completedRuns: 1,
      failedRuns: 1,
      successRate: 0.5,
    });
    expect(stats.avgDuration).toBe(30 * 60 * 1000);
    expect(stats.perWorkflow).toEqual([
      expect.objectContaining({
        workflowId: 'wf-1',
        workflowName: 'Workflow One',
        runs: 2,
        completed: 1,
        failed: 1,
        successRate: 0.5,
        avgDuration: 30 * 60 * 1000,
      }),
    ]);
  });

  it('rejects invalid ids, missing workflows, invalid metadata reads, and unimplemented agent escalation', async () => {
    await expect(service.getRun('../bad')).rejects.toThrow(/illegal path characters/);
    await expect(service.getRun('run_invalid')).rejects.toThrow(/format is invalid/);

    mockLoadWorkflow.mockResolvedValueOnce(null);
    await expect(service.startRun('missing')).rejects.toThrow(/not found/);

    mockLoadWorkflow.mockResolvedValue(
      makeWorkflow({
        steps: [
          {
            id: 'step-1',
            type: 'agent',
            agent: 'agent-1',
            prompt: 'x',
            on_fail: { escalate_to: 'agent:TARS' },
          },
        ],
      })
    );
    mockExecuteStep.mockRejectedValueOnce(new Error('boom'));
    const run = await service.startRun('wf-1');
    await vi.waitFor(async () => expect((await service.getRun(run.id)).status).toBe('failed'));
    expect((await service.getRun(run.id)).error).toMatch(/Agent escalation not yet implemented/);
  });
});
