import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  ZERO_AGENT_BUDGET_USAGE,
  type RunRecoveryRecord,
} from '@veritas-kanban/shared';
import type { WorkflowDefinition, WorkflowRun } from '../../types/workflow.js';
import { WorkflowService } from '../../services/workflow-service.js';
import {
  createTestSqliteDatabase,
  type TestSqliteDatabase,
} from '../../storage/sqlite/test-helpers.js';
import { workflowAdmissionStub } from '../helpers/workflow-admission-stub.js';

const mockExecuteStep = vi.fn();
const mockPrepareStep = vi.fn(async (step: unknown) => ({ kind: 'non-agent', step }));
const mockApplyPreparation = vi.fn();
const mockBroadcastWorkflowStatus = vi.fn();
const mockGetTask = vi.fn();

vi.mock('../../services/workflow-step-executor.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/workflow-step-executor.js')>();
  return {
    HumanGateBlockError: actual.HumanGateBlockError,
    WorkflowStepExecutor: class {
      prepareStep = mockPrepareStep;
      applyPreparation = mockApplyPreparation;
      executeStep = mockExecuteStep;
    },
  };
});

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
        on_fail: { retry: 1, retry_delay_ms: 100 },
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

  it('allows only one service instance to claim a persisted workflow recovery', async () => {
    const { WorkflowRunService } = await import('../../services/workflow-run-service.js');
    const definition = workflow();
    await workflowService.saveWorkflow(definition);
    const runsDir = path.join(testRoot, 'storage', 'workflow-runs');
    const admission = workflowAdmissionStub();
    const first = new WorkflowRunService({
      runsDir,
      storageType: 'sqlite',
      sqliteDatabase: fixture.database,
      workflowService,
      admission,
    });
    const second = new WorkflowRunService({
      runsDir,
      storageType: 'sqlite',
      sqliteDatabase: fixture.database,
      workflowService,
      admission,
    });
    const recovery: RunRecoveryRecord = {
      schemaVersion: 'run-recovery/v1',
      rootRunId: 'run_root',
      parentRunId: 'run_parent',
      sequence: 1,
      fallbackUsed: false,
      state: 'scheduled',
      action: 'retry',
      failure: {
        classification: 'transient-transport',
        summary: 'ECONNRESET',
        retryable: true,
        approvalRequired: false,
        destructiveSideEffects: false,
      },
      reason: 'Retry after transient transport failure.',
      backoffMs: 100,
      scheduledAt: '2026-07-24T00:00:00.000Z',
      notBefore: '2026-07-24T00:00:00.100Z',
      selectedAgent: 'agent-1',
      routingDecision: 'Workflow retry policy.',
      requiredRuntimeCapabilities: ['run.start'],
      cumulativeBudget: { ...ZERO_AGENT_BUDGET_USAGE },
    };
    const run: WorkflowRun = {
      id: 'run_1784941000000_race01',
      workflowId: definition.id,
      workflowVersion: definition.version,
      status: 'pending',
      currentStep: 'retryable',
      context: {},
      startedAt: '2026-07-24T00:00:00.000Z',
      steps: [
        {
          stepId: 'retryable',
          status: 'failed',
          agent: 'agent-1',
          retries: 1,
          runRetry: recovery,
        },
      ],
    };
    await (
      first as unknown as { saveRun(run: WorkflowRun): Promise<void> }
    ).saveRun(run);
    const executeFirst = vi
      .spyOn(first as never, 'executeRun')
      .mockResolvedValue(undefined as never);
    const executeSecond = vi
      .spyOn(second as never, 'executeRun')
      .mockResolvedValue(undefined as never);

    await Promise.all([
      (
        first as unknown as {
          resumeScheduledWorkflowRecovery(runId: string, stepId: string): Promise<void>;
        }
      ).resumeScheduledWorkflowRecovery(run.id, 'retryable'),
      (
        second as unknown as {
          resumeScheduledWorkflowRecovery(runId: string, stepId: string): Promise<void>;
        }
      ).resumeScheduledWorkflowRecovery(run.id, 'retryable'),
    ]);

    expect(executeFirst.mock.calls.length + executeSecond.mock.calls.length).toBe(1);
    // Universal admission owns the launch boundary, so the recovery remains
    // scheduled until the mocked executeRun reaches the agent launch itself.
    expect(await first.getRun(run.id)).toMatchObject({
      revision: 3,
      status: 'pending',
      steps: [
        expect.objectContaining({
          runRetry: expect.objectContaining({
            state: 'scheduled',
            parentRunId: recovery.parentRunId,
            sequence: recovery.sequence,
          }),
        }),
      ],
    });
  });
});
