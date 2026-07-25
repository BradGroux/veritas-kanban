import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_FEATURE_SETTINGS,
  type AdmissionSettings,
  type WorkflowDefinition,
} from '@veritas-kanban/shared';
import { AdmissionControlService } from '../services/admission-control-service.js';
import { WorkflowRunService } from '../services/workflow-run-service.js';
import type {
  WorkflowAgentStepPreparation,
  WorkflowStepExecutor,
} from '../services/workflow-step-executor.js';
import { FileAdmissionReservationRepository } from '../storage/admission-reservation-repository.js';
import { SqliteAdmissionReservationRepository } from '../storage/sqlite/admission-reservation-repository.js';
import { SqliteDatabase } from '../storage/sqlite/database.js';

const roots: string[] = [];
const admissions: AdmissionControlService[] = [];
const runs: WorkflowRunService[] = [];
const databases: SqliteDatabase[] = [];

afterEach(async () => {
  for (const run of runs.splice(0)) run.dispose();
  for (const admission of admissions.splice(0)) admission.dispose();
  for (const database of databases.splice(0)) database.close();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

function workflow(overrides: Partial<WorkflowDefinition> = {}): WorkflowDefinition {
  return {
    id: 'workflow-admission',
    name: 'Workflow admission',
    version: 1,
    description: 'Exercises root and executable step admission.',
    agents: [
      {
        id: 'agent',
        name: 'Agent',
        role: 'implementation',
        provider: 'codex-sdk',
        description: 'Test agent',
      },
    ],
    steps: [
      {
        id: 'execute',
        name: 'Execute',
        type: 'agent',
        agent: 'agent',
        input: 'Run the test.',
      },
    ],
    ...overrides,
  };
}

function settings(overrides: Partial<AdmissionSettings> = {}): AdmissionSettings {
  return {
    ...structuredClone(DEFAULT_FEATURE_SETTINGS.admission),
    global: { concurrentRuns: 2 },
    workspaces: { local: { estimatedMemoryMb: 512 } },
    providers: { 'codex-sdk': { processSlots: 1 } },
    hosts: { 'local-process': { processSlots: 1 } },
    heartbeatMs: 20_000,
    ...overrides,
  };
}

function preparation(step: WorkflowDefinition['steps'][number]): WorkflowAgentStepPreparation {
  return {
    kind: 'agent',
    step,
    runtimeProvider: 'codex-sdk',
    hostRouting: {
      selectedHostId: 'local-process',
    },
  } as WorkflowAgentStepPreparation;
}

function executor(
  executeStep: (step: WorkflowDefinition['steps'][number]) => Promise<{
    output: unknown;
    outputPath: string;
  }>
): WorkflowStepExecutor {
  return {
    prepareStep: async (step: WorkflowDefinition['steps'][number]) => preparation(step),
    applyPreparation: () => undefined,
    executeStep,
    validateFallbackAgent: async () => ({}),
  } as unknown as WorkflowStepExecutor;
}

async function createHarness(
  backend: 'file' | 'sqlite',
  admissionSettings: AdmissionSettings,
  stepExecutor: WorkflowStepExecutor,
  ownerId = `owner-${backend}`
) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `workflow-admission-${backend}-`));
  roots.push(root);
  let database: SqliteDatabase | undefined;
  const repository =
    backend === 'file'
      ? new FileAdmissionReservationRepository(path.join(root, 'admission.jsonl'))
      : (() => {
          database = new SqliteDatabase({ databasePath: path.join(root, 'veritas.db') });
          database.open();
          databases.push(database);
          return new SqliteAdmissionReservationRepository(database);
        })();
  const admission = new AdmissionControlService({
    repository,
    settings: async () => structuredClone(admissionSettings),
    hostId: 'workflow-host',
    ownerId,
    processId: backend === 'file' ? 101 : 202,
  });
  admissions.push(admission);
  const definition = workflow();
  const service = new WorkflowRunService({
    runsDir: path.join(root, 'runs'),
    storageType: backend,
    sqliteDatabase: database,
    workflowService: {
      loadWorkflow: async (id: string) => (id === definition.id ? definition : null),
    } as never,
    stepExecutor,
    admission,
  });
  runs.push(service);
  return { root, database, repository, admission, definition, service };
}

