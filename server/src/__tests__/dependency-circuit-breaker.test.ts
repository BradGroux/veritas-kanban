import { describe, expect, it } from 'vitest';
import type {
  DependencyCircuitAdmission,
  DependencyCircuitPolicy,
  DependencyOutcome,
} from '@veritas-kanban/shared';
import {
  DependencyCircuitBreaker,
  classifyDependencyOutcome,
  dependencyCircuitKey,
  opaqueDependencyId,
} from '../services/dependency-circuit-breaker.js';

function policy(overrides: Partial<DependencyCircuitPolicy> = {}): DependencyCircuitPolicy {
  return {
    schemaVersion: 'dependency-circuit-policy/v1',
    minimumSamples: 4,
    rollingWindowMs: 10_000,
    failureRateThreshold: 0.5,
    slowCallDurationMs: 1_000,
    slowCallRateThreshold: 0.5,
    openDurationMs: 2_000,
    openDurationJitterRatio: 0,
    halfOpenMaxConcurrent: 1,
    probeSuccessThreshold: 2,
    ...overrides,
  };
}

function fixture(overrides: Partial<DependencyCircuitPolicy> = {}) {
  let now = Date.parse('2026-07-25T12:00:00.000Z');
  const breaker = new DependencyCircuitBreaker({
    dependency: {
      kind: 'model-endpoint',
      id: 'openai-gpt',
      workspaceId: 'workspace_1',
      provider: 'codex-cli',
      model: 'gpt-5.6',
    },
    policy: policy(overrides),
    now: () => now,
    jitter: () => 0.5,
  });
  return {
    breaker,
    advance: (milliseconds: number) => {
      now += milliseconds;
    },
  };
}

function admitted(admission: DependencyCircuitAdmission) {
  if (!admission.allowed) throw new Error('Expected the circuit to admit the call.');
  return admission.lease;
}

function record(
  breaker: DependencyCircuitBreaker,
  outcome: DependencyOutcome,
  durationMs = 10
) {
  const lease = admitted(breaker.acquire());
  breaker.record(lease, outcome, durationMs);
}

