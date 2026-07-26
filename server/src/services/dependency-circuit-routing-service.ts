import type {
  DependencyCircuitAdmission,
  DependencyCircuitLease,
  DependencyCircuitPolicy,
  DependencyCircuitSnapshot,
  DependencyIdentity,
  DependencyOutcomeSignals,
  DependencyRetryBudgetKind,
  DependencyRouteCandidate,
  DependencyRouteDecision,
  DependencyRoutePolicy,
} from '@veritas-kanban/shared';
import { DependencyRoutePolicySchema } from '../schemas/dependency-circuit-schemas.js';
import { classifyDependencyOutcome } from './dependency-circuit-breaker.js';
import { DependencyCircuitRegistryService } from './dependency-circuit-registry-service.js';

export class DependencyRouteUnavailableError extends Error {
  readonly retryClass: DependencyRetryBudgetKind = 'circuit-rejection';

  constructor(readonly decision: Extract<DependencyRouteDecision, { selected: false }>) {
    super(decision.reason);
    this.name = 'DependencyRouteUnavailableError';
  }
}

export class DependencyCircuitRoutingService {
  constructor(private readonly registry: DependencyCircuitRegistryService) {}

  async select(
    candidates: DependencyRouteCandidate[],
    inputPolicy: DependencyRoutePolicy
  ): Promise<DependencyRouteDecision> {
    const policy = DependencyRoutePolicySchema.parse(inputPolicy);
    const ordered = [...candidates].sort(
      (left, right) => left.priority - right.priority || left.id.localeCompare(right.id)
    );
    const eligible = policy.allowFallback ? ordered : ordered.slice(0, 1);
    const exclusions: Extract<
      DependencyRouteDecision,
      { selected: false }
    >['exclusions'] = [];
    for (const candidate of eligible) {
      const admission = await this.registry.acquire(candidate.dependency, candidate.policy);
      if (!admission.allowed) {
        exclusions.push({
          candidateId: candidate.id,
          dependencyKey: admission.snapshot.key,
          reason: admission.reason,
          retryAt: admission.retryAt,
          snapshot: admission.snapshot,
        });
        continue;
      }
      const fallback = candidate !== ordered[0];
      return {
        selected: true,
        candidate,
        admission,
        fallback,
        reason: fallback
          ? `Selected fallback ${candidate.label} after excluding ${exclusions.length} unavailable dependency route(s).`
          : admission.decision === 'probe'
            ? `Selected ${candidate.label} for a bounded half-open probe.`
            : `Selected primary dependency route ${candidate.label}.`,
        exclusions,
      };
    }
    return {
      selected: false,
      action: policy.noMatchAction,
      reason:
        eligible.length === 0
          ? 'No dependency routes were configured.'
          : `No policy-compliant dependency route is available; action=${policy.noMatchAction}.`,
      exclusions,
    };
  }

  async require(
    candidates: DependencyRouteCandidate[],
    policy: DependencyRoutePolicy
  ): Promise<Extract<DependencyRouteDecision, { selected: true }>> {
    const decision = await this.select(candidates, policy);
    if (!decision.selected) throw new DependencyRouteUnavailableError(decision);
    return decision;
  }
}

export interface DependencyCircuitExecutionOptions {
  signal?: AbortSignal;
  policy?: DependencyCircuitPolicy;
  signalsForError?: (error: unknown) => DependencyOutcomeSignals;
}

export class DependencyCircuitExecutionService {
  constructor(
    private readonly registry: DependencyCircuitRegistryService,
    private readonly now: () => number = Date.now
  ) {}

  async execute<T>(
    dependency: DependencyIdentity,
    operation: () => Promise<T>,
    options: DependencyCircuitExecutionOptions = {}
  ): Promise<T> {
    return this.executeAll([dependency], operation, options);
  }

  async executeAll<T>(
    dependencies: DependencyIdentity[],
    operation: () => Promise<T>,
    options: DependencyCircuitExecutionOptions = {}
  ): Promise<T> {
    if (dependencies.length === 0) return operation();
    const startedAt = this.now();
    const admissions: Array<Extract<DependencyCircuitAdmission, { allowed: true }>> = [];
    for (const dependency of dependencies) {
      const admission = await this.registry.acquire(dependency, options.policy);
      if (!admission.allowed) {
        await Promise.all(
          admissions.map(({ lease }) =>
            this.registry.record(lease, 'policy-block', this.elapsed(startedAt))
          )
        );
        throw dependencyRejection(admission);
      }
      admissions.push(admission);
    }
    try {
      const result = await operation();
      await Promise.all(
        admissions.map(({ lease }) =>
          this.registry.record(lease, 'success', this.elapsed(startedAt))
        )
      );
      return result;
    } catch (error) {
      const signals = options.signalsForError?.(error) ?? defaultSignals(error, options.signal);
      const outcome = classifyDependencyOutcome(signals);
      await Promise.all(
        admissions.map(({ lease }) =>
          this.registry.record(lease, outcome, this.elapsed(startedAt))
        )
      );
      throw error;
    }
  }

  async executeAdmission<T>(
    admission: Extract<DependencyCircuitAdmission, { allowed: true }>,
    operation: () => Promise<T>,
    options: DependencyCircuitExecutionOptions = {}
  ): Promise<T> {
    const startedAt = this.now();
    try {
      const result = await operation();
      await this.registry.record(admission.lease, 'success', this.elapsed(startedAt));
      return result;
    } catch (error) {
      const signals = options.signalsForError?.(error) ?? defaultSignals(error, options.signal);
      await this.registry.record(
        admission.lease,
        classifyDependencyOutcome(signals),
        this.elapsed(startedAt)
      );
      throw error;
    }
  }

  async settleCancellation(lease: DependencyCircuitLease, startedAt: number): Promise<void> {
    await this.registry.record(lease, 'caller-cancellation', this.elapsed(startedAt));
  }

  async snapshot(key: string): Promise<DependencyCircuitSnapshot | null> {
    return this.registry.getSnapshot(key);
  }

  async inspect(
    dependency: DependencyIdentity,
    policy?: DependencyCircuitPolicy
  ): Promise<DependencyCircuitSnapshot> {
    return this.registry.inspect(dependency, policy);
  }

  private elapsed(startedAt: number): number {
    return Math.max(0, this.now() - startedAt);
  }
}

function dependencyRejection(
  admission: Extract<DependencyCircuitAdmission, { allowed: false }>
): DependencyRouteUnavailableError {
  return new DependencyRouteUnavailableError({
    selected: false,
    action: 'reject',
    reason: `Dependency circuit rejected ${admission.snapshot.key}.`,
    exclusions: [
      {
        candidateId: admission.snapshot.key,
        dependencyKey: admission.snapshot.key,
        reason: admission.reason,
        retryAt: admission.retryAt,
        snapshot: admission.snapshot,
      },
    ],
  });
}

function defaultSignals(error: unknown, signal?: AbortSignal): DependencyOutcomeSignals {
  if (signal?.aborted) return { callerCancelled: true };
  if (!(error instanceof Error)) return {};
  const candidate = error as Error & {
    code?: string;
    status?: number;
    statusCode?: number;
  };
  return {
    callerCancelled: candidate.name === 'AbortError',
    validationFailed: candidate.name === 'ZodError',
    timedOut: candidate.name === 'TimeoutError' || candidate.code === 'ETIMEDOUT',
    statusCode: candidate.statusCode ?? candidate.status,
    errorCode: candidate.code,
  };
}
