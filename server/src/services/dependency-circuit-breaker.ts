import { createHash } from 'node:crypto';
import { nanoid } from 'nanoid';
import {
  DEPENDENCY_CIRCUIT_POLICY_SCHEMA_VERSION,
  DEPENDENCY_CIRCUIT_SCHEMA_VERSION,
  type DependencyCircuitAdmission,
  type DependencyCircuitLease,
  type DependencyCircuitPolicy,
  type DependencyCircuitReason,
  type DependencyCircuitSnapshot,
  type DependencyIdentity,
  type DependencyOutcome,
  type DependencyOutcomeSignals,
} from '@veritas-kanban/shared';
import {
  DependencyCircuitPolicySchema,
  DependencyIdentitySchema,
} from '../schemas/dependency-circuit-schemas.js';

export const DEFAULT_DEPENDENCY_CIRCUIT_POLICY: DependencyCircuitPolicy = {
  schemaVersion: DEPENDENCY_CIRCUIT_POLICY_SCHEMA_VERSION,
  minimumSamples: 10,
  rollingWindowMs: 60_000,
  failureRateThreshold: 0.5,
  slowCallDurationMs: 30_000,
  slowCallRateThreshold: 0.5,
  openDurationMs: 30_000,
  openDurationJitterRatio: 0.1,
  halfOpenMaxConcurrent: 1,
  probeSuccessThreshold: 2,
};

interface CircuitSample {
  occurredAt: number;
  outcome: DependencyOutcome;
  durationMs: number;
}

interface ActiveLease {
  lease: DependencyCircuitLease;
  settled: boolean;
}

export interface DependencyCircuitBreakerOptions {
  dependency: DependencyIdentity;
  policy?: DependencyCircuitPolicy;
  now?: () => number;
  jitter?: () => number;
}

function isFailure(outcome: DependencyOutcome): boolean {
  return ['dependency-failure', 'timeout', 'throttled', 'overload'].includes(outcome);
}

function isExcluded(outcome: DependencyOutcome): boolean {
  return ['caller-cancellation', 'policy-block', 'validation-error'].includes(outcome);
}

export function dependencyCircuitKey(identity: DependencyIdentity): string {
  const parsed = DependencyIdentitySchema.parse(identity);
  return [
    parsed.workspaceId ?? 'global',
    parsed.kind,
    parsed.id,
    parsed.provider ?? '-',
    parsed.model ?? '-',
    parsed.hostId ?? '-',
  ].join(':');
}

export function opaqueDependencyId(value: string): string {
  return `dep_${createHash('sha256').update(value).digest('base64url').slice(0, 24)}`;
}

export function classifyDependencyOutcome(signals: DependencyOutcomeSignals): DependencyOutcome {
  if (signals.callerCancelled) return 'caller-cancellation';
  if (signals.policyBlocked) return 'policy-block';
  if (signals.validationFailed) return 'validation-error';
  if (signals.timedOut || signals.errorCode === 'ETIMEDOUT') return 'timeout';
  if (signals.statusCode === 429 || signals.errorCode === 'RATE_LIMITED') return 'throttled';
  if (
    signals.statusCode === 503 ||
    signals.statusCode === 529 ||
    signals.errorCode === 'OVERLOADED'
  ) {
    return 'overload';
  }
  if (signals.succeeded) return 'success';
  return 'dependency-failure';
}

export class DependencyCircuitBreaker {
  readonly key: string;
  readonly dependency: DependencyIdentity;
  readonly policy: DependencyCircuitPolicy;

  private readonly now: () => number;
  private readonly jitter: () => number;
  private stateValue: DependencyCircuitSnapshot['state'] = 'closed';
  private samples: CircuitSample[] = [];
  private leases = new Map<string, ActiveLease>();
  private reason?: DependencyCircuitReason;
  private openedAt?: number;
  private nextProbeAt?: number;
  private halfOpenSuccesses = 0;
  private lastOutcome?: DependencyOutcome;
  private lastOutcomeAt?: number;

  constructor(options: DependencyCircuitBreakerOptions) {
    this.dependency = DependencyIdentitySchema.parse(options.dependency);
    this.policy = DependencyCircuitPolicySchema.parse(
      options.policy ?? DEFAULT_DEPENDENCY_CIRCUIT_POLICY
    );
    this.key = dependencyCircuitKey(this.dependency);
    this.now = options.now ?? Date.now;
    this.jitter = options.jitter ?? Math.random;
  }

  acquire(): DependencyCircuitAdmission {
    const now = this.now();
    this.prune(now);
    if (
      this.stateValue === 'open' &&
      this.nextProbeAt !== undefined &&
      now >= this.nextProbeAt
    ) {
      this.stateValue = 'half-open';
      this.halfOpenSuccesses = 0;
      this.reason = this.buildReason('probe-window-opened', now);
    }
    if (this.stateValue === 'open') {
      return {
        allowed: false,
        decision: 'reject',
        reason: 'circuit-open',
        retryAt: this.nextProbeAt ? new Date(this.nextProbeAt).toISOString() : undefined,
        snapshot: this.snapshot(now),
      };
    }
    const probe = this.stateValue === 'half-open';
    if (probe && this.activeProbeCount() >= this.policy.halfOpenMaxConcurrent) {
      return {
        allowed: false,
        decision: 'reject',
        reason: 'probe-concurrency-exhausted',
        retryAt: this.nextProbeAt ? new Date(this.nextProbeAt).toISOString() : undefined,
        snapshot: this.snapshot(now),
      };
    }
    const lease: DependencyCircuitLease = {
      id: `cirlease_${nanoid(18)}`,
      circuitKey: this.key,
      probe,
      acquiredAt: new Date(now).toISOString(),
    };
    this.leases.set(lease.id, { lease, settled: false });
    return {
      allowed: true,
      decision: probe ? 'probe' : 'allow',
      lease,
      snapshot: this.snapshot(now),
    };
  }

