import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AdmissionReservationRepository } from '../storage/interfaces.js';
import {
  DEFAULT_FEATURE_SETTINGS,
  type AdmissionCapacityLimit,
  type AdmissionSettings,
  type ExecutionTreeBudgetPolicy,
  ZERO_AGENT_BUDGET_USAGE,
} from '@veritas-kanban/shared';
import {
  AdmissionControlService,
  type AdmissionControlServiceOptions,
} from '../services/admission-control-service.js';
import { acquireLock } from '../services/file-lock.js';
import { FileAdmissionReservationRepository } from '../storage/admission-reservation-repository.js';
import { SqliteDatabase } from '../storage/sqlite/database.js';
import { SqliteAdmissionReservationRepository } from '../storage/sqlite/admission-reservation-repository.js';

const roots: string[] = [];
const services: AdmissionControlService[] = [];
const databases: SqliteDatabase[] = [];

afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.dispose()));
  for (const database of databases.splice(0)) database.close();
  await Promise.all(
    roots
      .splice(0)
      .map((root) => fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }))
  );
});

function configuredSettings(
  overrides: {
    global?: AdmissionCapacityLimit;
    providers?: AdmissionSettings['providers'];
    queue?: Partial<AdmissionSettings['queue']>;
    fanOutBreaker?: Partial<AdmissionSettings['fanOutBreaker']>;
  } = {}
): AdmissionSettings {
  return {
    ...structuredClone(DEFAULT_FEATURE_SETTINGS.admission),
    global: overrides.global ?? {},
    providers: overrides.providers ?? {},
    queue: {
      ...DEFAULT_FEATURE_SETTINGS.admission.queue,
      ...overrides.queue,
    },
    fanOutBreaker: {
      ...DEFAULT_FEATURE_SETTINGS.admission.fanOutBreaker,
      ...overrides.fanOutBreaker,
    },
    heartbeatMs: 20_000,
  };
}

function createService(
  repository: AdmissionReservationRepository,
  settings: AdmissionSettings,
  options: {
    now?: () => Date;
    ownerId?: string;
    treeControlTelemetry?: AdmissionControlServiceOptions['treeControlTelemetry'];
  } = {}
): AdmissionControlService {
  const service = new AdmissionControlService({
    repository,
    settings: async () => structuredClone(settings),
    hostId: 'execution-host-a',
    ownerId: options.ownerId ?? 'owner-a',
    processId: 101,
    now: options.now,
    treeControlTelemetry: options.treeControlTelemetry,
  });
  services.push(service);
  return service;
}

function request(taskId: string, idempotencyKey = `launch:${taskId}`) {
  return {
    taskId,
    workspaceId: 'workspace-a',
    provider: 'codex-cli' as const,
    hostId: 'local-process',
    idempotencyKey,
  };
}

async function repositoryFor(backend: 'file' | 'sqlite') {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `veritas-admission-${backend}-`));
  roots.push(root);
  if (backend === 'file') {
    return new FileAdmissionReservationRepository(path.join(root, 'admission.jsonl'));
  }
  const database = new SqliteDatabase({ databasePath: path.join(root, 'veritas.db') });
  database.open();
  databases.push(database);
  return new SqliteAdmissionReservationRepository(database);
}

type CompleteAppend = (
  handle: {
    write: (
      buffer: Uint8Array,
      offset: number,
      length: number,
      position: number | null
    ) => Promise<{ bytesWritten: number }>;
  },
  content: Uint8Array
) => Promise<void>;

function completeAppend(repository: FileAdmissionReservationRepository): CompleteAppend {
  return (
    repository as unknown as {
      writeCompleteAppend: CompleteAppend;
    }
  ).writeCompleteAppend.bind(repository);
}

const treePolicy: ExecutionTreeBudgetPolicy = {
  id: 'budget_root_objective',
  scope: 'root-objective',
  scopeId: 'objective-a',
  name: 'Root objective budget',
  limits: { totalTokens: 100, fanOut: 2 },
  hardAction: 'pause',
};

function treeRequest(
  taskId: string,
  nodeId: string,
  parentNodeId?: string,
  budgetRequest: Partial<typeof ZERO_AGENT_BUDGET_USAGE> = { fanOut: 1 },
  identity: {
    edge?: 'child-agent' | 'retry' | 'fallback';
    depth?: number;
  } = {}
) {
  return {
    ...request(taskId, `tree:${nodeId}`),
    executionTree: {
      schemaVersion: 'execution-tree-identity/v1' as const,
      rootObjectiveId: 'objective-a',
      nodeId,
      ...(parentNodeId ? { parentNodeId } : {}),
      edge: parentNodeId ? (identity.edge ?? 'child-agent') : ('root' as const),
      depth: parentNodeId ? (identity.depth ?? 1) : 0,
    },
    budgetPolicies: [treePolicy],
    budgetRequest,
  };
}

