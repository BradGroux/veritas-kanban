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
  tokensPerRun: number[];
  byAgent: Map<string, {
    totalTokens: number;
    inputTokens: number;
    outputTokens: number;
    runs: number;
  }>;
}

// Default paths - resolve to project root
const PROJECT_ROOT = path.resolve(process.cwd(), '..');
const TELEMETRY_DIR = path.join(PROJECT_ROOT, '.veritas-kanban', 'telemetry');

export interface FailedRunDetails {
  timestamp: string;
  taskId?: string;
  taskTitle?: string;
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

        acc.totalTokens += totalTokens;
        acc.inputTokens += tokenEvent.inputTokens;
        acc.outputTokens += tokenEvent.outputTokens;
        acc.tokensPerRun.push(totalTokens);

        if (!acc.byAgent.has(agent)) {
          acc.byAgent.set(agent, { totalTokens: 0, inputTokens: 0, outputTokens: 0, runs: 0 });
        }
        const agentAcc = acc.byAgent.get(agent)!;
        agentAcc.totalTokens += totalTokens;
        agentAcc.inputTokens += tokenEvent.inputTokens;
        agentAcc.outputTokens += tokenEvent.outputTokens;
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

              tokenAcc.totalTokens += totalTokens;
              tokenAcc.inputTokens += tokenEvent.inputTokens;
              tokenAcc.outputTokens += tokenEvent.outputTokens;
              tokenAcc.tokensPerRun.push(totalTokens);

              if (!tokenAcc.byAgent.has(agent)) {
                tokenAcc.byAgent.set(agent, { totalTokens: 0, inputTokens: 0, outputTokens: 0, runs: 0 });
              }
              const agentTokenAcc = tokenAcc.byAgent.get(agent)!;
              agentTokenAcc.totalTokens += totalTokens;
              agentTokenAcc.inputTokens += tokenEvent.inputTokens;
              agentTokenAcc.outputTokens += tokenEvent.outputTokens;
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
        runs: data.runs,
      });
    }
    tokenByAgent.sort((a, b) => b.totalTokens - a.totalTokens);

    const tokens: TokenMetrics = {
      period,
      totalTokens: tokenAcc.totalTokens,
      inputTokens: tokenAcc.inputTokens,
      outputTokens: tokenAcc.outputTokens,
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

    return { tasks, runs, tokens, duration };
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
                taskTitle: runEvent.taskTitle,
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

// Singleton instance
let instance: MetricsService | null = null;

export function getMetricsService(): MetricsService {
  if (!instance) {
    instance = new MetricsService();
  }
  return instance;
}
