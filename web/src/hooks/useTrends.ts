import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api/helpers';

import type { MetricsPeriod } from './useMetrics';

export type TrendsPeriod = MetricsPeriod;

export interface DailyTrendPoint {
  date: string; // YYYY-MM-DD
  runs: number;
  successes: number;
  failures: number;
  errors: number;
  successRate: number;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  avgDurationMs: number;
  tasksCreated: number;
  statusChanges: number;
  tasksArchived: number;
}

export interface TrendsData {
  period: TrendsPeriod;
  daily: DailyTrendPoint[];
}

const API_BASE = '/api';

async function fetchTrends(
  period: TrendsPeriod,
  project?: string,
  from?: string,
  to?: string
): Promise<TrendsData> {
  const params = new URLSearchParams();
  params.set('period', period);
  if (project) {
    params.set('project', project);
  }
  if (from) params.set('from', from);
  if (to) params.set('to', to);

  return apiFetch<TrendsData>(`${API_BASE}/metrics/trends?${params}`);
}

export function useTrends(
  period: TrendsPeriod = '7d',
  project?: string,
  from?: string,
  to?: string
) {
  return useQuery({
    queryKey: ['trends', period, project, from, to],
    queryFn: () => fetchTrends(period, project, from, to),
    refetchInterval: 30000, // Refresh every 30 seconds
    staleTime: 10000,
  });
}

// Utility functions for chart formatting
export function formatDate(dateStr: string, period: TrendsPeriod): string {
  const date = new Date(dateStr + 'T00:00:00');
  const shortRange = period === 'today' || period === 'wtd' || period === '7d';
  if (shortRange) {
    return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  }
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function formatShortDate(dateStr: string): string {
  const date = new Date(dateStr + 'T00:00:00');
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