describe('AdmissionControlService', () => {
  it('distinguishes an impossible policy request from retryable active-capacity overload', async () => {
    const repository = await repositoryFor('file');
    const impossible = createService(
      repository,
      configuredSettings({ global: { concurrentRuns: 0 } })
    );
    await expect(impossible.admit(request('task-impossible'))).resolves.toMatchObject({
      outcome: 'terminal-policy-denial',
      limitingPolicies: [{ scope: 'global', scopeId: 'global' }],
      retryAfterMs: undefined,
    });

    const settings = configuredSettings({
      global: { concurrentRuns: 1 },
      providers: { 'codex-cli': { processSlots: 1 } },
    });
    const service = createService(repository, settings);
    const admitted = await service.admit(request('task-one'));
    expect(admitted).toMatchObject({
      outcome: 'admitted',
      reservation: { state: 'active' },
    });
    await expect(
      service.admit(request('task-one', 'launch:task-one:duplicate'))
    ).resolves.toMatchObject({
      outcome: 'retryable-overload',
      limitingPolicies: expect.arrayContaining([
        expect.objectContaining({ scope: 'task', scopeId: 'task-one' }),
      ]),
    });
    await expect(service.admit(request('task-two'))).resolves.toMatchObject({
      outcome: 'retryable-overload',
      retryAfterMs: settings.retryAfterMs,
      limitingPolicies: expect.arrayContaining([
        expect.objectContaining({ scope: 'global', scopeId: 'global' }),
        expect.objectContaining({ scope: 'provider', scopeId: 'codex-cli' }),
      ]),
    });
  });

  it('queues every provider-neutral agent launch source through one target contract', async () => {
    const repository = await repositoryFor('file');
    const service = createService(
      repository,
      configuredSettings({ global: { concurrentRuns: 1 } })
    );
    const active = await service.admit(request('task-source-blocker'));
    expect(active.outcome).toBe('admitted');

    const sources = ['direct', 'conversation', 'recovery', 'fallback', 'child-agent'] as const;
    for (const source of sources) {
      const options =
        source === 'conversation'
          ? {
              overrideReason: 'Private operator justification',
              conversation: {
                mode: 'resume' as const,
                intent: 'follow-up' as const,
                sourceAttemptId: 'attempt-private-parent',
                message: 'Private queued conversation message',
              },
            }
          : {};
      const decision = await service.admitOrQueue(
        {
          ...request(`task-source-${source}`),
          source,
        },
        {
          attemptId: `attempt-source-${source}`,
          target: {
            kind: 'agent-launch',
            agent: 'codex',
            source,
            options,
          },
        }
      );
      expect(decision).toMatchObject({
        outcome: 'queued',
        request: { source },
        queueEntry: {
          target: {
            kind: 'agent-launch',
            agent: 'codex',
            source,
          },
        },
      });
    }

    const inspection = await service.inspectQueue({ limit: 10 });
    expect(inspection.entries).toHaveLength(sources.length);
    expect(inspection.entries).toEqual(
      expect.arrayContaining(
        sources.map((source) =>
          expect.objectContaining({
            launch: expect.objectContaining({ source, target: 'agent-launch' }),
          })
        )
      )
    );
    const serialized = JSON.stringify(inspection);
    expect(serialized).not.toContain('Private operator justification');
    expect(serialized).not.toContain('Private queued conversation message');
    expect(serialized).not.toContain('attempt-private-parent');
  });

  it('admits maximum-length scope identifiers without overflowing generated policy IDs', async () => {
    const repository = await repositoryFor('file');
    const service = createService(repository, configuredSettings());

    await expect(service.admit(request('t'.repeat(240)))).resolves.toMatchObject({
      outcome: 'admitted',
      reservation: {
        policies: [expect.objectContaining({ scope: 'task' })],
      },
    });
  });

  it('renews a verified live run after lease expiry without creating a duplicate reservation', async () => {
    const repository = await repositoryFor('file');
    let now = new Date('2026-07-25T10:00:00.000Z');
    const settings = configuredSettings({ global: { concurrentRuns: 1 } });
    const original = createService(repository, settings, { now: () => now });
    const decision = await original.admit(request('task-recover'));
    const bound = await original.bindAttempt(decision.reservation?.id as string, 'attempt-recover');
    await original.dispose();

    now = new Date('2026-07-25T10:00:31.000Z');
    await original.expireAbandoned();
    const recovering = createService(repository, settings, {
      now: () => now,
      ownerId: 'owner-b',
    });
    const recovered = await recovering.recoverVerifiedRun({
      workspaceId: 'workspace-a',
      taskId: 'task-recover',
      attemptId: 'attempt-recover',
    });
    expect(recovered).toMatchObject({
      id: bound.id,
      state: 'active',
      attemptId: 'attempt-recover',
      lease: { ownerId: 'owner-b' },
    });
    await expect(
      recovering.admit(request('task-recover', 'launch:task-recover'))
    ).resolves.toMatchObject({
      outcome: 'admitted',
      reservation: { id: bound.id },
    });
    await expect(repository.list({ taskId: 'task-recover' })).resolves.toHaveLength(1);
  });

  it('does not resurrect an intentionally released run during restart recovery', async () => {
    const repository = await repositoryFor('file');
    const service = createService(repository, configuredSettings());
    const decision = await service.admit(request('task-released-recovery'));
    const bound = await service.bindAttempt(
      decision.reservation?.id as string,
      'attempt-released-recovery'
    );
    await service.release(bound.id, 'completed', 'release-before-recovery');

    await expect(
      service.recoverVerifiedRun({
        workspaceId: 'workspace-a',
        taskId: 'task-released-recovery',
        attemptId: 'attempt-released-recovery',
      })
    ).rejects.toMatchObject({
      statusCode: 409,
      details: {
        reservationId: bound.id,
        reservationState: 'released',
      },
    });
  });

  it('does not release another attempt when an idempotent retry loses the bind race', async () => {
    const repository = await repositoryFor('file');
    const settings = configuredSettings();
    const original = createService(repository, settings, { ownerId: 'owner-original' });
    const retry = createService(repository, settings, { ownerId: 'owner-retry' });
    const originalDecision = await original.admit(request('task-idempotent'));
    const retryDecision = await retry.admit(request('task-idempotent'));
    expect(originalDecision.reservation?.request.idempotencyKey).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(originalDecision.reservation?.request.idempotencyKey).not.toContain(
      'launch:task-idempotent'
    );

    const bound = await original.bindAttempt(
      originalDecision.reservation?.id as string,
      'attempt-original'
    );
    await expect(
      retry.bindAttempt(retryDecision.reservation?.id as string, 'attempt-retry')
    ).rejects.toMatchObject({
      statusCode: 409,
    });
    await retry.releaseIfUnbound(
      retryDecision.reservation?.id as string,
      'start-failed',
      'bind-failed:attempt-retry'
    );

    await expect(repository.get(bound.id)).resolves.toMatchObject({
      state: 'active',
      attemptId: 'attempt-original',
      lease: { ownerId: 'owner-original' },
    });
  });

  it('compacts file heartbeat snapshots without losing the latest reservation revision', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'veritas-admission-compact-'));
    roots.push(root);
    const logPath = path.join(root, 'admission.jsonl');
    const repository = new FileAdmissionReservationRepository(logPath, 3);
    const service = createService(repository, configuredSettings());
    const decision = await service.admit(request('task-compact'));
    const bound = await service.bindAttempt(decision.reservation?.id as string, 'attempt-compact');
    const renewed = await service.renew(bound.id);
    const compacted = await service.renew(bound.id);

    const lines = (await fs.readFile(logPath, 'utf8')).trim().split('\n');
    expect(lines).toHaveLength(1);
    await expect(repository.get(bound.id)).resolves.toMatchObject({
      revision: compacted.revision,
      state: 'active',
      attemptId: 'attempt-compact',
      lease: { heartbeatAt: compacted.lease.heartbeatAt },
    });
    expect(compacted.revision).toBe(renewed.revision + 1);
  });

  it('completes partial file admission appends before returning', async () => {
    const writes: string[] = [];
    const write = vi.fn(
      async (buffer: Uint8Array, offset: number, length: number, position: number | null) => {
        expect(position).toBeNull();
        const bytesWritten = Math.min(3, length);
        writes.push(Buffer.from(buffer.subarray(offset, offset + bytesWritten)).toString('utf8'));
        return { bytesWritten };
      }
    );

    await completeAppend(new FileAdmissionReservationRepository('/tmp/admission.jsonl'))(
      { write },
      Buffer.from('{"durable":true}\n')
    );

    expect(writes.join('')).toBe('{"durable":true}\n');
    expect(write).toHaveBeenCalledTimes(6);
  });

  it('fails closed when a file admission append makes no forward progress', async () => {
    const write = vi.fn().mockResolvedValue({ bytesWritten: 0 });

    await expect(
      completeAppend(new FileAdmissionReservationRepository('/tmp/admission.jsonl'))(
        { write },
        Buffer.from('{"durable":true}\n')
      )
    ).rejects.toThrow(/no forward progress/i);
  });

  it('does not expose an incomplete admission snapshot to concurrent readers', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'veritas-admission-read-lock-'));
    roots.push(root);
    const logPath = path.join(root, 'admission.jsonl');
    const repository = new FileAdmissionReservationRepository(logPath);
    const service = createService(repository, configuredSettings());
    await service.admit(request('task-read-lock'));
    const completeLog = await fs.readFile(logPath);
    const splitAt = Math.floor(completeLog.byteLength / 2);
    const unlock = await acquireLock(logPath);
    const handle = await fs.open(logPath, 'w');
    let handleClosed = false;
    let read:
      | Promise<{
          records: Awaited<ReturnType<typeof repository.list>> | null;
          error: unknown;
        }>
      | undefined;

    try {
      await handle.write(completeLog.subarray(0, splitAt));
      await handle.sync();
      let readSettled = false;
      read = repository
        .list({ taskId: 'task-read-lock' })
        .then(
          (records) => ({ records, error: null }),
          (error: unknown) => ({ records: null, error })
        )
        .finally(() => {
          readSettled = true;
        });

      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(readSettled).toBe(false);
      await handle.write(completeLog.subarray(splitAt));
      await handle.sync();
      await handle.close();
      handleClosed = true;
    } finally {
      if (!handleClosed) await handle.close().catch(() => {});
      await unlock();
    }

    await expect(read).resolves.toMatchObject({
      records: [
        expect.objectContaining({
          request: expect.objectContaining({ taskId: 'task-read-lock' }),
        }),
      ],
      error: null,
    });
  });

  it('renews a leased queue claim until dispatch ownership takes over', async () => {
    const repository = await repositoryFor('file');
    const settings = {
      ...configuredSettings({ global: { concurrentRuns: 1 } }),
      heartbeatMs: 10,
    };
    const service = createService(repository, settings, { ownerId: 'owner-heartbeat' });
    const active = await service.admit(request('task-heartbeat-active'));
    const queued = await service.admitOrQueue(request('task-heartbeat-queued'), {
      agent: 'codex',
      attemptId: 'attempt-heartbeat-queued',
    });
    await service.release(
      active.reservation?.id as string,
      'completed',
      'release-heartbeat-active'
    );
    const claim = await service.claimNextQueued();
    await service.bindQueuedAttempt(
      claim?.entry.id as string,
      claim?.reservation.id as string,
      claim?.entry.attemptId as string
    );
    const initialQueueRevision = claim?.entry.revision as number;
    const initialReservationRevision = (await repository.get(claim?.reservation.id as string))
      ?.revision as number;

    await vi.waitFor(
      async () => {
        const queueEntry = await service.getQueueEntry(queued.queueEntry?.id as string);
        const reservation = await repository.get(claim?.reservation.id as string);
        expect(queueEntry.state).toBe('leased');
        expect(queueEntry.revision).toBeGreaterThan(initialQueueRevision);
        expect(reservation).toMatchObject({ state: 'active' });
        expect(reservation?.revision).toBeGreaterThan(initialReservationRevision);
      },
      { timeout: 500, interval: 10 }
    );

    const dispatched = await service.markQueueDispatched(
      claim?.entry.id as string,
      claim?.entry.attemptId as string
    );
    await new Promise((resolve) => setTimeout(resolve, settings.heartbeatMs * 3));
    await expect(service.getQueueEntry(dispatched.id)).resolves.toEqual(dispatched);
    await service.dispose();
  });
});

