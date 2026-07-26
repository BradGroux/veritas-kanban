import { mkdtemp, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type {
  DependencyCircuitAdmission,
  DependencyCircuitPolicy,
  DependencyIdentity,
  DependencyOutcome,
} from '@veritas-kanban/shared';
import { DependencyCircuitRegistryService } from '../services/dependency-circuit-registry-service.js';
import {
  FileDependencyCircuitStateRepository,
  InMemoryDependencyCircuitStateRepository,
} from '../storage/dependency-circuit-state-repository.js';

const identity: DependencyIdentity = {
  kind: 'model-endpoint',
  id: 'openai-gpt',
  workspaceId: 'workspace_1',
  provider: 'codex-cli',
  model: 'gpt-5.6',
};

function policy(overrides: Partial<DependencyCircuitPolicy> = {}): DependencyCircuitPolicy {
  return {
    schemaVersion: 'dependency-circuit-policy/v1',
    minimumSamples: 2,
    rollingWindowMs: 10_000,
    failureRateThreshold: 0.5,
    slowCallDurationMs: 1_000,
    slowCallRateThreshold: 0.5,
    openDurationMs: 2_000,
    openDurationJitterRatio: 0,
    halfOpenMaxConcurrent: 1,
    probeSuccessThreshold: 1,
    ...overrides,
  };
}

function admitted(admission: DependencyCircuitAdmission) {
  if (!admission.allowed) throw new Error('Expected dependency circuit admission.');
  return admission.lease;
}

async function report(
  registry: DependencyCircuitRegistryService,
  outcome: DependencyOutcome,
  durationMs = 10
) {
  const lease = admitted(await registry.acquire(identity, policy()));
  return registry.record(lease, outcome, durationMs);
}

describe('DependencyCircuitRegistryService', () => {
  it('restores open circuits and probe timing from durable state', async () => {
    let now = Date.parse('2026-07-25T12:00:00.000Z');
    const repository = new InMemoryDependencyCircuitStateRepository();
    const first = new DependencyCircuitRegistryService({
      repository,
      now: () => now,
      jitter: () => 0.5,
    });
    await report(first, 'dependency-failure');
    await report(first, 'timeout');

    const restarted = new DependencyCircuitRegistryService({
      repository,
      now: () => now,
      jitter: () => 0.5,
    });
    expect(await restarted.acquire(identity, policy())).toMatchObject({
      allowed: false,
      reason: 'circuit-open',
      retryAt: '2026-07-25T12:00:02.000Z',
    });
    now += 2_000;
    expect(await restarted.acquire(identity, policy())).toMatchObject({
      allowed: true,
      decision: 'probe',
    });
  });

  it('serializes mutations and exposes sorted health snapshots', async () => {
    const repository = new InMemoryDependencyCircuitStateRepository();
    const registry = new DependencyCircuitRegistryService({
      repository,
      now: () => Date.parse('2026-07-25T12:00:00.000Z'),
      jitter: () => 0.5,
    });
    const alternate = { ...identity, id: 'anthropic-claude', provider: 'claude-code' };

    const firstLease = admitted(await registry.acquire(identity, policy()));
    const secondLease = admitted(await registry.acquire(alternate, policy()));
    await Promise.all([
      registry.record(firstLease, 'success', 10),
      registry.record(secondLease, 'success', 10),
    ]);

    const snapshots = await registry.listSnapshots();
    expect(snapshots).toHaveLength(2);
    expect(snapshots.map((snapshot) => snapshot.key)).toEqual(
      [...snapshots.map((snapshot) => snapshot.key)].sort()
    );
  });

  it('invalidates persisted evidence when the configured policy changes', async () => {
    const repository = new InMemoryDependencyCircuitStateRepository();
    const first = new DependencyCircuitRegistryService({ repository });
    await report(first, 'dependency-failure');

    const restarted = new DependencyCircuitRegistryService({ repository });
    const admission = await restarted.acquire(identity, policy({ minimumSamples: 20 }));

    expect(admission).toMatchObject({
      allowed: true,
      snapshot: { state: 'closed', sampleCount: 0 },
    });
  });

  it('persists operator reset state across restart', async () => {
    const repository = new InMemoryDependencyCircuitStateRepository();
    const registry = new DependencyCircuitRegistryService({ repository });
    await report(registry, 'dependency-failure');
    const opened = await report(registry, 'timeout');

    expect(await registry.reset(opened.key)).toBe(true);
    const restarted = new DependencyCircuitRegistryService({ repository });

    expect(await restarted.getSnapshot(opened.key)).toMatchObject({
      state: 'closed',
      sampleCount: 0,
      reason: { code: 'operator-reset' },
    });
  });

  it('persists bounded state to a file repository', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'vk-dependency-circuits-'));
    const repository = new FileDependencyCircuitStateRepository(directory);
    const registry = new DependencyCircuitRegistryService({
      repository,
      now: () => Date.parse('2026-07-25T12:00:00.000Z'),
      jitter: () => 0.5,
    });
    const lease = admitted(await registry.acquire(identity, policy()));
    await registry.record(lease, 'success', 10);

    const states = await repository.list();
    expect(states).toHaveLength(1);
    expect(await repository.read(states[0].snapshot.key)).toEqual(states[0]);
    expect(await repository.delete(states[0].snapshot.key)).toBe(true);
    expect(await repository.list()).toEqual([]);
  });

  it.runIf(process.platform !== 'win32')('refuses symlinked state entries', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'vk-dependency-circuits-'));
    const target = path.join(directory, 'target');
    await symlink(target, path.join(directory, `${'a'.repeat(64)}.json`));
    const repository = new FileDependencyCircuitStateRepository(directory);

    await expect(repository.list()).rejects.toThrow('non-regular state entry');
  });
});
