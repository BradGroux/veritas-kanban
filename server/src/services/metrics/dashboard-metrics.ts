/**
 * Dashboard and composite metrics: all-in-one dashboard, trends, and agent comparison.
 * These are performance-optimized methods that do single-pass file processing.
 */
import type {
  RunTelemetryEvent,
  TokenTelemetryEvent,
  AnyTelemetryEvent,
} from '@veritas-kanban/shared';
import { TaskService } from '../task-service.js';
import {
  getPeriodStart,
  getPreviousPeriodRange,
  calculateTrend,
  calculateChange,
  percentile,
  formatDurationForRecommendation,
  formatTokensForRecommendation,
} from './helpers.js';
import { getEventFiles, createLineReader } from './telemetry-reader.js';
import { computeTaskMetrics } from './task-metrics.js';
import type {
  MetricsPeriod,
  TaskMetrics,
  RunMetrics,
  TokenMetrics,
  DurationMetrics,
  TrendComparison,
  AgentBreakdown,
  RunAccumulator,
  TokenAccumulator,
  DailyTrendPoint,
  TrendsData,
  AgentComparisonData,
  AgentRecommendation,
  AgentComparisonResult,
} from './types.js';
import { createLogger } from '../../lib/logger.js';
const log = createLogger('dashboard-metrics');

/**
 * Get all metrics in one call (for dashboard).
 * Optimized: streams files once and extracts all metrics in single pass.
 */