describe.each(['file', 'sqlite'] as const)('%s admission reservation parity', (backend) => {
  it('cancels a leased queue entry and releases its reservation idempotently', async () => {
    const repository = await repositoryFor(backend);
    const service = createService(
      repository,
      configuredSettings({ global: { concurrentRuns: 1 } })
    );
    const root = await service.admit(treeRequest('task-cancel-queue-root', 'node-cancel-root'));
    await service.bindAttempt(root.reservation?.id as string, 'attempt-cancel-root');
    const queued = await service.admitOrQueue(
      {
        ...treeRequest('task-cancel-queue-child', 'node-cancel-child', 'node-cancel-root'),
        source: 'child-agent',
      },
      {
        attemptId: 'attempt-cancel-child',
        target: {
          kind: 'agent-launch',
          agent: 'codex',
          source: 'child-agent',
          options: {},
        },
      }
    );
    await service.release(root.reservation?.id as string, 'completed', 'release-cancel-queue-root');
    const claim = await service.claimNextQueued();
    expect(claim?.entry.id).toBe(queued.queueEntry?.id);

    const cancelled = await service.cancelQueuedLaunch(claim?.entry.id as string, {
      idempotencyKey: 'cancel-queue-entry-123',
      reason: 'Operator cancelled this queued descendant.',
    });
    expect(cancelled).toMatchObject({
      scope: 'queued-launch',
      reservationReleased: true,
      queueEntry: {
        state: 'terminal',
        terminal: {
          code: 'QUEUE_CANCELLED',
          idempotencyKey: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
        },
      },
    });
    expect(JSON.stringify(cancelled)).not.toContain('cancel-queue-entry-123');
    await expect(
      service.cancelQueuedLaunch(claim?.entry.id as string, {
        idempotencyKey: 'cancel-queue-entry-123',
        reason: 'Operator cancelled this queued descendant.',
      })
    ).resolves.toMatchObject({ queueEntry: { state: 'terminal' } });
    await expect(
      service.cancelQueuedLaunch(claim?.entry.id as string, {
        idempotencyKey: 'different-cancel-queue-entry',
        reason: 'A conflicting cancellation identity.',
      })
    ).rejects.toMatchObject({ statusCode: 409 });
    await expect(service.get(claim?.reservation.id as string)).resolves.toMatchObject({
      state: 'released',
      release: { reason: 'cancelled' },
    });
  });

  it('marks a tree cancelled before draining descendants and rejects late expansion', async () => {
    const repository = await repositoryFor(backend);
    const service = createService(
      repository,
      configuredSettings({ global: { concurrentRuns: 2 } })
    );
    const root = await service.admit(treeRequest('task-tree-cancel-root', 'node-tree-root'));
    await service.bindAttempt(root.reservation?.id as string, 'attempt-tree-root');
    const child = await service.admit(
      treeRequest('task-tree-cancel-child', 'node-tree-child', 'node-tree-root')
    );
    await service.bindAttempt(child.reservation?.id as string, 'attempt-tree-child');
    const queued = await service.admitOrQueue(
      {
        ...treeRequest('task-tree-cancel-queued', 'node-tree-queued', 'node-tree-root'),
        source: 'child-agent',
      },
      {
        attemptId: 'attempt-tree-queued',
        target: {
          kind: 'agent-launch',
          agent: 'codex',
          source: 'child-agent',
          options: {},
        },
      }
    );

    const cancelled = await service.cancelExecutionTree('objective-a', {
      idempotencyKey: 'cancel-execution-tree-123',
      reason: 'Operator stopped runaway expansion.',
    });
    expect(cancelled).toMatchObject({
      scope: 'execution-tree',
      rootObjectiveId: 'objective-a',
      control: {
        state: 'cancelled',
        trigger: 'operator',
        idempotencyKey: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      },
      queueEntriesCancelled: 1,
      runningAttempts: expect.arrayContaining([
        expect.objectContaining({ attemptId: 'attempt-tree-root' }),
        expect.objectContaining({ attemptId: 'attempt-tree-child' }),
      ]),
    });
    await expect(service.getQueueEntry(queued.queueEntry?.id as string)).resolves.toMatchObject({
      state: 'terminal',
      terminal: { code: 'QUEUE_CANCELLED' },
    });
    await expect(service.getExecutionTreeControl('objective-a')).resolves.toMatchObject({
      state: 'cancelled',
    });
    await expect(service.getExecutionTreeSummary('objective-a')).resolves.toMatchObject({
      control: {
        state: 'cancelled',
        trigger: 'operator',
        idempotencyKey: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      },
    });
    await expect(
      service.admit(
        treeRequest('task-tree-cancel-late', 'node-tree-late', 'node-tree-child', undefined, {
          depth: 2,
        })
      )
    ).resolves.toMatchObject({
      outcome: 'terminal-policy-denial',
      executionTreeControl: { state: 'cancelled' },
      reservation: undefined,
    });
    await expect(
      service.cancelExecutionTree('objective-a', {
        idempotencyKey: 'different-tree-cancellation',
        reason: 'Conflicting operator identity.',
      })
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it('serializes competing execution-tree cancellation ownership', async () => {
    const repository = await repositoryFor(backend);
    const settings = configuredSettings();
    const left = createService(repository, settings, { ownerId: 'owner-cancel-left' });
    const right = createService(repository, settings, { ownerId: 'owner-cancel-right' });
    await left.admit(treeRequest('task-tree-cancel-race-root', 'node-tree-cancel-race-root'));

    const results = await Promise.allSettled([
      left.cancelExecutionTree('objective-a', {
        idempotencyKey: 'cancel-tree-race-left',
        reason: 'Left operator cancellation request.',
      }),
      right.cancelExecutionTree('objective-a', {
        idempotencyKey: 'cancel-tree-race-right',
        reason: 'Right operator cancellation request.',
      }),
    ]);

    const fulfilled = results.filter(
      (
        result
      ): result is PromiseFulfilledResult<Awaited<ReturnType<typeof left.cancelExecutionTree>>> =>
        result.status === 'fulfilled'
    );
    const rejected = results.filter((result) => result.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toMatchObject({ reason: { statusCode: 409 } });
    await expect(right.getExecutionTreeControl('objective-a')).resolves.toMatchObject({
      state: 'cancelled',
      idempotencyKey: fulfilled[0]?.value.idempotencyKey,
    });
  });

  it('continues tree cancellation when queue dispatch wins the drain race', async () => {
    const repository = await repositoryFor(backend);
    const service = createService(
      repository,
      configuredSettings({ global: { concurrentRuns: 1 } })
    );
    const root = await service.admit(treeRequest('task-tree-drain-root', 'node-tree-drain-root'));
    await service.bindAttempt(root.reservation?.id as string, 'attempt-tree-drain-root');
    const queued = await service.admitOrQueue(
      {
        ...treeRequest('task-tree-drain-child', 'node-tree-drain-child', 'node-tree-drain-root'),
        source: 'child-agent',
      },
      {
        attemptId: 'attempt-tree-drain-child',
        target: {
          kind: 'agent-launch',
          agent: 'codex',
          source: 'child-agent',
          options: {},
        },
      }
    );
    await service.release(root.reservation?.id as string, 'completed', 'release-tree-drain-root');
    const claim = await service.claimNextQueued();
    await service.bindQueuedAttempt(
      claim?.entry.id as string,
      claim?.reservation.id as string,
      claim?.entry.attemptId as string
    );
    const cancelQueuedLaunch = service.cancelQueuedLaunch.bind(service);
    vi.spyOn(service, 'cancelQueuedLaunch').mockImplementationOnce(async (id, input) => {
      await service.markQueueDispatched(id, claim?.entry.attemptId as string);
      return cancelQueuedLaunch(id, input);
    });

    await expect(
      service.cancelExecutionTree('objective-a', {
        idempotencyKey: 'cancel-tree-drain-race',
        reason: 'Operator cancelled during queue dispatch.',
      })
    ).resolves.toMatchObject({
      queueEntriesCancelled: 0,
      runningAttempts: [
        expect.objectContaining({
          attemptId: 'attempt-tree-drain-child',
          reservationId: claim?.reservation.id,
        }),
      ],
    });
    await expect(service.getQueueEntry(queued.queueEntry?.id as string)).resolves.toMatchObject({
      state: 'dispatched',
      dispatchedAttemptId: 'attempt-tree-drain-child',
    });
  });

  it('pauses wide trees before the configured descendant boundary can grow', async () => {
    const repository = await repositoryFor(backend);
    const treeControlTelemetry = vi.fn().mockResolvedValue(undefined);
    const service = createService(
      repository,
      configuredSettings({
        fanOutBreaker: {
          maxDescendants: 2,
          pressureActivationDescendants: 100,
        },
      }),
      { treeControlTelemetry }
    );
    const wideRequest = (taskId: string, nodeId: string, parentNodeId?: string) => ({
      ...treeRequest(taskId, nodeId, parentNodeId),
      budgetPolicies: [
        {
          ...treePolicy,
          id: 'budget_wide_breaker',
          limits: { fanOut: 100 },
        },
      ],
    });
    await service.admit(wideRequest('task-wide-root', 'node-wide-root'));
    await service.admit(wideRequest('task-wide-left', 'node-wide-left', 'node-wide-root'));
    await service.admit(wideRequest('task-wide-right', 'node-wide-right', 'node-wide-root'));

    await expect(
      service.admit(wideRequest('task-wide-overflow', 'node-wide-overflow', 'node-wide-root'))
    ).resolves.toMatchObject({
      outcome: 'retryable-overload',
      executionTreeControl: {
        state: 'paused',
        trigger: 'fan-out-breaker',
        evidence: {
          signals: expect.arrayContaining(['descendant-limit']),
          observed: { descendants: 3 },
          thresholds: { maxDescendants: 2 },
        },
      },
    });
    await expect(service.getExecutionTreeSummary('objective-a')).resolves.toMatchObject({
      control: {
        state: 'paused',
        evidence: { observed: { descendants: 3 } },
      },
    });
    expect(treeControlTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'admission.tree_control',
        action: 'paused',
        trigger: 'fan-out-breaker',
        rootObjectiveKey: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
        signals: expect.arrayContaining(['descendant-limit']),
      })
    );
    expect(JSON.stringify(treeControlTelemetry.mock.calls)).not.toContain('objective-a');
  });

  it('pauses recursive expansion beyond the configured depth', async () => {
    const repository = await repositoryFor(backend);
    const service = createService(
      repository,
      configuredSettings({
        fanOutBreaker: {
          maxDepth: 2,
          pressureActivationDescendants: 100,
        },
      })
    );
    await service.admit(treeRequest('task-deep-root', 'node-deep-root'));
    await service.admit(treeRequest('task-deep-child', 'node-deep-child', 'node-deep-root'));
    await service.admit(
      treeRequest('task-deep-grandchild', 'node-deep-grandchild', 'node-deep-child', undefined, {
        depth: 2,
      })
    );

    await expect(
      service.admit(
        treeRequest('task-deep-overflow', 'node-deep-overflow', 'node-deep-grandchild', undefined, {
          depth: 3,
        })
      )
    ).resolves.toMatchObject({
      outcome: 'retryable-overload',
      executionTreeControl: {
        state: 'paused',
        evidence: {
          signals: expect.arrayContaining(['depth-limit']),
          observed: { maxDepth: 3 },
        },
      },
    });
  });

  it('serializes concurrent children at the atomic fan-out boundary', async () => {
    const repository = await repositoryFor(backend);
    const settings = configuredSettings({
      fanOutBreaker: {
        maxDescendants: 1,
        pressureActivationDescendants: 100,
      },
    });
    const left = createService(repository, settings, { ownerId: 'owner-fanout-left' });
    const right = createService(repository, settings, { ownerId: 'owner-fanout-right' });
    await left.admit(treeRequest('task-concurrent-root', 'node-concurrent-root'));

    const decisions = await Promise.all([
      left.admit(
        treeRequest('task-concurrent-left', 'node-concurrent-left', 'node-concurrent-root')
      ),
      right.admit(
        treeRequest('task-concurrent-right', 'node-concurrent-right', 'node-concurrent-root')
      ),
    ]);

    expect(decisions.map((decision) => decision.outcome).sort()).toEqual([
      'admitted',
      'retryable-overload',
    ]);
    expect(decisions.find((decision) => decision.outcome !== 'admitted')).toMatchObject({
      executionTreeControl: {
        state: 'paused',
        evidence: { signals: expect.arrayContaining(['descendant-limit']) },
      },
    });
    await expect(
      repository.list({ rootObjectiveId: 'objective-a', states: ['active'] })
    ).resolves.toHaveLength(2);
  });

  it('resumes expansion only after recoverable reservation pressure clears', async () => {
    const repository = await repositoryFor(backend);
    const settings = configuredSettings({
      fanOutBreaker: {
        maxActiveReservations: 2,
        pressureActivationDescendants: 100,
      },
    });
    const service = createService(repository, settings);
    const root = await service.admit(treeRequest('task-resume-root', 'node-resume-root'));
    const child = await service.admit(
      treeRequest('task-resume-child', 'node-resume-child', 'node-resume-root')
    );
    await expect(
      service.admit(treeRequest('task-resume-paused', 'node-resume-paused', 'node-resume-root'))
    ).resolves.toMatchObject({
      outcome: 'retryable-overload',
      executionTreeControl: {
        state: 'paused',
        evidence: { signals: expect.arrayContaining(['active-reservation-limit']) },
      },
    });

    const restarted = createService(repository, settings, {
      ownerId: 'owner-resume-after-restart',
    });
    await expect(restarted.getExecutionTreeSummary('objective-a')).resolves.toMatchObject({
      control: {
        state: 'paused',
        evidence: { signals: expect.arrayContaining(['active-reservation-limit']) },
      },
    });
    await expect(
      restarted.resumeExecutionTree('objective-a', {
        idempotencyKey: 'resume-pressure-tree-123',
        reason: 'Operator reviewed the still-active descendants.',
      })
    ).rejects.toMatchObject({
      statusCode: 409,
      details: {
        code: 'EXECUTION_TREE_RESUME_BLOCKED',
      },
    });

    await service.release(
      child.reservation?.id as string,
      'completed',
      'complete-resume-pressure-child'
    );
    const resumed = await restarted.resumeExecutionTree('objective-a', {
      idempotencyKey: 'resume-pressure-tree-123',
      reason: 'Operator confirmed reservation pressure cleared.',
    });
    expect(resumed).toMatchObject({
      state: 'resumed',
      resumeIdempotencyKey: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      resumeReason: 'Operator confirmed reservation pressure cleared.',
    });
    expect(JSON.stringify(resumed)).not.toContain('resume-pressure-tree-123');
    await expect(
      restarted.admit(treeRequest('task-resume-next', 'node-resume-next', 'node-resume-root'))
    ).resolves.toMatchObject({ outcome: 'admitted' });
    await service.release(
      root.reservation?.id as string,
      'completed',
      'complete-resume-pressure-root'
    );
  });

  it('bounds sustained concurrent fan-out without growing durable queues or control events', async () => {
    const repository = await repositoryFor(backend);
    const treeControlTelemetry = vi.fn().mockResolvedValue(undefined);
    const service = createService(
      repository,
      configuredSettings({
        fanOutBreaker: {
          maxDescendants: 16,
          pressureActivationDescendants: 100,
        },
      }),
      { treeControlTelemetry }
    );
    const loadRequest = (taskId: string, nodeId: string, parentNodeId?: string) => ({
      ...treeRequest(taskId, nodeId, parentNodeId),
      budgetPolicies: [
        {
          ...treePolicy,
          id: 'budget_bounded_fanout_load',
          limits: { fanOut: 1_000 },
        },
      ],
    });
    await service.admit(loadRequest('task-load-root', 'node-load-root'));

    const decisions = await Promise.all(
      Array.from({ length: 64 }, (_, index) =>
        service.admit(
          loadRequest(`task-load-child-${index}`, `node-load-child-${index}`, 'node-load-root')
        )
      )
    );

    expect(decisions.filter((decision) => decision.outcome === 'admitted')).toHaveLength(16);
    expect(decisions.filter((decision) => decision.outcome === 'retryable-overload')).toHaveLength(
      48
    );
    await expect(repository.list({ rootObjectiveId: 'objective-a' })).resolves.toHaveLength(17);
    await expect(
      repository.list({ rootObjectiveId: 'objective-a', states: ['active'] })
    ).resolves.toHaveLength(17);
    await expect(repository.listQueue({ limit: 1_000 })).resolves.toHaveLength(0);
    expect(treeControlTelemetry).toHaveBeenCalledTimes(1);
  });

  it('durably queues and atomically claims a saturated direct launch', async () => {
    const repository = await repositoryFor(backend);
    const settings = configuredSettings({ global: { concurrentRuns: 1 } });
    const original = createService(repository, settings, { ownerId: 'owner-original' });
    const active = await original.admit(request(`task-active-${backend}`));

    const queued = await original.admitOrQueue(request(`task-queued-${backend}`), {
      agent: 'codex',
      attemptId: `attempt-queued-${backend}`,
    });
    expect(queued).toMatchObject({
      outcome: 'queued',
      queueEntry: {
        state: 'queued',
        revision: 1,
        agent: 'codex',
        attemptId: `attempt-queued-${backend}`,
      },
    });

    await original.release(
      active.reservation?.id as string,
      'completed',
      `release-active-${backend}`
    );
    await original.dispose();

    const restarted = createService(repository, settings, { ownerId: 'owner-restarted' });
    const claimed = await restarted.claimNextQueued();
    expect(claimed).toMatchObject({
      entry: {
        id: queued.queueEntry?.id,
        state: 'leased',
        revision: 2,
        lease: { ownerId: 'owner-restarted' },
      },
      reservation: {
        state: 'active',
        request: { taskId: `task-queued-${backend}` },
        lease: { ownerId: 'owner-restarted' },
      },
    });
    await expect(restarted.claimNextQueued()).resolves.toBeNull();
  });

  it('fails closed on terminal policy, queue bounds, and sensitive idempotency input', async () => {
    const repository = await repositoryFor(backend);
    const terminal = createService(
      repository,
      configuredSettings({ global: { concurrentRuns: 0 } })
    );
    await expect(
      terminal.admitOrQueue(request(`task-terminal-${backend}`), {
        agent: 'codex',
        attemptId: `attempt-terminal-${backend}`,
      })
    ).resolves.toMatchObject({ outcome: 'terminal-policy-denial', queueEntry: undefined });
    await expect(terminal.listQueue()).resolves.toEqual([]);

    const settings = configuredSettings({
      global: { concurrentRuns: 1 },
      queue: { globalLimit: 1, workspaceLimit: 1 },
    });
    const service = createService(repository, settings);
    await service.admit(request(`task-active-bound-${backend}`));
    const rawIdempotencyKey = `operator-secret-${backend}`;
    const queued = await service.admitOrQueue(
      request(`task-bounded-${backend}`, rawIdempotencyKey),
      {
        agent: 'codex',
        attemptId: `attempt-bounded-${backend}`,
      }
    );
    expect(queued.outcome).toBe('queued');
    expect(JSON.stringify(queued.queueEntry)).not.toContain(rawIdempotencyKey);

    const duplicate = await service.admitOrQueue(
      request(`task-bounded-${backend}`, `different-${rawIdempotencyKey}`),
      {
        agent: 'codex',
        attemptId: `attempt-bounded-duplicate-${backend}`,
      }
    );
    expect(duplicate.queueEntry?.id).toBe(queued.queueEntry?.id);
    await expect(
      service.admitOrQueue(
        request(`task-bounded-${backend}`, `different-agent-${rawIdempotencyKey}`),
        {
          agent: 'copilot',
          attemptId: `attempt-bounded-agent-change-${backend}`,
        }
      )
    ).resolves.toMatchObject({
      outcome: 'terminal-policy-denial',
      queueEntry: undefined,
    });
    await expect(
      service.admitOrQueue(request(`task-overflow-${backend}`), {
        agent: 'codex',
        attemptId: `attempt-overflow-${backend}`,
      })
    ).resolves.toMatchObject({
      outcome: 'queue-overflow',
      retryAfterMs: settings.retryAfterMs,
      queueEntry: undefined,
    });
    await expect(service.listQueue()).resolves.toHaveLength(1);
  });

  it('preserves FIFO under competing claims and recovers an abandoned lease once', async () => {
    const repository = await repositoryFor(backend);
    let now = new Date('2026-07-25T12:00:00.000Z');
    const settings = configuredSettings({
      global: { concurrentRuns: 1 },
      queue: { retryBackoffMs: 250 },
    });
    const original = createService(repository, settings, {
      now: () => now,
      ownerId: 'owner-original',
    });
    const active = await original.admit(request(`task-fifo-active-${backend}`));
    const first = await original.admitOrQueue(request(`task-fifo-first-${backend}`), {
      agent: 'codex',
      attemptId: `attempt-fifo-first-${backend}`,
    });
    const second = await original.admitOrQueue(request(`task-fifo-second-${backend}`), {
      agent: 'codex',
      attemptId: `attempt-fifo-second-${backend}`,
    });
    await original.release(
      active.reservation?.id as string,
      'completed',
      `release-fifo-active-${backend}`
    );

    const left = createService(repository, settings, { now: () => now, ownerId: 'owner-left' });
    const right = createService(repository, settings, { now: () => now, ownerId: 'owner-right' });
    const competing = await Promise.all([left.claimNextQueued(), right.claimNextQueued()]);
    const winners = competing.filter((claim) => claim !== null);
    expect(winners).toHaveLength(1);
    expect(winners[0]?.entry.id).toBe(first.queueEntry?.id);
    expect(winners[0]?.entry.selectionEvidence).toMatchObject({
      selectedQueueEntryId: first.queueEntry?.id,
      skipped: [
        {
          queueEntryId: second.queueEntry?.id,
          capacityReadiness: 'not-evaluated',
          reason: 'lower-rank',
        },
      ],
    });
    await left.markQueueDispatched(
      winners[0]?.entry.id as string,
      winners[0]?.entry.attemptId as string
    );
    await left.release(
      winners[0]?.reservation.id as string,
      'completed',
      `release-fifo-first-${backend}`
    );

    const leasedSecond = await right.claimNextQueued();
    expect(leasedSecond?.entry.id).toBe(second.queueEntry?.id);
    now = new Date('2026-07-25T12:00:31.000Z');
    await expect(right.claimNextQueued()).resolves.toBeNull();
    now = new Date('2026-07-25T12:00:31.300Z');
    const recovered = createService(repository, settings, {
      now: () => now,
      ownerId: 'owner-recovered',
    });
    await expect(recovered.claimNextQueued()).resolves.toMatchObject({
      entry: {
        id: second.queueEntry?.id,
        state: 'leased',
        retryCount: 1,
        lease: { ownerId: 'owner-recovered' },
      },
      reservation: { lease: { ownerId: 'owner-recovered' } },
    });
    await expect(recovered.claimNextQueued()).resolves.toBeNull();
  });

  it('skips a capacity-blocked priority leader and persists redacted selection evidence', async () => {
    const repository = await repositoryFor(backend);
    const settings = configuredSettings({
      global: { concurrentRuns: 1 },
      providers: { 'codex-cli': { concurrentRuns: 1 } },
    });
    const service = createService(repository, settings, { ownerId: `owner-scheduler-${backend}` });
    await service.admit(request(`task-provider-blocker-${backend}`));
    const blockedHigh = await service.admitOrQueue(request(`task-high-${backend}`), {
      agent: 'codex',
      attemptId: `attempt-high-${backend}`,
      priority: 'critical',
    });
    const readyLow = await service.admitOrQueue(
      {
        ...request(`task-low-${backend}`),
        provider: 'codex-sdk',
      },
      {
        agent: 'codex-sdk',
        attemptId: `attempt-low-${backend}`,
        priority: 'low',
      }
    );
    settings.global.concurrentRuns = 2;

    const claim = await service.claimNextQueued();

    expect(claim).toMatchObject({
      entry: {
        id: readyLow.queueEntry?.id,
        selectionEvidence: {
          schemaVersion: 'admission-queue-selection/v1',
          policyVersion: 'admission-queue-scheduler/v1',
          selectedQueueEntryId: readyLow.queueEntry?.id,
          rawPriority: 0,
          capacityReadiness: 'ready',
          limitingScopes: [],
          conditionalStartFactors: [
            'queue-eligibility',
            'capacity-available',
            'active-reservation-release',
          ],
          skipped: [
            {
              queueEntryId: blockedHigh.queueEntry?.id,
              rawPriority: 3,
              capacityReadiness: 'blocked',
              limitingScopes: [
                {
                  scope: 'provider',
                  scopeKey: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
                },
              ],
              reason: 'capacity-blocked',
            },
          ],
        },
      },
    });
    const stillQueued = await service.getQueueEntry(blockedHigh.queueEntry?.id as string);
    expect(stillQueued.state).toBe('queued');
    expect(stillQueued.selectionEvidence).toBeUndefined();
  });

  it('projects a filtered, redacted queue view and inspects leased evidence', async () => {
    const repository = await repositoryFor(backend);
    let now = new Date('2026-07-25T12:00:00.000Z');
    const settings = configuredSettings({ global: { concurrentRuns: 1 } });
    const service = createService(repository, settings, {
      now: () => now,
      ownerId: `owner-inspection-${backend}`,
    });
    await expect(service.inspectQueue({ page: 1, limit: 1 })).resolves.toMatchObject({
      depth: { global: { current: 0, limit: 1_000 }, workspaces: [] },
      pagination: {
        page: 1,
        limit: 1,
        total: 0,
        hasMore: false,
        snapshotTruncated: false,
      },
      entries: [],
    });
    const active = await service.admit(request(`task-inspection-active-${backend}`));
    const low = await service.admitOrQueue(
      treeRequest(`task-inspection-low-${backend}`, 'node-low'),
      {
        agent: 'codex',
        attemptId: `attempt-inspection-low-${backend}`,
        priority: 'low',
      }
    );
    const high = await service.admitOrQueue(
      {
        ...request(`task-inspection-high-${backend}`),
        workspaceId: 'workspace-b',
      },
      {
        agent: 'codex',
        attemptId: `attempt-inspection-high-${backend}`,
        priority: 'critical',
      }
    );
    now = new Date('2026-07-25T12:02:00.000Z');

    const listed = await service.inspectQueue({
      workspaceId: 'workspace-a',
      rootObjectiveId: 'objective-a',
      nodeId: 'node-low',
      sources: ['direct'],
      states: ['queued'],
      priority: 0,
      limitingScopes: ['global'],
      minAgeMs: 60_000,
      maxAgeMs: 180_000,
      page: 1,
      limit: 10,
    });

    expect(listed).toMatchObject({
      schemaVersion: 'admission-queue-list/v1',
      generatedAt: now.toISOString(),
      conditional: true,
      depth: {
        global: { current: 2, limit: 1_000 },
        workspaces: expect.arrayContaining([
          expect.objectContaining({
            workspaceId: 'workspace-a',
            workspaceKey: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
            current: 1,
            limit: 100,
          }),
        ]),
      },
      pagination: { page: 1, limit: 10, total: 1, hasMore: false },
      entries: [
        {
          id: low.queueEntry?.id,
          state: 'queued',
          position: 2,
          rawPriority: 0,
          effectivePriority: 2,
          agePromotion: 2,
          ageMs: 120_000,
          readiness: 'conditional',
          lease: { posture: 'none' },
          launch: {
            source: 'direct',
            target: 'direct',
            provider: 'codex-cli',
            workspaceId: 'workspace-a',
            taskKey: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
            workspaceKey: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
            rootObjectiveKey: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
            nodeKey: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
          },
          navigation: {
            taskId: `task-inspection-low-${backend}`,
            attemptId: `attempt-inspection-low-${backend}`,
            executionTree: {
              rootObjectiveId: 'objective-a',
              nodeId: 'node-low',
              edge: 'root',
              depth: 0,
            },
          },
          limitingPolicies: [
            {
              scope: 'global',
              scopeKey: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
              limits: { concurrentRuns: 1 },
            },
          ],
          conditionalStartFactors: expect.arrayContaining([
            'queue-eligibility',
            'active-reservation-release',
            'policy-recheck',
          ]),
        },
      ],
    });
    const serialized = JSON.stringify(listed);
    expect(serialized).toContain('workspace-a');
    expect(serialized).toContain(`task-inspection-low-${backend}`);
    expect(serialized).not.toContain(`tree:node-low`);
    expect(serialized).not.toContain('idempotencyKey');

    const firstPage = await service.inspectQueue({ page: 1, limit: 1 });
    const secondPage = await service.inspectQueue({ page: 2, limit: 1 });
    expect(firstPage).toMatchObject({
      pagination: { page: 1, limit: 1, total: 2, hasMore: true },
      entries: [{ id: high.queueEntry?.id, position: 1 }],
    });
    expect(secondPage).toMatchObject({
      pagination: { page: 2, limit: 1, total: 2, hasMore: false },
      entries: [{ id: low.queueEntry?.id, position: 2 }],
    });

    await service.release(
      active.reservation?.id as string,
      'completed',
      `release-inspection-active-${backend}`
    );
    const claim = await service.claimNextQueued();
    expect(claim?.entry.id).toBe(high.queueEntry?.id);

    const inspected = await service.inspectQueueEntry(high.queueEntry?.id as string);
    expect(inspected).toMatchObject({
      schemaVersion: 'admission-queue-inspection/v1',
      conditional: true,
      entry: {
        id: high.queueEntry?.id,
        state: 'leased',
        readiness: 'reserved',
        lease: { posture: 'active', expiresAt: claim?.entry.lease?.expiresAt },
        selectionEvidence: {
          selectedQueueEntryId: high.queueEntry?.id,
          capacityReadiness: 'ready',
        },
      },
    });
    expect(inspected.entry.position).toBeUndefined();
  });

  it('reactivates a released pre-dispatch reservation when the queue retries', async () => {
    const repository = await repositoryFor(backend);
    let now = new Date('2026-07-25T12:00:00.000Z');
    const settings = configuredSettings({
      global: { concurrentRuns: 1 },
      queue: { retryBackoffMs: 250 },
    });
    const service = createService(repository, settings, {
      ownerId: `owner-retry-${backend}`,
      now: () => now,
    });
    const active = await service.admit(request(`task-retry-active-${backend}`));
    const queued = await service.admitOrQueue(request(`task-retry-queued-${backend}`), {
      agent: 'codex',
      attemptId: `attempt-retry-${backend}`,
    });
    await service.release(
      active.reservation?.id as string,
      'completed',
      `release-retry-active-${backend}`
    );
    const firstClaim = await service.claimNextQueued();
    await service.release(
      firstClaim?.reservation.id as string,
      'start-failed',
      `release-retry-claim-${backend}`
    );
    await service.requeueQueueEntry(
      queued.queueEntry?.id as string,
      'TRANSIENT_PRE_DISPATCH',
      'Transient pre-dispatch failure.'
    );
    now = new Date('2026-07-25T12:00:00.300Z');

    const secondClaim = await service.claimNextQueued();
    expect(secondClaim).toMatchObject({
      entry: {
        id: queued.queueEntry?.id,
        state: 'leased',
        retryCount: 1,
      },
      reservation: {
        id: firstClaim?.reservation.id,
        state: 'active',
      },
    });
    expect(secondClaim?.reservation.revision).toBeGreaterThan(
      firstClaim?.reservation.revision as number
    );
  });

  it('atomically reserves, converts, summarizes, and releases execution-tree budgets', async () => {
    const repository = await repositoryFor(backend);
    const service = createService(repository, configuredSettings());
    const root = await service.admit(treeRequest('task-tree-root', 'node-root'));
    const rootId = root.reservation?.id as string;
    await service.bindAttempt(rootId, 'attempt-root');
    await service.recordBudgetUsage(rootId, {
      schemaVersion: 'execution-tree-budget-event/v1',
      id: 'root-launch',
      mode: 'delta',
      usage: { ...ZERO_AGENT_BUDGET_USAGE, fanOut: 1 },
      source: 'test-launch',
      occurredAt: '2026-07-25T12:00:00.000Z',
    });
    await expect(
      service.admit({
        ...treeRequest('task-tree-looser-policy', 'node-looser-policy', 'node-root', {
          totalTokens: 150,
        }),
        budgetPolicies: [
          {
            ...treePolicy,
            limits: { totalTokens: 200, fanOut: 2 },
          },
        ],
      })
    ).resolves.toMatchObject({
      outcome: 'terminal-policy-denial',
      limitingBudgetPolicies: [
        expect.objectContaining({
          id: treePolicy.id,
          limits: expect.objectContaining({ totalTokens: 100 }),
        }),
      ],
    });

    const child = await service.admit(
      treeRequest('task-tree-child', 'node-child', 'node-root', {
        fanOut: 1,
        totalTokens: 50,
      })
    );
    expect(child.outcome).toBe('admitted');
    const childId = child.reservation?.id as string;
    await service.bindAttempt(childId, 'attempt-child');
    const usageEvent = {
      schemaVersion: 'execution-tree-budget-event/v1' as const,
      id: 'child-usage',
      mode: 'snapshot' as const,
      usage: { ...ZERO_AGENT_BUDGET_USAGE, fanOut: 1, totalTokens: 20 },
      source: 'test-result',
      occurredAt: '2026-07-25T12:00:01.000Z',
    };
    const recorded = await service.recordBudgetUsage(childId, usageEvent);
    await expect(service.recordBudgetUsage(childId, usageEvent)).resolves.toEqual(recorded);
    await expect(
      service.recordBudgetUsage(childId, { ...usageEvent, source: 'conflicting-result' })
    ).rejects.toMatchObject({ statusCode: 409 });

    const released = await service.release(childId, 'completed', 'completed:child');
    expect(released.executionBudget).toMatchObject({
      committed: { totalTokens: 20, fanOut: 1 },
      remaining: { totalTokens: 0, fanOut: 0 },
      releasedUnused: { totalTokens: 30 },
    });
    await expect(service.recordBudgetUsage(childId, usageEvent)).resolves.toEqual(released);
    await expect(
      service.recordBudgetUsage(childId, {
        ...usageEvent,
        id: 'late-child-usage',
        occurredAt: '2026-07-25T12:00:02.000Z',
      })
    ).rejects.toMatchObject({
      statusCode: 409,
    });
    await expect(service.getExecutionTreeSummary('objective-a')).resolves.toMatchObject({
      committed: { totalTokens: 20, fanOut: 2 },
      reserved: { totalTokens: 0, fanOut: 0 },
      contributorCount: 2,
      contributors: expect.arrayContaining([
        expect.objectContaining({
          identity: expect.objectContaining({ nodeId: 'node-child', parentNodeId: 'node-root' }),
        }),
      ]),
    });
    await expect(
      repository.list({ rootObjectiveId: 'objective-a', parentNodeId: 'node-root' })
    ).resolves.toHaveLength(1);

    await expect(
      service.admit(treeRequest('task-tree-overflow', 'node-overflow', 'node-root'))
    ).resolves.toMatchObject({
      outcome: 'terminal-policy-denial',
      limitingBudgetPolicies: [{ id: treePolicy.id }],
    });
  });

  it('serializes competing execution-tree budget claims under the capacity lock', async () => {
    const repository = await repositoryFor(backend);
    const left = createService(repository, configuredSettings(), { ownerId: 'owner-budget-left' });
    const right = createService(repository, configuredSettings(), {
      ownerId: 'owner-budget-right',
    });
    const root = await left.admit(treeRequest('task-budget-root', 'node-root'));
    await left.bindAttempt(root.reservation?.id as string, 'attempt-budget-root');
    const decisions = await Promise.all([
      left.admit(treeRequest('task-budget-left', 'node-left', 'node-root')),
      right.admit(treeRequest('task-budget-right', 'node-right', 'node-root')),
    ]);
    expect(decisions.map((decision) => decision.outcome).sort()).toEqual([
      'admitted',
      'retryable-overload',
    ]);
    expect(decisions.find((decision) => decision.outcome === 'retryable-overload')).toMatchObject({
      limitingBudgetPolicies: [{ id: treePolicy.id }],
    });
  });

  it('reuses released capacity across deep retry and fallback branches', async () => {
    const repository = await repositoryFor(backend);
    const service = createService(repository, configuredSettings());
    const branchPolicy: ExecutionTreeBudgetPolicy = {
      ...treePolicy,
      id: 'budget_deep_wide_tree',
      limits: { totalTokens: 100, fanOut: 10 },
    };
    const withPolicy = (
      taskId: string,
      nodeId: string,
      parentNodeId?: string,
      budgetRequest: Partial<typeof ZERO_AGENT_BUDGET_USAGE> = { fanOut: 1 },
      identity: { edge?: 'child-agent' | 'retry' | 'fallback'; depth?: number } = {}
    ) => ({
      ...treeRequest(taskId, nodeId, parentNodeId, budgetRequest, identity),
      budgetPolicies: [branchPolicy],
    });

    const root = await service.admit(withPolicy('task-branch-root', 'node-branch-root'));
    await service.bindAttempt(root.reservation?.id as string, 'attempt-branch-root');
    const retry = await service.admit(
      withPolicy(
        'task-branch-retry',
        'node-branch-retry',
        'node-branch-root',
        { totalTokens: 60, fanOut: 1, retries: 1 },
        { edge: 'retry' }
      )
    );
    await service.bindAttempt(retry.reservation?.id as string, 'attempt-branch-retry');
    await service.release(retry.reservation?.id as string, 'failed', 'retry-replaced');

    const fallback = await service.admit(
      withPolicy(
        'task-branch-fallback',
        'node-branch-fallback',
        'node-branch-retry',
        { totalTokens: 60, fanOut: 1, retries: 1 },
        { edge: 'fallback', depth: 2 }
      )
    );
    expect(fallback.outcome).toBe('admitted');
    await service.bindAttempt(fallback.reservation?.id as string, 'attempt-branch-fallback');
    const siblings = await Promise.all([
      service.admit(
        withPolicy('task-branch-left', 'node-branch-left', 'node-branch-root', {
          totalTokens: 10,
          fanOut: 1,
        })
      ),
      service.admit(
        withPolicy('task-branch-right', 'node-branch-right', 'node-branch-root', {
          totalTokens: 10,
          fanOut: 1,
        })
      ),
    ]);
    expect(siblings.every((decision) => decision.outcome === 'admitted')).toBe(true);
    await expect(service.getExecutionTreeSummary('objective-a')).resolves.toMatchObject({
      reserved: { totalTokens: 80, fanOut: 4, retries: 1 },
      contributorCount: 5,
      contributors: expect.arrayContaining([
        expect.objectContaining({
          identity: expect.objectContaining({
            nodeId: 'node-branch-fallback',
            parentNodeId: 'node-branch-retry',
            edge: 'fallback',
            depth: 2,
          }),
        }),
      ]),
    });
  });

  it('serializes competing claims and releases the winner idempotently', async () => {
    const repository = await repositoryFor(backend);
    const settings = configuredSettings({ global: { concurrentRuns: 1 } });
    const left = createService(repository, settings, { ownerId: 'owner-left' });
    const right = createService(repository, settings, { ownerId: 'owner-right' });
    const decisions = await Promise.all([
      left.admit(request('task-left')),
      right.admit(request('task-right')),
    ]);
    expect(decisions.map((decision) => decision.outcome).sort()).toEqual([
      'admitted',
      'retryable-overload',
    ]);
    const admitted = decisions.find((decision) => decision.outcome === 'admitted');
    const reservation = await left.bindAttempt(
      admitted?.reservation?.id as string,
      'attempt-winner'
    );
    const released = await left.release(reservation.id, 'completed', 'terminal:attempt-winner');
    await expect(
      left.release(reservation.id, 'completed', 'terminal:attempt-winner')
    ).resolves.toEqual(released);
    expect(released).toMatchObject({
      state: 'released',
      release: {
        reason: 'completed',
        idempotencyKey: 'terminal:attempt-winner',
      },
    });
  });

  it('renews and expires leases with equivalent revisioned state transitions', async () => {
    const repository = await repositoryFor(backend);
    let now = new Date('2026-07-25T12:00:00.000Z');
    const service = createService(repository, configuredSettings(), { now: () => now });
    const decision = await service.admit(request(`task-lease-${backend}`));
    const bound = await service.bindAttempt(
      decision.reservation?.id as string,
      `attempt-lease-${backend}`
    );

    now = new Date('2026-07-25T12:00:01.000Z');
    const renewed = await service.renew(bound.id);
    expect(renewed.revision).toBe(bound.revision + 1);
    expect(renewed.lease.heartbeatAt).toBe(now.toISOString());

    now = new Date('2026-07-25T12:00:32.000Z');
    await expect(service.expireAbandoned()).resolves.toEqual([
      expect.objectContaining({
        id: bound.id,
        state: 'expired',
        revision: renewed.revision + 1,
      }),
    ]);
  });
});
