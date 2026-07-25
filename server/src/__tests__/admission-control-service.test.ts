import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AdmissionReservationRepository } from '../storage/interfaces.js';
import {
  DEFAULT_FEATURE_SETTINGS,
  type AdmissionCapacityLimit,
  type AdmissionSettings,
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
  } = {}
): AdmissionSettings {
  return {
    ...structuredClone(DEFAULT_FEATURE_SETTINGS.admission),
    global: overrides.global ?? {},
    providers: overrides.providers ?? {},
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
});

describe.each(['file', 'sqlite'] as const)('%s admission reservation parity', (backend) => {
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
