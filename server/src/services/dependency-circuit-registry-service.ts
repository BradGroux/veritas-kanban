import type {
  DependencyCircuitAdmission,
  DependencyCircuitLease,
  DependencyCircuitOverride,
  DependencyCircuitPolicy,
  DependencyCircuitPersistedState,
  DependencyCircuitSnapshot,
  DependencyIdentity,
  DependencyOutcome,
} from '@veritas-kanban/shared';
import type { DependencyCircuitStateRepository } from '../storage/dependency-circuit-state-repository.js';
import type { DependencyCircuitOverrideRepository } from '../storage/dependency-circuit-override-repository.js';
import { DependencyCircuitOverrideSchema } from '../schemas/dependency-circuit-schemas.js';
import {
  DEFAULT_DEPENDENCY_CIRCUIT_POLICY,
  DependencyCircuitBreaker,
  dependencyCircuitKey,
} from './dependency-circuit-breaker.js';

export interface DependencyCircuitRegistryOptions {
  repository: DependencyCircuitStateRepository;
  overrideRepository?: DependencyCircuitOverrideRepository;
  now?: () => number;
  jitter?: () => number;
}

export class DependencyCircuitRegistryService {
  private readonly repository: DependencyCircuitStateRepository;
  private readonly overrideRepository?: DependencyCircuitOverrideRepository;
  private readonly now?: () => number;
  private readonly jitter?: () => number;
  private readonly breakers = new Map<string, DependencyCircuitBreaker>();
  private readonly persisted = new Map<string, DependencyCircuitPersistedState>();
  private readonly overrides = new Map<string, DependencyCircuitOverride>();
  private readonly queues = new Map<string, Promise<void>>();
  private initialization?: Promise<void>;

  constructor(options: DependencyCircuitRegistryOptions) {
    this.repository = options.repository;
    this.overrideRepository = options.overrideRepository;
    this.now = options.now;
    this.jitter = options.jitter;
  }

  async acquire(
    dependency: DependencyIdentity,
    policy: DependencyCircuitPolicy = DEFAULT_DEPENDENCY_CIRCUIT_POLICY
  ): Promise<DependencyCircuitAdmission> {
    const key = dependencyCircuitKey(dependency);
    return this.withKey(key, async () => {
      const breaker = this.getOrCreate(dependency, policy);
      const before = breaker.getSnapshot();
      const missingDurableState = !this.persisted.has(key);
      const override = await this.activeOverride(key);
      if (override?.mode === 'block') {
        return {
          allowed: false,
          decision: 'reject',
          reason: 'operator-block',
          retryAt: override.expiresAt,
          snapshot: before,
        };
      }
      const admission = breaker.acquire(override?.mode === 'allow' ? override.id : undefined);
      if (
        missingDurableState ||
        before.state !== admission.snapshot.state ||
        before.nextProbeAt !== admission.snapshot.nextProbeAt
      ) {
        await this.persist(breaker);
      }
      return admission;
    });
  }

  async record(
    lease: DependencyCircuitLease,
    outcome: DependencyOutcome,
    durationMs: number
  ): Promise<DependencyCircuitSnapshot> {
    return this.withKey(lease.circuitKey, async () => {
      const breaker = this.getByKey(lease.circuitKey);
      if (!breaker) {
        throw new Error('Dependency circuit is not registered for this lease.');
      }
      breaker.record(lease, outcome, durationMs);
      await this.persist(breaker);
      return breaker.getSnapshot();
    });
  }

  async reset(key: string): Promise<boolean> {
    return this.withKey(key, async () => {
      const breaker = this.getByKey(key);
      if (!breaker) return false;
      breaker.reset();
      await this.persist(breaker);
      return true;
    });
  }

  async getSnapshot(key: string): Promise<DependencyCircuitSnapshot | null> {
    await this.initialize();
    return this.getByKey(key)?.getSnapshot() ?? null;
  }

