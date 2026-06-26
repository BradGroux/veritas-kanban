export type GovernanceTraceKind =
  | 'policy'
  | 'tool-policy'
  | 'sandbox-policy'
  | 'budget-policy'
  | 'agent-permission'
  | 'routing'
  | 'workflow-gate'
  | 'ceremony';

export type GovernanceTraceOutcome =
  | 'allowed'
  | 'warned'
  | 'blocked'
  | 'approval-required'
  | 'routed'
  | 'fallback'
  | 'skipped';

export type GovernanceTraceStepStatus = 'matched' | 'not-matched' | 'skipped' | 'info';

export interface GovernanceTraceSubject {
  actorId?: string;
  agentId?: string;
  role?: string;
  taskId?: string;
  workflowId?: string;
  runId?: string;
  stepId?: string;
  actionType?: string;
  tool?: string;
  project?: string;
}

export interface GovernanceTraceRule {
  id: string;
  label: string;
  type: string;
  status: GovernanceTraceStepStatus;
  outcome?: GovernanceTraceOutcome;
  message: string;
  details?: Record<string, unknown>;
}

export interface GovernanceTraceStep {
  id: string;
  label: string;
  status: GovernanceTraceStepStatus;
  message: string;
  details?: Record<string, unknown>;
}

export interface GovernanceTraceRecord {
  id: string;
  kind: GovernanceTraceKind;
  outcome: GovernanceTraceOutcome;
  title: string;
  summary: string;
  remediation?: string;
  subject: GovernanceTraceSubject;
  evaluatedRules: GovernanceTraceRule[];
  matchedRules: GovernanceTraceRule[];
  steps: GovernanceTraceStep[];
  raw?: Record<string, unknown>;
  redacted: true;
  createdAt: string;
}

export interface CreateGovernanceTraceInput {
  kind: GovernanceTraceKind;
  outcome: GovernanceTraceOutcome;
  title: string;
  summary: string;
  remediation?: string;
  subject?: GovernanceTraceSubject;
  evaluatedRules?: GovernanceTraceRule[];
  matchedRules?: GovernanceTraceRule[];
  steps?: GovernanceTraceStep[];
  raw?: Record<string, unknown>;
  createdAt?: string;
}

export interface GovernanceTraceListFilters {
  kind?: GovernanceTraceKind;
  outcome?: GovernanceTraceOutcome;
  agent?: string;
  taskId?: string;
  actionType?: string;
  startTime?: string;
  endTime?: string;
  limit?: number;
}
