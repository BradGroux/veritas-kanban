import type { CreateGovernanceTraceInput } from './governance-trace.types.js';

export type AgentBudgetAction = 'warn' | 'pause' | 'require-approval' | 'downgrade' | 'cancel';

export type AgentBudgetDecision = 'allow' | AgentBudgetAction;

export type AgentBudgetScope = 'workspace' | 'agent' | 'workflow' | 'workflow-agent' | 'run';

export type AgentBudgetMetric =
  | 'inputTokens'
  | 'outputTokens'
  | 'totalTokens'
  | 'costUsd'
  | 'toolCalls'
  | 'runtimeSeconds'
  | 'idleRuntimeSeconds'
  | 'retries'
  | 'fanOut';

export interface AgentBudgetLimits {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  costUsd?: number;
  toolCalls?: number;
  runtimeSeconds?: number;
  idleRuntimeSeconds?: number;
  retries?: number;
  fanOut?: number;
}

export interface AgentBudgetPolicy {
  enabled?: boolean;
  name?: string;
  scope?: AgentBudgetScope;
  limits?: AgentBudgetLimits;
  softThresholdPercent?: number;
  hardAction?: Exclude<AgentBudgetAction, 'warn'>;
  downgradeModel?: string;
  notes?: string;
}

export interface AgentBudgetUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
  toolCalls: number;
  runtimeSeconds: number;
  idleRuntimeSeconds: number;
  retries: number;
  fanOut: number;
}

export interface AgentBudgetThresholdEvent {
  metric: AgentBudgetMetric;
  limit: number;
  used: number;
  percent: number;
  threshold: 'soft' | 'hard';
  action: AgentBudgetAction;
  message: string;
}

export interface AgentBudgetEvaluation {
  decision: AgentBudgetDecision;
  usage: AgentBudgetUsage;
  effectiveBudget?: AgentBudgetPolicy;
  thresholdEvents: AgentBudgetThresholdEvent[];
  modelOverride?: string;
  trace?: CreateGovernanceTraceInput;
}

export interface AgentBudgetState {
  enabled: boolean;
  policy?: AgentBudgetPolicy;
  usage: AgentBudgetUsage;
  decision: AgentBudgetDecision;
  thresholdEvents: AgentBudgetThresholdEvent[];
  traceIds: string[];
  overrideReason?: string;
  modelOverride?: string;
}

export interface AgentBudgetResolutionInput {
  workspaceBudget?: AgentBudgetPolicy;
  agentBudget?: AgentBudgetPolicy;
  workflowBudget?: AgentBudgetPolicy;
  workflowAgentBudget?: AgentBudgetPolicy;
  runBudget?: AgentBudgetPolicy;
}

export const ZERO_AGENT_BUDGET_USAGE: AgentBudgetUsage = {
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  costUsd: 0,
  toolCalls: 0,
  runtimeSeconds: 0,
  idleRuntimeSeconds: 0,
  retries: 0,
  fanOut: 0,
};
