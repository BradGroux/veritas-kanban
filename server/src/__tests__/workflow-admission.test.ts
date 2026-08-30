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
const RECOVERED_EXECUTION_TIMEOUT_MS = 5_000;

afterEach(async () => {
  for (const run of runs.splice(0)) run.dispose();
  await Promise.all(admissions.splice(0).map((admission) => admission.dispose()));
  for (const database of databases.splice(0)) database.close();
  await Promise.all(
    roots
      .splice(0)
      .map((root) => fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }))
  );
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
    runtimeManifest: {
      digest: `sha256:${'a'.repeat(64)}`,
    },
    requiredRuntimeCapabilities: [],
    hostRouting: {
      selectedHostId: 'local-process',
    },
    phaseAuthority: {
      evidence: {
        digest: `sha256:${'b'.repeat(64)}`,
      },
    },
    phaseLaunchDigest: `sha256:${'c'.repeat(64)}`,
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
    requestAdmissionQueueDrain: () => undefined,
  });
  runs.push(service);
  return { root, database, repository, admission, definition, service };
}

async function restartHarness(
  harness: Awaited<ReturnType<typeof createHarness>>,
  admissionSettings: AdmissionSettings,
  stepExecutor: WorkflowStepExecutor,
  ownerId: string
) {
  harness.service.dispose();
  await harness.admission.dispose();
  const admission = new AdmissionControlService({
    repository: harness.repository,
    settings: async () => structuredClone(admissionSettings),
    hostId: 'workflow-host',
    ownerId,
    processId: 303,
  });
  admissions.push(admission);
  const service = new WorkflowRunService({
    runsDir: path.join(harness.root, 'runs'),
    storageType: harness.database ? 'sqlite' : 'file',
    sqliteDatabase: harness.database,
    workflowService: {
      loadWorkflow: async (id: string) =>
        id === harness.definition.id ? harness.definition : null,
    } as never,
    stepExecutor,
    admission,
    requestAdmissionQueueDrain: () => undefined,
  });
  runs.push(service);
  return { admission, service };
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
          executionTree: {
            rootObjectiveId: root?.request.executionTree?.rootObjectiveId,
            parentNodeId: root?.request.executionTree?.nodeId,
            edge: 'workflow-step',
            depth: 1,
          },
        },
      });
      expect(root?.request.executionTree).toMatchObject({
        edge: 'root',
        depth: 0,
      });
      await expect(
        harness.admission.getExecutionTreeSummary(
          root?.request.executionTree?.rootObjectiveId as string
        )
      ).resolves.toMatchObject({
        committed: { fanOut: 2 },
        contributorCount: 2,
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

  it.each(['file', 'sqlite'] as const)(
    'queues a saturated workflow root and resumes it exactly once with %s storage',
    async (backend) => {
      const executeStep = vi.fn(async (step: WorkflowDefinition['steps'][number]) => ({
        output: { completed: true },
        outputPath: `/tmp/${step.id}.json`,
      }));
      const harness = await createHarness(
        backend,
        settings({ global: { concurrentRuns: 2 } }),
        executor(executeStep)
      );
      const blockers = await Promise.all(
        ['one', 'two'].map((suffix) =>
          harness.admission.admit({
            taskId: `root-blocker-${suffix}`,
            workspaceId: 'other-workspace',
            provider: 'workflow-control',
            hostId: 'workflow-host',
            idempotencyKey: `root-blocker-${backend}-${suffix}`,
            requested: { runSlots: 1, processSlots: 0, estimatedMemoryMb: 0 },
          })
        )
      );
      expect(blockers.every((decision) => decision.outcome === 'admitted')).toBe(true);

      const rawContextSecret = `workflow-root-secret-${backend}`;
      const run = await harness.service.startRun(harness.definition.id, undefined, {
        scheduler: {
          itemId: 'workflow:scheduled-admission',
          trigger: 'due-run',
          runAt: '2026-07-25T12:00:00.000Z',
        },
        operatorPrompt: `Use ${rawContextSecret}`,
        toolArguments: { credential: rawContextSecret },
      });
      expect(run).toMatchObject({
        status: 'pending',
        admission: {
          state: 'waiting',
          decision: { outcome: 'queued' },
        },
      });
      expect(executeStep).not.toHaveBeenCalled();

      const [queued] = await harness.admission.listQueue({
        taskId: `workflow-root:${run.id}`,
      });
      expect(queued).toMatchObject({
        state: 'queued',
        request: { source: 'scheduled' },
        target: {
          kind: 'workflow-root',
          workflowId: harness.definition.id,
          workflowVersion: harness.definition.version,
          workflowRunId: run.id,
          workflowRunRevision: run.revision,
        },
      });
      expect(JSON.stringify(queued)).not.toContain(rawContextSecret);

      await Promise.all(
        blockers.map((decision, index) =>
          harness.admission.release(
            decision.reservation?.id as string,
            'completed',
            `release-root-blocker-${backend}-${index}`
          )
        )
      );
      const claim = await harness.admission.claimNextQueued();
      expect(claim?.entry).toMatchObject({
        id: queued?.id,
        target: { kind: 'workflow-root' },
        selectionEvidence: {
          policyVersion: 'admission-queue-scheduler/v1',
          selectedQueueEntryId: queued?.id,
          capacityReadiness: 'ready',
        },
      });
      await (
        harness.service as unknown as {
          dispatchQueuedAdmission: (input: NonNullable<typeof claim>) => Promise<void>;
        }
      ).dispatchQueuedAdmission(claim as NonNullable<typeof claim>);

      await vi.waitFor(async () => {
        expect((await harness.service.getRun(run.id))?.status).toBe('completed');
      });
      expect(executeStep).toHaveBeenCalledTimes(1);
      await expect(harness.admission.getQueueEntry(queued?.id as string)).resolves.toMatchObject({
        state: 'dispatched',
        dispatchedAttemptId: `workflow-root:${run.id}`,
      });
    }
  );

  it.each(['file', 'sqlite'] as const)(
    'recovers a durably dispatched workflow root exactly once after restart with %s storage',
    async (backend) => {
      const executeStep = vi.fn(async (step: WorkflowDefinition['steps'][number]) => ({
        output: { completed: true },
        outputPath: `/tmp/${step.id}.json`,
      }));
      const admissionSettings = settings({ global: { concurrentRuns: 2 } });
      const stepExecutor = executor(executeStep);
      const harness = await createHarness(backend, admissionSettings, stepExecutor);
      const blockers = await Promise.all(
        ['one', 'two'].map((suffix) =>
          harness.admission.admit({
            taskId: `restart-root-blocker-${suffix}`,
            workspaceId: 'other-workspace',
            provider: 'workflow-control',
            hostId: 'workflow-host',
            idempotencyKey: `restart-root-blocker-${backend}-${suffix}`,
            requested: { runSlots: 1, processSlots: 0, estimatedMemoryMb: 0 },
          })
        )
      );
      const run = await harness.service.startRun(harness.definition.id);
      await Promise.all(
        blockers.map((decision, index) =>
          harness.admission.release(
            decision.reservation?.id as string,
            'completed',
            `release-restart-root-blocker-${backend}-${index}`
          )
        )
      );
      const claim = await harness.admission.claimNextQueued();
      const markQueueDispatched = harness.admission.markQueueDispatched.bind(harness.admission);
      vi.spyOn(harness.admission, 'markQueueDispatched').mockImplementationOnce(
        async (queueId, attemptId) => {
          await markQueueDispatched(queueId, attemptId);
          throw new Error('simulated process exit after durable queue dispatch');
        }
      );
      await (
        harness.service as unknown as {
          dispatchQueuedAdmission: (input: NonNullable<typeof claim>) => Promise<void>;
        }
      ).dispatchQueuedAdmission(claim as NonNullable<typeof claim>);
      await expect(harness.service.getRun(run.id)).resolves.toMatchObject({
        status: 'pending',
        admission: { state: 'dispatching' },
      });
      expect(executeStep).not.toHaveBeenCalled();

      const restarted = await restartHarness(
        harness,
        admissionSettings,
        stepExecutor,
        `owner-restarted-root-${backend}`
      );
      await restarted.service.reconcilePendingRecoveries();

      await vi.waitFor(async () => {
        expect((await restarted.service.getRun(run.id))?.status).toBe('completed');
      });
      expect(executeStep).toHaveBeenCalledTimes(1);
      await vi.waitFor(async () => {
        expect(
          (await restarted.admission.list({ workflowRunId: run.id })).every(
            (reservation) => reservation.state === 'released'
          )
        ).toBe(true);
      });
    }
  );

  it.each(['file', 'sqlite'] as const)(
    'queues a saturated workflow step and dispatches it exactly once with %s storage',
    async (backend) => {
      const executeStep = vi.fn(async (step: WorkflowDefinition['steps'][number]) => ({
        output: { completed: true },
        outputPath: `/tmp/${step.id}.json`,
      }));
      const harness = await createHarness(
        backend,
        settings({ global: { concurrentRuns: 3 } }),
        executor(executeStep)
      );
      const blocker = await harness.admission.admit({
        taskId: 'step-provider-blocker',
        workspaceId: 'other-workspace',
        provider: 'codex-sdk',
        hostId: 'local-process',
        idempotencyKey: `step-provider-blocker-${backend}`,
        requested: { runSlots: 1, processSlots: 1, estimatedMemoryMb: 0 },
      });
      expect(blocker.outcome).toBe('admitted');

      const started = await harness.service.startRun(harness.definition.id);
      const waiting = await vi.waitFor(async () => {
        const run = await harness.service.getRun(started.id);
        expect(run).toMatchObject({
          status: 'pending',
          steps: [
            {
              stepId: 'execute',
              status: 'pending',
              admission: {
                state: 'waiting',
                decision: { outcome: 'queued' },
              },
            },
          ],
        });
        if (!run) throw new Error('Expected a persisted workflow run');
        return run;
      });
      expect(executeStep).not.toHaveBeenCalled();

      const [queued] = (await harness.admission.listQueue({})).filter(
        (entry) => entry.target?.kind === 'workflow-step'
      );
      expect(queued).toMatchObject({
        state: 'queued',
        target: {
          kind: 'workflow-step',
          workflowId: harness.definition.id,
          workflowVersion: harness.definition.version,
          workflowRunId: waiting.id,
          workflowRunRevision: waiting.revision,
          workflowStepId: 'execute',
          workflowStepSequence: 1,
          recoverySequence: 0,
          provider: 'codex-sdk',
          hostId: 'local-process',
          providerRuntimeManifestDigest: `sha256:${'a'.repeat(64)}`,
          phaseEvidenceDigest: `sha256:${'b'.repeat(64)}`,
          phaseLaunchDigest: `sha256:${'c'.repeat(64)}`,
        },
      });
      expect(JSON.stringify(queued)).not.toContain('Run the test.');

      await harness.admission.release(
        blocker.reservation?.id as string,
        'completed',
        `release-step-blocker-${backend}`
      );
      const claim = await harness.admission.claimNextQueued();
      expect(claim?.entry).toMatchObject({
        id: queued?.id,
        target: { kind: 'workflow-step' },
        selectionEvidence: {
          policyVersion: 'admission-queue-scheduler/v1',
          selectedQueueEntryId: queued?.id,
          capacityReadiness: 'ready',
        },
      });
      await (
        harness.service as unknown as {
          dispatchQueuedAdmission: (input: NonNullable<typeof claim>) => Promise<void>;
        }
      ).dispatchQueuedAdmission(claim as NonNullable<typeof claim>);

      await vi.waitFor(async () => {
        expect((await harness.service.getRun(waiting.id))?.status).toBe('completed');
      });
      expect(executeStep).toHaveBeenCalledTimes(1);
      await expect(harness.admission.getQueueEntry(queued?.id as string)).resolves.toMatchObject({
        state: 'dispatched',
      });
    }
  );

  it.each(['file', 'sqlite'] as const)(
    'recovers a durably dispatched workflow step exactly once after restart with %s storage',
    async (backend) => {
      const executeStep = vi.fn(async (step: WorkflowDefinition['steps'][number]) => ({
        output: { completed: true },
        outputPath: `/tmp/${step.id}.json`,
      }));
      const admissionSettings = settings({ global: { concurrentRuns: 3 } });
      const stepExecutor = executor(executeStep);
      const harness = await createHarness(backend, admissionSettings, stepExecutor);
      const blocker = await harness.admission.admit({
        taskId: 'restart-step-provider-blocker',
        workspaceId: 'other-workspace',
        provider: 'codex-sdk',
        hostId: 'local-process',
        idempotencyKey: `restart-step-provider-blocker-${backend}`,
        requested: { runSlots: 1, processSlots: 1, estimatedMemoryMb: 0 },
      });
      const run = await harness.service.startRun(harness.definition.id);
      await vi.waitFor(async () => {
        expect((await harness.service.getRun(run.id))?.steps[0]?.admission?.state).toBe('waiting');
      });
      await harness.admission.release(
        blocker.reservation?.id as string,
        'completed',
        `release-restart-step-blocker-${backend}`
      );
      const claim = await harness.admission.claimNextQueued();
      const markQueueDispatched = harness.admission.markQueueDispatched.bind(harness.admission);
      vi.spyOn(harness.admission, 'markQueueDispatched').mockImplementationOnce(
        async (queueId, attemptId) => {
          await markQueueDispatched(queueId, attemptId);
          throw new Error('simulated process exit after durable step dispatch');
        }
      );
      await (
        harness.service as unknown as {
          dispatchQueuedAdmission: (input: NonNullable<typeof claim>) => Promise<void>;
        }
      ).dispatchQueuedAdmission(claim as NonNullable<typeof claim>);
      await expect(harness.service.getRun(run.id)).resolves.toMatchObject({
        status: 'pending',
        steps: [
          expect.objectContaining({
            stepId: 'execute',
            admission: expect.objectContaining({ state: 'dispatching' }),
          }),
        ],
      });
      expect(executeStep).not.toHaveBeenCalled();

      const restarted = await restartHarness(
        harness,
        admissionSettings,
        stepExecutor,
        `owner-restarted-step-${backend}`
      );
      await restarted.service.reconcilePendingRecoveries();

      await vi.waitFor(async () => {
        expect((await restarted.service.getRun(run.id))?.status).toBe('completed');
      }, RECOVERED_EXECUTION_TIMEOUT_MS);
      expect(executeStep).toHaveBeenCalledTimes(1);
      await vi.waitFor(async () => {
        expect(
          (await restarted.admission.list({ workflowRunId: run.id })).every(
            (reservation) => reservation.state === 'released'
          )
        ).toBe(true);
      }, RECOVERED_EXECUTION_TIMEOUT_MS);
    }
  );

  it.each(['retry', 'fallback'] as const)(
    'queues a saturated %s replacement only after releasing its predecessor',
    async (replacement) => {
      let invocationCount = 0;
      const executeStep = vi.fn(async (step: WorkflowDefinition['steps'][number]) => {
        invocationCount += 1;
        if (invocationCount === 1) throw new Error('ECONNRESET before replacement');
        return { output: { completed: true }, outputPath: `/tmp/${step.id}.json` };
      });
      const harness = await createHarness('file', settings(), executor(executeStep));
      harness.definition.steps[0].on_fail =
        replacement === 'retry'
          ? { retry: 1, retry_delay_ms: 250 }
          : { retry: 0, retry_delay_ms: 250, escalate_to: 'agent:agent' };

      const run = await harness.service.startRun(harness.definition.id);
      await vi.waitFor(async () => {
        expect((await harness.service.getRun(run.id))?.steps[0]?.runRetry?.state).toBe('scheduled');
      });
      const blocker = await harness.admission.admit({
        taskId: `${replacement}-replacement-blocker`,
        workspaceId: 'other-workspace',
        provider: 'codex-sdk',
        hostId: 'local-process',
        idempotencyKey: `${replacement}-replacement-blocker`,
        requested: { runSlots: 1, processSlots: 1, estimatedMemoryMb: 0 },
      });
      expect(blocker.outcome).toBe('admitted');

      const waiting = await vi.waitFor(
        async () => {
          const persisted = await harness.service.getRun(run.id);
          expect(persisted?.steps[0]?.admission?.state).toBe('waiting');
          if (!persisted) throw new Error('Expected replacement workflow run');
          return persisted;
        },
        { timeout: 2_000 }
      );
      const reservations = await harness.admission.list({ workflowRunId: run.id });
      const predecessor = reservations.find(
        (reservation) =>
          reservation.request.workflowStepId === 'execute' &&
          reservation.attemptId !== waiting.steps[0]?.admission?.attemptId
      );
      expect(predecessor).toMatchObject({
        state: 'released',
        release: { reason: 'failed' },
      });
      const [queued] = (await harness.admission.listQueue({})).filter(
        (entry) => entry.target?.kind === 'workflow-step'
      );
      expect(queued).toMatchObject({
        state: 'queued',
        request: {
          source: replacement === 'retry' ? 'recovery' : 'fallback',
          budgetRequest: { retries: 1 },
        },
        target: {
          kind: 'workflow-step',
          workflowStepSequence: 2,
          recoverySequence: 1,
          edge: replacement,
        },
      });

      await harness.admission.release(
        blocker.reservation?.id as string,
        'completed',
        `release-${replacement}-replacement-blocker`
      );
      const claim = await harness.admission.claimNextQueued();
      await (
        harness.service as unknown as {
          dispatchQueuedAdmission: (input: NonNullable<typeof claim>) => Promise<void>;
        }
      ).dispatchQueuedAdmission(claim as NonNullable<typeof claim>);

      await vi.waitFor(async () => {
        expect((await harness.service.getRun(run.id))?.status).toBe('completed');
      });
      expect(executeStep).toHaveBeenCalledTimes(2);
      await vi.waitFor(async () => {
        expect(
          (await harness.admission.list({ workflowRunId: run.id })).every(
            (reservation) => reservation.state === 'released'
          )
        ).toBe(true);
      });
    }
  );

  it('terminalizes a queued step without provider dispatch when launch authority drifts', async () => {
    let runtimeManifestDigest = `sha256:${'a'.repeat(64)}`;
    const executeStep = vi.fn(async () => ({
      output: { completed: true },
      outputPath: '/tmp/execute.json',
    }));
    const stepExecutor = executor(executeStep);
    stepExecutor.prepareStep = async (step) => ({
      ...preparation(step),
      runtimeManifest: { digest: runtimeManifestDigest },
    });
    const harness = await createHarness(
      'file',
      settings({ global: { concurrentRuns: 3 } }),
      stepExecutor
    );
    const blocker = await harness.admission.admit({
      taskId: 'drift-provider-blocker',
      workspaceId: 'other-workspace',
      provider: 'codex-sdk',
      hostId: 'local-process',
      idempotencyKey: 'drift-provider-blocker',
      requested: { runSlots: 1, processSlots: 1, estimatedMemoryMb: 0 },
    });
    const started = await harness.service.startRun(harness.definition.id);
    await vi.waitFor(async () => {
      expect((await harness.service.getRun(started.id))?.steps[0]?.admission?.state).toBe(
        'waiting'
      );
    });
    const [queued] = (await harness.admission.listQueue({})).filter(
      (entry) => entry.target?.kind === 'workflow-step'
    );
    await harness.admission.release(
      blocker.reservation?.id as string,
      'completed',
      'release-drift-blocker'
    );
    const claim = await harness.admission.claimNextQueued();
    runtimeManifestDigest = `sha256:${'d'.repeat(64)}`;

    await (
      harness.service as unknown as {
        dispatchQueuedAdmission: (input: NonNullable<typeof claim>) => Promise<void>;
      }
    ).dispatchQueuedAdmission(claim as NonNullable<typeof claim>);

    await expect(harness.admission.getQueueEntry(queued?.id as string)).resolves.toMatchObject({
      state: 'terminal',
      terminal: { code: 'WORKFLOW_QUEUE_AUTHORITY_DRIFT' },
    });
    await expect(harness.service.getRun(started.id)).resolves.toMatchObject({
      status: 'failed',
      steps: [
        expect.objectContaining({
          stepId: 'execute',
          status: 'failed',
          admission: expect.objectContaining({ state: 'terminal' }),
        }),
      ],
    });
    expect(executeStep).not.toHaveBeenCalled();
    expect(
      (await harness.admission.list({ workflowRunId: started.id })).map(
        (reservation) => reservation.state
      )
    ).toEqual(['released', 'released']);
  });

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
    await first.admission.dispose();

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
