import {
  DEPENDENCY_RETRY_BUDGET_KINDS,
  type DependencyRetryBudgetDecision,
  type DependencyRetryBudgetKind,
  type DependencyRetryBudgetPolicy,
  type DependencyRetryBudgetUsage,
} from '@veritas-kanban/shared';
import {
  DependencyRetryBudgetPolicySchema,
  DependencyRetryBudgetUsageSchema,
} from '../schemas/dependency-circuit-schemas.js';

export class DependencyRetryBudgetService {
  private readonly policy: DependencyRetryBudgetPolicy;
  private readonly usage: DependencyRetryBudgetUsage;

  constructor(policy: DependencyRetryBudgetPolicy, usage?: DependencyRetryBudgetUsage) {
    this.policy = DependencyRetryBudgetPolicySchema.parse(policy);
    this.usage = DependencyRetryBudgetUsageSchema.parse(
      usage ?? {
        used: Object.fromEntries(DEPENDENCY_RETRY_BUDGET_KINDS.map((kind) => [kind, 0])),
      }
    );
  }

  consume(kind: DependencyRetryBudgetKind): DependencyRetryBudgetDecision {
    const decision = this.inspect(kind);
    if (decision.allowed) this.usage.used[kind] += 1;
    return decision;
  }

  inspect(kind: DependencyRetryBudgetKind): DependencyRetryBudgetDecision {
    const limit = this.policy.limits[kind];
    const used = this.usage.used[kind];
    return {
      kind,
      allowed: used < limit,
      limit,
      used,
      remaining: Math.max(0, limit - used),
    };
  }

  snapshot(): DependencyRetryBudgetUsage {
    return structuredClone(this.usage);
  }
}
