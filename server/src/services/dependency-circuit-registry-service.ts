import type {
  DependencyCircuitAdmission,
  DependencyCircuitLease,
  DependencyCircuitPolicy,
  DependencyCircuitPersistedState,
  DependencyCircuitSnapshot,
  DependencyIdentity,
  DependencyOutcome,
} from '@veritas-kanban/shared';
import type { DependencyCircuitStateRepository } from '../storage/dependency-circuit-state-repository.js';
import {
  DEFAULT_DEPENDENCY_CIRCUIT_POLICY,
  DependencyCircuitBreaker,
  dependencyCircuitKey,
} from './dependency-circuit-breaker.js';

export interface DependencyCircuitRegistryOptions {
  repository: DependencyCircuitStateRepository;
  now?: () => number;
  jitter?: () => number;
}

export class DependencyCircuitRegistryService {
  private readonly repository: DependencyCircuitStateRepository;
  private readonly now?: () => number;
  private readonly jitter?: () => number;
  private readonly breakers = new Map<string, DependencyCircuitBreaker>();
  private readonly persisted = new Map<string, DependencyCircuitPersistedState>();
  private readonly queues = new Map<string, Promise<void>>();
  private initialization?: Promise<void>;

  constructor(options: DependencyCircuitRegistryOptions) {
    this.repository = options.repository;
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
      const admission = breaker.acquire();
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

  private async initialize(): Promise<void> {
    this.initialization ??= (async () => {
      for (const state of await this.repository.list()) {
        this.persisted.set(state.snapshot.key, state);
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
