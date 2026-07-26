import type { AgentBudgetLimits, AgentBudgetUsage } from './agent-budget.types.js';

export const DURABLE_GOAL_SCHEMA_VERSION = 'durable-goal/v1' as const;

export const DURABLE_GOAL_STATES = [
  'active',
  'paused',
  'blocked',
  'awaiting-approval',
  'usage-limited',
  'budget-limited',
  'complete',
  'cancelled',
  'failed',
] as const;

export type DurableGoalState = (typeof DURABLE_GOAL_STATES)[number];
export type DurableGoalTerminalState = Extract<
  DurableGoalState,
  'complete' | 'cancelled' | 'failed'
>;

export const DURABLE_GOAL_CONTINUATION_MODES = ['manual', 'automatic'] as const;
export type DurableGoalContinuationMode = (typeof DURABLE_GOAL_CONTINUATION_MODES)[number];

export type DurableGoalRoot =
  | {
      kind: 'task';
      taskId: string;
    }
  | {
      kind: 'workflow';
      workflowId: string;
      taskId?: string;
    };

export interface DurableGoalContinuationPolicy {
  mode: DurableGoalContinuationMode;
  maxTurns?: number;
  maxRollovers?: number;
  compactAfterTokens?: number;
  requireApprovalForRollover?: boolean;
}

export interface DurableGoalCompletionRequirement {
  id: string;
  description: string;
  required: boolean;
  verificationKind: 'test' | 'build' | 'artifact' | 'operator' | 'external' | 'other';
}

export interface DurableGoalCompletionEvidence {
  requirementId: string;
  evidenceId: string;
  summary: string;
  verifier: string;
  verifiedAt: string;
}

export interface DurableGoalBlocker {
  id: string;
  code: string;
  summary: string;
  attempts: number;
  nextSafeAction: string;
  requiredAuthority?: string;
  externalStateChange?: string;
  recordedAt: string;
}

export interface DurableGoalRunLink {
  taskId: string;
  attemptId?: string;
  workflowRunId?: string;
  conversationId?: string;
  parentAttemptId?: string;
  linkedAt: string;
}

export interface DurableGoalUsageEvent {
  id: string;
  taskId: string;
  attemptId?: string;
  usage: AgentBudgetUsage;
  recordedAt: string;
}

export const DURABLE_GOAL_CONTINUATION_STATES = ['planned', 'dispatched', 'failed'] as const;
export type DurableGoalContinuationState = (typeof DURABLE_GOAL_CONTINUATION_STATES)[number];

export interface DurableGoalContinuationAttempt {
  id: string;
  sourceTaskId: string;
  sourceAttemptId: string;
  state: DurableGoalContinuationState;
  admissionIdempotencyKey: string;
  message: string;
  resultAttemptId?: string;
  queueId?: string;
  errorCode?: string;
  errorSummary?: string;
  createdAt: string;
  updatedAt: string;
}

export interface DurableGoalTransition {
  revision: number;
  from: DurableGoalState;
  to: DurableGoalState;
  actorId: string;
  reason: string;
  recordedAt: string;
}

export interface DurableGoalRecord {
  schemaVersion: typeof DURABLE_GOAL_SCHEMA_VERSION;
  id: string;
  workspaceId: string;
  objective: string;
  constraints: string[];
  acceptanceCriteria: string[];
  root: DurableGoalRoot;
  state: DurableGoalState;
  revision: number;
  continuation: DurableGoalContinuationPolicy;
  budgets?: AgentBudgetLimits;
  usage: AgentBudgetUsage;
  usageEvents: DurableGoalUsageEvent[];
  currentRun?: DurableGoalRunLink;
  continuationChain: DurableGoalRunLink[];
  continuationAttempts: DurableGoalContinuationAttempt[];
  blockers: DurableGoalBlocker[];
  completionRequirements: DurableGoalCompletionRequirement[];
  completionEvidence: DurableGoalCompletionEvidence[];
  transitions: DurableGoalTransition[];
  terminalReason?: string;
  createdAt: string;
  updatedAt: string;
}

export interface DurableGoalListQuery {
  workspaceId: string;
  states?: DurableGoalState[];
  rootTaskId?: string;
  rootWorkflowId?: string;
  limit?: number;
}

export interface DurableGoalCompareAndSetInput {
  id: string;
  expectedRevision: number;
  next: DurableGoalRecord;
}

export interface DurableGoalCompareAndSetResult {
  record?: DurableGoalRecord;
  updated: boolean;
  reason?: 'not-found' | 'stale-revision' | 'invalid-revision';
}
