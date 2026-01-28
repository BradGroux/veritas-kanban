import { createReadStream } from 'fs';
import fs from 'fs/promises';
import path from 'path';
import readline from 'readline';
import { getTelemetryService, type TelemetryService } from './telemetry-service.js';
import { TaskService } from './task-service.js';
import type { 
  TaskStatus, 
  BlockedCategory,
  RunTelemetryEvent, 
  TokenTelemetryEvent,
  AnyTelemetryEvent,
  TelemetryEventType,
} from '@veritas-kanban/shared';

export type MetricsPeriod = '24h' | '7d' | '30d';

export interface TaskMetrics {
  byStatus: Record<TaskStatus, number>;
  byBlockedReason: Record<BlockedCategory | 'unspecified', number>;
  total: number;
  completed: number;  // done + archived
  archived: number;
}

export interface AgentBreakdown {
  agent: string;
  runs: number;
  successes: number;
  failures: number;
  errors: number;
  successRate: number;
  avgDurationMs: number;
  totalTokens: number;
}

export interface RunMetrics {
  period: MetricsPeriod;
  runs: number;
  successes: number;
  failures: number;
  errors: number;
  errorRate: number;   // (failures + errors) / runs
  successRate: number; // successes / runs
  byAgent: AgentBreakdown[];
}

export interface TokenMetrics {
  period: MetricsPeriod;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  runs: number;
  perSuccessfulRun: {
    avg: number;
    p50: number;
    p95: number;
  };
  byAgent: Array<{
    agent: string;
    totalTokens: number;
    inputTokens: number;
    outputTokens: number;
    cacheTokens: number;
    runs: number;
  }>;
}

export interface DurationMetrics {
  period: MetricsPeriod;
  runs: number;
  avgMs: number;
  p50Ms: number;
  p95Ms: number;
  byAgent: Array<{
    agent: string;
    runs: number;
    avgMs: number;
    p50Ms: number;
    p95Ms: number;
  }>;
}

// Trend direction: positive means improvement (more runs, higher success, etc.)
export type TrendDirection = 'up' | 'down' | 'flat';

export interface TrendComparison {
  runsTrend: TrendDirection;
  runsChange: number; // percentage change
  successRateTrend: TrendDirection;
  successRateChange: number;
  tokensTrend: TrendDirection;
  tokensChange: number;
  durationTrend: TrendDirection;
  durationChange: number;
}

// Internal accumulator types for streaming
interface RunAccumulator {
  successes: number;
  failures: number;
  errors: number;
  durations: number[];
  byAgent: Map<string, {
    successes: number;
    failures: number;
    errors: number;
    durations: number[];
  }>;
}

interface TokenAccumulator {
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  tokensPerRun: number[];
  byAgent: Map<string, {
    totalTokens: number;
    inputTokens: number;
    outputTokens: number;
    cacheTokens: number;
    runs: number;
  }>;
}

// Default paths - resolve to project root
const PROJECT_ROOT = path.resolve(process.cwd(), '..');
const TELEMETRY_DIR = path.join(PROJECT_ROOT, '.veritas-kanban', 'telemetry');

export interface FailedRunDetails {
  timestamp: string;
  taskId?: string;
  project?: string;
  agent: string;
  success: boolean;
  errorMessage?: string;
  durationMs?: number;
}

export class MetricsService {
  private telemetry: TelemetryService;
  private taskService: TaskService;
  private telemetryDir: string;

  constructor(telemetryDir?: string) {
    this.telemetry = getTelemetryService();
    this.taskService = new TaskService();
    this.telemetryDir = telemetryDir || TELEMETRY_DIR;
  }

