import type {
  AgentBudgetAction,
  AgentBudgetDecision,
  AgentBudgetEvaluation,
  AgentBudgetLimits,
  AgentBudgetMetric,
  AgentBudgetPolicy,
  AgentBudgetResolutionInput,
  AgentBudgetState,
  AgentBudgetThresholdEvent,
  AgentBudgetUsage,
  CreateGovernanceTraceInput,
  GovernanceTraceOutcome,
} from '@veritas-kanban/shared';
import { ZERO_AGENT_BUDGET_USAGE } from '@veritas-kanban/shared';
import { AgentBudgetPolicySchema } from '../schemas/agent-budget-schemas.js';

const METRICS: AgentBudgetMetric[] = [
  'inputTokens',
  'outputTokens',
  'totalTokens',
  'costUsd',
  'toolCalls',
  'runtimeSeconds',
  'idleRuntimeSeconds',
  'retries',
  'fanOut',
];

const ACTION_RANK: Record<Exclude<AgentBudgetAction, 'warn'>, number> = {
  downgrade: 1,
  pause: 2,
  'require-approval': 3,
  cancel: 4,
};

export class AgentBudgetService {
  resolve(input: AgentBudgetResolutionInput): AgentBudgetPolicy | undefined {
    const policies = [
      input.workspaceBudget,
      input.agentBudget,
      input.workflowBudget,
      input.workflowAgentBudget,
      input.runBudget,
    ]
      .filter((policy): policy is AgentBudgetPolicy => Boolean(policy))
      .map((policy) => this.normalizePolicy(policy))
      .filter((policy) => policy.enabled !== false);

    if (policies.length === 0) return undefined;

    const limits: AgentBudgetLimits = {};
    for (const policy of policies) {
      for (const metric of METRICS) {
        const limit = policy.limits?.[metric];
        if (!isPositiveLimit(limit)) continue;
        const current = limits[metric];
        limits[metric] = current === undefined ? limit : Math.min(current, limit);
      }
    }

    const softThresholdPercent = Math.min(
      ...policies
        .map((policy) => policy.softThresholdPercent)
        .filter((value): value is number => typeof value === 'number' && value > 0)
    );
    const hardAction = policies.reduce<Exclude<AgentBudgetAction, 'warn'> | undefined>(
      (current, policy) => stricterAction(current, policy.hardAction),
      undefined
    );
    const downgradeModel = [...policies]
      .reverse()
      .find((policy) => policy.downgradeModel)?.downgradeModel;
    const name = [...policies].reverse().find((policy) => policy.name)?.name;

    if (Object.keys(limits).length === 0) {
      return undefined;
    }

    return {
      enabled: true,
      name: name ?? 'Effective agent run budget',
      scope: 'run',
      limits,
      softThresholdPercent: Number.isFinite(softThresholdPercent) ? softThresholdPercent : 80,
      hardAction: hardAction ?? 'require-approval',
      downgradeModel,
      notes: [...policies].reverse().find((policy) => policy.notes)?.notes,
    };
  }

  evaluate(
    policy: AgentBudgetPolicy | undefined,
    usage: Partial<AgentBudgetUsage>,
    subject: CreateGovernanceTraceInput['subject'] = {}
  ): AgentBudgetEvaluation {
    const normalizedUsage = normalizeUsage(usage);
    if (!policy || policy.enabled === false || !policy.limits) {
      return {
        decision: 'allow',
        usage: normalizedUsage,
        thresholdEvents: [],
      };
    }

    const normalizedPolicy = this.normalizePolicy(policy);
    const thresholdEvents = this.evaluateThresholds(normalizedPolicy, normalizedUsage);
    const hardEvents = thresholdEvents.filter((event) => event.threshold === 'hard');
    const softEvents = thresholdEvents.filter((event) => event.threshold === 'soft');
    const hardAction = normalizedPolicy.hardAction ?? 'require-approval';
    const decision: AgentBudgetDecision =
      hardEvents.length > 0 ? hardAction : softEvents.length > 0 ? 'warn' : 'allow';
    const modelOverride =
      decision === 'downgrade' && normalizedPolicy.downgradeModel
        ? normalizedPolicy.downgradeModel
        : undefined;

    return {
      decision,
      usage: normalizedUsage,
      effectiveBudget: normalizedPolicy,
      thresholdEvents,
      modelOverride,
      trace:
        thresholdEvents.length > 0
          ? this.buildTrace(normalizedPolicy, normalizedUsage, thresholdEvents, decision, subject)
          : undefined,
    };
  }

