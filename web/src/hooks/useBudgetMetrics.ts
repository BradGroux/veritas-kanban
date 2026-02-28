import { useQuery } from '@tanstack/react-query';
import { useFeatureSettings } from './useFeatureSettings';
import { apiFetch } from '@/lib/api/helpers';
import { API_BASE } from '@/lib/config';
import { useWebSocketStatus } from '@/contexts/WebSocketContext';

export interface BudgetMetrics {
  periodStart: string;
  periodEnd: string;
  daysInMonth: number;
  daysElapsed: number;
  daysRemaining: number;

  totalTokens: number;
  inputTokens: number;
  outputTokens: number;

  estimatedCost: number;

  tokensPerDay: number;
  costPerDay: number;

  projectedMonthlyTokens: number;
  projectedMonthlyCost: number;

  tokenBudget: number;
  costBudget: number;
  tokenBudgetUsed: number;
  costBudgetUsed: number;
  projectedTokenOverage: number;
  projectedCostOverage: number;

  status: 'ok' | 'warning' | 'danger';
}

async function fetchBudgetMetrics(
  tokenBudget: number,
  costBudget: number,
  warningThreshold: number,
  project?: string
): Promise<BudgetMetrics> {
  const params = new URLSearchParams();
  params.set('tokenBudget', String(tokenBudget));
  params.set('costBudget', String(costBudget));
  params.set('warningThreshold', String(warningThreshold));
  if (project) {
    params.set('project', project);
  }

  return apiFetch<BudgetMetrics>(`${API_BASE}/metrics/budget?${params}`);
}

export function useBudgetMetrics(project?: string) {
  const { settings } = useFeatureSettings();
  const { enabled, monthlyTokenLimit, monthlyCostLimit, warningThreshold } = settings.budget;
  const { isConnected } = useWebSocketStatus();

  return useQuery({
    queryKey: ['budget-metrics', monthlyTokenLimit, monthlyCostLimit, warningThreshold, project],
    queryFn: () =>
      fetchBudgetMetrics(monthlyTokenLimit, monthlyCostLimit, warningThreshold, project),
    enabled: enabled,
    // Budget metrics update less frequently (derived from telemetry)
    // - Connected: 120s safety-net polling
    // - Disconnected: 60s fallback polling
    refetchInterval: isConnected ? 120_000 : 60_000,
    staleTime: isConnected ? 60_000 : 30_000,
  });
}

// Utility functions for formatting
export function formatBudgetTokens(tokens: number): string {
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(1)}M`;
  }
  if (tokens >= 1_000) {
    return `${(tokens / 1_000).toFixed(1)}K`;
  }
  return tokens.toString();
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}