  record(lease: DependencyCircuitLease, outcome: DependencyOutcome, durationMs: number): void {
    const active = this.leases.get(lease.id);
    if (!active || active.settled || active.lease.circuitKey !== this.key) {
      throw new Error('Dependency circuit lease is missing, settled, or belongs to another circuit.');
    }
    if (!Number.isFinite(durationMs) || durationMs < 0) {
      throw new Error('Dependency circuit duration must be a non-negative finite number.');
    }
    active.settled = true;
    this.leases.delete(lease.id);
    const now = this.now();
    this.lastOutcome = outcome;
    this.lastOutcomeAt = now;

    if (!isExcluded(outcome)) {
      const normalizedOutcome =
        outcome === 'success' && durationMs >= this.policy.slowCallDurationMs
          ? 'slow-success'
          : outcome;
      this.samples.push({ occurredAt: now, outcome: normalizedOutcome, durationMs });
      this.lastOutcome = normalizedOutcome;
    }
    this.prune(now);

    if (!lease.probe) {
      this.evaluateClosed(now);
      return;
    }
    if (this.stateValue !== 'half-open') return;
    if (isExcluded(outcome)) return;
    const failed =
      isFailure(this.lastOutcome ?? outcome) ||
      durationMs >= this.policy.slowCallDurationMs;
    if (failed) {
      this.open('probe-failed', now);
      return;
    }
    this.halfOpenSuccesses += 1;
    if (this.halfOpenSuccesses >= this.policy.probeSuccessThreshold) {
      this.close('probe-succeeded', now);
    }
  }

  reset(): void {
    const now = this.now();
    this.samples = [];
    this.leases.clear();
    this.stateValue = 'closed';
    this.openedAt = undefined;
    this.nextProbeAt = undefined;
    this.halfOpenSuccesses = 0;
    this.reason = this.buildReason('operator-reset', now);
  }

  getSnapshot(): DependencyCircuitSnapshot {
    const now = this.now();
    this.prune(now);
    return this.snapshot(now);
  }

  private evaluateClosed(now: number): void {
    if (this.stateValue !== 'closed') return;
    const metrics = this.metrics();
    if (metrics.sampleCount < this.policy.minimumSamples) return;
    if (metrics.failureRate >= this.policy.failureRateThreshold) {
      this.open('failure-rate', now);
      return;
    }
    if (metrics.slowCallRate >= this.policy.slowCallRateThreshold) {
      this.open('slow-call-rate', now);
    }
  }

  private open(
    code: Extract<
      DependencyCircuitReason['code'],
      'failure-rate' | 'slow-call-rate' | 'probe-failed'
    >,
    now: number
  ): void {
    const jitterFactor =
      1 + (Math.min(Math.max(this.jitter(), 0), 1) * 2 - 1) * this.policy.openDurationJitterRatio;
    this.stateValue = 'open';
    this.openedAt = now;
    this.nextProbeAt = now + Math.round(this.policy.openDurationMs * jitterFactor);
    this.halfOpenSuccesses = 0;
    this.reason = this.buildReason(code, now);
  }

  private close(code: 'probe-succeeded', now: number): void {
    this.stateValue = 'closed';
    this.samples = [];
    this.openedAt = undefined;
    this.nextProbeAt = undefined;
    this.halfOpenSuccesses = 0;
    this.reason = this.buildReason(code, now);
  }

  private prune(now: number): void {
    const cutoff = now - this.policy.rollingWindowMs;
    this.samples = this.samples.filter((sample) => sample.occurredAt > cutoff);
  }

  private activeProbeCount(): number {
    return [...this.leases.values()].filter((lease) => lease.lease.probe && !lease.settled).length;
  }

  private metrics() {
    const sampleCount = this.samples.length;
    const failureCount = this.samples.filter((sample) => isFailure(sample.outcome)).length;
    const slowCallCount = this.samples.filter(
      (sample) =>
        sample.outcome === 'slow-success' || sample.durationMs >= this.policy.slowCallDurationMs
    ).length;
    return {
      sampleCount,
      failureCount,
      slowCallCount,
      failureRate: sampleCount === 0 ? 0 : failureCount / sampleCount,
      slowCallRate: sampleCount === 0 ? 0 : slowCallCount / sampleCount,
    };
  }

  private buildReason(code: DependencyCircuitReason['code'], now: number): DependencyCircuitReason {
    return {
      code,
      observedAt: new Date(now).toISOString(),
      ...this.metrics(),
    };
  }

  private snapshot(now: number): DependencyCircuitSnapshot {
    const metrics = this.metrics();
    return {
      schemaVersion: DEPENDENCY_CIRCUIT_SCHEMA_VERSION,
      key: this.key,
      dependency: this.dependency,
      policy: this.policy,
      state: this.stateValue,
      reason: this.reason,
      ...metrics,
      openedAt: this.openedAt ? new Date(this.openedAt).toISOString() : undefined,
      nextProbeAt: this.nextProbeAt ? new Date(this.nextProbeAt).toISOString() : undefined,
      halfOpenInFlight: this.activeProbeCount(),
      halfOpenSuccesses: this.halfOpenSuccesses,
      lastOutcome: this.lastOutcome,
      lastOutcomeAt: this.lastOutcomeAt
        ? new Date(this.lastOutcomeAt).toISOString()
        : undefined,
      updatedAt: new Date(now).toISOString(),
    };
  }
}
