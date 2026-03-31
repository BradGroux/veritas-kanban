/**
 * Shared utility functions for metrics calculations.
 */
import path from 'path';
import type { MetricsPeriod, TrendDirection } from './types.js';
import { getProjectRoot, getTelemetryDir } from '../../utils/paths.js';

// Default paths - resolve via shared paths helper
export const PROJECT_ROOT = getProjectRoot();
export const TELEMETRY_DIR = getTelemetryDir();

/**
 * Get timestamp for start of period
 * For 'custom' period, returns null (use from/to params instead)
 */
export function getPeriodStart(period: MetricsPeriod, customFrom?: string): string | null {
  // Custom period uses explicit from/to params
  if (period === 'custom') {
    return customFrom || null;
  }

  // All period returns null (no date filter)
  if (period === 'all') {
    return null;
  }

  const now = new Date();
  switch (period) {
    case 'today':
      // Start of current day (00:00:00)
      now.setHours(0, 0, 0, 0);
      break;
    case '24h':
      now.setTime(now.getTime() - 24 * 60 * 60 * 1000);
      break;
    case '3d':
      now.setTime(now.getTime() - 3 * 24 * 60 * 60 * 1000);
      break;
    case 'wtd': {
      // Start of current week (Monday 00:00:00)
      now.setHours(0, 0, 0, 0);
      const day = now.getDay();
      const diff = day === 0 ? 6 : day - 1; // Sunday is 0, Monday is 1
      now.setDate(now.getDate() - diff);
      break;
    }
    case 'mtd':
      // Start of current month (1st day 00:00:00)
      now.setDate(1);
      now.setHours(0, 0, 0, 0);
      break;
    case 'ytd':
      // Start of current year (Jan 1 00:00:00)
      now.setMonth(0, 1);
      now.setHours(0, 0, 0, 0);
      break;
    case '7d':
      now.setTime(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      break;
    case '30d':
      now.setTime(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      break;
    case '3m':
      now.setMonth(now.getMonth() - 3);
      break;
    case '6m':
      now.setMonth(now.getMonth() - 6);
      break;
    case '12m':
      now.setMonth(now.getMonth() - 12);
      break;
  }
  return now.toISOString();
}

/**
 * Get timestamp range for previous period (for trend comparison)
 */
export function getPreviousPeriodRange(
  period: MetricsPeriod,
  customFrom?: string,
  customTo?: string
): { since: string; until: string } | null {
  // Can't calculate trends for 'all' or 'custom' periods
  if (period === 'all') {
    return null;
  }

  if (period === 'custom') {
    if (!customFrom || !customTo) return null;
    const fromDate = new Date(customFrom);
    const toDate = new Date(customTo);
    const periodMs = toDate.getTime() - fromDate.getTime();
    const previousStart = new Date(fromDate.getTime() - periodMs);
    return {
      since: previousStart.toISOString(),
      until: fromDate.toISOString(),
    };
  }

  const now = new Date();
  let periodMs: number;

  switch (period) {
    case 'today':
      // Previous day
      periodMs = 24 * 60 * 60 * 1000;
      break;
    case '24h':
      periodMs = 24 * 60 * 60 * 1000;
      break;
    case '3d':
      periodMs = 3 * 24 * 60 * 60 * 1000;
      break;
    case 'wtd':
      // Previous week
      periodMs = 7 * 24 * 60 * 60 * 1000;
      break;
    case 'mtd':
      // Previous month (approximate - use 30 days)
      periodMs = 30 * 24 * 60 * 60 * 1000;
      break;
    case 'ytd':
      // Previous year (approximate)
      periodMs = 365 * 24 * 60 * 60 * 1000;
      break;
    case '7d':
      periodMs = 7 * 24 * 60 * 60 * 1000;
      break;
    case '30d':
      periodMs = 30 * 24 * 60 * 60 * 1000;
      break;
    case '3m':
      periodMs = 90 * 24 * 60 * 60 * 1000;
      break;
    case '6m':
      periodMs = 180 * 24 * 60 * 60 * 1000;
      break;
    case '12m':
      periodMs = 365 * 24 * 60 * 60 * 1000;
      break;
    default:
      return null;
  }

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

/**
 * Convert a UTC ISO timestamp to a local date string (YYYY-MM-DD)
 * using the given UTC offset in hours. Defaults to server local time.
 *
 * @param isoTimestamp - UTC timestamp (e.g. "2026-02-06T01:20:00Z")
 * @param utcOffsetHours - Optional UTC offset in hours (e.g. -6 for CST, 9 for JST)
 * @returns Local date string like "2026-02-05"
 */
export function toLocalDateStr(isoTimestamp: string, utcOffsetHours?: number): string {
  const d = new Date(isoTimestamp);
  if (utcOffsetHours !== undefined) {
    // Apply explicit offset: shift UTC time by offset hours
    const utcMs = d.getTime() + d.getTimezoneOffset() * 60000; // normalize to true UTC
    const localMs = utcMs + utcOffsetHours * 3600000;
    const local = new Date(localMs);
    return `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, '0')}-${String(local.getDate()).padStart(2, '0')}`;
  }
  // Default: use server local time
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Get "today" as YYYY-MM-DD in the given timezone.
 * @param utcOffsetHours - Optional UTC offset (defaults to server local)
 */
export function getTodayStr(utcOffsetHours?: number): string {
  return toLocalDateStr(new Date().toISOString(), utcOffsetHours);
}

/**
 * Get elapsed milliseconds since midnight in the given timezone.
 * @param utcOffsetHours - Optional UTC offset (defaults to server local)
 */
export function getElapsedTodayMs(utcOffsetHours?: number): number {
  const now = new Date();
  if (utcOffsetHours !== undefined) {
    const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
    const localMs = utcMs + utcOffsetHours * 3600000;
    const local = new Date(localMs);
    return local.getHours() * 3600000 + local.getMinutes() * 60000 + local.getSeconds() * 1000;
  }
  return now.getHours() * 3600000 + now.getMinutes() * 60000 + now.getSeconds() * 1000;
}
