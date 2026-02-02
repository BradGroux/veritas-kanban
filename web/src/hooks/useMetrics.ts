import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api/helpers';

export type MetricsPeriod =
  | 'today'
  | '24h'
  | '3d'
  | '7d'
  | '30d'
  | '3m'
  | '6m'
  | '12m'
  | 'wtd'
  | 'mtd'
  | 'ytd'
  | 'all'
  | 'custom';

export interface TaskMetrics {
  byStatus: Record<string, number>;
  byBlockedReason: Record<string, number>;
  total: number;
  completed: number;
  archived: number;
}

export interface RunMetrics {
  period: MetricsPeriod;
  runs: number;
  successes: number;
  failures: number;
  errors: number;
  errorRate: number;
  successRate: number;
}

export interface TokenMetrics {
  period: MetricsPeriod;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  runs: number;
  perSuccessfulRun: {
    avg: number;
    p50: number;
    p95: number;
  };
}

export interface DurationMetrics {
  period: MetricsPeriod;
  runs: number;
  avgMs: number;
  p50Ms: number;
  p95Ms: number;
}

export type TrendDirection = 'up' | 'down' | 'flat';

export interface TrendComparison {
  runsTrend: TrendDirection;
  runsChange: number;
  successRateTrend: TrendDirection;
  successRateChange: number;
  tokensTrend: TrendDirection;
  tokensChange: number;
  durationTrend: TrendDirection;
  durationChange: number;
}

export interface AllMetrics {
  tasks: TaskMetrics;
  runs: RunMetrics;
  tokens: TokenMetrics;
  duration: DurationMetrics;
  trends: TrendComparison;
}

const API_BASE = '/api';

async function fetchMetrics(
  period: MetricsPeriod,
  project?: string,
  from?: string,
  to?: string
): Promise<AllMetrics> {
  const params = new URLSearchParams();
  params.set('period', period);
  if (project) {
    params.set('project', project);
  }
  if (from) {
    params.set('from', from);
  }
  if (to) {
    params.set('to', to);
  }

  return apiFetch<AllMetrics>(`${API_BASE}/metrics/all?${params}`);
}

export function useMetrics(
  period: MetricsPeriod = '7d',
  project?: string,
  from?: string,
  to?: string
) {
  return useQuery({
    queryKey: ['metrics', period, project, from, to],
    queryFn: () => fetchMetrics(period, project, from, to),
    refetchInterval: 30000, // Refresh every 30 seconds
    staleTime: 10000, // Consider stale after 10 seconds
  });
}

