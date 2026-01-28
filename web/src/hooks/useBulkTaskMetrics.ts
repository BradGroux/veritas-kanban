import { useQuery } from '@tanstack/react-query';
import type {
  AnyTelemetryEvent,
  RunStartedEvent,
  RunCompletedEvent,
  RunErrorEvent,
  TokenTelemetryEvent,
} from '@veritas-kanban/shared';

const API_BASE = '/api';

/**
 * Compact metrics for display on task cards
 */
export interface TaskCardMetrics {
  totalRuns: number;
  successfulRuns: number;
  failedRuns: number;
  lastRunSuccess?: boolean;
  totalDurationMs: number;
}

/**
 * Aggregate metrics from telemetry events for a single task
 */
function aggregateTaskMetrics(events: AnyTelemetryEvent[]): TaskCardMetrics {
  // Group events by attempt/session
  const attemptMap = new Map<string, {
    started?: RunStartedEvent;
    completed?: RunCompletedEvent;
    error?: RunErrorEvent;
    tokens?: TokenTelemetryEvent;
  }>();

  // Process events
  for (const event of events) {
    let attemptKey: string | undefined;
    
    if (event.type === 'run.started') {
      const e = event as RunStartedEvent;
      attemptKey = e.attemptId || `${e.timestamp}_${e.agent}`;
      const attempt = attemptMap.get(attemptKey) || {};
      attempt.started = e;
      attemptMap.set(attemptKey, attempt);
    } else if (event.type === 'run.completed') {
      const e = event as RunCompletedEvent;
      attemptKey = e.attemptId || `${e.timestamp}_${e.agent}`;
      // Try to find matching started event
      let found = false;
      const entries = Array.from(attemptMap.entries());
      for (const [, attempt] of entries) {
        if (attempt.started?.agent === e.agent && !attempt.completed) {
          attempt.completed = e;
          found = true;
          break;
        }
      }
      if (!found) {
        const attempt = attemptMap.get(attemptKey) || {};
        attempt.completed = e;
        attemptMap.set(attemptKey, attempt);
      }
    } else if (event.type === 'run.error') {
      const e = event as RunErrorEvent;
      const entries = Array.from(attemptMap.entries());
      for (const [, attempt] of entries) {
        if (attempt.started?.agent === e.agent && !attempt.error) {
          attempt.error = e;
          break;
        }
      }
    }
  }

  // Calculate aggregates
  let totalRuns = 0;
  let successfulRuns = 0;
  let failedRuns = 0;
  let totalDurationMs = 0;
  let lastRunSuccess: boolean | undefined;
  let latestTimestamp = '';

  const allEntries = Array.from(attemptMap.entries());
  for (const [, data] of allEntries) {
    if (data.completed?.success !== undefined || data.error) {
      totalRuns++;
      const success = data.completed?.success === true && !data.error;
      if (success) {
        successfulRuns++;
      } else {
        failedRuns++;
      }
      
      // Track last run
      const timestamp = data.completed?.timestamp || data.started?.timestamp || '';
      if (timestamp > latestTimestamp) {
        latestTimestamp = timestamp;
        lastRunSuccess = success;
      }
    } else if (data.started) {
      // Count started but not completed runs
      totalRuns++;
    }

    if (data.completed?.durationMs) {
      totalDurationMs += data.completed.durationMs;
    }
  }

  return {
    totalRuns,
    successfulRuns,
    failedRuns,
    lastRunSuccess,
    totalDurationMs,
  };
}

/**
 * Fetch bulk task events and aggregate metrics
 */
async function fetchBulkMetrics(taskIds: string[]): Promise<Map<string, TaskCardMetrics>> {
  if (taskIds.length === 0) {
    return new Map();
  }

  const response = await fetch(`${API_BASE}/telemetry/events/bulk`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ taskIds }),
  });

  if (!response.ok) {
    throw new Error('Failed to fetch bulk task telemetry');
  }

  const eventsMap: Record<string, AnyTelemetryEvent[]> = await response.json();
  
  const result = new Map<string, TaskCardMetrics>();
  for (const taskId of taskIds) {
    const events = eventsMap[taskId] || [];
    result.set(taskId, aggregateTaskMetrics(events));
  }
  
  return result;
}

/**
 * Hook to fetch metrics for multiple tasks at once
 * Used by KanbanColumn to batch-fetch metrics for done tasks
 */
export function useBulkTaskMetrics(taskIds: string[], enabled = true) {
  return useQuery({
    queryKey: ['bulkTaskMetrics', taskIds.sort().join(',')],
    queryFn: () => fetchBulkMetrics(taskIds),
    enabled: enabled && taskIds.length > 0,
    staleTime: 60000, // 1 minute
    refetchInterval: 120000, // Refresh every 2 minutes
  });
}

/**
 * Format duration in compact form for card display
 */
export function formatCompactDuration(ms: number): string {
  if (ms === 0) return '0s';
  
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (remainingMinutes === 0) return `${hours}h`;
  return `${hours}h${remainingMinutes}m`;
}
