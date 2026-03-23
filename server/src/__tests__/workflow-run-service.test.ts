import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

describe('WorkflowRunService', () => {
  const originalCwd = process.cwd();
  let tempDir: string;
  let service: any; // Type as any since we'll import dynamically
  let workflowService: any;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'vk-workflow-run-'));
    process.env.DATA_DIR = tempDir;

    // We need a dummy directory to offset `getProjectRoot()` fallback logic correctly
    const runDir = join(tempDir, 'dummy-cwd');
    const fs = await import('fs/promises');
    await fs.mkdir(runDir, { recursive: true });
    process.chdir(runDir);

    vi.resetModules();

    // Mock WorkflowStepExecutor so we don't actually run agents
    vi.doMock('../services/workflow-step-executor.js', () => {
      return {
        WorkflowStepExecutor: class {
          async executeStep(step: any, run: any) {
            // Check if we should fake a failure
            if (run.context._failStep === step.id) {
              throw new Error(`Simulated failure for step ${step.id}`);
            }
            return {
              output: `Output from ${step.id}`,
              outputPath: `/fake/path/to/${step.id}.md`
            };
          }
        }
      };
    });

    // Mock the permission check dynamic import for getStats
    vi.doMock('../middleware/workflow-auth.js', () => {
      return {
        checkWorkflowPermission: async () => true // always grant permission for tests
      };
    });

    // Mock the broadcast-service so it doesn't fail on WebSocket setup
    vi.doMock('../services/broadcast-service.js', () => {
      return {
        broadcastWorkflowStatus: vi.fn()
      };
    });

    // Mock the task-service to return dummy tasks
    vi.doMock('../services/task-service.js', () => {
      return {
        getTaskService: () => ({
          getTask: async (id: string) => ({ id, title: 'Fake Task' })
        })
      };
    });

    const { getWorkflowService } = await import('../services/workflow-service.js');
    workflowService = getWorkflowService();

    const { getWorkflowRunService } = await import('../services/workflow-run-service.js');
    service = getWorkflowRunService();

    // Create a dummy workflow to use for tests
    await workflowService.saveWorkflow({
      id: 'test-workflow-run',
      name: 'Test Workflow Run',
      version: 1,
      description: 'A test workflow run',
      agents: [
        { id: 'agent1', name: 'Agent 1', role: 'developer', description: 'Test agent' }
      ],
      steps: [
        {
          id: 'step1',
          name: 'Step 1',
          type: 'agent',
          agent: 'agent1',
          input: 'Do something',
          on_fail: { escalate_to: 'human' }
        },
        {
          id: 'step2',
          name: 'Step 2',
          type: 'agent',
          agent: 'agent1',
          input: 'Do something else'
        }
      ]
    });
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    delete process.env.DATA_DIR;
    await rm(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('starts a run and completes it', async () => {
    const run = await service.startRun('test-workflow-run');

    expect(run).toBeDefined();
    expect(run.workflowId).toBe('test-workflow-run');
    expect(run.status).toBe('running');

    // Wait for async execution to complete
    await new Promise(resolve => setTimeout(resolve, 100));

    const completedRun = await service.getRun(run.id);
    expect(completedRun.status).toBe('completed');
    expect(completedRun.steps[0].status).toBe('completed');
    expect(completedRun.steps[1].status).toBe('completed');
    expect(completedRun.context.step1).toBe('Output from step1');
    expect(completedRun.context.step2).toBe('Output from step2');
  });

  it('lists runs', async () => {
    await service.startRun('test-workflow-run', 'task-1');
    await service.startRun('test-workflow-run', 'task-2');

    await new Promise(resolve => setTimeout(resolve, 100));

    const runs = await service.listRuns();
    expect(runs).toHaveLength(2);

    const task1Runs = await service.listRuns({ taskId: 'task-1' });
    expect(task1Runs).toHaveLength(1);
    expect(task1Runs[0].taskId).toBe('task-1');
  });

  it('blocks a run on failure and resumes it', async () => {
    // Inject a failure instruction into context
    const run = await service.startRun('test-workflow-run', undefined, {
      _failStep: 'step1'
    });

    await new Promise(resolve => setTimeout(resolve, 100));

    let blockedRun = await service.getRun(run.id);
    expect(blockedRun.status).toBe('blocked');
    expect(blockedRun.steps[0].status).toBe('failed');
    expect(blockedRun.steps[0].error).toContain('Simulated failure');

    // Remove failure instruction via resumeContext
    await service.resumeRun(run.id, { _failStep: null });

    // Wait for async execution to complete
    await new Promise(resolve => setTimeout(resolve, 100));

    const completedRun = await service.getRun(run.id);
    expect(completedRun.status).toBe('completed');
    expect(completedRun.steps[0].status).toBe('completed');
  });

  it('gets stats', async () => {
    await service.startRun('test-workflow-run');

    await new Promise(resolve => setTimeout(resolve, 100));

    const stats = await service.getStats('24h', 'user-1');

    expect(stats.totalWorkflows).toBe(1);
    expect(stats.completedRuns).toBe(1);
    expect(stats.perWorkflow[0].workflowId).toBe('test-workflow-run');
    expect(stats.perWorkflow[0].completed).toBe(1);
    expect(stats.successRate).toBe(1);
  });
});