export async function computeAllMetrics(
  taskService: TaskService,
  telemetryDir: string,
  period: MetricsPeriod = '7d',
  project?: string,
  from?: string,
  to?: string
): Promise<{
  tasks: TaskMetrics;
  runs: RunMetrics;
  tokens: TokenMetrics;
  duration: DurationMetrics;
  trends: TrendComparison;
}> {
  const since = getPeriodStart(period, from);
  const files = await getEventFiles(telemetryDir, since);

  // Combined accumulator for single-pass processing
  const runAcc: RunAccumulator = {
    successes: 0,
    failures: 0,
    errors: 0,
    durations: [],
    byAgent: new Map(),
  };

  const tokenAcc: TokenAccumulator = {
    totalTokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheTokens: 0,
    tokensPerRun: [],
    byAgent: new Map(),
  };

  // Single pass through all files
  for (const filePath of files) {
    try {
      const rl = createLineReader(filePath);

      for await (const line of rl) {
        if (!line.trim()) continue;

        try {
          const event = JSON.parse(line) as AnyTelemetryEvent;

          // Early timestamp filter
          if (since && event.timestamp < since) continue;
          if (to && event.timestamp > to) continue;
          if (project && event.project !== project) continue;

          const eventType = event.type;

          // Process run events
          if (eventType === 'run.completed' || eventType === 'run.error') {
            const runEvent = event as RunTelemetryEvent;
            const agent = runEvent.agent || 'veritas';

            if (!runAcc.byAgent.has(agent)) {
              runAcc.byAgent.set(agent, { successes: 0, failures: 0, errors: 0, durations: [] });
            }
            const agentAcc = runAcc.byAgent.get(agent)!;

            if (eventType === 'run.error') {
              runAcc.errors++;
              agentAcc.errors++;
            } else {
              const isSuccess =
                runEvent.success === true ||
                (runEvent as unknown as Record<string, unknown>).status === 'success';
              if (isSuccess) {
                runAcc.successes++;
                agentAcc.successes++;
              } else {
                runAcc.failures++;
                agentAcc.failures++;
              }
              if (runEvent.durationMs && runEvent.durationMs > 0) {
                runAcc.durations.push(runEvent.durationMs);
                agentAcc.durations.push(runEvent.durationMs);
              }
            }
          }

          // Process token events
          if (eventType === 'run.tokens') {
            const tokenEvent = event as TokenTelemetryEvent;
            const agent = tokenEvent.agent || 'veritas';
            // Calculate totalTokens if not provided
            const totalTokens =
              tokenEvent.totalTokens ?? tokenEvent.inputTokens + tokenEvent.outputTokens;
            const cacheTokens = tokenEvent.cacheTokens ?? 0;

            tokenAcc.totalTokens += totalTokens;
            tokenAcc.inputTokens += tokenEvent.inputTokens;
            tokenAcc.outputTokens += tokenEvent.outputTokens;
            tokenAcc.cacheTokens += cacheTokens;
            tokenAcc.tokensPerRun.push(totalTokens);

            if (!tokenAcc.byAgent.has(agent)) {
              tokenAcc.byAgent.set(agent, {
                totalTokens: 0,
                inputTokens: 0,
                outputTokens: 0,
                cacheTokens: 0,
                runs: 0,
              });
            }
            const agentTokenAcc = tokenAcc.byAgent.get(agent)!;
            agentTokenAcc.totalTokens += totalTokens;
            agentTokenAcc.inputTokens += tokenEvent.inputTokens;
            agentTokenAcc.outputTokens += tokenEvent.outputTokens;
            agentTokenAcc.cacheTokens += cacheTokens;
            agentTokenAcc.runs++;
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

  // Get task metrics — filtered by period like everything else
  const tasks = await computeTaskMetrics(taskService, project, since);

  // Build run metrics
  const totalRuns = runAcc.successes + runAcc.failures + runAcc.errors;
  const runByAgent: AgentBreakdown[] = [];
  for (const [agent, data] of runAcc.byAgent.entries()) {
    const agentRuns = data.successes + data.failures + data.errors;
    const avgDuration =
      data.durations.length > 0
        ? Math.round(data.durations.reduce((a, b) => a + b, 0) / data.durations.length)
        : 0;

    runByAgent.push({
      agent,
      runs: agentRuns,
      successes: data.successes,
      failures: data.failures,
      errors: data.errors,
      successRate: agentRuns > 0 ? data.successes / agentRuns : 0,
      avgDurationMs: avgDuration,
      totalTokens: tokenAcc.byAgent.get(agent)?.totalTokens || 0,
    });
  }
  runByAgent.sort((a, b) => b.runs - a.runs);

  const runs: RunMetrics = {
    period,
    runs: totalRuns,
    successes: runAcc.successes,
    failures: runAcc.failures,
    errors: runAcc.errors,
    errorRate: totalRuns > 0 ? (runAcc.failures + runAcc.errors) / totalRuns : 0,
    successRate: totalRuns > 0 ? runAcc.successes / totalRuns : 0,
    byAgent: runByAgent,
  };

  // Build token metrics
  tokenAcc.tokensPerRun.sort((a, b) => a - b);
  const tokenRuns = tokenAcc.tokensPerRun.length;
  const tokenByAgent: TokenMetrics['byAgent'] = [];
  for (const [agent, data] of tokenAcc.byAgent.entries()) {
    tokenByAgent.push({
      agent,
      totalTokens: data.totalTokens,
      inputTokens: data.inputTokens,
      outputTokens: data.outputTokens,
      cacheTokens: data.cacheTokens,
      runs: data.runs,
    });
  }
  tokenByAgent.sort((a, b) => b.totalTokens - a.totalTokens);

  const tokens: TokenMetrics = {
    period,
    totalTokens: tokenAcc.totalTokens,
    inputTokens: tokenAcc.inputTokens,
    outputTokens: tokenAcc.outputTokens,
    cacheTokens: tokenAcc.cacheTokens,
    runs: tokenRuns,
    perSuccessfulRun: {
      avg: tokenRuns > 0 ? Math.round(tokenAcc.totalTokens / tokenRuns) : 0,
      p50: percentile(tokenAcc.tokensPerRun, 50),
      p95: percentile(tokenAcc.tokensPerRun, 95),
    },
    byAgent: tokenByAgent,
  };

  // Build duration metrics
  runAcc.durations.sort((a, b) => a - b);
  const durationByAgent: DurationMetrics['byAgent'] = [];
  for (const [agent, data] of runAcc.byAgent.entries()) {
    data.durations.sort((a, b) => a - b);
    const agentSum = data.durations.reduce((a, b) => a + b, 0);
    durationByAgent.push({
      agent,
      runs: data.durations.length,
      avgMs: data.durations.length > 0 ? Math.round(agentSum / data.durations.length) : 0,
      p50Ms: percentile(data.durations, 50),
      p95Ms: percentile(data.durations, 95),
    });
  }
  durationByAgent.sort((a, b) => b.runs - a.runs);

  const durationSum = runAcc.durations.reduce((a, b) => a + b, 0);
  const duration: DurationMetrics = {
    period,
    runs: runAcc.durations.length,
    avgMs: runAcc.durations.length > 0 ? Math.round(durationSum / runAcc.durations.length) : 0,
    p50Ms: percentile(runAcc.durations, 50),
    p95Ms: percentile(runAcc.durations, 95),
    byAgent: durationByAgent,
  };

  // Calculate trends by comparing with previous period
  const previousRange = getPreviousPeriodRange(period, from, to);

  // If trends can't be calculated for this period (e.g., 'all' or missing custom dates), use flat trends
  if (!previousRange) {
    const trends: TrendComparison = {
      runsTrend: 'flat',
      runsChange: 0,
      successRateTrend: 'flat',
      successRateChange: 0,
      tokensTrend: 'flat',
      tokensChange: 0,
      durationTrend: 'flat',
      durationChange: 0,
    };
    return { tasks, runs, tokens, duration, trends };
  }

  const previousFiles = await getEventFiles(telemetryDir, previousRange.since);

  // Quick accumulator for previous period (runs, tokens, duration only)
  let prevRuns = 0,
    prevSuccesses = 0,
    prevTokens = 0,
    prevDurationSum = 0,
    prevDurationCount = 0;

  for (const filePath of previousFiles) {
    try {
      const rl = createLineReader(filePath);

      for await (const line of rl) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line) as AnyTelemetryEvent;
          if (event.timestamp < previousRange.since || event.timestamp >= previousRange.until)
            continue;
          if (project && event.project !== project) continue;

          if (event.type === 'run.completed') {
            const runEvent = event as RunTelemetryEvent;
            prevRuns++;
            const wasSuccess =
              runEvent.success === true ||
              (runEvent as unknown as Record<string, unknown>).status === 'success';
            if (wasSuccess) prevSuccesses++;
            if (runEvent.durationMs && runEvent.durationMs > 0) {
              prevDurationSum += runEvent.durationMs;
              prevDurationCount++;
            }
          } else if (event.type === 'run.error') {
            prevRuns++;
          } else if (event.type === 'run.tokens') {
            const tokenEvent = event as TokenTelemetryEvent;
            prevTokens +=
              tokenEvent.totalTokens ?? tokenEvent.inputTokens + tokenEvent.outputTokens;
          }
        } catch {
          // Intentionally silent: skip malformed NDJSON line
          continue;
        }
      }
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        log.error(`[Metrics] Error reading ${filePath}:`, error.message);
      }
    }
  }

  const prevSuccessRate = prevRuns > 0 ? prevSuccesses / prevRuns : 0;
  const prevAvgDuration = prevDurationCount > 0 ? prevDurationSum / prevDurationCount : 0;

  const trends: TrendComparison = {
    runsTrend: calculateTrend(runs.runs, prevRuns, true),
    runsChange: calculateChange(runs.runs, prevRuns),
    successRateTrend: calculateTrend(runs.successRate, prevSuccessRate, true),
    successRateChange: calculateChange(runs.successRate * 100, prevSuccessRate * 100),
    tokensTrend: calculateTrend(tokens.totalTokens, prevTokens, false), // Lower is better
    tokensChange: calculateChange(tokens.totalTokens, prevTokens),
    durationTrend: calculateTrend(duration.avgMs, prevAvgDuration, false), // Lower is better
    durationChange: calculateChange(duration.avgMs, prevAvgDuration),
  };

  return { tasks, runs, tokens, duration, trends };
}

/**
 * Get historical trends data aggregated by day
 */
export async function computeTrends(
  telemetryDir: string,
  period: MetricsPeriod,
  project?: string,
  from?: string,
  to?: string
): Promise<TrendsData> {
  const since = getPeriodStart(period, from);
  const files = await getEventFiles(telemetryDir, since);

  // Accumulator per day
  const dailyData = new Map<
    string,
    {
      runs: number;
      successes: number;
      failures: number;
      errors: number;
      totalTokens: number;
      inputTokens: number;
      outputTokens: number;
      durations: number[];
      costEstimate: number;
      tasksCreated: number;
      statusChanges: number;
      tasksArchived: number;
    }
  >();

  // Initialize all days in the period
  if (period === 'custom' && (!from || !to)) {
    throw new Error('Custom trends require from/to');
  }

  let startDate: Date;
  if (since) {
    startDate = new Date(since);
  } else {
    // 'all' period: infer start from earliest telemetry file date
    const dates = files
      .map((f) => {
        const match = f.match(/events-(\d{4}-\d{2}-\d{2})\.ndjson(\.gz)?$/);
        return match?.[1];
      })
      .filter((d): d is string => Boolean(d))
      .sort();

    startDate = dates.length > 0 ? new Date(dates[0] + 'T00:00:00.000Z') : new Date();
  }

  const endDate = to ? new Date(to) : new Date();
  for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
    const dateStr = d.toISOString().slice(0, 10);
    dailyData.set(dateStr, {
      runs: 0,
      successes: 0,
      failures: 0,
      errors: 0,
      totalTokens: 0,
      inputTokens: 0,
      outputTokens: 0,
      durations: [],
      costEstimate: 0,
      tasksCreated: 0,
      statusChanges: 0,
      tasksArchived: 0,
    });
  }

  // Process all files
  for (const filePath of files) {
    try {
      const rl = createLineReader(filePath);

      for await (const line of rl) {
        if (!line.trim()) continue;

        try {
          const event = JSON.parse(line) as AnyTelemetryEvent;

          // Early timestamp filter
          if (since && event.timestamp < since) continue;
          if (to && event.timestamp > to) continue;
          if (project && event.project !== project) continue;

          const dateStr = event.timestamp.slice(0, 10);
          if (!dailyData.has(dateStr)) {
            dailyData.set(dateStr, {
              runs: 0,
              successes: 0,
              failures: 0,
              errors: 0,
              totalTokens: 0,
              inputTokens: 0,
              outputTokens: 0,
              durations: [],
              costEstimate: 0,
              tasksCreated: 0,
              statusChanges: 0,
              tasksArchived: 0,
            });
          }
          const dayAcc = dailyData.get(dateStr)!;

          // Count task activity events
          if (event.type === 'task.created') {
            dayAcc.tasksCreated++;
          } else if (event.type === 'task.status_changed') {
            dayAcc.statusChanges++;
          } else if (event.type === 'task.archived') {
            dayAcc.tasksArchived++;
          }

          if (event.type === 'run.completed') {
            const runEvent = event as RunTelemetryEvent;
            dayAcc.runs++;
            const isSuccess =
              runEvent.success === true ||
              (runEvent as unknown as Record<string, unknown>).status === 'success';
            if (isSuccess) {
              dayAcc.successes++;
            } else {
              dayAcc.failures++;
            }
            if (runEvent.durationMs && runEvent.durationMs > 0) {
              dayAcc.durations.push(runEvent.durationMs);
            }
          } else if (event.type === 'run.error') {
            dayAcc.runs++;
            dayAcc.errors++;
          } else if (event.type === 'run.tokens') {
            const tokenEvent = event as TokenTelemetryEvent;
            const totalTokens =
              tokenEvent.totalTokens ?? tokenEvent.inputTokens + tokenEvent.outputTokens;
            dayAcc.totalTokens += totalTokens;
            dayAcc.inputTokens += tokenEvent.inputTokens;
            dayAcc.outputTokens += tokenEvent.outputTokens;
            // Accumulate reported cost for daily cost estimates
            const eventCost = (tokenEvent as unknown as Record<string, unknown>).cost;
            if (typeof eventCost === 'number' && eventCost > 0) {
              dayAcc.costEstimate = (dayAcc.costEstimate || 0) + eventCost;
            }
          }
        } catch {
          // Intentionally silent: skip malformed NDJSON line
          continue;
        }
      }
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        log.error(`[Metrics] Error reading ${filePath}:`, error.message);
      }
    }
  }

  // Convert to sorted array
  const daily: DailyTrendPoint[] = [];
  const sortedDates = [...dailyData.keys()].sort();

  for (const date of sortedDates) {
    const data = dailyData.get(date)!;
    const avgDurationMs =
      data.durations.length > 0
        ? Math.round(data.durations.reduce((a, b) => a + b, 0) / data.durations.length)
        : 0;

    daily.push({
      date,
      runs: data.runs,
      successes: data.successes,
      failures: data.failures,
      errors: data.errors,
      successRate: data.runs > 0 ? data.successes / data.runs : 0,
      totalTokens: data.totalTokens,
      inputTokens: data.inputTokens,
      outputTokens: data.outputTokens,
      costEstimate: Math.round(data.costEstimate * 100) / 100,
      avgDurationMs,
      tasksCreated: data.tasksCreated,
      statusChanges: data.statusChanges,
      tasksArchived: data.tasksArchived,
    });
  }

  return { period, daily };
}

