import type { WorkflowScheduleMode } from './workflow.js';

export type SchedulerDeliverableSchedule = 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'custom';
export type SchedulerItemKind = 'scheduled-deliverable' | 'workflow' | 'queue-monitor';
export type SchedulerItemProvider = 'local-server';
export type SchedulerHealth = 'healthy' | 'warning' | 'paused' | 'blocked';
export type SchedulerRunStatus = 'success' | 'failed' | 'skipped' | 'started';
export type SchedulerEventType =
  | 'due-run'
  | 'manual-run'
  | 'pause'
  | 'resume'
  | 'validate'
  | 'overlap';

export interface SchedulerTrigger {
  mode: SchedulerDeliverableSchedule | WorkflowScheduleMode;
  description: string;
  cronExpr?: string;
  timezone?: string;
  startAt?: string;
  endAt?: string;
  customDueRunnerSupported: boolean;
}

export interface SchedulerRetryState {
  attempts: number;
  maxAttempts: number;
  backoffMinutes: number;
  nextAttemptAt?: string;
}

export interface SchedulerItem {
  id: string;
  kind: SchedulerItemKind;
  provider: SchedulerItemProvider;
  sourceId: string;
  name: string;
  description: string;
  enabled: boolean;
  trigger: SchedulerTrigger;
  tags: string[];
  nextRunAt?: string;
  lastRunAt?: string;
  lastStatus?: SchedulerRunStatus;
  lastSummary?: string;
  lastError?: string;
  sourceRunId?: string;
  health: SchedulerHealth;
  healthSummary: string;
  retry: SchedulerRetryState;
  actions: {
    canRun: boolean;
    canPause: boolean;
    canResume: boolean;
    canValidate: boolean;
  };
}

export interface SchedulerEvent {
  id: string;
  itemId: string;
  sourceId: string;
  kind: SchedulerItemKind;
  type: SchedulerEventType;
  status: SchedulerRunStatus;
  summary: string;
  runAt: string;
  durationMs?: number;
  error?: string;
  sourceRunId?: string;
  nextRunAt?: string;
}

export interface SchedulerValidationIssue {
  severity: 'error' | 'warning' | 'info';
  path: string;
  message: string;
  remediation: string;
}

export interface SchedulerValidationResult {
  itemId: string;
  ok: boolean;
  issues: SchedulerValidationIssue[];
}

export interface SchedulerSummary {
  total: number;
  enabled: number;
  paused: number;
  due: number;
  failed: number;
  blocked: number;
}

export interface SchedulerListResponse {
  generatedAt: string;
  summary: SchedulerSummary;
  items: SchedulerItem[];
  recentEvents: SchedulerEvent[];
}

export interface SchedulerRunResult {
  item: SchedulerItem;
  event: SchedulerEvent;
}

export interface SchedulerDueRunResult {
  checked: number;
  executed: number;
  skipped: number;
  failed: number;
  overlapping: boolean;
  events: SchedulerEvent[];
}
