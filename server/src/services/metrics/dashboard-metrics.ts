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

/**
 * Get all metrics in one call (for dashboard).
 * Optimized: streams files once and extracts all metrics in single pass.
 */
export async function computeAllMetrics(
  taskService: TaskService,
  telemetryDir: string,
  period: MetricsPeriod = '24h',
  project?: string
): Promise<{
  tasks: TaskMetrics;
  runs: RunMetrics;
  tokens: TokenMetrics;
  duration: DurationMetrics;
  trends: TrendComparison;
}> {
  const since = getPeriodStart(period);
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
          if (event.timestamp < since) continue;
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
              if (runEvent.success) {
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
        console.error(`[Metrics] Error reading ${filePath}:`, error.message);
      }
    }
  }

  // Get task metrics (separate query, always fast)
  const tasks = await computeTaskMetrics(taskService, project);

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
  const previousRange = getPreviousPeriodRange(period);
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
            if (runEvent.success) prevSuccesses++;
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
        console.error(`[Metrics] Error reading ${filePath}:`, error.message);
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
  period: '7d' | '30d',
  project?: string
): Promise<TrendsData> {
  const since = getPeriodStart(period);
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
    }
  >();

  // Initialize all days in the period
  const startDate = new Date(since);
  const endDate = new Date();
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
          if (event.timestamp < since) continue;
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
            });
          }
          const dayAcc = dailyData.get(dateStr)!;

          if (event.type === 'run.completed') {
            const runEvent = event as RunTelemetryEvent;
            dayAcc.runs++;
            if (runEvent.success) {
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
          }
        } catch {
          // Intentionally silent: skip malformed NDJSON line
          continue;
        }
      }
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        console.error(`[Metrics] Error reading ${filePath}:`, error.message);
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
      avgDurationMs,
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

          if (event.timestamp < since) continue;
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
              if (runEvent.success) {
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
            // Cost estimate: $0.01/1K input, $0.03/1K output
            acc.costEstimate +=
              (tokenEvent.inputTokens / 1000) * 0.01 + (tokenEvent.outputTokens / 1000) * 0.03;
          }
        } catch {
          // Intentionally silent: skip malformed NDJSON line
          continue;
        }
      }
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        console.error(`[Metrics] Error reading ${filePath}:`, error.message);
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
