/**
 * Shared utility functions for metrics calculations.
 */
import path from 'path';
import type { MetricsPeriod, TrendDirection } from './types.js';

// Default paths - resolve to project root
export const PROJECT_ROOT = path.resolve(process.cwd(), '..');
export const TELEMETRY_DIR = path.join(PROJECT_ROOT, '.veritas-kanban', 'telemetry');

/**
 * Get timestamp for start of period
 */
export function getPeriodStart(period: MetricsPeriod): string {
  const now = new Date();
  switch (period) {
    case '24h':
      now.setHours(now.getHours() - 24);
      break;
    case '7d':
      now.setDate(now.getDate() - 7);
      break;
    case '30d':
      now.setDate(now.getDate() - 30);
      break;
  }
  return now.toISOString();
}

/**
 * Get timestamp range for previous period (for trend comparison)
 */
export function getPreviousPeriodRange(period: MetricsPeriod): { since: string; until: string } {
  const now = new Date();
  const periodMs =
    period === '24h'
      ? 24 * 60 * 60 * 1000
      : period === '7d'
        ? 7 * 24 * 60 * 60 * 1000
        : 30 * 24 * 60 * 60 * 1000;

  const currentPeriodStart = new Date(now.getTime() - periodMs);
  const previousPeriodStart = new Date(currentPeriodStart.getTime() - periodMs);

  return {
    since: previousPeriodStart.toISOString(),
    until: currentPeriodStart.toISOString(),
  };
}

/**
 * Calculate trend direction based on change
 */
export function calculateTrend(
  current: number,
  previous: number,
  higherIsBetter = true
): TrendDirection {
  if (previous === 0) return current > 0 ? 'up' : 'flat';
  const changePercent = ((current - previous) / previous) * 100;
  if (Math.abs(changePercent) < 5) return 'flat'; // Less than 5% change is flat
  const isUp = current > previous;
  // For metrics where lower is better (like duration), invert the logic
  return higherIsBetter ? (isUp ? 'up' : 'down') : isUp ? 'down' : 'up';
}

/**
 * Calculate percentage change
 */
export function calculateChange(current: number, previous: number): number {
  if (previous === 0) return current > 0 ? 100 : 0;
  return Math.round(((current - previous) / previous) * 100);
}

/**
 * Calculate percentile from sorted array
 */
export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}

/**
 * Format duration for recommendation display
 */
export function formatDurationForRecommendation(ms: number): string {
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3600000) return `${Math.round(ms / 60000)}m`;
  return `${(ms / 3600000).toFixed(1)}h`;
}

/**
 * Format tokens for recommendation display
 */
export function formatTokensForRecommendation(tokens: number): string {
  if (tokens < 1000) return `${tokens}`;
  if (tokens < 1000000) return `${(tokens / 1000).toFixed(1)}K`;
  return `${(tokens / 1000000).toFixed(2)}M`;
}