// Utility functions for formatting
export function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(1)}M`;
  }
  if (tokens >= 1_000) {
    return `${(tokens / 1_000).toFixed(1)}K`;
  }
  return tokens.toString();
}

export function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) {
    return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}

export function formatPercent(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

// Types for detailed metrics
export interface AgentBreakdown {
  agent: string;
  runs: number;
  successes: number;
  failures: number;
  errors: number;
  successRate: number;
  avgDurationMs: number;
  totalTokens: number;
}

export interface TokenAgentBreakdown {
  agent: string;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  runs: number;
}

export interface DurationAgentBreakdown {
  agent: string;
  runs: number;
  avgMs: number;
  p50Ms: number;
  p95Ms: number;
}

export interface FailedRunDetails {
  timestamp: string;
  taskId?: string;
  project?: string;
  agent: string;
  success: boolean;
  errorMessage?: string;
  durationMs?: number;
}

// Detailed metrics with agent breakdowns
export interface DetailedRunMetrics extends RunMetrics {
  byAgent: AgentBreakdown[];
}

export interface DetailedTokenMetrics extends TokenMetrics {
  byAgent: TokenAgentBreakdown[];
}

export interface DetailedDurationMetrics extends DurationMetrics {
  byAgent: DurationAgentBreakdown[];
}

async function fetchFailedRuns(
  period: MetricsPeriod,
  project?: string,
  limit = 50,
  from?: string,
  to?: string
): Promise<FailedRunDetails[]> {
  const params = new URLSearchParams();
  params.set('period', period);
  if (project) {
    params.set('project', project);
  }
  params.set('limit', String(limit));
  if (from) params.set('from', from);
  if (to) params.set('to', to);

  return apiFetch<FailedRunDetails[]>(`${API_BASE}/metrics/failed-runs?${params}`);
}

async function fetchRunMetrics(
  period: MetricsPeriod,
  project?: string,
  from?: string,
  to?: string
): Promise<DetailedRunMetrics> {
  const params = new URLSearchParams();
  params.set('period', period);
  if (project) {
    params.set('project', project);
  }
  if (from) params.set('from', from);
  if (to) params.set('to', to);

  return apiFetch<DetailedRunMetrics>(`${API_BASE}/metrics/runs?${params}`);
}

async function fetchTokenMetrics(
  period: MetricsPeriod,
  project?: string,
  from?: string,
  to?: string
): Promise<DetailedTokenMetrics> {
  const params = new URLSearchParams();
  params.set('period', period);
  if (project) {
    params.set('project', project);
  }
  if (from) params.set('from', from);
  if (to) params.set('to', to);

  return apiFetch<DetailedTokenMetrics>(`${API_BASE}/metrics/tokens?${params}`);
}

async function fetchDurationMetrics(
  period: MetricsPeriod,
  project?: string,
  from?: string,
  to?: string
): Promise<DetailedDurationMetrics> {
  const params = new URLSearchParams();
  params.set('period', period);
  if (project) {
    params.set('project', project);
  }
  if (from) params.set('from', from);
  if (to) params.set('to', to);

  return apiFetch<DetailedDurationMetrics>(`${API_BASE}/metrics/duration?${params}`);
}

export function useFailedRuns(
  period: MetricsPeriod = '7d',
  project?: string,
  limit = 50,
  from?: string,
  to?: string
) {
  return useQuery({
    queryKey: ['failed-runs', period, project, limit, from, to],
    queryFn: () => fetchFailedRuns(period, project, limit, from, to),
    staleTime: 30000,
  });
}

export function useRunMetrics(
  period: MetricsPeriod = '7d',
  project?: string,
  from?: string,
  to?: string
) {
  return useQuery({
    queryKey: ['run-metrics', period, project, from, to],
    queryFn: () => fetchRunMetrics(period, project, from, to),
    staleTime: 30000,
  });
}

export function useTokenMetrics(
  period: MetricsPeriod = '7d',
  project?: string,
  from?: string,
  to?: string
) {
  return useQuery({
    queryKey: ['token-metrics', period, project, from, to],
    queryFn: () => fetchTokenMetrics(period, project, from, to),
    staleTime: 30000,
  });
}

export function useDurationMetrics(
  period: MetricsPeriod = '7d',
  project?: string,
  from?: string,
  to?: string
) {
  return useQuery({
    queryKey: ['duration-metrics', period, project, from, to],
    queryFn: () => fetchDurationMetrics(period, project, from, to),
    staleTime: 30000,
  });
}

// ── Task Cost ───────────────────────────────────────────────────────

export interface TaskCostEntry {
  taskId: string;
  taskTitle?: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCost: number;
  runs: number;
  avgCostPerRun: number;
}

export interface TaskCostMetrics {
  period: MetricsPeriod;
  tasks: TaskCostEntry[];
  totalCost: number;
  avgCostPerTask: number;
}

async function fetchTaskCost(
  period: MetricsPeriod,
  project?: string,
  from?: string,
  to?: string
): Promise<TaskCostMetrics> {
  const params = new URLSearchParams();
  params.set('period', period);
  if (project) params.set('project', project);
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  return apiFetch<TaskCostMetrics>(`${API_BASE}/metrics/task-cost?${params}`);
}

export function useTaskCost(
  period: MetricsPeriod = '7d',
  project?: string,
  from?: string,
  to?: string
) {
  return useQuery({
    queryKey: ['task-cost', period, project, from, to],
    queryFn: () => fetchTaskCost(period, project, from, to),
    staleTime: 30000,
  });
}

// ── Agent Utilization ───────────────────────────────────────────────

export interface DailyUtilization {
  date: string;
  activeMs: number;
  idleMs: number;
  errorMs: number;
  utilizationPercent: number;
}

export interface UtilizationMetrics {
  period: MetricsPeriod;
  totalActiveMs: number;
  totalIdleMs: number;
  totalErrorMs: number;
  utilizationPercent: number;
  daily: DailyUtilization[];
}

async function fetchUtilization(
  period: MetricsPeriod,
  from?: string,
  to?: string
): Promise<UtilizationMetrics> {
  const params = new URLSearchParams();
  params.set('period', period);
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  return apiFetch<UtilizationMetrics>(`${API_BASE}/metrics/utilization?${params}`);
}

export function useUtilization(
  period: MetricsPeriod = '7d',
  from?: string,
  to?: string
) {
  return useQuery({
    queryKey: ['utilization', period, from, to],
    queryFn: () => fetchUtilization(period, from, to),
    staleTime: 30000,
  });
}
