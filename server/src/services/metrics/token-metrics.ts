/**
 * Token-related metrics: token usage and budget tracking.
 */
import type { TokenTelemetryEvent, AnyTelemetryEvent } from '@veritas-kanban/shared';
import { getPeriodStart, percentile } from './helpers.js';
import { getEventFiles, streamEvents, createLineReader } from './telemetry-reader.js';
import type { MetricsPeriod, TokenMetrics, TokenAccumulator, BudgetMetrics } from './types.js';
import { createLogger } from '../../lib/logger.js';
const log = createLogger('token-metrics');

/**
 * Get token metrics with per-agent breakdown
 */
export async function computeTokenMetrics(
  telemetryDir: string,
  period: MetricsPeriod,
  project?: string,
  from?: string,
  to?: string
): Promise<TokenMetrics> {
  const since = getPeriodStart(period, from);
  const files = await getEventFiles(telemetryDir, since);

  const accumulator: TokenAccumulator = {
    totalTokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheTokens: 0,
    tokensPerRun: [],
    byAgent: new Map(),
  };

  await streamEvents(
    files,
    ['run.tokens'],
    since,
    project,
    accumulator,
    (event, acc) => {
      const tokenEvent = event as TokenTelemetryEvent;
      const agent = tokenEvent.agent || 'veritas';
      // Calculate totalTokens if not provided
      const totalTokens =
        tokenEvent.totalTokens ?? tokenEvent.inputTokens + tokenEvent.outputTokens;
      const cacheTokens = tokenEvent.cacheTokens ?? 0;

      acc.totalTokens += totalTokens;
      acc.inputTokens += tokenEvent.inputTokens;
      acc.outputTokens += tokenEvent.outputTokens;
      acc.cacheTokens += cacheTokens;
      acc.tokensPerRun.push(totalTokens);

      if (!acc.byAgent.has(agent)) {
        acc.byAgent.set(agent, {
          totalTokens: 0,
          inputTokens: 0,
          outputTokens: 0,
          cacheTokens: 0,
          runs: 0,
        });
      }
      const agentAcc = acc.byAgent.get(agent)!;
      agentAcc.totalTokens += totalTokens;
      agentAcc.inputTokens += tokenEvent.inputTokens;
      agentAcc.outputTokens += tokenEvent.outputTokens;
      agentAcc.cacheTokens += cacheTokens;
      agentAcc.runs++;
    },
    to
  );

  // Sort for percentile calculations
  accumulator.tokensPerRun.sort((a, b) => a - b);

  const runs = accumulator.tokensPerRun.length;
  const avg = runs > 0 ? accumulator.totalTokens / runs : 0;
  const p50 = percentile(accumulator.tokensPerRun, 50);
  const p95 = percentile(accumulator.tokensPerRun, 95);

  // Build per-agent breakdown
  const byAgent: TokenMetrics['byAgent'] = [];
  for (const [agent, data] of accumulator.byAgent.entries()) {
    byAgent.push({
      agent,
      totalTokens: data.totalTokens,
      inputTokens: data.inputTokens,
      outputTokens: data.outputTokens,
      cacheTokens: data.cacheTokens,
      runs: data.runs,
    });
  }

  // Sort by totalTokens descending
  byAgent.sort((a, b) => b.totalTokens - a.totalTokens);

  return {
    period,
    totalTokens: accumulator.totalTokens,
    inputTokens: accumulator.inputTokens,
    outputTokens: accumulator.outputTokens,
    cacheTokens: accumulator.cacheTokens,
    runs,
    perSuccessfulRun: {
      avg: Math.round(avg),
      p50,
      p95,
    },
    byAgent,
  };
}

/**
 * Get monthly budget metrics for the current month
 */
