import { describe, expect, it } from 'vitest';
import type {
  DependencyCircuitAdmission,
  DependencyCircuitPolicy,
  DependencyIdentity,
  DependencyRetryBudgetKind,
  DependencyRouteCandidate,
} from '@veritas-kanban/shared';
import {
  DependencyCircuitExecutionService,
  DependencyCircuitRoutingService,
  DependencyRouteUnavailableError,
} from '../services/dependency-circuit-routing-service.js';
import { DependencyCircuitRegistryService } from '../services/dependency-circuit-registry-service.js';
import { DependencyRetryBudgetService } from '../services/dependency-retry-budget-service.js';
import { InMemoryDependencyCircuitStateRepository } from '../storage/dependency-circuit-state-repository.js';

const circuitPolicy: DependencyCircuitPolicy = {
  schemaVersion: 'dependency-circuit-policy/v1',
  minimumSamples: 1,
  rollingWindowMs: 10_000,
  failureRateThreshold: 1,
  slowCallDurationMs: 1_000,
  slowCallRateThreshold: 1,
  openDurationMs: 2_000,
  openDurationJitterRatio: 0,
  halfOpenMaxConcurrent: 1,
  probeSuccessThreshold: 1,
};

const primary: DependencyIdentity = {
  kind: 'model-endpoint',
  id: 'openai-primary',
  workspaceId: 'workspace_1',
  provider: 'codex-cli',
  model: 'gpt-5.6',
};

const fallback: DependencyIdentity = {
  kind: 'model-endpoint',
  id: 'anthropic-fallback',
  workspaceId: 'workspace_1',
  provider: 'claude-code',
  model: 'claude-opus-4-5',
};

const agentHost: DependencyIdentity = {
  kind: 'agent-host',
  id: 'host-local-process',
  workspaceId: 'workspace_1',
  hostId: 'local-process',
};

function candidates(): DependencyRouteCandidate[] {
  return [
    { id: 'primary', label: 'Primary model', dependency: primary, priority: 0, policy: circuitPolicy },
    {
      id: 'fallback',
      label: 'Fallback model',
      dependency: fallback,
      priority: 10,
      policy: circuitPolicy,
    },
  ];
}

function admitted(admission: DependencyCircuitAdmission) {
  if (!admission.allowed) throw new Error('Expected dependency circuit admission.');
  return admission.lease;
}

async function open(
  registry: DependencyCircuitRegistryService,
  dependency: DependencyIdentity
) {
  const lease = admitted(await registry.acquire(dependency, circuitPolicy));
  await registry.record(lease, 'timeout', 2_000);
}

describe('DependencyCircuitRoutingService', () => {
  it('selects the primary route and returns its exact admission lease', async () => {
    const registry = new DependencyCircuitRegistryService({
      repository: new InMemoryDependencyCircuitStateRepository(),
    });
    const routing = new DependencyCircuitRoutingService(registry);

    const decision = await routing.require(candidates(), {
      allowFallback: true,
      noMatchAction: 'reject',
    });

    expect(decision).toMatchObject({
      candidate: { id: 'primary' },
      fallback: false,
      admission: { decision: 'allow' },
      exclusions: [],
    });
    await registry.record(decision.admission.lease, 'success', 10);
  });

  it('selects an explicit fallback and explains the open primary', async () => {
    const registry = new DependencyCircuitRegistryService({
      repository: new InMemoryDependencyCircuitStateRepository(),
    });
    await open(registry, primary);
    const decision = await new DependencyCircuitRoutingService(registry).require(candidates(), {
      allowFallback: true,
      noMatchAction: 'reject',
    });

    expect(decision).toMatchObject({
      candidate: { id: 'fallback' },
      fallback: true,
      exclusions: [{ candidateId: 'primary', reason: 'circuit-open' }],
    });
    expect(decision.reason).toContain('Selected fallback');
    await registry.record(decision.admission.lease, 'success', 10);
  });

  it('fails closed with the configured queue action when fallback is forbidden', async () => {
    const registry = new DependencyCircuitRegistryService({
      repository: new InMemoryDependencyCircuitStateRepository(),
    });
    await open(registry, primary);
    const routing = new DependencyCircuitRoutingService(registry);

    const decision = await routing.select(candidates(), {
      allowFallback: false,
      noMatchAction: 'queue',
    });

    expect(decision).toMatchObject({
      selected: false,
      action: 'queue',
      exclusions: [{ candidateId: 'primary', reason: 'circuit-open' }],
    });
    await expect(
      routing.require(candidates(), {
        allowFallback: false,
        noMatchAction: 'operator-approval',
      })
    ).rejects.toBeInstanceOf(DependencyRouteUnavailableError);
  });

  it('single-flights a half-open probe and routes the concurrent caller to fallback', async () => {
    let now = Date.parse('2026-07-25T12:00:00.000Z');
    const registry = new DependencyCircuitRegistryService({
      repository: new InMemoryDependencyCircuitStateRepository(),
      now: () => now,
      jitter: () => 0.5,
    });
    await open(registry, primary);
    now += 2_000;
    const routing = new DependencyCircuitRoutingService(registry);

    const probe = await routing.require(candidates(), {
      allowFallback: true,
      noMatchAction: 'reject',
    });
    const concurrent = await routing.require(candidates(), {
      allowFallback: true,
      noMatchAction: 'reject',
    });

    expect(probe).toMatchObject({ candidate: { id: 'primary' }, admission: { decision: 'probe' } });
    expect(concurrent).toMatchObject({
      candidate: { id: 'fallback' },
      exclusions: [{ reason: 'probe-concurrency-exhausted' }],
    });
    await registry.record(probe.admission.lease, 'success', 10);
    await registry.record(concurrent.admission.lease, 'success', 10);
  });
});

