/**
 * Run-related metrics: run success/error rates, duration, and failed run details.
 */
import type { RunTelemetryEvent } from '@veritas-kanban/shared';
import { getPeriodStart, percentile } from './helpers.js';
import { getEventFiles, streamEvents, createLineReader } from './telemetry-reader.js';
import type {
  MetricsPeriod,
  RunMetrics,
  AgentBreakdown,
  RunAccumulator,
  DurationMetrics,
  FailedRunDetails,
} from './types.js';
import { createLogger } from '../../lib/logger.js';
const log = createLogger('run-metrics');

/**
 * Get run metrics (error rate, success rate) with per-agent breakdown
 */
export async function computeRunMetrics(
  telemetryDir: string,
  period: MetricsPeriod,
  project?: string,
  from?: string,
  to?: string
): Promise<RunMetrics> {
  const since = getPeriodStart(period, from);
  const files = await getEventFiles(telemetryDir, since);

  const accumulator: RunAccumulator = {
    successes: 0,
    failures: 0,
    errors: 0,
    durations: [],
    byAgent: new Map(),
  };

  await streamEvents(
    files,
    ['run.completed', 'run.error'],
    since,
    project,
    accumulator,
    (event, acc) => {
      const agent = (event as RunTelemetryEvent).agent || 'veritas';

      if (!acc.byAgent.has(agent)) {
        acc.byAgent.set(agent, { successes: 0, failures: 0, errors: 0, durations: [] });
      }
      const agentAcc = acc.byAgent.get(agent)!;

      if (event.type === 'run.error') {
        acc.errors++;
        agentAcc.errors++;
      } else if (event.type === 'run.completed') {
        const runEvent = event as RunTelemetryEvent;
        // Support both formats: `success: true` (canonical) and `status: "success"` (legacy)
        const isSuccess =
          runEvent.success === true ||
          (runEvent as unknown as Record<string, unknown>).status === 'success';
        if (isSuccess) {
          acc.successes++;
          agentAcc.successes++;
        } else {
          acc.failures++;
          agentAcc.failures++;
        }
        if (runEvent.durationMs && runEvent.durationMs > 0) {
          acc.durations.push(runEvent.durationMs);
          agentAcc.durations.push(runEvent.durationMs);
        }
      }
    },
    to
  );

  const runs = accumulator.successes + accumulator.failures + accumulator.errors;
  const errorRate = runs > 0 ? (accumulator.failures + accumulator.errors) / runs : 0;
  const successRate = runs > 0 ? accumulator.successes / runs : 0;

  // Build per-agent breakdown
  const byAgent: AgentBreakdown[] = [];
  for (const [agent, data] of accumulator.byAgent.entries()) {
    const agentRuns = data.successes + data.failures + data.errors;
    const avgDuration =
      data.durations.length > 0
        ? Math.round(data.durations.reduce((a, b) => a + b, 0) / data.durations.length)
        : 0;

    byAgent.push({
      agent,
      runs: agentRuns,
      successes: data.successes,
      failures: data.failures,
      errors: data.errors,
      successRate: agentRuns > 0 ? data.successes / agentRuns : 0,
      avgDurationMs: avgDuration,
      totalTokens: 0, // Will be populated if needed
    });
  }

  // Sort by runs descending
  byAgent.sort((a, b) => b.runs - a.runs);

  return {
    period,
    runs,
    successes: accumulator.successes,
    failures: accumulator.failures,
    errors: accumulator.errors,
    errorRate,
    successRate,
    byAgent,
  };
}

/**
 * Get duration metrics with per-agent breakdown
 */
export async function computeDurationMetrics(
  telemetryDir: string,
  period: MetricsPeriod,
  project?: string,
  from?: string,
  to?: string
): Promise<DurationMetrics> {
  const since = getPeriodStart(period, from);
  const files = await getEventFiles(telemetryDir, since);

  const accumulator = {
    durations: [] as number[],
    byAgent: new Map<string, number[]>(),
  };

  await streamEvents(
    files,
    ['run.completed'],
    since,
    project,
    accumulator,
    (event, acc) => {
      const runEvent = event as RunTelemetryEvent;
      if (runEvent.durationMs !== undefined && runEvent.durationMs > 0) {
        const agent = runEvent.agent || 'veritas';

        acc.durations.push(runEvent.durationMs);

        if (!acc.byAgent.has(agent)) {
          acc.byAgent.set(agent, []);
        }
        acc.byAgent.get(agent)!.push(runEvent.durationMs);
      }
    },
    to
  );

  // Sort for percentile calculations
  accumulator.durations.sort((a, b) => a - b);

  const runs = accumulator.durations.length;
  const sum = accumulator.durations.reduce((a, b) => a + b, 0);
  const avgMs = runs > 0 ? Math.round(sum / runs) : 0;
  const p50Ms = percentile(accumulator.durations, 50);
  const p95Ms = percentile(accumulator.durations, 95);

  // Build per-agent breakdown
  const byAgent: DurationMetrics['byAgent'] = [];
  for (const [agent, durations] of accumulator.byAgent.entries()) {
    durations.sort((a, b) => a - b);
    const agentSum = durations.reduce((a, b) => a + b, 0);

    byAgent.push({
      agent,
      runs: durations.length,
      avgMs: durations.length > 0 ? Math.round(agentSum / durations.length) : 0,
      p50Ms: percentile(durations, 50),
      p95Ms: percentile(durations, 95),
    });
  }

  // Sort by runs descending
  byAgent.sort((a, b) => b.runs - a.runs);

  return {
    period,
    runs,
    avgMs,
    p50Ms,
    p95Ms,
    byAgent,
  };
}

/**
 * Get list of failed runs with details
 */
export async function computeFailedRuns(
  telemetryDir: string,
  period: MetricsPeriod,
  project?: string,
  limit = 50,
  from?: string,
  to?: string
): Promise<FailedRunDetails[]> {
  const since = getPeriodStart(period, from);
  const files = await getEventFiles(telemetryDir, since);

  const failedRuns: FailedRunDetails[] = [];

  for (const filePath of files) {
    try {
      const rl = createLineReader(filePath);

      for await (const line of rl) {
        if (!line.trim()) continue;

        try {
          const event = JSON.parse(line) as RunTelemetryEvent;

          // Filter by type and time
          if (event.type !== 'run.completed' && event.type !== 'run.error') continue;
          if (since && event.timestamp < since) continue;
          if (to && event.timestamp > to) continue;
          if (project && event.project !== project) continue;

          // Only include failed runs
          const isSuccess =
            event.success === true ||
            (event as unknown as Record<string, unknown>).status === 'success';
          if (event.type === 'run.error' || (event.type === 'run.completed' && !isSuccess)) {
            failedRuns.push({
              timestamp: event.timestamp,
              taskId: event.taskId,
              project: event.project,
              agent: event.agent || 'veritas',
              success: false,
              errorMessage: event.error,
              durationMs: event.durationMs,
            });
          }
        } catch {
          // Skip malformed lines
          continue;
        }
      }
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        log.error(`[Metrics] Error reading ${filePath}:`, error.message);
      }
    }
  }

  // Sort by timestamp descending (most recent first) and limit
  return failedRuns
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, limit);
}