/**
 * Get agent comparison metrics for recommendations.
 * Aggregates performance data per agent with minimum run threshold.
 */
export async function computeAgentComparison(
  telemetryDir: string,
  period: MetricsPeriod,
  project?: string,
  minRuns = 3
): Promise<AgentComparisonResult> {
  const since = getPeriodStart(period);
  const files = await getEventFiles(telemetryDir, since);

  // Per-agent accumulator
  const agentData = new Map<
    string,
    {
      runs: number;
      successes: number;
      failures: number;
      errors: number;
      durations: number[];
      totalTokens: number;
      inputTokens: number;
      outputTokens: number;
      costEstimate: number;
    }
  >();

  // Process all files
  for (const filePath of files) {
    try {
      const rl = createLineReader(filePath);

      for await (const line of rl) {
        if (!line.trim()) continue;

        try {
          const event = JSON.parse(line) as AnyTelemetryEvent;

          if (since && event.timestamp < since) continue;
          if (project && event.project !== project) continue;

          const eventType = event.type;

          // Process run events
          if (eventType === 'run.completed' || eventType === 'run.error') {
            const runEvent = event as RunTelemetryEvent;
            const agent = runEvent.agent || 'veritas';

            if (!agentData.has(agent)) {
              agentData.set(agent, {
                runs: 0,
                successes: 0,
                failures: 0,
                errors: 0,
                durations: [],
                totalTokens: 0,
                inputTokens: 0,
                outputTokens: 0,
                costEstimate: 0,
              });
            }
            const acc = agentData.get(agent)!;

            if (eventType === 'run.error') {
              acc.runs++;
              acc.errors++;
            } else {
              acc.runs++;
              const isSuccess =
                runEvent.success === true ||
                (runEvent as unknown as Record<string, unknown>).status === 'success';
              if (isSuccess) {
                acc.successes++;
              } else {
                acc.failures++;
              }
              if (runEvent.durationMs && runEvent.durationMs > 0) {
                acc.durations.push(runEvent.durationMs);
              }
            }
          }

          // Process token events
          if (eventType === 'run.tokens') {
            const tokenEvent = event as TokenTelemetryEvent;
            const agent = tokenEvent.agent || 'veritas';

            if (!agentData.has(agent)) {
              agentData.set(agent, {
                runs: 0,
                successes: 0,
                failures: 0,
                errors: 0,
                durations: [],
                totalTokens: 0,
                inputTokens: 0,
                outputTokens: 0,
                costEstimate: 0,
              });
            }
            const acc = agentData.get(agent)!;
            const totalTokens =
              tokenEvent.totalTokens ?? tokenEvent.inputTokens + tokenEvent.outputTokens;

            acc.totalTokens += totalTokens;
            acc.inputTokens += tokenEvent.inputTokens;
            acc.outputTokens += tokenEvent.outputTokens;
            // Prefer reported cost; fall back to estimation ($0.01/1K in, $0.03/1K out)
            const eventCost = (tokenEvent as unknown as Record<string, unknown>).cost;
            acc.costEstimate +=
              typeof eventCost === 'number' && eventCost > 0
                ? eventCost
                : (tokenEvent.inputTokens / 1000) * 0.01 + (tokenEvent.outputTokens / 1000) * 0.03;
          }
        } catch {
          // Intentionally silent: skip malformed NDJSON line
          continue;
        }
      }
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        log.error(`[Metrics] Error reading ${filePath}:`, error.message);
      }
    }
  }

  // Build comparison data for agents meeting minimum runs threshold
  const agents: AgentComparisonData[] = [];

  for (const [agent, data] of agentData.entries()) {
    if (data.runs < minRuns) continue;

    const avgDurationMs =
      data.durations.length > 0
        ? Math.round(data.durations.reduce((a, b) => a + b, 0) / data.durations.length)
        : 0;
    const successRate = data.runs > 0 ? data.successes / data.runs : 0;
    const avgTokensPerRun = data.runs > 0 ? Math.round(data.totalTokens / data.runs) : 0;
    const avgCostPerRun =
      data.runs > 0 ? Math.round((data.costEstimate / data.runs) * 100) / 100 : 0;

    agents.push({
      agent,
      runs: data.runs,
      successes: data.successes,
      failures: data.failures + data.errors,
      successRate: Math.round(successRate * 1000) / 10, // e.g., 95.5%
      avgDurationMs,
      avgTokensPerRun,
      totalTokens: data.totalTokens,
      avgCostPerRun,
      totalCost: Math.round(data.costEstimate * 100) / 100,
    });
  }

  // Sort by runs descending by default
  agents.sort((a, b) => b.runs - a.runs);

  // Generate recommendations
  const recommendations: AgentRecommendation[] = [];

  if (agents.length > 0) {
    // Most reliable (highest success rate)
    const mostReliable = [...agents].sort((a, b) => b.successRate - a.successRate)[0];
    if (mostReliable.successRate >= 80) {
      recommendations.push({
        category: 'reliability',
        agent: mostReliable.agent,
        value: `${mostReliable.successRate}% success rate`,
        reason: `Highest success rate among agents with ${minRuns}+ runs`,
      });
    }

    // Fastest (lowest avg duration)
    const fastest = [...agents]
      .filter((a) => a.avgDurationMs > 0)
      .sort((a, b) => a.avgDurationMs - b.avgDurationMs)[0];
    if (fastest) {
      recommendations.push({
        category: 'speed',
        agent: fastest.agent,
        value: formatDurationForRecommendation(fastest.avgDurationMs),
        reason: 'Shortest average run duration',
      });
    }

    // Cheapest (lowest avg cost)
    const cheapest = [...agents]
      .filter((a) => a.avgCostPerRun > 0)
      .sort((a, b) => a.avgCostPerRun - b.avgCostPerRun)[0];
    if (cheapest) {
      recommendations.push({
        category: 'cost',
        agent: cheapest.agent,
        value: `$${cheapest.avgCostPerRun.toFixed(2)}/run`,
        reason: 'Lowest average cost per run',
      });
    }

    // Most efficient (tokens per successful run)
    const efficientAgents = agents
      .filter((a) => a.successes > 0)
      .map((a) => ({
        ...a,
        tokensPerSuccess: Math.round(a.totalTokens / a.successes),
      }))
      .sort((a, b) => a.tokensPerSuccess - b.tokensPerSuccess);

    if (efficientAgents.length > 0) {
      const mostEfficient = efficientAgents[0];
      recommendations.push({
        category: 'efficiency',
        agent: mostEfficient.agent,
        value: `${formatTokensForRecommendation(mostEfficient.tokensPerSuccess)}/success`,
        reason: 'Fewest tokens per successful run',
      });
    }
  }

  return {
    period,
    minRuns,
    agents,
    recommendations,
    totalAgents: agentData.size,
    qualifyingAgents: agents.length,
  };
}