export async function computeBudgetMetrics(
  telemetryDir: string,
  tokenBudget: number,
  costBudget: number,
  warningThreshold: number,
  project?: string
): Promise<BudgetMetrics> {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();

  // Calculate period boundaries
  const periodStart = new Date(year, month, 1);
  const periodEnd = new Date(year, month + 1, 0); // Last day of month
  const daysInMonth = periodEnd.getDate();
  const daysElapsed = now.getDate();
  const daysRemaining = daysInMonth - daysElapsed;

  const since = periodStart.toISOString();
  const files = await getEventFiles(telemetryDir, since);

  // Token accumulator
  let totalTokens = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let reportedCost = 0; // Sum of event.cost when available (preferred over estimation)

  // Stream through files for current month only
  for (const filePath of files) {
    try {
      const rl = createLineReader(filePath);

      for await (const line of rl) {
        if (!line.trim()) continue;

        try {
          const event = JSON.parse(line) as AnyTelemetryEvent;

          // Filter to current month and token events only
          if (event.type !== 'run.tokens') continue;
          if (event.timestamp < since) continue;
          if (project && event.project !== project) continue;

          const tokenEvent = event as TokenTelemetryEvent;
          const eventTotal =
            tokenEvent.totalTokens ?? tokenEvent.inputTokens + tokenEvent.outputTokens;

          totalTokens += eventTotal;
          inputTokens += tokenEvent.inputTokens;
          outputTokens += tokenEvent.outputTokens;
          // Use the reported cost if available (preferred over estimated)
          if (typeof (tokenEvent as unknown as Record<string, unknown>).cost === 'number') {
            reportedCost += (tokenEvent as unknown as Record<string, unknown>).cost as number;
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

  // Cost: prefer reported cost from events; fall back to estimation
  // Fallback rates: Input $0.01/1K, Output $0.03/1K (rough average across models)
  const fallbackCost = (inputTokens / 1000) * 0.01 + (outputTokens / 1000) * 0.03;
  const estimatedCost = reportedCost > 0 ? reportedCost : fallbackCost;

  // Burn rate calculations
  const tokensPerDay = daysElapsed > 0 ? totalTokens / daysElapsed : 0;
  const costPerDay = daysElapsed > 0 ? estimatedCost / daysElapsed : 0;

  // Projections
  const projectedMonthlyTokens = Math.round(tokensPerDay * daysInMonth);
  const projectedMonthlyCost = costPerDay * daysInMonth;

  // Budget percentages
  const tokenBudgetUsed = tokenBudget > 0 ? (totalTokens / tokenBudget) * 100 : 0;
  const costBudgetUsed = costBudget > 0 ? (estimatedCost / costBudget) * 100 : 0;
  const projectedTokenOverage = tokenBudget > 0 ? (projectedMonthlyTokens / tokenBudget) * 100 : 0;
  const projectedCostOverage = costBudget > 0 ? (projectedMonthlyCost / costBudget) * 100 : 0;

  // Determine status based on highest usage percentage
  let status: 'ok' | 'warning' | 'danger' = 'ok';
  const maxUsage = Math.max(
    tokenBudget > 0 ? tokenBudgetUsed : 0,
    costBudget > 0 ? costBudgetUsed : 0,
    tokenBudget > 0 ? projectedTokenOverage : 0,
    costBudget > 0 ? projectedCostOverage : 0
  );

  if (maxUsage >= 100) {
    status = 'danger';
  } else if (maxUsage >= warningThreshold) {
    status = 'warning';
  }

  return {
    periodStart: periodStart.toISOString().slice(0, 10),
    periodEnd: periodEnd.toISOString().slice(0, 10),
    daysInMonth,
    daysElapsed,
    daysRemaining,
    totalTokens,
    inputTokens,
    outputTokens,
    estimatedCost: Math.round(estimatedCost * 100) / 100,
    tokensPerDay: Math.round(tokensPerDay),
    costPerDay: Math.round(costPerDay * 100) / 100,
    projectedMonthlyTokens,
    projectedMonthlyCost: Math.round(projectedMonthlyCost * 100) / 100,
    tokenBudget,
    costBudget,
    tokenBudgetUsed: Math.round(tokenBudgetUsed * 10) / 10,
    costBudgetUsed: Math.round(costBudgetUsed * 10) / 10,
    projectedTokenOverage: Math.round(projectedTokenOverage * 10) / 10,
    projectedCostOverage: Math.round(projectedCostOverage * 10) / 10,
    status,
  };
}