  initialState(policy: AgentBudgetPolicy | undefined): AgentBudgetState {
    return {
      enabled: Boolean(
        policy?.enabled !== false && policy?.limits && Object.keys(policy.limits).length
      ),
      policy,
      usage: { ...ZERO_AGENT_BUDGET_USAGE },
      decision: 'allow',
      thresholdEvents: [],
      traceIds: [],
    };
  }

  mergeUsage(
    current: AgentBudgetUsage | undefined,
    delta: Partial<AgentBudgetUsage>
  ): AgentBudgetUsage {
    const base = current ?? ZERO_AGENT_BUDGET_USAGE;
    return {
      inputTokens: Math.max(0, base.inputTokens + (delta.inputTokens ?? 0)),
      outputTokens: Math.max(0, base.outputTokens + (delta.outputTokens ?? 0)),
      totalTokens: Math.max(0, base.totalTokens + (delta.totalTokens ?? 0)),
      costUsd: Math.max(0, base.costUsd + (delta.costUsd ?? 0)),
      toolCalls: Math.max(0, base.toolCalls + (delta.toolCalls ?? 0)),
      runtimeSeconds: Math.max(base.runtimeSeconds, delta.runtimeSeconds ?? 0),
      idleRuntimeSeconds: Math.max(base.idleRuntimeSeconds, delta.idleRuntimeSeconds ?? 0),
      retries: Math.max(base.retries, delta.retries ?? 0),
      fanOut: Math.max(base.fanOut, delta.fanOut ?? 0),
    };
  }

  private normalizePolicy(policy: AgentBudgetPolicy): AgentBudgetPolicy {
    return AgentBudgetPolicySchema.parse(policy) as AgentBudgetPolicy;
  }

  private evaluateThresholds(
    policy: AgentBudgetPolicy,
    usage: AgentBudgetUsage
  ): AgentBudgetThresholdEvent[] {
    const limits = policy.limits ?? {};
    const softPercent = policy.softThresholdPercent ?? 80;
    const hardAction = policy.hardAction ?? 'require-approval';
    const events: AgentBudgetThresholdEvent[] = [];

    for (const metric of METRICS) {
      const limit = limits[metric];
      if (!isPositiveLimit(limit)) continue;
      const used = usage[metric];
      const percent = limit === 0 ? 0 : (used / limit) * 100;
      if (used >= limit) {
        events.push({
          metric,
          limit,
          used,
          percent,
          threshold: 'hard',
          action: hardAction,
          message: `${metric} used ${formatMetricValue(metric, used)} of ${formatMetricValue(
            metric,
            limit
          )}.`,
        });
      } else if (percent >= softPercent) {
        events.push({
          metric,
          limit,
          used,
          percent,
          threshold: 'soft',
          action: 'warn',
          message: `${metric} is at ${Math.round(percent)}% of budget.`,
        });
      }
    }

    return events;
  }

