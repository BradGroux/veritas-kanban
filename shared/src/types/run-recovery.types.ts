import type { AgentBudgetUsage } from './agent-budget.types.js';

export const RUN_RECOVERY_SCHEMA_VERSION = 'run-recovery/v1' as const;

export const RUN_FAILURE_CLASSES = [
  'transient-transport',
  'provider-unavailable',
  'rate-limit',
  'invalid-request',
  'task-failure',
  'verification-failure',
  'policy-block',
  'cancellation',
  'timeout',
  'partial-side-effect',
  'unknown',
] as const;

export type RunFailureClass = (typeof RUN_FAILURE_CLASSES)[number];

export const RUN_RECOVERY_ACTIONS = [
  'retry',
  'fallback',
  'approval',
  'terminal',
  'cancelled',
] as const;

export type RunRecoveryAction = (typeof RUN_RECOVERY_ACTIONS)[number];

export const RUN_RECOVERY_STATES = [
  'scheduled',
  'launching',
  'launched',
  'approval-required',
  'exhausted',
  'cancelled',
] as const;

export type RunRecoveryState = (typeof RUN_RECOVERY_STATES)[number];

export interface RunFailureClassification {
  classification: RunFailureClass;
  summary: string;
  retryable: boolean;
  approvalRequired: boolean;
  destructiveSideEffects: boolean;
}

export interface RunRecoveryHandoff {
  summary: string;
  nextActions: string[];
}

/**
 * Durable causal record for a retry or fallback decision.
 *
 * Task attempts and workflow steps both persist this shape so recovery can be
 * reconciled after restart without relying on an in-memory timer.
 */
export interface RunRecoveryRecord {
  schemaVersion: typeof RUN_RECOVERY_SCHEMA_VERSION;
  rootRunId: string;
  parentRunId: string;
  sequence: number;
  fallbackUsed: boolean;
  state: RunRecoveryState;
  action: RunRecoveryAction;
  failure: RunFailureClassification;
  reason: string;
  backoffMs: number;
  scheduledAt?: string;
  notBefore?: string;
  launchedAt?: string;
  launchedRunId?: string;
  cancelledAt?: string;
  cancelledBy?: string;
  selectedAgent: string;
  fallbackAgent?: string;
  routingDecision: string;
  sourceManifestDigest?: string;
  launchedManifestDigest?: string;
  requiredRuntimeCapabilities: string[];
  cumulativeBudget: AgentBudgetUsage;
  handoff?: RunRecoveryHandoff;
}