/**
 * Compute cost per task — aggregates token usage and cost by taskId.
 */
export async function computeTaskCost(
  telemetryDir: string,
  taskService: TaskService,
  period: MetricsPeriod,
  project?: string,
  from?: string,
  to?: string
): Promise<import('./types.js').TaskCostMetrics> {
  const since = getPeriodStart(period, from);
  const files = await getEventFiles(telemetryDir, since);

  const taskCosts = new Map<
    string,
    { inputTokens: number; outputTokens: number; totalTokens: number; cost: number; runs: number }
  >();

  for (const filePath of files) {
    try {
      const rl = createLineReader(filePath);
      for await (const line of rl) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line) as AnyTelemetryEvent;
          if (since && event.timestamp < since) continue;
          if (to && event.timestamp > to) continue;
          if (project && event.project !== project) continue;

          if (event.type === 'run.tokens' && event.taskId) {
            const tokenEvent = event as TokenTelemetryEvent;
            const existing = taskCosts.get(event.taskId) || {
              inputTokens: 0,
              outputTokens: 0,
              totalTokens: 0,
              cost: 0,
              runs: 0,
            };
            existing.inputTokens += tokenEvent.inputTokens;
            existing.outputTokens += tokenEvent.outputTokens;
            existing.totalTokens +=
              tokenEvent.totalTokens ?? tokenEvent.inputTokens + tokenEvent.outputTokens;
            const eventCost = (tokenEvent as unknown as Record<string, unknown>).cost;
            if (typeof eventCost === 'number' && eventCost > 0) {
              existing.cost += eventCost;
            } else {
              // Estimate at Opus rates
              existing.cost +=
                tokenEvent.inputTokens * (15 / 1e6) + tokenEvent.outputTokens * (75 / 1e6);
            }
            existing.runs++;
            taskCosts.set(event.taskId, existing);
          }
        } catch {
          continue;
        }
      }
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        log.error(`[Metrics] Error reading ${filePath}:`, error.message);
      }
    }
  }

  // Look up task titles
  const allTasks = await taskService.listTasks();
  const taskMap = new Map(allTasks.map((t) => [t.id, t.title]));

  let totalCost = 0;
  const tasks: import('./types.js').TaskCostEntry[] = [];

  for (const [taskId, data] of taskCosts) {
    const cost = Math.round(data.cost * 100) / 100;
    totalCost += cost;
    tasks.push({
      taskId,
      taskTitle: taskMap.get(taskId),
      inputTokens: data.inputTokens,
      outputTokens: data.outputTokens,
      totalTokens: data.totalTokens,
      estimatedCost: cost,
      runs: data.runs,
      avgCostPerRun: data.runs > 0 ? Math.round((cost / data.runs) * 100) / 100 : 0,
    });
  }

  // Sort by cost descending
  tasks.sort((a, b) => b.estimatedCost - a.estimatedCost);

  return {
    period,
    tasks,
    totalCost: Math.round(totalCost * 100) / 100,
    avgCostPerTask: tasks.length > 0 ? Math.round((totalCost / tasks.length) * 100) / 100 : 0,
  };
}

