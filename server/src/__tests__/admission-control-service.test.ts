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
import { AdmissionControlService } from '../services/admission-control-service.js';
import { FileAdmissionReservationRepository } from '../storage/admission-reservation-repository.js';
import { SqliteDatabase } from '../storage/sqlite/database.js';
import { SqliteAdmissionReservationRepository } from '../storage/sqlite/admission-reservation-repository.js';

const roots: string[] = [];
const services: AdmissionControlService[] = [];
const databases: SqliteDatabase[] = [];

afterEach(async () => {
  for (const service of services.splice(0)) service.dispose();
  for (const database of databases.splice(0)) database.close();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

function configuredSettings(
  overrides: {
    global?: AdmissionCapacityLimit;
    providers?: AdmissionSettings['providers'];
    queue?: Partial<AdmissionSettings['queue']>;
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
    heartbeatMs: 20_000,
  };
}

function createService(
  repository: AdmissionReservationRepository,
  settings: AdmissionSettings,
  options: { now?: () => Date; ownerId?: string } = {}
): AdmissionControlService {
  const service = new AdmissionControlService({
    repository,
    settings: async () => structuredClone(settings),
    hostId: 'execution-host-a',
    ownerId: options.ownerId ?? 'owner-a',
    processId: 101,
    now: options.now,
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
    original.dispose();

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
    const initialQueueRevision = claim?.entry.revision as number;
    const initialReservationRevision = claim?.reservation.revision as number;

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
    service.dispose();
  });
});

describe.each(['file', 'sqlite'] as const)('%s admission reservation parity', (backend) => {
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
    original.dispose();

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
