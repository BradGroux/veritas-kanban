import { mkdtemp, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type {
  DependencyCircuitAdmission,
  DependencyCircuitPolicy,
  DependencyIdentity,
} from '@veritas-kanban/shared';
import { DependencyCircuitControlService } from '../services/dependency-circuit-control-service.js';
import { DependencyCircuitRegistryService } from '../services/dependency-circuit-registry-service.js';
import {
  FileDependencyCircuitOverrideRepository,
  InMemoryDependencyCircuitOverrideRepository,
} from '../storage/dependency-circuit-override-repository.js';
import { InMemoryDependencyCircuitStateRepository } from '../storage/dependency-circuit-state-repository.js';

const identity: DependencyIdentity = {
  kind: 'provider',
  id: 'provider-fixture',
  workspaceId: 'workspace_1',
  provider: 'codex-cli',
};

const policy: DependencyCircuitPolicy = {
  schemaVersion: 'dependency-circuit-policy/v1',
  minimumSamples: 1,
  rollingWindowMs: 10_000,
  failureRateThreshold: 1,
  slowCallDurationMs: 1_000,
  slowCallRateThreshold: 1,
  openDurationMs: 120_000,
  openDurationJitterRatio: 0,
  halfOpenMaxConcurrent: 1,
  probeSuccessThreshold: 1,
};

function admitted(admission: DependencyCircuitAdmission) {
  if (!admission.allowed) throw new Error('Expected dependency circuit admission.');
  return admission.lease;
}

function fixture() {
  let now = Date.parse('2026-07-25T12:00:00.000Z');
  const stateRepository = new InMemoryDependencyCircuitStateRepository();
  const overrideRepository = new InMemoryDependencyCircuitOverrideRepository();
  const registry = new DependencyCircuitRegistryService({
    repository: stateRepository,
    overrideRepository,
    now: () => now,
    jitter: () => 0.5,
  });
  const audit = vi.fn(async () => undefined);
  const controls = new DependencyCircuitControlService(registry, audit, () => now);
  return {
    registry,
    controls,
    audit,
    stateRepository,
    overrideRepository,
    advance: (milliseconds: number) => {
      now += milliseconds;
    },
    now: () => now,
  };
}

async function open(registry: DependencyCircuitRegistryService) {
  const lease = admitted(await registry.acquire(identity, policy));
  await registry.record(lease, 'timeout', 2_000);
}

describe('DependencyCircuitControlService', () => {
  it('allows an expiring audited bypass without silently closing the circuit', async () => {
    const { registry, controls, audit, advance } = fixture();
    await open(registry);
    const override = await controls.override({
      circuitKey: (await registry.listSnapshots())[0].key,
      mode: 'allow',
      reason: 'Operator verified a bounded recovery window.',
      durationSeconds: 60,
      actorId: 'operator-1',
    });

    const admission = await registry.acquire(identity, policy);
    expect(admission).toMatchObject({
      allowed: true,
      lease: { overrideId: override.id },
      snapshot: { state: 'open' },
    });
    if (admission.allowed) await registry.record(admission.lease, 'success', 10);
    expect((await registry.listSnapshots())[0].state).toBe('open');
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'dependency-circuit.override.created',
        actor: 'operator-1',
      })
    );

    advance(60_001);
    expect(await registry.acquire(identity, policy)).toMatchObject({
      allowed: false,
      reason: 'circuit-open',
    });
    expect(await registry.listOverrides()).toEqual([]);
  });

  it('blocks a healthy dependency until the operator override expires', async () => {
    const { registry, controls, advance } = fixture();
    const initial = await registry.acquire(identity, policy);
    if (initial.allowed) await registry.record(initial.lease, 'success', 10);
    const key = (await registry.listSnapshots())[0].key;
    await controls.override({
      circuitKey: key,
      mode: 'block',
      reason: 'Operator observed unsafe upstream behavior.',
      durationSeconds: 60,
      actorId: 'operator-1',
    });

    expect(await registry.acquire(identity, policy)).toMatchObject({
      allowed: false,
      reason: 'operator-block',
    });
    advance(60_001);
    expect(await registry.acquire(identity, policy)).toMatchObject({ allowed: true });
  });

  it('restores active overrides across a registry restart', async () => {
    const first = fixture();
    const initial = await first.registry.acquire(identity, policy);
    if (initial.allowed) await first.registry.record(initial.lease, 'success', 10);
    const key = (await first.registry.listSnapshots())[0].key;
    await first.controls.override({
      circuitKey: key,
      mode: 'block',
      reason: 'Keep the dependency blocked during incident response.',
      durationSeconds: 60,
      actorId: 'operator-1',
    });
    const restarted = new DependencyCircuitRegistryService({
      repository: first.stateRepository,
      overrideRepository: first.overrideRepository,
      now: first.now,
      jitter: () => 0.5,
    });

    expect(await restarted.acquire(identity, policy)).toMatchObject({
      allowed: false,
      reason: 'operator-block',
    });
  });

  it('resets circuit evidence and emits a redacted audit record', async () => {
    const { registry, controls, audit } = fixture();
    await open(registry);
    const key = (await registry.listSnapshots())[0].key;

    expect(await controls.reset(key, 'operator-1', 'Verified provider recovery.')).toBe(true);
    expect(await registry.getSnapshot(key)).toMatchObject({
      state: 'closed',
      sampleCount: 0,
      reason: { code: 'operator-reset' },
    });
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'dependency-circuit.reset',
        actor: 'operator-1',
      })
    );
  });

  it('persists bounded overrides to a file repository', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'vk-dependency-overrides-'));
    const overrideRepository = new FileDependencyCircuitOverrideRepository(directory);
    const registry = new DependencyCircuitRegistryService({
      repository: new InMemoryDependencyCircuitStateRepository(),
      overrideRepository,
    });
    const controls = new DependencyCircuitControlService(registry, async () => undefined);
    const initial = await registry.acquire(identity, policy);
    if (initial.allowed) await registry.record(initial.lease, 'success', 10);
    const key = (await registry.listSnapshots())[0].key;

    const created = await controls.override({
      circuitKey: key,
      mode: 'block',
      reason: 'Keep this dependency blocked during recovery.',
      durationSeconds: 60,
      actorId: 'operator-1',
    });

    expect(await overrideRepository.list()).toEqual([created]);
    expect(await overrideRepository.delete(key)).toBe(true);
    expect(await overrideRepository.list()).toEqual([]);
  });

  it.runIf(process.platform !== 'win32')('refuses symlinked override entries', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'vk-dependency-overrides-'));
    const target = path.join(directory, 'target');
    await symlink(target, path.join(directory, `${'a'.repeat(64)}.json`));
    const repository = new FileDependencyCircuitOverrideRepository(directory);

    await expect(repository.list()).rejects.toThrow('non-regular entry');
  });
});
