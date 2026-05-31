import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { WorkflowDefinition, WorkflowRun } from '../../types/workflow.js';
import { WorkflowRunService } from '../../services/workflow-run-service.js';
import { WorkflowService } from '../../services/workflow-service.js';
import {
  createTestSqliteDatabase,
  type TestSqliteDatabase,
} from '../../storage/sqlite/test-helpers.js';

function workflow(): WorkflowDefinition {
  return {
    id: 'wf-sqlite',
    name: 'SQLite Workflow',
    version: 2,
    description: 'Workflow persisted in SQLite',
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
        id: 'step-1',
        name: 'Step One',
        type: 'agent',
        agent: 'agent-1',
        input: 'do the work',
        on_fail: { retry: 1, retry_delay_ms: 1 },
      },
    ],
  };
}

function run(overrides: Partial<WorkflowRun> = {}): WorkflowRun {
  return {
    id: 'run_1234567890_abcdef',
    workflowId: 'wf-sqlite',
    workflowVersion: 2,
    taskId: 'task_1',
    status: 'running',
    currentStep: 'step-1',
    context: { started: true },
    startedAt: '2026-03-01T00:00:00.000Z',
    steps: [{ stepId: 'step-1', status: 'running', retries: 1 }],
    ...overrides,
  };
}

describe('SQLite workflow repositories', () => {
  let fixture: TestSqliteDatabase;
  let testRoot: string;

  beforeEach(async () => {
    fixture = createTestSqliteDatabase();
    fixture.database.open();
    testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'veritas-sqlite-workflow-'));
  });

  afterEach(async () => {
    fixture.cleanup();
    await fs.rm(testRoot, { recursive: true, force: true });
  });

  it('stores workflow definitions, ACLs, and workflow audit events in SQLite', async () => {
    const workflowsDir = path.join(testRoot, 'storage', 'workflows');
    const service = new WorkflowService({
      workflowsDir,
      storageType: 'sqlite',
      sqliteDatabase: fixture.database,
    });

    const definition = workflow();
    await service.saveWorkflow(definition);

    expect(await service.loadWorkflow(definition.id)).toEqual(definition);
    expect(await service.listWorkflowsMetadata()).toEqual([
      {
        id: definition.id,
        name: definition.name,
        version: definition.version,
        description: definition.description,
      },
    ]);

    await service.saveACL({
      workflowId: definition.id,
      owner: 'brad',
      editors: ['brad'],
      viewers: ['team'],
      executors: ['agent'],
      isPublic: false,
    });
    expect(await service.loadACL(definition.id)).toMatchObject({ owner: 'brad' });

    await service.auditChange({
      timestamp: '2026-03-01T00:00:00.000Z',
      userId: 'brad',
      action: 'edit',
      workflowId: definition.id,
      workflowVersion: definition.version,
    });

    await service.deleteWorkflow(definition.id);
    expect(await service.loadWorkflow(definition.id)).toBeNull();
    await expect(fs.access(workflowsDir)).rejects.toThrow();
  });

  it('stores workflow run state, checkpoints, filters, and snapshots in SQLite', async () => {
    const runsDir = path.join(testRoot, 'storage', 'workflow-runs');
    const workflowService = new WorkflowService({
      workflowsDir: path.join(testRoot, 'storage', 'workflows'),
      storageType: 'sqlite',
      sqliteDatabase: fixture.database,
    });
    const runService = new WorkflowRunService({
      runsDir,
      storageType: 'sqlite',
      sqliteDatabase: fixture.database,
      workflowService,
    });
    const internals = runService as unknown as {
      saveRun(value: WorkflowRun): Promise<void>;
      snapshotWorkflow(runId: string, definition: WorkflowDefinition): Promise<void>;
    };

    const definition = workflow();
    await workflowService.saveWorkflow(definition);

    const running = run();
    await internals.saveRun(running);
    await internals.snapshotWorkflow(running.id, definition);

    const completed = run({
      status: 'completed',
      completedAt: '2026-03-01T00:05:00.000Z',
      steps: [
        {
          stepId: 'step-1',
          status: 'completed',
          retries: 1,
          output: '/tmp/step-1.json',
        },
      ],
    });
    await internals.saveRun(completed);

    expect(await runService.getRun(completed.id)).toMatchObject({
      id: completed.id,
      status: 'completed',
      lastCheckpoint: expect.any(String),
    });
    expect((await runService.listRuns({ taskId: 'task_1' })).map((item) => item.id)).toEqual([
      completed.id,
    ]);
    expect(await runService.listRunsMetadata({ workflowId: 'wf-sqlite' })).toEqual([
      expect.objectContaining({
        id: completed.id,
        workflowId: 'wf-sqlite',
        taskId: 'task_1',
        status: 'completed',
        completedAt: '2026-03-01T00:05:00.000Z',
      }),
    ]);

    await expect(fs.access(runsDir)).rejects.toThrow();
  });
});