  /**
   * Get timestamp for start of period
   */
  private getPeriodStart(period: MetricsPeriod): string {
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
  private getPreviousPeriodRange(period: MetricsPeriod): { since: string; until: string } {
    const now = new Date();
    const periodMs = period === '24h' ? 24 * 60 * 60 * 1000 
      : period === '7d' ? 7 * 24 * 60 * 60 * 1000 
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
  private calculateTrend(current: number, previous: number, higherIsBetter = true): TrendDirection {
    if (previous === 0) return current > 0 ? 'up' : 'flat';
    const changePercent = ((current - previous) / previous) * 100;
    if (Math.abs(changePercent) < 5) return 'flat'; // Less than 5% change is flat
    const isUp = current > previous;
    // For metrics where lower is better (like duration), invert the logic
    return higherIsBetter ? (isUp ? 'up' : 'down') : (isUp ? 'down' : 'up');
  }

  /**
   * Calculate percentage change
   */
  private calculateChange(current: number, previous: number): number {
    if (previous === 0) return current > 0 ? 100 : 0;
    return Math.round(((current - previous) / previous) * 100);
  }

  /**
   * Calculate percentile from sorted array
   */
  private percentile(sorted: number[], p: number): number {
    if (sorted.length === 0) return 0;
    const index = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)];
  }

