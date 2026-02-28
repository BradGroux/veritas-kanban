import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api/helpers';
import { API_BASE } from '@/lib/config';
import type {
  AnyTelemetryEvent,
  RunStartedEvent,
  RunCompletedEvent,
  RunErrorEvent,
  TokenTelemetryEvent,
} from '@veritas-kanban/shared';

export interface AttemptMetrics {
  attemptId: string;
  startTime: string;
  endTime?: string;
  agent: string;
  model?: string;
  durationMs?: number;
  success?: boolean;
  error?: string;
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  totalTokens: number;
  cost: number;
}

export interface AggregatedTaskMetrics {
  taskId: string;
  totalRuns: number;
  successfulRuns: number;
  failedRuns: number;
  successRate: number;
  totalDurationMs: number;
  avgDurationMs: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheTokens: number;
  totalTokens: number;
  totalCost: number;
  lastRun?: AttemptMetrics;
  attempts: AttemptMetrics[];
}

async function fetchTaskTelemetry(taskId: string): Promise<AnyTelemetryEvent[]> {
  return apiFetch<AnyTelemetryEvent[]>(
    `${API_BASE}/telemetry/events/task/${encodeURIComponent(taskId)}`
  );
}

function aggregateMetrics(taskId: string, events: AnyTelemetryEvent[]): AggregatedTaskMetrics {
  // Group events by attempt/session
  const attemptMap = new Map<
    string,
    {
      started?: RunStartedEvent;
      completed?: RunCompletedEvent;
      error?: RunErrorEvent;
      tokens?: TokenTelemetryEvent;
    }
  >();

  // Process events
  for (const event of events) {
    if (!event.taskId || event.taskId !== taskId) continue;

    // Use attemptId if available, or generate one from timestamp+agent
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
      for (const [, attempt] of attemptMap.entries()) {
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
      attemptKey = e.attemptId || `${e.timestamp}_${e.agent}`;
      for (const [, attempt] of attemptMap.entries()) {
        if (attempt.started?.agent === e.agent && !attempt.error) {
          attempt.error = e;
          break;
        }
      }
    } else if (event.type === 'run.tokens') {
      const e = event as TokenTelemetryEvent;
      attemptKey = e.attemptId || `${e.timestamp}_${e.agent}`;
      // Associate with the most recent started event for this agent
      for (const [, attempt] of attemptMap.entries()) {
        if (attempt.started?.agent === e.agent && !attempt.tokens) {
          attempt.tokens = e;
          break;
        }
      }
      // If no match, create standalone entry
      if (!attemptMap.has(attemptKey)) {
        attemptMap.set(attemptKey, { tokens: e });
      }
    }
  }

  // Convert to AttemptMetrics array
  const attempts: AttemptMetrics[] = [];

  for (const [key, data] of attemptMap.entries()) {
    const attempt: AttemptMetrics = {
      attemptId: key,
      startTime:
        data.started?.timestamp || data.completed?.timestamp || data.tokens?.timestamp || '',
      endTime: data.completed?.timestamp,
      agent: data.started?.agent || data.completed?.agent || data.tokens?.agent || 'unknown',
      model: data.started?.model || data.tokens?.model,
      durationMs: data.completed?.durationMs,
      success: data.completed?.success,
      error: data.completed?.error || data.error?.error,
      inputTokens: data.tokens?.inputTokens || 0,
      outputTokens: data.tokens?.outputTokens || 0,
      cacheTokens: data.tokens?.cacheTokens || 0,
      totalTokens:
        data.tokens?.totalTokens ||
        (data.tokens ? data.tokens.inputTokens + data.tokens.outputTokens : 0),
      cost: data.tokens?.cost || 0,
    };

    if (attempt.startTime) {
      attempts.push(attempt);
    }
  }

  // Sort by start time (newest first)
  attempts.sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());

  // Calculate aggregates
  const runsWithOutcome = attempts.filter((a) => a.success !== undefined);
  const successfulRuns = runsWithOutcome.filter((a) => a.success === true).length;
  const failedRuns = runsWithOutcome.filter((a) => a.success === false).length;
  const totalRuns = runsWithOutcome.length || attempts.length;

  const durationsMs = attempts.filter((a) => a.durationMs !== undefined).map((a) => a.durationMs!);
  const totalDurationMs = durationsMs.reduce((sum, d) => sum + d, 0);
  const avgDurationMs = durationsMs.length > 0 ? totalDurationMs / durationsMs.length : 0;

  const totalInputTokens = attempts.reduce((sum, a) => sum + a.inputTokens, 0);
  const totalOutputTokens = attempts.reduce((sum, a) => sum + a.outputTokens, 0);
  const totalCacheTokens = attempts.reduce((sum, a) => sum + a.cacheTokens, 0);
  const totalTokens = attempts.reduce((sum, a) => sum + a.totalTokens, 0);
  const totalCost = attempts.reduce((sum, a) => sum + a.cost, 0);

  return {
    taskId,
    totalRuns,
    successfulRuns,
    failedRuns,
    successRate: totalRuns > 0 ? successfulRuns / totalRuns : 0,
    totalDurationMs,
    avgDurationMs,
    totalInputTokens,
    totalOutputTokens,
    totalCacheTokens,
    totalTokens,
    totalCost,
    lastRun: attempts[0],
    attempts,
  };
}

export function useTaskMetrics(taskId: string | undefined) {
  return useQuery({
    queryKey: ['taskMetrics', taskId],
    queryFn: async () => {
      if (!taskId) return null;
      const events = await fetchTaskTelemetry(taskId);
      return aggregateMetrics(taskId, events);
    },
    enabled: !!taskId,
    staleTime: 30000, // 30 seconds
    refetchInterval: 60000, // Refresh every minute
  });
}