describe('DependencyCircuitExecutionService', () => {
  it('records timeout failures and rejects the next operation', async () => {
    const registry = new DependencyCircuitRegistryService({
      repository: new InMemoryDependencyCircuitStateRepository(),
    });
    const execution = new DependencyCircuitExecutionService(registry);
    const timeout = Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' });

    await expect(
      execution.execute(primary, async () => Promise.reject(timeout), { policy: circuitPolicy })
    ).rejects.toBe(timeout);
    await expect(
      execution.execute(primary, async () => 'unreachable', { policy: circuitPolicy })
    ).rejects.toBeInstanceOf(DependencyRouteUnavailableError);
  });

  it('excludes caller cancellation from dependency failure evidence', async () => {
    const registry = new DependencyCircuitRegistryService({
      repository: new InMemoryDependencyCircuitStateRepository(),
    });
    const execution = new DependencyCircuitExecutionService(registry);
    const abort = new DOMException('cancelled', 'AbortError');

    await expect(
      execution.execute(fallback, async () => Promise.reject(abort), { policy: circuitPolicy })
    ).rejects.toBe(abort);

    const snapshots = await registry.listSnapshots();
    expect(snapshots[0]).toMatchObject({
      state: 'closed',
      sampleCount: 0,
      failureCount: 0,
      lastOutcome: 'caller-cancellation',
    });
  });

  it('records successful slow calls against the slow-call threshold', async () => {
    let now = 1_000;
    const registry = new DependencyCircuitRegistryService({
      repository: new InMemoryDependencyCircuitStateRepository(),
      now: () => now,
      jitter: () => 0.5,
    });
    const execution = new DependencyCircuitExecutionService(registry, () => now);

    await execution.execute(
      primary,
      async () => {
        now += 1_000;
        return 'ok';
      },
      { policy: circuitPolicy }
    );

    expect((await registry.listSnapshots())[0]).toMatchObject({
      state: 'open',
      slowCallCount: 1,
      reason: { code: 'slow-call-rate' },
    });
  });

  it('records one operation against provider and agent-host circuits', async () => {
    const registry = new DependencyCircuitRegistryService({
      repository: new InMemoryDependencyCircuitStateRepository(),
    });
    const execution = new DependencyCircuitExecutionService(registry);

    await expect(
      execution.executeAll([primary, agentHost], async () => 'started', {
        policy: circuitPolicy,
      })
    ).resolves.toBe('started');

    expect(await registry.listSnapshots()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          dependency: expect.objectContaining({ kind: 'model-endpoint' }),
          sampleCount: 1,
          lastOutcome: 'success',
        }),
        expect.objectContaining({
          dependency: expect.objectContaining({ kind: 'agent-host' }),
          sampleCount: 1,
          lastOutcome: 'success',
        }),
      ])
    );
  });

  it('settles earlier leases as policy blocks when a later dependency rejects', async () => {
    const registry = new DependencyCircuitRegistryService({
      repository: new InMemoryDependencyCircuitStateRepository(),
    });
    await open(registry, agentHost);
    const execution = new DependencyCircuitExecutionService(registry);

    await expect(
      execution.executeAll([primary, agentHost], async () => 'unreachable', {
        policy: circuitPolicy,
      })
    ).rejects.toBeInstanceOf(DependencyRouteUnavailableError);

    expect(await registry.inspect(primary, circuitPolicy)).toMatchObject({
      state: 'closed',
      sampleCount: 0,
      lastOutcome: 'policy-block',
    });
  });
});

describe('DependencyRetryBudgetService', () => {
  it('accounts for each retry class independently', () => {
    const kinds: DependencyRetryBudgetKind[] = [
      'transport-retry',
      'throttling-backoff',
      'circuit-rejection',
      'model-resample',
      'watchdog-recovery',
      'provider-fallback',
    ];
    const budgets = new DependencyRetryBudgetService({
      limits: Object.fromEntries(kinds.map((kind) => [kind, kind === 'transport-retry' ? 1 : 2])) as Record<
        DependencyRetryBudgetKind,
        number
      >,
    });

    expect(budgets.consume('transport-retry')).toMatchObject({ allowed: true, remaining: 1 });
    expect(budgets.consume('transport-retry')).toMatchObject({ allowed: false, remaining: 0 });
    expect(budgets.inspect('provider-fallback')).toMatchObject({
      allowed: true,
      used: 0,
      remaining: 2,
    });
    expect(budgets.snapshot().used['transport-retry']).toBe(1);
  });
});