  /**
   * Get list of event files within a date range
   */
  private async getEventFiles(since: string): Promise<string[]> {
    try {
      const files = await fs.readdir(this.telemetryDir);
      const eventFiles = files.filter((f) => f.startsWith('events-') && f.endsWith('.ndjson'));
      const sinceDate = since.slice(0, 10);

      return eventFiles
        .filter((filename) => {
          const match = filename.match(/events-(\d{4}-\d{2}-\d{2})\.ndjson/);
          if (!match) return false;
          return match[1] >= sinceDate;
        })
        .map((f) => path.join(this.telemetryDir, f));
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  /**
   * Stream events from NDJSON files with filtering
   * Performance-optimized: reads line by line, filters early, accumulates in memory-efficient way
   */
  private async streamEvents<T>(
    files: string[],
    types: TelemetryEventType[],
    since: string,
    project: string | undefined,
    accumulator: T,
    handler: (event: AnyTelemetryEvent, acc: T) => void
  ): Promise<T> {
    for (const filePath of files) {
      try {
        const fileStream = createReadStream(filePath, { encoding: 'utf-8' });
        const rl = readline.createInterface({
          input: fileStream,
          crlfDelay: Infinity,
        });

        for await (const line of rl) {
          if (!line.trim()) continue;

          try {
            const event = JSON.parse(line) as AnyTelemetryEvent;

            // Early filtering for performance
            if (!types.includes(event.type)) continue;
            if (event.timestamp < since) continue;
            if (project && event.project !== project) continue;

            handler(event, accumulator);
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

    return accumulator;
  }

  /**
   * Get task counts by status
   */
  async getTaskMetrics(project?: string): Promise<TaskMetrics> {
    const [activeTasks, archivedTasks] = await Promise.all([
      this.taskService.listTasks(),
      this.taskService.listArchivedTasks(),
    ]);

    // Filter by project if specified
    const filteredActive = project 
      ? activeTasks.filter(t => t.project === project)
      : activeTasks;
    const filteredArchived = project
      ? archivedTasks.filter(t => t.project === project)
      : archivedTasks;

    // Count by status
    const byStatus: Record<TaskStatus, number> = {
      'todo': 0,
      'in-progress': 0,
      'blocked': 0,
      'done': 0,
    };

    // Count by blocked reason
    const byBlockedReason: Record<BlockedCategory | 'unspecified', number> = {
      'waiting-on-feedback': 0,
      'technical-snag': 0,
      'prerequisite': 0,
      'other': 0,
      'unspecified': 0,
    };

    for (const task of filteredActive) {
      byStatus[task.status]++;
      
      // Count blocked reasons for blocked tasks
      if (task.status === 'blocked') {
        if (task.blockedReason?.category) {
          byBlockedReason[task.blockedReason.category]++;
        } else {
          byBlockedReason['unspecified']++;
        }
      }
    }

    const archived = filteredArchived.length;
    const total = filteredActive.length + archived;
    const completed = byStatus['done'] + archived;

    return {
      byStatus,
      byBlockedReason,
      total,
      completed,
      archived,
    };
  }

  /**
   * Get run metrics (error rate, success rate) with per-agent breakdown
   */
  async getRunMetrics(period: MetricsPeriod, project?: string): Promise<RunMetrics> {
    const since = this.getPeriodStart(period);
    const files = await this.getEventFiles(since);

    const accumulator: RunAccumulator = {
      successes: 0,
      failures: 0,
      errors: 0,
      durations: [],
      byAgent: new Map(),
    };

    await this.streamEvents(
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
          if (runEvent.success) {
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
      }
    );

    const runs = accumulator.successes + accumulator.failures + accumulator.errors;
    const errorRate = runs > 0 ? (accumulator.failures + accumulator.errors) / runs : 0;
    const successRate = runs > 0 ? accumulator.successes / runs : 0;

    // Build per-agent breakdown
    const byAgent: AgentBreakdown[] = [];
    for (const [agent, data] of accumulator.byAgent.entries()) {
      const agentRuns = data.successes + data.failures + data.errors;
      const avgDuration = data.durations.length > 0
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
   * Get token metrics with per-agent breakdown
   */
  async getTokenMetrics(period: MetricsPeriod, project?: string): Promise<TokenMetrics> {
    const since = this.getPeriodStart(period);
    const files = await this.getEventFiles(since);

    const accumulator: TokenAccumulator = {
      totalTokens: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheTokens: 0,
      tokensPerRun: [],
      byAgent: new Map(),
    };

    await this.streamEvents(
      files,
      ['run.tokens'],
      since,
      project,
      accumulator,
      (event, acc) => {
        const tokenEvent = event as TokenTelemetryEvent;
        const agent = tokenEvent.agent || 'veritas';
        // Calculate totalTokens if not provided
        const totalTokens = tokenEvent.totalTokens ?? (tokenEvent.inputTokens + tokenEvent.outputTokens);
        const cacheTokens = tokenEvent.cacheTokens ?? 0;

        acc.totalTokens += totalTokens;
        acc.inputTokens += tokenEvent.inputTokens;
        acc.outputTokens += tokenEvent.outputTokens;
        acc.cacheTokens += cacheTokens;
        acc.tokensPerRun.push(totalTokens);

        if (!acc.byAgent.has(agent)) {
          acc.byAgent.set(agent, { totalTokens: 0, inputTokens: 0, outputTokens: 0, cacheTokens: 0, runs: 0 });
        }
        const agentAcc = acc.byAgent.get(agent)!;
        agentAcc.totalTokens += totalTokens;
        agentAcc.inputTokens += tokenEvent.inputTokens;
        agentAcc.outputTokens += tokenEvent.outputTokens;
        agentAcc.cacheTokens += cacheTokens;
        agentAcc.runs++;
      }
    );

    // Sort for percentile calculations
    accumulator.tokensPerRun.sort((a, b) => a - b);

    const runs = accumulator.tokensPerRun.length;
    const avg = runs > 0 ? accumulator.totalTokens / runs : 0;
    const p50 = this.percentile(accumulator.tokensPerRun, 50);
    const p95 = this.percentile(accumulator.tokensPerRun, 95);

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
   * Get duration metrics with per-agent breakdown
   */
  async getDurationMetrics(period: MetricsPeriod, project?: string): Promise<DurationMetrics> {
    const since = this.getPeriodStart(period);
    const files = await this.getEventFiles(since);

    const accumulator = {
      durations: [] as number[],
      byAgent: new Map<string, number[]>(),
    };

    await this.streamEvents(
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
      }
    );

    // Sort for percentile calculations
    accumulator.durations.sort((a, b) => a - b);

    const runs = accumulator.durations.length;
    const sum = accumulator.durations.reduce((a, b) => a + b, 0);
    const avgMs = runs > 0 ? Math.round(sum / runs) : 0;
    const p50Ms = this.percentile(accumulator.durations, 50);
    const p95Ms = this.percentile(accumulator.durations, 95);

    // Build per-agent breakdown
    const byAgent: DurationMetrics['byAgent'] = [];
    for (const [agent, durations] of accumulator.byAgent.entries()) {
      durations.sort((a, b) => a - b);
      const agentSum = durations.reduce((a, b) => a + b, 0);
      
      byAgent.push({
        agent,
        runs: durations.length,
        avgMs: durations.length > 0 ? Math.round(agentSum / durations.length) : 0,
        p50Ms: this.percentile(durations, 50),
        p95Ms: this.percentile(durations, 95),
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
   * Get all metrics in one call (for dashboard)
   * Optimized: streams files once and extracts all metrics in single pass
   */
  async getAllMetrics(period: MetricsPeriod = '24h', project?: string): Promise<{
    tasks: TaskMetrics;
    runs: RunMetrics;
    tokens: TokenMetrics;
    duration: DurationMetrics;
    trends: TrendComparison;
  }> {
    const since = this.getPeriodStart(period);
    const files = await this.getEventFiles(since);

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
        const fileStream = createReadStream(filePath, { encoding: 'utf-8' });
        const rl = readline.createInterface({
          input: fileStream,
          crlfDelay: Infinity,
        });

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
              const totalTokens = tokenEvent.totalTokens ?? (tokenEvent.inputTokens + tokenEvent.outputTokens);
              const cacheTokens = tokenEvent.cacheTokens ?? 0;

              tokenAcc.totalTokens += totalTokens;
              tokenAcc.inputTokens += tokenEvent.inputTokens;
              tokenAcc.outputTokens += tokenEvent.outputTokens;
              tokenAcc.cacheTokens += cacheTokens;
              tokenAcc.tokensPerRun.push(totalTokens);

              if (!tokenAcc.byAgent.has(agent)) {
                tokenAcc.byAgent.set(agent, { totalTokens: 0, inputTokens: 0, outputTokens: 0, cacheTokens: 0, runs: 0 });
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
    const tasks = await this.getTaskMetrics(project);

    // Build run metrics
    const totalRuns = runAcc.successes + runAcc.failures + runAcc.errors;
    const runByAgent: AgentBreakdown[] = [];
    for (const [agent, data] of runAcc.byAgent.entries()) {
      const agentRuns = data.successes + data.failures + data.errors;
      const avgDuration = data.durations.length > 0
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
        p50: this.percentile(tokenAcc.tokensPerRun, 50),
        p95: this.percentile(tokenAcc.tokensPerRun, 95),
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
        p50Ms: this.percentile(data.durations, 50),
        p95Ms: this.percentile(data.durations, 95),
      });
    }
    durationByAgent.sort((a, b) => b.runs - a.runs);

    const durationSum = runAcc.durations.reduce((a, b) => a + b, 0);
    const duration: DurationMetrics = {
      period,
      runs: runAcc.durations.length,
      avgMs: runAcc.durations.length > 0 ? Math.round(durationSum / runAcc.durations.length) : 0,
      p50Ms: this.percentile(runAcc.durations, 50),
      p95Ms: this.percentile(runAcc.durations, 95),
      byAgent: durationByAgent,
    };

    // Calculate trends by comparing with previous period
    const previousRange = this.getPreviousPeriodRange(period);
    const previousFiles = await this.getEventFiles(previousRange.since);
    
    // Quick accumulator for previous period (runs, tokens, duration only)
    let prevRuns = 0, prevSuccesses = 0, prevTokens = 0, prevDurationSum = 0, prevDurationCount = 0;
    
    for (const filePath of previousFiles) {
      try {
        const fileStream = createReadStream(filePath, { encoding: 'utf-8' });
        const rl = readline.createInterface({
          input: fileStream,
          crlfDelay: Infinity,
        });

        for await (const line of rl) {
          if (!line.trim()) continue;
          try {
            const event = JSON.parse(line) as AnyTelemetryEvent;
            if (event.timestamp < previousRange.since || event.timestamp >= previousRange.until) continue;
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
              prevTokens += tokenEvent.totalTokens ?? (tokenEvent.inputTokens + tokenEvent.outputTokens);
            }
          } catch {
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
      runsTrend: this.calculateTrend(runs.runs, prevRuns, true),
      runsChange: this.calculateChange(runs.runs, prevRuns),
      successRateTrend: this.calculateTrend(runs.successRate, prevSuccessRate, true),
      successRateChange: this.calculateChange(runs.successRate * 100, prevSuccessRate * 100),
      tokensTrend: this.calculateTrend(tokens.totalTokens, prevTokens, false), // Lower is better
      tokensChange: this.calculateChange(tokens.totalTokens, prevTokens),
      durationTrend: this.calculateTrend(duration.avgMs, prevAvgDuration, false), // Lower is better
      durationChange: this.calculateChange(duration.avgMs, prevAvgDuration),
    };

    return { tasks, runs, tokens, duration, trends };
  }

  /**
   * Get historical trends data aggregated by day
   */
  async getTrends(period: '7d' | '30d', project?: string): Promise<TrendsData> {
    const since = this.getPeriodStart(period);
    const files = await this.getEventFiles(since);

    // Accumulator per day
    const dailyData = new Map<string, {
      runs: number;
      successes: number;
      failures: number;
      errors: number;
      totalTokens: number;
      inputTokens: number;
      outputTokens: number;
      durations: number[];
    }>();

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
        const fileStream = createReadStream(filePath, { encoding: 'utf-8' });
        const rl = readline.createInterface({
          input: fileStream,
          crlfDelay: Infinity,
        });

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
              const totalTokens = tokenEvent.totalTokens ?? (tokenEvent.inputTokens + tokenEvent.outputTokens);
              dayAcc.totalTokens += totalTokens;
              dayAcc.inputTokens += tokenEvent.inputTokens;
              dayAcc.outputTokens += tokenEvent.outputTokens;
            }
          } catch {
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
      const avgDurationMs = data.durations.length > 0
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
   * Get monthly budget metrics for the current month
   */
  async getBudgetMetrics(tokenBudget: number, costBudget: number, warningThreshold: number, project?: string): Promise<BudgetMetrics> {
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
    const files = await this.getEventFiles(since);

    // Token accumulator
    let totalTokens = 0;
    let inputTokens = 0;
    let outputTokens = 0;

    // Stream through files for current month only
    for (const filePath of files) {
      try {
        const fileStream = createReadStream(filePath, { encoding: 'utf-8' });
        const rl = readline.createInterface({
          input: fileStream,
          crlfDelay: Infinity,
        });

        for await (const line of rl) {
          if (!line.trim()) continue;

          try {
            const event = JSON.parse(line) as AnyTelemetryEvent;

            // Filter to current month and token events only
            if (event.type !== 'run.tokens') continue;
            if (event.timestamp < since) continue;
            if (project && event.project !== project) continue;

            const tokenEvent = event as TokenTelemetryEvent;
            const eventTotal = tokenEvent.totalTokens ?? (tokenEvent.inputTokens + tokenEvent.outputTokens);
            
            totalTokens += eventTotal;
            inputTokens += tokenEvent.inputTokens;
            outputTokens += tokenEvent.outputTokens;
          } catch {
            continue;
          }
        }
      } catch (error: any) {
        if (error.code !== 'ENOENT') {
          console.error(`[Metrics] Error reading ${filePath}:`, error.message);
        }
      }
    }

    // Cost estimation (simplified pricing model)
    // Input: $0.01 per 1K tokens, Output: $0.03 per 1K tokens
    const estimatedCost = (inputTokens / 1000 * 0.01) + (outputTokens / 1000 * 0.03);
    
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

  /**
   * Get agent comparison metrics for recommendations
   * Aggregates performance data per agent with minimum run threshold
   */
  async getAgentComparison(period: MetricsPeriod, project?: string, minRuns = 3): Promise<AgentComparisonResult> {
    const since = this.getPeriodStart(period);
    const files = await this.getEventFiles(since);

    // Per-agent accumulator
    const agentData = new Map<string, {
      runs: number;
      successes: number;
      failures: number;
      errors: number;
      durations: number[];
      totalTokens: number;
      inputTokens: number;
      outputTokens: number;
      costEstimate: number;
    }>();

    // Process all files
    for (const filePath of files) {
      try {
        const fileStream = createReadStream(filePath, { encoding: 'utf-8' });
        const rl = readline.createInterface({
          input: fileStream,
          crlfDelay: Infinity,
        });

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
              const totalTokens = tokenEvent.totalTokens ?? (tokenEvent.inputTokens + tokenEvent.outputTokens);
              
              acc.totalTokens += totalTokens;
              acc.inputTokens += tokenEvent.inputTokens;
              acc.outputTokens += tokenEvent.outputTokens;
              // Cost estimate: $0.01/1K input, $0.03/1K output
              acc.costEstimate += (tokenEvent.inputTokens / 1000 * 0.01) + (tokenEvent.outputTokens / 1000 * 0.03);
            }
          } catch {
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

      const avgDurationMs = data.durations.length > 0
        ? Math.round(data.durations.reduce((a, b) => a + b, 0) / data.durations.length)
        : 0;
      const successRate = data.runs > 0 ? data.successes / data.runs : 0;
      const avgTokensPerRun = data.runs > 0 ? Math.round(data.totalTokens / data.runs) : 0;
      const avgCostPerRun = data.runs > 0 ? Math.round((data.costEstimate / data.runs) * 100) / 100 : 0;

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
      const fastest = [...agents].filter(a => a.avgDurationMs > 0).sort((a, b) => a.avgDurationMs - b.avgDurationMs)[0];
      if (fastest) {
        recommendations.push({
          category: 'speed',
          agent: fastest.agent,
          value: this.formatDurationForRecommendation(fastest.avgDurationMs),
          reason: 'Shortest average run duration',
        });
      }

      // Cheapest (lowest avg cost)
      const cheapest = [...agents].filter(a => a.avgCostPerRun > 0).sort((a, b) => a.avgCostPerRun - b.avgCostPerRun)[0];
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
        .filter(a => a.successes > 0)
        .map(a => ({
          ...a,
          tokensPerSuccess: Math.round(a.totalTokens / a.successes),
        }))
        .sort((a, b) => a.tokensPerSuccess - b.tokensPerSuccess);
      
      if (efficientAgents.length > 0) {
        const mostEfficient = efficientAgents[0];
        recommendations.push({
          category: 'efficiency',
          agent: mostEfficient.agent,
          value: `${this.formatTokensForRecommendation(mostEfficient.tokensPerSuccess)}/success`,
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
   * Format duration for recommendation display
   */
  private formatDurationForRecommendation(ms: number): string {
    if (ms < 60000) return `${Math.round(ms / 1000)}s`;
    if (ms < 3600000) return `${Math.round(ms / 60000)}m`;
    return `${(ms / 3600000).toFixed(1)}h`;
  }

  /**
   * Format tokens for recommendation display
   */
  private formatTokensForRecommendation(tokens: number): string {
    if (tokens < 1000) return `${tokens}`;
    if (tokens < 1000000) return `${(tokens / 1000).toFixed(1)}K`;
    return `${(tokens / 1000000).toFixed(2)}M`;
  }

  /**
   * Get sprint velocity metrics
   * Calculates tasks completed per sprint with rolling average and trend
   */
  async getVelocityMetrics(project?: string, limit = 10): Promise<VelocityMetrics> {
    // Get all tasks (active + archived) to calculate velocity
    const [activeTasks, archivedTasks] = await Promise.all([
      this.taskService.listTasks(),
      this.taskService.listArchivedTasks(),
    ]);

    // Filter by project if specified
    const allTasks = [...activeTasks, ...archivedTasks]
      .filter(t => !project || t.project === project);

    // Group tasks by sprint
    const sprintData = new Map<string, {
      completed: number;
      total: number;
      byType: Record<string, number>;
    }>();

    for (const task of allTasks) {
      if (!task.sprint) continue;

      if (!sprintData.has(task.sprint)) {
        sprintData.set(task.sprint, { completed: 0, total: 0, byType: {} });
      }

      const data = sprintData.get(task.sprint)!;
      data.total++;
      
      // Count completed tasks (done or archived)
      const isCompleted = task.status === 'done' || archivedTasks.some(a => a.id === task.id);
      if (isCompleted) {
        data.completed++;
        
        // Track by type
        const taskType = task.type || 'other';
        data.byType[taskType] = (data.byType[taskType] || 0) + 1;
      }
    }

    // Sort sprints by label (assumes sprint labels are sortable like "US-100", "US-200", etc.)
    const sortedSprints = [...sprintData.entries()]
      .sort((a, b) => {
        // Extract numeric part for better sorting
        const numA = parseInt(a[0].replace(/\D/g, ''), 10) || 0;
        const numB = parseInt(b[0].replace(/\D/g, ''), 10) || 0;
        return numA - numB;
      })
      .slice(-limit); // Keep only the most recent sprints

    // Calculate velocity for each sprint
    const sprints: SprintVelocityPoint[] = [];
    const completedCounts: number[] = [];

    for (const [sprint, data] of sortedSprints) {
      completedCounts.push(data.completed);
      
      // Calculate rolling average (last 3 sprints)
      const recentCompleted = completedCounts.slice(-3);
      const rollingAverage = recentCompleted.length > 0
        ? Math.round((recentCompleted.reduce((a, b) => a + b, 0) / recentCompleted.length) * 10) / 10
        : 0;

      sprints.push({
        sprint,
        completed: data.completed,
        total: data.total,
        rollingAverage,
        byType: data.byType,
      });
    }

    // Calculate overall metrics
    const totalCompleted = completedCounts.reduce((a, b) => a + b, 0);
    const averageVelocity = sprints.length > 0
      ? Math.round((totalCompleted / sprints.length) * 10) / 10
      : 0;

    // Determine trend (comparing last 3 vs previous 3)
    let trend: VelocityTrend = 'steady';
    if (sprints.length >= 4) {
      const recentSprints = sprints.slice(-3);
      const previousSprints = sprints.slice(-6, -3);
      
      if (previousSprints.length >= 2) {
        const recentAvg = recentSprints.reduce((a, b) => a + b.completed, 0) / recentSprints.length;
        const previousAvg = previousSprints.reduce((a, b) => a + b.completed, 0) / previousSprints.length;
        
        const changePercent = previousAvg > 0 ? ((recentAvg - previousAvg) / previousAvg) * 100 : 0;
        
        if (changePercent > 10) {
          trend = 'accelerating';
        } else if (changePercent < -10) {
          trend = 'slowing';
        }
      }
    }

    // Get current sprint progress (find sprints with incomplete tasks)
    let currentSprint: CurrentSprintProgress | undefined;
    for (const [sprint, data] of [...sprintData.entries()].reverse()) {
      if (data.completed < data.total) {
        currentSprint = {
          sprint,
          completed: data.completed,
          total: data.total,
          percentComplete: data.total > 0 ? Math.round((data.completed / data.total) * 100) : 0,
          vsAverage: averageVelocity > 0
            ? Math.round(((data.completed - averageVelocity) / averageVelocity) * 100)
            : 0,
        };
        break;
      }
    }

    return {
      sprints,
      averageVelocity,
      trend,
      currentSprint,
    };
  }

  /**
   * Get list of failed runs with details
   */
  async getFailedRuns(period: MetricsPeriod, project?: string, limit = 50): Promise<FailedRunDetails[]> {
    const since = this.getPeriodStart(period);
    const files = await this.getEventFiles(since);

    const failedRuns: FailedRunDetails[] = [];

    for (const filePath of files) {
      try {
        const fileStream = createReadStream(filePath, { encoding: 'utf-8' });
        const rl = readline.createInterface({
          input: fileStream,
          crlfDelay: Infinity,
        });

        for await (const line of rl) {
          if (!line.trim()) continue;

          try {
            const event = JSON.parse(line) as AnyTelemetryEvent;

            // Filter by type and time
            if (event.type !== 'run.completed' && event.type !== 'run.error') continue;
            if (event.timestamp < since) continue;
            if (project && event.project !== project) continue;

            const runEvent = event as RunTelemetryEvent;
            
            // Only include failed runs
            if (event.type === 'run.error' || (event.type === 'run.completed' && !runEvent.success)) {
              failedRuns.push({
                timestamp: event.timestamp,
                taskId: runEvent.taskId,
                project: runEvent.project,
                agent: runEvent.agent || 'veritas',
                success: false,
                errorMessage: runEvent.error,
                durationMs: runEvent.durationMs,
              });
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

    // Sort by timestamp descending (most recent first) and limit
    return failedRuns
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, limit);
  }
}

export interface DailyTrendPoint {
  date: string; // YYYY-MM-DD
  runs: number;
  successes: number;
  failures: number;
  errors: number;
  successRate: number;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  avgDurationMs: number;
}

export interface TrendsData {
  period: '7d' | '30d';
  daily: DailyTrendPoint[];
}

export interface BudgetMetrics {
  periodStart: string;           // Start of current month (YYYY-MM-DD)
  periodEnd: string;             // End of current month (YYYY-MM-DD)
  daysInMonth: number;
  daysElapsed: number;
  daysRemaining: number;
  
  // Token usage
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  
  // Cost estimation (simplified: $0.01 per 1K tokens input, $0.03 per 1K output)
  estimatedCost: number;
  
  // Burn rate calculations
  tokensPerDay: number;          // Average tokens per day so far
  costPerDay: number;            // Average cost per day
  
  // Projections
  projectedMonthlyTokens: number;
  projectedMonthlyCost: number;
  
  // Budget status
  tokenBudget: number;           // From settings (0 = no limit)
  costBudget: number;            // From settings (0 = no limit)
  tokenBudgetUsed: number;       // Percentage used (0-100+)
  costBudgetUsed: number;        // Percentage used (0-100+)
  projectedTokenOverage: number; // Percentage of projected vs budget (0-100+)
  projectedCostOverage: number;  // Percentage of projected vs budget (0-100+)
  
  // Status indicator
  status: 'ok' | 'warning' | 'danger';  // Based on warningThreshold
}

/** Agent comparison data for a single agent */
export interface AgentComparisonData {
  agent: string;
  runs: number;
  successes: number;
  failures: number;
  successRate: number;           // Percentage (0-100)
  avgDurationMs: number;
  avgTokensPerRun: number;
  totalTokens: number;
  avgCostPerRun: number;         // Estimated cost per run
  totalCost: number;             // Total estimated cost
}

/** Recommendation for best agent in a category */
export interface AgentRecommendation {
  category: 'reliability' | 'speed' | 'cost' | 'efficiency';
  agent: string;
  value: string;                 // Human-readable value (e.g., "95.5%", "2.3m")
  reason: string;                // Explanation
}

/** Full agent comparison result */
export interface AgentComparisonResult {
  period: MetricsPeriod;
  minRuns: number;
  agents: AgentComparisonData[];
  recommendations: AgentRecommendation[];
  totalAgents: number;           // Total agents found (before minRuns filter)
  qualifyingAgents: number;      // Agents meeting minRuns threshold
}

// Sprint velocity types
export type VelocityTrend = 'accelerating' | 'steady' | 'slowing';

export interface SprintVelocityPoint {
  sprint: string;                    // Sprint identifier (e.g., "US-100")
  completed: number;                 // Tasks completed in this sprint
  total: number;                     // Total tasks in this sprint
  rollingAverage: number;            // 3-sprint rolling average at this point
  byType: Record<string, number>;    // Breakdown by task type
}

export interface CurrentSprintProgress {
  sprint: string;
  completed: number;
  total: number;
  percentComplete: number;           // 0-100
  vsAverage: number;                 // Percentage vs historical average (-100 to +100+)
}

export interface VelocityMetrics {
  sprints: SprintVelocityPoint[];    // Sprint data (oldest to newest)
  averageVelocity: number;           // Overall average tasks per sprint
  trend: VelocityTrend;              // Current trend indicator
  currentSprint?: CurrentSprintProgress; // Progress on current/active sprint
}

// Singleton instance
let instance: MetricsService | null = null;

export function getMetricsService(): MetricsService {
  if (!instance) {
    instance = new MetricsService();
  }
  return instance;
}