/**
 * Compute agent utilization — active vs idle time from status history.
 */
export async function computeUtilization(
  telemetryDir: string,
  period: MetricsPeriod,
  from?: string,
  to?: string
): Promise<import('./types.js').UtilizationMetrics> {
  const since = getPeriodStart(period, from);
  const files = await getEventFiles(telemetryDir, since);

  // Track time between run.started and run.completed events per day
  const dailyActive = new Map<string, number>();
  const runStarts = new Map<string, string>(); // agent → start timestamp

  for (const filePath of files) {
    try {
      const rl = createLineReader(filePath);
      for await (const line of rl) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line) as AnyTelemetryEvent;
          if (since && event.timestamp < since) continue;
          if (to && event.timestamp > to) continue;

          if (event.type === 'run.started') {
            const agent = (event as any).agent || 'unknown';
            runStarts.set(agent, event.timestamp);
          } else if (event.type === 'run.completed') {
            const runEvent = event as RunTelemetryEvent;
            const agent = runEvent.agent || 'unknown';
            const durationMs = runEvent.durationMs || 0;
            if (durationMs > 0) {
              const dateStr = event.timestamp.slice(0, 10);
              dailyActive.set(dateStr, (dailyActive.get(dateStr) || 0) + durationMs);
            }
            runStarts.delete(agent);
          }
        } catch {
          continue;
        }
      }
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        log.error(`[Metrics] Error reading ${filePath}:`, error.message);
      }
    }
  }

  // Build daily utilization (assume 24h per day as total available time)
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  const daily: import('./types.js').DailyUtilization[] = [];
  let totalActiveMs = 0;
  let totalDays = 0;

  const sortedDates = [...dailyActive.keys()].sort();
  for (const date of sortedDates) {
    const activeMs = dailyActive.get(date) || 0;
    const idleMs = MS_PER_DAY - activeMs;
    totalActiveMs += activeMs;
    totalDays++;
    daily.push({
      date,
      activeMs,
      idleMs: Math.max(0, idleMs),
      errorMs: 0,
      utilizationPercent: Math.round((activeMs / MS_PER_DAY) * 10000) / 100,
    });
  }

  const totalMs = totalDays * MS_PER_DAY || 1;
  const totalIdleMs = totalMs - totalActiveMs;

  return {
    period,
    totalActiveMs,
    totalIdleMs: Math.max(0, totalIdleMs),
    totalErrorMs: 0,
    utilizationPercent: Math.round((totalActiveMs / totalMs) * 10000) / 100,
    daily,
  };
}
