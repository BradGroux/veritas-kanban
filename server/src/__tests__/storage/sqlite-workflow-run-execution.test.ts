import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { WorkflowDefinition } from '../../types/workflow.js';
import { WorkflowService } from '../../services/workflow-service.js';
import {
  createTestSqliteDatabase,
  type TestSqliteDatabase,
} from '../../storage/sqlite/test-helpers.js';

const mockExecuteStep = vi.fn();
const mockBroadcastWorkflowStatus = vi.fn();
const mockGetTask = vi.fn();

vi.mock('../../services/workflow-step-executor.js', () => ({
  WorkflowStepExecutor: class {
    executeStep = mockExecuteStep;
  },
}));

vi.mock('../../services/broadcast-service.js', () => ({
  broadcastWorkflowStatus: mockBroadcastWorkflowStatus,
}));

vi.mock('../../services/task-service.js', () => ({
  getTaskService: () => ({ getTask: mockGetTask }),
}));

function workflow(): WorkflowDefinition {
  return {
    id: 'wf-sqlite-execution',
    name: 'SQLite Execution Workflow',
    version: 1,
    description: 'Workflow execution persisted in SQLite',
    variables: { project: 'core' },
    agents: [
      {
        id: 'agent-1',
        name: 'Agent One',
        role: 'developer',
        description: 'Test agent',
      },
    ],
    steps: [
      {
        id: 'retryable',
        name: 'Retryable',
        type: 'agent',
        agent: 'agent-1',
        input: 'retry once',
        on_fail: { retry: 1 },
      },
      {
        id: 'approval',
        name: 'Approval',
        type: 'agent',
        agent: 'agent-1',
        input: 'requires approval',
        on_fail: { escalate_to: 'human', escalate_message: 'Needs approval' },
      },
    ],
  };
}

describe('SQLite workflow run execution', () => {
  let fixture: TestSqliteDatabase;
  let testRoot: string;
  let workflowService: WorkflowService;

  beforeEach(async () => {
    fixture = createTestSqliteDatabase();
    fixture.database.open();
    testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'veritas-sqlite-workflow-execution-'));
    workflowService = new WorkflowService({
      workflowsDir: path.join(testRoot, 'storage', 'workflows'),
      storageType: 'sqlite',
      sqliteDatabase: fixture.database,
    });
    mockGetTask.mockResolvedValue(null);
  });

  afterEach(async () => {
    vi.clearAllMocks();
    fixture.cleanup();
    await fs.rm(testRoot, { recursive: true, force: true });
  });

  it('starts, retries, blocks, resumes, and completes runs in SQLite mode', async () => {
    const { WorkflowRunService } = await import('../../services/workflow-run-service.js');
    const definition = workflow();
    const runsDir = path.join(testRoot, 'storage', 'workflow-runs');
    const runService = new WorkflowRunService({
      runsDir,
      storageType: 'sqlite',
      sqliteDatabase: fixture.database,
      workflowService,
    });
    const counts: Record<string, number> = {};

    await workflowService.saveWorkflow(definition);
    mockExecuteStep.mockImplementation(async (step: { id: string }) => {
      counts[step.id] = (counts[step.id] || 0) + 1;
      if (step.id === 'retryable' && counts[step.id] === 1) {
        throw new Error('transient failure');
      }
      if (step.id === 'approval' && counts[step.id] === 1) {
        throw new Error('approval required');
      }
      return {
        output: { done: step.id },
        outputPath: `/tmp/${step.id}.json`,
      };
    });

    const run = await runService.startRun(definition.id);
    await vi.waitFor(async () => {
      const saved = await runService.getRun(run.id);
      expect(saved?.status).toBe('blocked');
      expect(saved?.error).toBe('Needs approval');
    });

    const blocked = await runService.getRun(run.id);
    expect(blocked?.steps.find((step) => step.stepId === 'retryable')).toMatchObject({
      status: 'completed',
      retries: 1,
    });
    expect(blocked?.steps.find((step) => step.stepId === 'approval')).toMatchObject({
      status: 'failed',
      error: 'approval required',
    });

    await runService.resumeRun(run.id, { approved: true });
    await vi.waitFor(async () => {
      const saved = await runService.getRun(run.id);
      expect(saved?.status).toBe('completed');
      expect(saved?.completedAt).toEqual(expect.any(String));
      expect(saved?.context.approved).toBe(true);
    });

    expect(await runService.listRunsMetadata({ status: 'completed' })).toEqual([
      expect.objectContaining({
        id: run.id,
        workflowId: definition.id,
        status: 'completed',
      }),
    ]);
    expect(counts).toEqual({ retryable: 2, approval: 2 });
    expect(mockBroadcastWorkflowStatus).toHaveBeenCalled();
    await expect(fs.access(runsDir)).rejects.toThrow();
  });
});
