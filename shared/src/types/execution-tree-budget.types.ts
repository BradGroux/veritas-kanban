import type {
  AgentBudgetAction,
  AgentBudgetLimits,
  AgentBudgetUsage,
} from './agent-budget.types.js';

export const EXECUTION_TREE_IDENTITY_SCHEMA_VERSION = 'execution-tree-identity/v1' as const;
export const EXECUTION_TREE_BUDGET_EVENT_SCHEMA_VERSION = 'execution-tree-budget-event/v1' as const;
export const EXECUTION_TREE_BUDGET_SUMMARY_SCHEMA_VERSION =
  'execution-tree-budget-summary/v1' as const;
export const EXECUTION_TREE_CONTROL_SCHEMA_VERSION = 'execution-tree-control/v1' as const;

export const EXECUTION_TREE_EDGE_KINDS = [
  'root',
  'resume',
  'follow-up',
  'fork',
  'retry',
  'fallback',
  'provider-handoff',
  'workflow-step',
  'child-agent',
] as const;
export type ExecutionTreeEdgeKind = (typeof EXECUTION_TREE_EDGE_KINDS)[number];

export interface ExecutionTreeIdentity {
  schemaVersion: typeof EXECUTION_TREE_IDENTITY_SCHEMA_VERSION;
  rootObjectiveId: string;
  nodeId: string;
  parentNodeId?: string;
  edge: ExecutionTreeEdgeKind;
  depth: number;
}

export type ExecutionTreeBudgetPolicyScope =
  'workspace' | 'agent' | 'workflow' | 'run' | 'root-objective';

export interface ExecutionTreeBudgetPolicy {
  id: string;
  scope: ExecutionTreeBudgetPolicyScope;
  scopeId: string;
  name: string;
  limits: AgentBudgetLimits;
  hardAction: Exclude<AgentBudgetAction, 'warn'>;
}

export interface ExecutionTreeBudgetUsageEvent {
  schemaVersion: typeof EXECUTION_TREE_BUDGET_EVENT_SCHEMA_VERSION;
  id: string;
  mode: 'delta' | 'snapshot';
  usage: AgentBudgetUsage;
  source: string;
  occurredAt: string;
}

export interface ExecutionTreeBudgetState {
  requested: AgentBudgetUsage;
  remaining: AgentBudgetUsage;
  committed: AgentBudgetUsage;
  releasedUnused: AgentBudgetUsage;
  events: ExecutionTreeBudgetUsageEvent[];
}

export interface ExecutionTreeBudgetPolicyStatus {
  policy: ExecutionTreeBudgetPolicy;
  used: AgentBudgetUsage;
  reserved: AgentBudgetUsage;
  remaining: AgentBudgetLimits;
  blocksNextLaunch: boolean;
}

export interface ExecutionTreeBudgetContributor {
  identity: ExecutionTreeIdentity;
  reservationId: string;
  taskId: string;
  attemptId?: string;
  provider: string;
  state: 'active' | 'released' | 'expired';
  committed: AgentBudgetUsage;
  reserved: AgentBudgetUsage;
  updatedAt: string;
}

export interface ExecutionTreeControl {
  schemaVersion: typeof EXECUTION_TREE_CONTROL_SCHEMA_VERSION;
  rootObjectiveId: string;
  state: 'paused' | 'cancelled';
  trigger: 'operator' | 'fan-out-breaker';
  reason: string;
  idempotencyKey: string;
  recordedAt: string;
}

export interface ExecutionTreeBudgetSummary {
  schemaVersion: typeof EXECUTION_TREE_BUDGET_SUMMARY_SCHEMA_VERSION;
  rootObjectiveId: string;
  control?: ExecutionTreeControl;
  committed: AgentBudgetUsage;
  reserved: AgentBudgetUsage;
  policies: ExecutionTreeBudgetPolicyStatus[];
  contributors: ExecutionTreeBudgetContributor[];
  contributorCount: number;
  truncated: boolean;
  generatedAt: string;
}