  private buildTrace(
    policy: AgentBudgetPolicy,
    usage: AgentBudgetUsage,
    thresholdEvents: AgentBudgetThresholdEvent[],
    decision: AgentBudgetDecision,
    subject: CreateGovernanceTraceInput['subject']
  ): CreateGovernanceTraceInput {
    const outcome = outcomeForDecision(decision);
    const hardEvents = thresholdEvents.filter((event) => event.threshold === 'hard');
    const title = `Budget policy ${policy.name ?? 'run budget'}`;
    return {
      kind: 'budget-policy',
      outcome,
      title,
      summary:
        hardEvents.length > 0
          ? `Hard budget threshold reached for ${hardEvents.map((event) => event.metric).join(', ')}.`
          : `Soft budget threshold reached for ${thresholdEvents
              .map((event) => event.metric)
              .join(', ')}.`,
      remediation: remediationForDecision(decision),
      subject: {
        ...subject,
        actionType: subject?.actionType ?? 'budget.evaluate',
      },
      evaluatedRules: thresholdEvents.map((event) => ({
        id: `budget:${event.metric}:${event.threshold}`,
        label: `${event.metric} ${event.threshold} threshold`,
        type: 'budget-policy',
        status: event.threshold === 'hard' ? 'matched' : 'info',
        outcome: event.threshold === 'hard' ? outcomeForDecision(event.action) : 'warned',
        message: event.message,
        details: {
          metric: event.metric,
          limit: event.limit,
          used: event.used,
          percent: event.percent,
          action: event.action,
        },
      })),
      matchedRules: thresholdEvents.map((event) => ({
        id: `budget:${event.metric}:${event.threshold}`,
        label: `${event.metric} ${event.threshold} threshold`,
        type: 'budget-policy',
        status: event.threshold === 'hard' ? 'matched' : 'info',
        outcome: event.threshold === 'hard' ? outcomeForDecision(event.action) : 'warned',
        message: event.message,
      })),
      raw: {
        policy: {
          name: policy.name,
          scope: policy.scope,
          limits: policy.limits,
          softThresholdPercent: policy.softThresholdPercent,
          hardAction: policy.hardAction,
          downgradeModel: policy.downgradeModel,
        },
        usage,
        thresholdEvents,
        decision,
      },
    };
  }
}

export const agentBudgetService = new AgentBudgetService();

export function getAgentBudgetService(): AgentBudgetService {
  return agentBudgetService;
}

function normalizeUsage(usage: Partial<AgentBudgetUsage>): AgentBudgetUsage {
  return {
    ...ZERO_AGENT_BUDGET_USAGE,
    ...usage,
    totalTokens: usage.totalTokens ?? (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0),
  };
}

function isPositiveLimit(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function stricterAction(
  current: Exclude<AgentBudgetAction, 'warn'> | undefined,
  next: Exclude<AgentBudgetAction, 'warn'> | undefined
): Exclude<AgentBudgetAction, 'warn'> | undefined {
  if (!next) return current;
  if (!current) return next;
  return ACTION_RANK[next] > ACTION_RANK[current] ? next : current;
}

function outcomeForDecision(
  decision: AgentBudgetDecision | AgentBudgetAction
): GovernanceTraceOutcome {
  if (decision === 'allow') return 'allowed';
  if (decision === 'warn') return 'warned';
  if (decision === 'require-approval' || decision === 'pause') return 'approval-required';
  if (decision === 'downgrade') return 'routed';
  return 'blocked';
}

function remediationForDecision(decision: AgentBudgetDecision): string | undefined {
  if (decision === 'warn') return 'Review budget posture before allowing the run to continue.';
  if (decision === 'pause')
    return 'Pause the run and resume after operator review or a stricter budget override.';
  if (decision === 'require-approval')
    return 'Request operator approval or lower the run scope before continuing.';
  if (decision === 'downgrade')
    return 'Run with the configured lower-cost model route and keep the trace visible.';
  if (decision === 'cancel') return 'Cancel the run or restart with a stricter scope.';
  return undefined;
}

function formatMetricValue(metric: AgentBudgetMetric, value: number): string {
  if (metric === 'costUsd') return `$${value.toFixed(value < 1 ? 4 : 2)}`;
  if (metric.endsWith('Seconds')) return `${value}s`;
  return value.toLocaleString();
}
