import { useQuery } from '@tanstack/react-query';

export type MetricsPeriod = '24h' | '7d';

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

export interface AllMetrics {
  tasks: TaskMetrics;
  runs: RunMetrics;
  tokens: TokenMetrics;
  duration: DurationMetrics;
}

const API_BASE = '/api';

async function fetchMetrics(period: MetricsPeriod, project?: string): Promise<AllMetrics> {
  const params = new URLSearchParams();
  params.set('period', period);
  if (project) {
    params.set('project', project);
  }
  
  const response = await fetch(`${API_BASE}/metrics/all?${params}`);
  if (!response.ok) {
    throw new Error('Failed to fetch metrics');
  }
  return response.json();
}

export function useMetrics(period: MetricsPeriod = '24h', project?: string) {
  return useQuery({
    queryKey: ['metrics', period, project],
    queryFn: () => fetchMetrics(period, project),
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
  taskTitle?: string;
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

async function fetchFailedRuns(period: MetricsPeriod, project?: string, limit = 50): Promise<FailedRunDetails[]> {
  const params = new URLSearchParams();
  params.set('period', period);
  if (project) {
    params.set('project', project);
  }
  params.set('limit', String(limit));
  
  const response = await fetch(`${API_BASE}/metrics/failed-runs?${params}`);
  if (!response.ok) {
    throw new Error('Failed to fetch failed runs');
  }
  return response.json();
}

async function fetchRunMetrics(period: MetricsPeriod, project?: string): Promise<DetailedRunMetrics> {
  const params = new URLSearchParams();
  params.set('period', period);
  if (project) {
    params.set('project', project);
  }
  
  const response = await fetch(`${API_BASE}/metrics/runs?${params}`);
  if (!response.ok) {
    throw new Error('Failed to fetch run metrics');
  }
  return response.json();
}

async function fetchTokenMetrics(period: MetricsPeriod, project?: string): Promise<DetailedTokenMetrics> {
  const params = new URLSearchParams();
  params.set('period', period);
  if (project) {
    params.set('project', project);
  }
  
  const response = await fetch(`${API_BASE}/metrics/tokens?${params}`);
  if (!response.ok) {
    throw new Error('Failed to fetch token metrics');
  }
  return response.json();
}

async function fetchDurationMetrics(period: MetricsPeriod, project?: string): Promise<DetailedDurationMetrics> {
  const params = new URLSearchParams();
  params.set('period', period);
  if (project) {
    params.set('project', project);
  }
  
  const response = await fetch(`${API_BASE}/metrics/duration?${params}`);
  if (!response.ok) {
    throw new Error('Failed to fetch duration metrics');
  }
  return response.json();
}

export function useFailedRuns(period: MetricsPeriod = '24h', project?: string, limit = 50) {
  return useQuery({
    queryKey: ['failed-runs', period, project, limit],
    queryFn: () => fetchFailedRuns(period, project, limit),
    staleTime: 30000,
  });
}

export function useRunMetrics(period: MetricsPeriod = '24h', project?: string) {
  return useQuery({
    queryKey: ['run-metrics', period, project],
    queryFn: () => fetchRunMetrics(period, project),
    staleTime: 30000,
  });
}

export function useTokenMetrics(period: MetricsPeriod = '24h', project?: string) {
  return useQuery({
    queryKey: ['token-metrics', period, project],
    queryFn: () => fetchTokenMetrics(period, project),
    staleTime: 30000,
  });
}

export function useDurationMetrics(period: MetricsPeriod = '24h', project?: string) {
  return useQuery({
    queryKey: ['duration-metrics', period, project],
    queryFn: () => fetchDurationMetrics(period, project),
    staleTime: 30000,
  });
}