describe('DependencyCircuitBreaker', () => {
  it('builds a stable scoped key while offering a hash for secret endpoint identities', () => {
    const identity = {
      kind: 'provider' as const,
      id: opaqueDependencyId('https://secret-host.example/v1?token=do-not-store'),
      workspaceId: 'workspace_1',
      provider: 'codex-cli',
    };

    expect(identity.id).toMatch(/^dep_[A-Za-z0-9_-]{24}$/);
    expect(identity.id).not.toContain('secret-host');
    expect(dependencyCircuitKey(identity)).toBe(
      `workspace_1:provider:${identity.id}:codex-cli:-:-`
    );
  });

  it('requires the minimum sample size before evaluating failure rate', () => {
    const { breaker } = fixture({ minimumSamples: 3, failureRateThreshold: 0.5 });

    record(breaker, 'dependency-failure');
    record(breaker, 'dependency-failure');
    expect(breaker.getSnapshot().state).toBe('closed');
    record(breaker, 'success');

    expect(breaker.getSnapshot()).toMatchObject({
      state: 'open',
      reason: {
        code: 'failure-rate',
        sampleCount: 3,
        failureCount: 2,
        failureRate: 2 / 3,
      },
    });
  });

  it('opens exactly at the configured failure-rate boundary', () => {
    const { breaker } = fixture();

    record(breaker, 'success');
    record(breaker, 'dependency-failure');
    record(breaker, 'success');
    record(breaker, 'timeout');

    expect(breaker.getSnapshot()).toMatchObject({
      state: 'open',
      failureCount: 2,
      failureRate: 0.5,
      reason: { code: 'failure-rate' },
    });
  });

  it('excludes caller cancellation, policy denial, and validation errors', () => {
    const { breaker } = fixture({ minimumSamples: 2 });

    record(breaker, 'caller-cancellation');
    record(breaker, 'policy-block');
    record(breaker, 'validation-error');
    record(breaker, 'success');

    expect(breaker.getSnapshot()).toMatchObject({
      state: 'closed',
      sampleCount: 1,
      failureCount: 0,
      lastOutcome: 'success',
    });
  });

  it('opens on slow-call rate without treating slow success as dependency failure', () => {
    const { breaker } = fixture();

    record(breaker, 'success', 1_000);
    record(breaker, 'success', 10);
    record(breaker, 'success', 1_500);
    record(breaker, 'success', 20);

    expect(breaker.getSnapshot()).toMatchObject({
      state: 'open',
      failureCount: 0,
      slowCallCount: 2,
      slowCallRate: 0.5,
      reason: { code: 'slow-call-rate' },
    });
  });

  it('rejects while open and single-flights half-open probes', () => {
    const { breaker, advance } = fixture({ minimumSamples: 1 });
    record(breaker, 'dependency-failure');

    expect(breaker.acquire()).toMatchObject({
      allowed: false,
      reason: 'circuit-open',
      retryAt: '2026-07-25T12:00:02.000Z',
    });
    advance(2_000);
    const probe = breaker.acquire();
    expect(probe).toMatchObject({ allowed: true, decision: 'probe' });
    expect(breaker.acquire()).toMatchObject({
      allowed: false,
      reason: 'probe-concurrency-exhausted',
    });
  });

  it('closes only after the configured number of successful probes', () => {
    const { breaker, advance } = fixture({ minimumSamples: 1 });
    record(breaker, 'dependency-failure');
    advance(2_000);

    record(breaker, 'success');
    expect(breaker.getSnapshot()).toMatchObject({ state: 'half-open', halfOpenSuccesses: 1 });
    record(breaker, 'success');

    expect(breaker.getSnapshot()).toMatchObject({
      state: 'closed',
      sampleCount: 0,
      reason: { code: 'probe-succeeded' },
    });
  });

  it('reopens after a failed probe and applies bounded jitter', () => {
    const { breaker, advance } = fixture({
      minimumSamples: 1,
      openDurationJitterRatio: 0.25,
    });
    record(breaker, 'dependency-failure');
    advance(2_000);
    const probe = admitted(breaker.acquire());
    breaker.record(probe, 'overload', 20);

    expect(breaker.getSnapshot()).toMatchObject({
      state: 'open',
      reason: { code: 'probe-failed' },
      nextProbeAt: '2026-07-25T12:00:04.000Z',
    });
  });

  it('does not let a stale concurrent probe close a reopened circuit', () => {
    const { breaker, advance } = fixture({
      minimumSamples: 1,
      halfOpenMaxConcurrent: 2,
      probeSuccessThreshold: 1,
    });
    record(breaker, 'dependency-failure');
    advance(2_000);
    const failed = admitted(breaker.acquire());
    const stale = admitted(breaker.acquire());
    breaker.record(failed, 'timeout', 2_000);
    breaker.record(stale, 'success', 10);

    expect(breaker.getSnapshot()).toMatchObject({
      state: 'open',
      reason: { code: 'probe-failed' },
    });
  });

  it('prunes old samples from the rolling window', () => {
    const { breaker, advance } = fixture({ minimumSamples: 2, rollingWindowMs: 1_000 });
    record(breaker, 'dependency-failure');
    advance(1_001);
    record(breaker, 'success');

    expect(breaker.getSnapshot()).toMatchObject({
      state: 'closed',
      sampleCount: 1,
      failureCount: 0,
    });
  });

  it('restores rolling evidence and open-state timing after restart', () => {
    const { breaker } = fixture({ minimumSamples: 3 });
    record(breaker, 'dependency-failure');
    record(breaker, 'success');
    const state = breaker.exportState();
    const restored = new DependencyCircuitBreaker({
      dependency: state.snapshot.dependency,
      policy: state.snapshot.policy,
      state,
      now: () => Date.parse(state.capturedAt),
      jitter: () => 0.5,
    });

    record(restored, 'timeout');

    expect(restored.getSnapshot()).toMatchObject({
      state: 'open',
      sampleCount: 3,
      failureCount: 2,
      reason: { code: 'failure-rate' },
    });
    const reopened = new DependencyCircuitBreaker({
      dependency: restored.dependency,
      policy: restored.policy,
      state: restored.exportState(),
      now: () => Date.parse(state.capturedAt),
      jitter: () => 0.5,
    });
    expect(reopened.acquire()).toMatchObject({
      allowed: false,
      reason: 'circuit-open',
      retryAt: '2026-07-25T12:00:02.000Z',
    });
  });

  it('rejects duplicate lease settlement', () => {
    const { breaker } = fixture();
    const lease = admitted(breaker.acquire());
    breaker.record(lease, 'success', 10);

    expect(() => breaker.record(lease, 'success', 10)).toThrow('missing, settled');
  });
});

describe('classifyDependencyOutcome', () => {
  it.each([
    [{ succeeded: true }, 'success'],
    [{ callerCancelled: true, timedOut: true }, 'caller-cancellation'],
    [{ policyBlocked: true }, 'policy-block'],
    [{ validationFailed: true }, 'validation-error'],
    [{ timedOut: true }, 'timeout'],
    [{ statusCode: 429 }, 'throttled'],
    [{ statusCode: 503 }, 'overload'],
    [{ errorCode: 'OVERLOADED' }, 'overload'],
    [{}, 'dependency-failure'],
  ] as const)('classifies %j as %s', (signals, expected) => {
    expect(classifyDependencyOutcome(signals)).toBe(expected);
  });
});
