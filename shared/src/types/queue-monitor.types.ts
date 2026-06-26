import type { AgentBudgetPolicy } from './agent-budget.types.js';
import type { SandboxPolicyDryRunResult } from './sandbox-policy.types.js';
import type { WatcherContinuationEvaluationResult } from './watcher-policy.types.js';

export type QueueMonitorMode = 'dry-run' | 'assign-only' | 'draft-plan' | 'execute';
export type QueueMonitorRunnerMode = 'local' | 'github-actions';
export type QueueMonitorSourceKind = 'github';
export type QueueMonitorCandidateKind = 'issue' | 'pull-request';
export type QueueMonitorHealth = 'healthy' | 'warning' | 'paused' | 'blocked';
export type QueueMonitorRunTrigger = 'manual-run' | 'due-run' | 'explain';
export type QueueMonitorEventType =
  | QueueMonitorRunTrigger
  | 'scan'
  | 'pause'
  | 'resume'
  | 'circuit-open';
export type QueueMonitorRunStatus = 'success' | 'failed' | 'skipped' | 'started' | 'blocked';
export type QueueMonitorAction =
  | 'none'
  | 'dry-run'
  | 'assign'
  | 'draft-plan'
  | 'start-workflow'
  | 'blocked'
  | 'escalate';

export interface QueueMonitorGitHubSource {
  kind: 'github';
  repo: string;
  state: 'open' | 'closed' | 'all';
  labels: string[];
  includeIssues: boolean;
  includePullRequests: boolean;
}

export interface QueueMonitorStopConditions {
  maxCandidates?: number;
  maxFailureStreak?: number;
  skipBlockedLabels?: string[];
  skipDraftPullRequests?: boolean;
  skipFailedChecks?: boolean;
}

export interface QueueMonitorDefinition {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  source: QueueMonitorGitHubSource;
  mode: QueueMonitorMode;
  runner: QueueMonitorRunnerMode;
  intervalMinutes: number;
  maxCandidates: number;
  workflowId?: string;
  assignee?: string;
  sandboxPresetId?: string;
  budget?: AgentBudgetPolicy;
  stopConditions: QueueMonitorStopConditions;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface QueueMonitorActionItem {
  id: string;
  title: string;
  severity: 'warning' | 'blocker';
  summary: string;
  remediation: string;
  createdAt: string;
}

export interface QueueMonitorState {
  lastScanAt?: string;
  lastActionAt?: string;
  nextRunAt?: string;
  failureStreak: number;
  lastStatus?: QueueMonitorRunStatus;
  lastSummary?: string;
  lastError?: string;
  lastPacket?: QueueMonitorCandidatePacket;
  lastAction?: QueueMonitorActionRecord;
  actionItem?: QueueMonitorActionItem;
}

export interface QueueMonitorGateCheck {
  name: string;
  status: 'pass' | 'warn' | 'block';
  summary: string;
  evidence?: string[];
}

export interface QueueMonitorCandidate {
  id: string;
  kind: QueueMonitorCandidateKind;
  repo: string;
  number: number;
  title: string;
  url: string;
  state: string;
  labels: string[];
  assignees: string[];
  author?: string;
  createdAt: string;
  updatedAt: string;
  comments?: number;
  isDraft?: boolean;
  reviewDecision?: string;
  ciState?: 'passing' | 'failing' | 'pending' | 'unknown';
  blockers: string[];
  score: number;
  reasons: string[];
}

export interface QueueMonitorSkippedCandidate {
  candidateId: string;
  title: string;
  reasons: string[];
}

export interface QueueMonitorCandidatePacket {
  id: string;
  monitorId: string;
  generatedAt: string;
  repo: string;
  filters: {
    labels: string[];
    state: string;
    includeIssues: boolean;
    includePullRequests: boolean;
    limit: number;
  };
  candidates: QueueMonitorCandidate[];
  selected?: QueueMonitorCandidate;
  skipped: QueueMonitorSkippedCandidate[];
  truncated: boolean;
  checks: QueueMonitorGateCheck[];
}

export interface QueueMonitorActionRecord {
  action: QueueMonitorAction;
  status: QueueMonitorRunStatus;
  summary: string;
  error?: string;
  selectedCandidateId?: string;
  sourceRunId?: string;
  skippedReasons: string[];
  policy?: WatcherContinuationEvaluationResult;
  sandbox?: Pick<
    SandboxPolicyDryRunResult,
    'decision' | 'provider' | 'warnings' | 'remediation'
  > & {
    presetId: string;
  };
  budgetDecision?: string;
  gateChecks: QueueMonitorGateCheck[];
  recordedAt: string;
}

export interface QueueMonitorSnapshot extends QueueMonitorDefinition {
  health: QueueMonitorHealth;
  healthSummary: string;
  lastScanAt?: string;
  lastActionAt?: string;
  nextRunAt?: string;
  failureStreak: number;
  lastStatus?: QueueMonitorRunStatus;
  lastSummary?: string;
  lastError?: string;
  lastPacket?: QueueMonitorCandidatePacket;
  lastAction?: QueueMonitorActionRecord;
  actionItem?: QueueMonitorActionItem;
  actions: {
    canRun: boolean;
    canPause: boolean;
    canResume: boolean;
    canExplain: boolean;
  };
}

export interface QueueMonitorEvent {
  id: string;
  monitorId: string;
  type: QueueMonitorEventType;
  status: QueueMonitorRunStatus;
  action: QueueMonitorAction;
  summary: string;
  createdAt: string;
  durationMs?: number;
  error?: string;
  selectedCandidateId?: string;
  sourceRunId?: string;
  skippedReasons: string[];
}

export interface QueueMonitorSummary {
  total: number;
  enabled: number;
  paused: number;
  blocked: number;
  failed: number;
  due: number;
}

export interface QueueMonitorListResponse {
  generatedAt: string;
  summary: QueueMonitorSummary;
  monitors: QueueMonitorSnapshot[];
  recentEvents: QueueMonitorEvent[];
}

export interface QueueMonitorRunResult {
  monitor: QueueMonitorSnapshot;
  packet: QueueMonitorCandidatePacket;
  action: QueueMonitorActionRecord;
  event: QueueMonitorEvent;
}

export interface QueueMonitorExplainResult {
  monitor: QueueMonitorSnapshot;
  packet: QueueMonitorCandidatePacket;
  action: QueueMonitorActionRecord;
}

export interface QueueMonitorHealthResult {
  monitor: QueueMonitorSnapshot;
  actionItem?: QueueMonitorActionItem;
}

export interface QueueMonitorUpdateInput {
  enabled?: boolean;
  mode?: QueueMonitorMode;
  runner?: QueueMonitorRunnerMode;
  intervalMinutes?: number;
  maxCandidates?: number;
  workflowId?: string | null;
  assignee?: string | null;
  sandboxPresetId?: string | null;
  budget?: AgentBudgetPolicy | null;
  repo?: string;
  state?: QueueMonitorGitHubSource['state'];
  labels?: string[];
  includeIssues?: boolean;
  includePullRequests?: boolean;
  stopConditions?: Partial<QueueMonitorStopConditions>;
}
