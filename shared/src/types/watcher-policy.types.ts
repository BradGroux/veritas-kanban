export type WatcherContinuationMode = 'ask_always' | 'ask_on_risk' | 'auto';

export type WatcherRiskClass =
  | 'destructive_command'
  | 'credential_reference'
  | 'recent_test_failure'
  | 'provider_error'
  | 'policy_violation';

export type WatcherContinuationDecision = 'allow' | 'require_approval' | 'block';

export type WatcherRiskLevel = 'low' | 'medium' | 'high' | 'critical';

export interface WatcherContinuationPolicy {
  id: string;
  enabled: boolean;
  project?: string;
  agent?: string;
  mode?: WatcherContinuationMode;
  maxContinuations?: number;
  spendCapUsd?: number;
  riskClasses?: WatcherRiskClass[];
  dispatchDenyPatterns?: string[];
}

export interface WatcherContinuationSettings {
  enabled: boolean;
  globalKillSwitch: boolean;
  defaultMode: WatcherContinuationMode;
  maxContinuationsPerRun: number;
  spendCapUsd: number;
  riskClasses: WatcherRiskClass[];
  dispatchDenyPatterns: string[];
  policies: WatcherContinuationPolicy[];
}

export interface WatcherContinuationEvaluationRequest {
  runId?: string;
  taskId?: string;
  project?: string;
  agent?: string;
  prompt?: string;
  command?: string;
  toolName?: string;
  continuationCount?: number;
  monthlySpendUsd?: number;
  hasRecentTestFailures?: boolean;
  recentProviderErrors?: number;
  policyViolations?: string[];
  riskHints?: WatcherRiskClass[];
  metadata?: Record<string, unknown>;
}

export interface WatcherContinuationEvidence {
  riskClass?: WatcherRiskClass;
  code: string;
  message: string;
}

export interface WatcherContinuationEvaluationResult {
  decision: WatcherContinuationDecision;
  mode: WatcherContinuationMode;
  riskLevel: WatcherRiskLevel;
  riskClasses: WatcherRiskClass[];
  matchedPolicyId?: string;
  reasons: string[];
  evidence: WatcherContinuationEvidence[];
  caps: {
    maxContinuations: number;
    spendCapUsd: number;
  };
  auditLogged: boolean;
  evaluatedAt: string;
}
