export const PROGRESS_WATCHDOG_POLICY_SCHEMA_VERSION = 'progress-watchdog-policy/v1' as const;
export const PROGRESS_WATCHDOG_FINDING_SCHEMA_VERSION = 'progress-watchdog-finding/v1' as const;
export const PROGRESS_WATCHDOG_ACTION_SCHEMA_VERSION = 'progress-watchdog-action/v1' as const;

export type ProgressWatchdogDetector =
  'identical-repetition' | 'multi-step-cycle' | 'failed-file-edit' | 'no-durable-progress';

export type ProgressWatchdogConfidence = 'low' | 'medium' | 'high';

export type ProgressWatchdogAction =
  'warn' | 'steer' | 'require-observation' | 'retry' | 'fallback' | 'pause' | 'cancel';

export type DurableProgressSignal =
  | 'workspace-delta'
  | 'artifact'
  | 'verification-passed'
  | 'task-transition'
  | 'goal-transition'
  | 'external-evidence'
  | 'operator-input';

export interface ExpectedRepetitionLease {
  leaseId: string;
  startsAt: string;
  expiresAt: string;
  maxEventsPerMinute: number;
  allowedKinds?: string[];
}

export interface ProgressWatchdogRecoveryPolicy {
  lowConfidenceAction: Extract<ProgressWatchdogAction, 'warn'>;
  mediumConfidenceAction: Extract<ProgressWatchdogAction, 'warn' | 'steer' | 'require-observation'>;
  highConfidenceAction: ProgressWatchdogAction;
  maxAutomatedActionsPerTurn: number;
  maxAutomatedActionsPerRun: number;
}

export interface ProgressWatchdogPolicy {
  schemaVersion: typeof PROGRESS_WATCHDOG_POLICY_SCHEMA_VERSION;
  version: number;
  enabled: boolean;
  windowEvents: number;
  identicalRepetitionThreshold: number;
  cycleMaxLength: number;
  cycleRepetitionThreshold: number;
  failedEditThreshold: number;
  noProgressEventThreshold: number;
  noProgressSeconds: number;
  noProgressTotalTokens: number;
  noProgressCostUsd: number;
  highConfidenceMultiplier: number;
  progressSignals: DurableProgressSignal[];
  expectedRepetitionAllowedKinds: string[];
  maxExpectedRepetitionLeaseSeconds: number;
  recovery: ProgressWatchdogRecoveryPolicy;
}

export interface ProgressWatchdogRecoveryUsage {
  turnId?: string;
  automatedActionsThisTurn: number;
  automatedActionsThisRun: number;
}

export interface ProgressWatchdogFinding {
  schemaVersion: typeof PROGRESS_WATCHDOG_FINDING_SCHEMA_VERSION;
  id: string;
  taskId: string;
  attemptId: string;
  turnId?: string;
  detector: ProgressWatchdogDetector;
  confidence: ProgressWatchdogConfidence;
  policyVersion: number;
  evidenceEventIds: string[];
  fingerprintHashes: string[];
  suppressedEventIds: string[];
  progressSignals: DurableProgressSignal[];
  action: ProgressWatchdogAction;
  recoveryBudgetRemaining: {
    turn: number;
    run: number;
  };
  createdAt: string;
}

export interface ProgressWatchdogEvaluation {
  findings: ProgressWatchdogFinding[];
  latestSequence: number;
  progressResetSequence?: number;
  suppressedEventIds: string[];
}

export type ProgressWatchdogActionStatus = 'executed' | 'operator-required' | 'failed';

export interface ProgressWatchdogActionOutcome {
  schemaVersion: typeof PROGRESS_WATCHDOG_ACTION_SCHEMA_VERSION;
  findingId: string;
  taskId: string;
  attemptId: string;
  turnId?: string;
  action: ProgressWatchdogAction;
  status: ProgressWatchdogActionStatus;
  diagnostic: string;
  recordedAt: string;
}
