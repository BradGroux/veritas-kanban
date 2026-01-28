import { useQuery } from '@tanstack/react-query';
import { api, type StatusHistoryEntry, type DailySummary } from '../lib/api';

export type { StatusHistoryEntry, DailySummary };

/**
 * Fetch status history entries
 */
export function useStatusHistory(limit: number = 100, offset: number = 0) {
  return useQuery({
    queryKey: ['status-history', limit, offset],
    queryFn: () => api.statusHistory.list(limit, offset),
    refetchInterval: 60000, // Refresh every minute
  });
}

/**
 * Fetch daily summary for a specific date (or today if not specified)
 */
export function useDailySummary(date?: string) {
  return useQuery({
    queryKey: ['status-history', 'daily', date || 'today'],
    queryFn: () => api.statusHistory.getDailySummary(date),
    refetchInterval: 60000, // Refresh every minute
  });
}

/**
 * Fetch weekly summary (last 7 days)
 */
export function useWeeklySummary() {
  return useQuery({
    queryKey: ['status-history', 'weekly'],
    queryFn: () => api.statusHistory.getWeeklySummary(),
    refetchInterval: 300000, // Refresh every 5 minutes
  });
}

/**
 * Format milliseconds to human-readable duration
 */
export function formatDurationMs(ms: number): string {
  if (ms < 1000) return '< 1s';
  
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  
  if (hours > 0) {
    const remainingMinutes = minutes % 60;
    return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
  }
  
  if (minutes > 0) {
    const remainingSeconds = seconds % 60;
    return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
  }
  
  return `${seconds}s`;
}

/**
 * Calculate percentage of active time
 */
export function calculateActivePercent(summary: DailySummary): number {
  const total = summary.activeMs + summary.idleMs + summary.errorMs;
  if (total === 0) return 0;
  return Math.round((summary.activeMs / total) * 100);
}

/**
 * Get status color class
 */
export function getStatusColor(status: string): string {
  switch (status) {
    case 'working':
    case 'thinking':
      return 'bg-green-500';
    case 'sub-agent':
      return 'bg-blue-500';
    case 'idle':
      return 'bg-gray-400';
    case 'error':
      return 'bg-red-500';
    default:
      return 'bg-gray-300';
  }
}

/**
 * Get status text color class
 */
export function getStatusTextColor(status: string): string {
  switch (status) {
    case 'working':
    case 'thinking':
      return 'text-green-500';
    case 'sub-agent':
      return 'text-blue-500';
    case 'idle':
      return 'text-gray-500';
    case 'error':
      return 'text-red-500';
    default:
      return 'text-gray-400';
  }
}
