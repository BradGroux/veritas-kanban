import { API_BASE, apiFetch } from './helpers';

export interface AgentOperationsDigestFilters {
  hours?: number;
  from?: string;
  to?: string;
  project?: string;
  repo?: string;
  cwd?: string;
}

export interface AgentOperationsSourceLink {
  kind: 'approval' | 'run' | 'task' | 'telemetry';
  id: string;
  label: string;
  timestamp?: string;
  taskId?: string;
}

export interface AgentOperationsFailure extends AgentOperationsSourceLink {
  agent?: string;
  error?: string;
}

export interface AgentOperationsApproval extends AgentOperationsSourceLink {
  agent: string;
  action: string;
  details?: string;
}

export interface AgentOperationsQueueMonitorActivity extends AgentOperationsSourceLink {
  status: 'success' | 'failed' | 'skipped' | 'started' | 'blocked';
  action: 'none' | 'dry-run' | 'assign' | 'draft-plan' | 'start-workflow' | 'blocked' | 'escalate';
  skippedReasons: string[];
}

export interface AgentOperationsDigestGroup {
  key: string;
  project: string;
  repo: string;
  cwd?: string;
  totals: {
    active: number;
    blocked: number;
    stuck: number;
    completed: number;
    failed: number;
    runs: number;
    tokenCost: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    wallTimeMs: number;
    activeTimeMs: number;
  };
  sourceLinks: {
    activeTasks: AgentOperationsSourceLink[];
    blockedTasks: AgentOperationsSourceLink[];
    stuckTasks: AgentOperationsSourceLink[];
    completedTasks: AgentOperationsSourceLink[];
    failedRuns: AgentOperationsSourceLink[];
    tokenEvents: AgentOperationsSourceLink[];
  };
  topPlanCompletions: AgentOperationsSourceLink[];
  notableFailures: AgentOperationsFailure[];
  openApprovals: AgentOperationsApproval[];
  queueMonitors?: AgentOperationsQueueMonitorActivity[];
}

export interface AgentOperationsDigest {
  period: {
    start: string;
    end: string;
    windowHours: number;
  };
  generatedAt: string;
  hasActivity: boolean;
  groups: AgentOperationsDigestGroup[];
  totals: AgentOperationsDigestGroup['totals'] & {
    openApprovals: number;
    groups: number;
  };
  refresh: {
    manual: boolean;
    schedule: 'daily-ready';
    narrative: 'deterministic-only';
  };
}

export interface AgentOperationsMarkdown {
  isEmpty: boolean;
  markdown?: string;
  message?: string;
}

function digestQuery(filters: AgentOperationsDigestFilters, format?: 'markdown'): string {
  const params = new URLSearchParams();
  if (format) params.set('format', format);
  if (typeof filters.hours === 'number') params.set('hours', String(filters.hours));
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  if (filters.project) params.set('project', filters.project);
  if (filters.repo) params.set('repo', filters.repo);
  if (filters.cwd) params.set('cwd', filters.cwd);
  const query = params.toString();
  return `${API_BASE}/digest/operations${query ? `?${query}` : ''}`;
}

export const digestApi = {
  operations: (filters: AgentOperationsDigestFilters = {}): Promise<AgentOperationsDigest> =>
    apiFetch<AgentOperationsDigest>(digestQuery(filters)),

  operationsMarkdown: (
    filters: AgentOperationsDigestFilters = {}
  ): Promise<AgentOperationsMarkdown> =>
    apiFetch<AgentOperationsMarkdown>(digestQuery(filters, 'markdown')),
};
