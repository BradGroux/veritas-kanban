export type AgentHealthState = 'healthy' | 'blocked' | 'stuck' | 'risky' | 'complete_candidate';

export type AgentHealthReasonCode =
  | 'active_ok'
  | 'explicit_completion_hint'
  | 'hitl_pending'
  | 'idle_after_plan_completion'
  | 'no_signal'
  | 'provider_errors'
  | 'recent_test_failures'
  | 'repeated_tool_failures'
  | 'supervisor_unavailable'
  | 'task_blocked';

export interface AgentHealthEvidence {
  code: AgentHealthReasonCode | string;
  message: string;
  timestamp?: string;
  taskId?: string;
  taskTitle?: string;
  runId?: string;
  url?: string;
}

export interface AgentHealthClassification {
  subjectId: string;
  subjectType: 'agent' | 'run' | 'task';
  agent?: string;
  taskId?: string;
  taskTitle?: string;
  state: AgentHealthState;
  reasonCode: AgentHealthReasonCode;
  explanation: string;
  confidence: number;
  evidence: AgentHealthEvidence[];
  updatedAt: string;
}

export interface AgentHealthClassificationResponse {
  classifications: AgentHealthClassification[];
  generatedAt: string;
}