describe('workflow admission', () => {
  it.each(['file', 'sqlite'] as const)(
    'reserves roots and provider steps atomically with %s storage',
    async (backend) => {
      let finishStep: (() => void) | undefined;
      const stepPending = new Promise<void>((resolve) => {
        finishStep = resolve;
      });
      const harness = await createHarness(
        backend,
        settings(),
        executor(async (step) => {
          await stepPending;
          return { output: { completed: true }, outputPath: `/tmp/${step.id}.json` };
        })
      );

      const run = await harness.service.startRun(harness.definition.id);
      await vi.waitFor(async () => {
        const reservations = await harness.admission.list({ workflowRunId: run.id });
        expect(reservations).toHaveLength(2);
        expect(reservations.every((reservation) => reservation.state === 'active')).toBe(true);
      });

      const active = await harness.admission.list({ workflowRunId: run.id });
      const root = active.find((reservation) => !reservation.request.workflowStepId);
      const step = active.find((reservation) => reservation.request.workflowStepId === 'execute');
      expect(root?.request.provider).toBe('workflow-control');
      expect(step).toMatchObject({
        request: {
          provider: 'codex-sdk',
          hostId: 'local-process',
          rootReservationId: root?.id,
        },
      });
      await expect(
        harness.admission.admit({
          taskId: 'direct-task',
          workspaceId: 'local',
          provider: 'codex-sdk',
          hostId: 'local-process',
          idempotencyKey: `direct:${backend}`,
        })
      ).resolves.toMatchObject({
        outcome: 'retryable-overload',
        limitingPolicies: expect.arrayContaining([
          expect.objectContaining({ scope: 'global' }),
          expect.objectContaining({ scope: 'workspace', scopeId: 'local' }),
          expect.objectContaining({ scope: 'provider', scopeId: 'codex-sdk' }),
          expect.objectContaining({ scope: 'host', scopeId: 'local-process' }),
        ]),
      });

      finishStep?.();
      await vi.waitFor(async () => {
        expect((await harness.service.getRun(run.id))?.status).toBe('completed');
      });
      expect(
        (await harness.admission.list({ workflowRunId: run.id })).map(
          (reservation) => reservation.state
        )
      ).toEqual(['released', 'released']);
    }
  );

  it('fails closed before provider dispatch when a step exceeds its provider ceiling', async () => {
    const executeStep = vi.fn(async () => ({
      output: { completed: true },
      outputPath: '/tmp/execute.json',
    }));
    const harness = await createHarness(
      'file',
      settings({ providers: { 'codex-sdk': { processSlots: 0 } } }),
      executor(executeStep)
    );

    const run = await harness.service.startRun(harness.definition.id);
    await vi.waitFor(async () => {
      expect((await harness.service.getRun(run.id))?.status).toBe('failed');
    });

    const persisted = await harness.service.getRun(run.id);
    expect(persisted?.steps[0]).toMatchObject({
      status: 'failed',
      admission: {
        decision: {
          outcome: 'terminal-policy-denial',
          limitingPolicies: [expect.objectContaining({ scope: 'provider', scopeId: 'codex-sdk' })],
        },
      },
    });
    expect(executeStep).not.toHaveBeenCalled();
    expect(
      (await harness.admission.list({ workflowRunId: run.id })).map(
        (reservation) => reservation.state
      )
    ).toEqual(['released']);
  });

  it('recovers the exact root lease before resuming a blocked run after restart', async () => {
    const first = await createHarness(
      'file',
      settings(),
      executor(async () => {
        throw new Error('permanent provider failure');
      }),
      'owner-before-restart'
    );
    first.definition.steps[0].on_fail = {
      retry: 0,
      escalate_to: 'human',
      escalate_message: 'Operator review required',
    };
    const run = await first.service.startRun(first.definition.id);
    await vi.waitFor(async () => {
      expect((await first.service.getRun(run.id))?.status).toBe('blocked');
    });
    const rootBinding = (await first.service.getRun(run.id))?.admission;
    expect(rootBinding).toBeDefined();
    first.admission.dispose();

    const restartedAdmission = new AdmissionControlService({
      repository: first.repository,
      settings: async () => settings(),
      hostId: 'workflow-host',
      ownerId: 'owner-after-restart',
      processId: 303,
    });
    admissions.push(restartedAdmission);
    const restarted = new WorkflowRunService({
      runsDir: path.join(first.root, 'runs'),
      workflowService: {
        loadWorkflow: async (id: string) => (id === first.definition.id ? first.definition : null),
      } as never,
      stepExecutor: executor(async () => ({
        output: { completed: true },
        outputPath: '/tmp/execute.json',
      })),
      admission: restartedAdmission,
    });
    runs.push(restarted);

    await restarted.resumeRun(run.id, { approved: true });
    await vi.waitFor(async () => {
      expect((await restarted.getRun(run.id))?.status).toBe('completed');
    });
    if (!rootBinding) throw new Error('Expected the workflow root admission binding');
    expect(await restartedAdmission.get(rootBinding.reservationId)).toMatchObject({
      state: 'released',
      lease: { ownerId: 'owner-after-restart' },
    });
  });

  it('releases the failed child once when recovery cancellation races', async () => {
    const executeStep = vi.fn(async () => {
      throw new Error('ETIMEDOUT');
    });
    const harness = await createHarness('file', settings(), executor(executeStep));
    harness.definition.steps[0].on_fail = {
      retry: 2,
      retry_delay_ms: 10_000,
    };

    const run = await harness.service.startRun(harness.definition.id);
    const pending = await vi.waitFor(async () => {
      const persisted = await harness.service.getRun(run.id);
      expect(persisted?.status).toBe('pending');
      expect(persisted?.steps[0].runRetry?.state).toBe('scheduled');
      if (!persisted) throw new Error('Expected the pending workflow run');
      return persisted;
    });
    const pendingRecovery = pending.steps[0]?.runRetry;
    if (!pendingRecovery) throw new Error('Expected the scheduled workflow recovery');
    const parentRunId = pendingRecovery.parentRunId;
    const cancellations = await Promise.allSettled([
      harness.service.cancelPendingRecovery(run.id, 'execute', parentRunId, 'operator-one'),
      harness.service.cancelPendingRecovery(run.id, 'execute', parentRunId, 'operator-two'),
    ]);

    expect(cancellations.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(cancellations.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect((await harness.service.getRun(run.id))?.status).toBe('blocked');
    const reservations = await harness.admission.list({ workflowRunId: run.id });
    expect(
      reservations.find((reservation) => reservation.request.workflowStepId === 'execute')
    ).toMatchObject({
      state: 'released',
      release: { reason: 'failed' },
    });
    expect(reservations.find((reservation) => !reservation.request.workflowStepId)).toMatchObject({
      state: 'active',
    });
    expect(executeStep).toHaveBeenCalledTimes(1);
  });
});
