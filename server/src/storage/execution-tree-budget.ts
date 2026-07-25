import type {
  AdmissionReservation,
  AgentBudgetLimits,
  AgentBudgetMetric,
  AgentBudgetUsage,
  ExecutionTreeBudgetPolicy,
  ExecutionTreeBudgetState,
  ExecutionTreeBudgetSummary,
  ExecutionTreeBudgetUsageEvent,
} from '@veritas-kanban/shared';
import {
  EXECUTION_TREE_BUDGET_SUMMARY_SCHEMA_VERSION,
  ZERO_AGENT_BUDGET_USAGE,
} from '@veritas-kanban/shared';

const BUDGET_METRICS: readonly AgentBudgetMetric[] = [
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

export interface ExecutionTreeBudgetLimits {
  terminal: ExecutionTreeBudgetPolicy[];
  retryable: ExecutionTreeBudgetPolicy[];
}

export function addBudgetUsage(left: AgentBudgetUsage, right: AgentBudgetUsage): AgentBudgetUsage {
  return Object.fromEntries(
    BUDGET_METRICS.map((metric) => [metric, left[metric] + right[metric]])
  ) as unknown as AgentBudgetUsage;
}

function subtractBudgetUsage(left: AgentBudgetUsage, right: AgentBudgetUsage): AgentBudgetUsage {
  return Object.fromEntries(
    BUDGET_METRICS.map((metric) => [metric, Math.max(0, left[metric] - right[metric])])
  ) as unknown as AgentBudgetUsage;
}

function snapshotDelta(committed: AgentBudgetUsage, snapshot: AgentBudgetUsage): AgentBudgetUsage {
  return Object.fromEntries(
    BUDGET_METRICS.map((metric) => [metric, Math.max(0, snapshot[metric] - committed[metric])])
  ) as unknown as AgentBudgetUsage;
}

export function initializeExecutionTreeBudget(
  requested: AgentBudgetUsage
): ExecutionTreeBudgetState {
  return {
    requested: { ...requested },
    remaining: { ...requested },
    committed: { ...ZERO_AGENT_BUDGET_USAGE },
    releasedUnused: { ...ZERO_AGENT_BUDGET_USAGE },
    events: [],
  };
}

export function applyExecutionTreeBudgetEvent(
  state: ExecutionTreeBudgetState,
  event: ExecutionTreeBudgetUsageEvent
): ExecutionTreeBudgetState {
  const existing = state.events.find((candidate) => candidate.id === event.id);
  if (existing) {
    if (JSON.stringify(existing) !== JSON.stringify(event)) {
      throw new Error(`Execution budget event ${event.id} has conflicting evidence.`);
    }
    return state;
  }
  if (state.events.length >= 10_000) {
    throw new Error('Execution budget event history reached its bounded limit.');
  }
  const delta =
    event.mode === 'snapshot' ? snapshotDelta(state.committed, event.usage) : event.usage;
  return {
    ...state,
    committed: addBudgetUsage(state.committed, delta),
    remaining: subtractBudgetUsage(state.remaining, delta),
    events: [...state.events, event],
  };
}

export function releaseExecutionTreeBudget(
  state: ExecutionTreeBudgetState | undefined
): ExecutionTreeBudgetState | undefined {
  if (!state) return undefined;
  return {
    ...state,
    releasedUnused: addBudgetUsage(state.releasedUnused, state.remaining),
    remaining: { ...ZERO_AGENT_BUDGET_USAGE },
  };
}

function sameExecutionTree(record: AdmissionReservation, candidate: AdmissionReservation): boolean {
  return (
    record.request.executionTree?.rootObjectiveId ===
    candidate.request.executionTree?.rootObjectiveId
  );
}

function carriesPolicy(record: AdmissionReservation, policyId: string): boolean {
  return Boolean(record.request.budgetPolicies?.some((policy) => policy.id === policyId));
}

function usageForPolicy(
  records: AdmissionReservation[],
  policy: ExecutionTreeBudgetPolicy,
  field: 'committed' | 'remaining'
): AgentBudgetUsage {
  return records
    .filter((record) => carriesPolicy(record, policy.id))
    .filter((record) => field === 'committed' || record.state === 'active')
    .reduce(
      (total, record) =>
        addBudgetUsage(total, record.executionBudget?.[field] ?? ZERO_AGENT_BUDGET_USAGE),
      { ...ZERO_AGENT_BUDGET_USAGE }
    );
}

function policyBlocks(
  used: AgentBudgetUsage,
  requested: AgentBudgetUsage,
  limits: AgentBudgetLimits
): boolean {
  return BUDGET_METRICS.some((metric) => {
    const limit = limits[metric];
    if (limit === undefined) return false;
    return requested[metric] > 0 ? used[metric] + requested[metric] > limit : used[metric] >= limit;
  });
}

function strictestPolicy(
  candidate: ExecutionTreeBudgetPolicy,
  records: AdmissionReservation[]
): ExecutionTreeBudgetPolicy {
  const limits = { ...candidate.limits };
  for (const policy of records
    .flatMap((record) => record.request.budgetPolicies ?? [])
    .filter((policy) => policy.id === candidate.id)) {
    for (const metric of BUDGET_METRICS) {
      const persisted = policy.limits[metric];
      if (persisted === undefined) continue;
      const current = limits[metric];
      limits[metric] = current === undefined ? persisted : Math.min(current, persisted);
    }
  }
  return { ...candidate, limits };
}

export function findLimitingExecutionTreeBudgetPolicies(
  records: AdmissionReservation[],
  candidate: AdmissionReservation
): ExecutionTreeBudgetLimits {
  if (!candidate.request.executionTree || !candidate.executionBudget) {
    return { terminal: [], retryable: [] };
  }
  const treeRecords = records.filter((record) => sameExecutionTree(record, candidate));
  const terminal: ExecutionTreeBudgetPolicy[] = [];
  const retryable: ExecutionTreeBudgetPolicy[] = [];
  for (const candidatePolicy of candidate.request.budgetPolicies ?? []) {
    const policy = strictestPolicy(candidatePolicy, treeRecords);
    const committed = usageForPolicy(treeRecords, policy, 'committed');
    if (policyBlocks(committed, candidate.executionBudget.remaining, policy.limits)) {
      terminal.push(policy);
      continue;
    }
    const reserved = usageForPolicy(treeRecords, policy, 'remaining');
    if (
      policyBlocks(
        addBudgetUsage(committed, reserved),
        candidate.executionBudget.remaining,
        policy.limits
      )
    ) {
      retryable.push(policy);
    }
  }
  return { terminal, retryable };
}

function remainingLimits(limits: AgentBudgetLimits, used: AgentBudgetUsage): AgentBudgetLimits {
  return Object.fromEntries(
    BUDGET_METRICS.flatMap((metric) =>
      limits[metric] === undefined
        ? []
        : [[metric, Math.max(0, (limits[metric] as number) - used[metric])]]
    )
  );
}

function reachesAnyLimit(usage: AgentBudgetUsage, limits: AgentBudgetLimits): boolean {
  return BUDGET_METRICS.some(
    (metric) => limits[metric] !== undefined && usage[metric] >= (limits[metric] as number)
  );
}

function strictestPolicies(records: AdmissionReservation[]): ExecutionTreeBudgetPolicy[] {
  const policies = new Map<string, ExecutionTreeBudgetPolicy>();
  for (const policy of records.flatMap((record) => record.request.budgetPolicies ?? [])) {
    policies.set(policy.id, strictestPolicy(policies.get(policy.id) ?? policy, records));
  }
  return [...policies.values()];
}

export function summarizeExecutionTreeBudget(
  rootObjectiveId: string,
  records: AdmissionReservation[],
  limit = 100,
  generatedAt = new Date().toISOString()
): ExecutionTreeBudgetSummary {
  const treeRecords = records.filter(
    (record) => record.request.executionTree?.rootObjectiveId === rootObjectiveId
  );
  const committed = treeRecords.reduce(
    (total, record) =>
      addBudgetUsage(total, record.executionBudget?.committed ?? ZERO_AGENT_BUDGET_USAGE),
    { ...ZERO_AGENT_BUDGET_USAGE }
  );
  const reserved = treeRecords
    .filter((record) => record.state === 'active')
    .reduce(
      (total, record) =>
        addBudgetUsage(total, record.executionBudget?.remaining ?? ZERO_AGENT_BUDGET_USAGE),
      { ...ZERO_AGENT_BUDGET_USAGE }
    );
  const policies = strictestPolicies(treeRecords).map((policy) => {
    const used = usageForPolicy(treeRecords, policy, 'committed');
    const policyReserved = usageForPolicy(treeRecords, policy, 'remaining');
    const total = addBudgetUsage(used, policyReserved);
    return {
      policy,
      used,
      reserved: policyReserved,
      remaining: remainingLimits(policy.limits, total),
      blocksNextLaunch: reachesAnyLimit(total, policy.limits),
    };
  });
  const contributors = treeRecords
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
    .slice(0, limit)
    .flatMap((record) => {
      const identity = record.request.executionTree;
      if (!identity) return [];
      return [
        {
          identity,
          reservationId: record.id,
          taskId: record.request.taskId,
          attemptId: record.attemptId,
          provider: record.request.provider,
          state: record.state,
          committed: record.executionBudget?.committed ?? { ...ZERO_AGENT_BUDGET_USAGE },
          reserved:
            record.state === 'active'
              ? (record.executionBudget?.remaining ?? { ...ZERO_AGENT_BUDGET_USAGE })
              : { ...ZERO_AGENT_BUDGET_USAGE },
          updatedAt: record.updatedAt,
        },
      ];
    });
  return {
    schemaVersion: EXECUTION_TREE_BUDGET_SUMMARY_SCHEMA_VERSION,
    rootObjectiveId,
    committed,
    reserved,
    policies,
    contributors,
    contributorCount: treeRecords.length,
    truncated: treeRecords.length > contributors.length,
    generatedAt,
  };
}