  async listSnapshots(): Promise<DependencyCircuitSnapshot[]> {
    await this.initialize();
    const keys = new Set([...this.persisted.keys(), ...this.breakers.keys()]);
    return [...keys]
      .map((key) => this.getByKey(key)?.getSnapshot())
      .filter((snapshot): snapshot is DependencyCircuitSnapshot => Boolean(snapshot))
      .sort((left, right) => left.key.localeCompare(right.key));
  }

  async setOverride(input: DependencyCircuitOverride): Promise<DependencyCircuitOverride> {
    const override = DependencyCircuitOverrideSchema.parse(input);
    return this.withKey(override.circuitKey, async () => {
      if (!this.getByKey(override.circuitKey)) {
        throw new Error('Dependency circuit is not registered for this override.');
      }
      await this.overrideRepository?.save(override);
      this.overrides.set(override.circuitKey, override);
      return structuredClone(override);
    });
  }

  async clearOverride(circuitKey: string): Promise<boolean> {
    return this.withKey(circuitKey, async () => {
      const existed = this.overrides.delete(circuitKey);
      const deleted = (await this.overrideRepository?.delete(circuitKey)) ?? false;
      return existed || deleted;
    });
  }

  async listOverrides(): Promise<DependencyCircuitOverride[]> {
    await this.initialize();
    const active: DependencyCircuitOverride[] = [];
    for (const key of [...this.overrides.keys()].sort()) {
      const override = await this.activeOverride(key);
      if (override) active.push(structuredClone(override));
    }
    return active;
  }

  private async initialize(): Promise<void> {
    this.initialization ??= (async () => {
      for (const state of await this.repository.list()) {
        this.persisted.set(state.snapshot.key, state);
      }
      for (const override of (await this.overrideRepository?.list()) ?? []) {
        this.overrides.set(override.circuitKey, override);
      }
    })();
    await this.initialization;
  }

  private getOrCreate(
    dependency: DependencyIdentity,
    policy: DependencyCircuitPolicy
  ): DependencyCircuitBreaker {
    const key = dependencyCircuitKey(dependency);
    const existing = this.breakers.get(key);
    if (existing && JSON.stringify(existing.policy) === JSON.stringify(policy)) return existing;
    if (existing) {
      this.breakers.delete(key);
      this.persisted.delete(key);
    }
    const state = this.persisted.get(key);
    const matchingState =
      state && JSON.stringify(state.snapshot.policy) === JSON.stringify(policy)
        ? state
        : undefined;
    const breaker = new DependencyCircuitBreaker({
      dependency,
      policy,
      state: matchingState,
      now: this.now,
      jitter: this.jitter,
    });
    this.breakers.set(key, breaker);
    if (!matchingState) this.persisted.delete(key);
    return breaker;
  }

  private getByKey(key: string): DependencyCircuitBreaker | undefined {
    const existing = this.breakers.get(key);
    if (existing) return existing;
    const state = this.persisted.get(key);
    if (!state) return undefined;
    const breaker = new DependencyCircuitBreaker({
      dependency: state.snapshot.dependency,
      policy: state.snapshot.policy,
      state,
      now: this.now,
      jitter: this.jitter,
    });
    this.breakers.set(key, breaker);
    return breaker;
  }

  private async persist(breaker: DependencyCircuitBreaker): Promise<void> {
    const state = breaker.exportState();
    await this.repository.save(state);
    this.persisted.set(breaker.key, state);
  }

  private async activeOverride(
    circuitKey: string
  ): Promise<DependencyCircuitOverride | undefined> {
    const override = this.overrides.get(circuitKey);
    if (!override) return undefined;
    const now = this.now?.() ?? Date.now();
    if (Date.parse(override.expiresAt) > now) return override;
    this.overrides.delete(circuitKey);
    await this.overrideRepository?.delete(circuitKey);
    return undefined;
  }

  private async withKey<T>(key: string, operation: () => Promise<T>): Promise<T> {
    await this.initialize();
    const previous = this.queues.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.queues.set(key, current);
    await previous;
    try {
      return await operation();
    } finally {
      if (this.queues.get(key) === current) this.queues.delete(key);
      release();
    }
  }
}
