/**
 * MetricsService - Thin facade that delegates to focused metric modules.
 * Maintains the original class API for backwards compatibility.
 */
import { getTelemetryService } from '../telemetry-service.js';
import { TaskService } from '../task-service.js';
import { TELEMETRY_DIR } from './helpers.js';
import { computeTaskMetrics, computeVelocityMetrics } from './task-metrics.js';
import { computeRunMetrics, computeDurationMetrics, computeFailedRuns } from './run-metrics.js';
import { computeTokenMetrics, computeBudgetMetrics } from './token-metrics.js';
import { computeAllMetrics, computeTrends, computeAgentComparison } from './dashboard-metrics.js';
import type {
  MetricsPeriod,
  TaskMetrics,
  RunMetrics,
  TokenMetrics,
  DurationMetrics,
  TrendComparison,
  TrendsData,
  BudgetMetrics,
  AgentComparisonResult,
  VelocityMetrics,
  FailedRunDetails,
} from './types.js';

export class MetricsService {
  private taskService: TaskService;
  private telemetryDir: string;

  constructor(telemetryDir?: string) {
    // Keep TelemetryService init for potential future use
    getTelemetryService();
    this.taskService = new TaskService();
    this.telemetryDir = telemetryDir || TELEMETRY_DIR;
  }

  async getTaskMetrics(project?: string): Promise<TaskMetrics> {
    return computeTaskMetrics(this.taskService, project);
  }

  async getRunMetrics(period: MetricsPeriod, project?: string): Promise<RunMetrics> {
    return computeRunMetrics(this.telemetryDir, period, project);
  }

  async getTokenMetrics(period: MetricsPeriod, project?: string): Promise<TokenMetrics> {
    return computeTokenMetrics(this.telemetryDir, period, project);
  }

  async getDurationMetrics(period: MetricsPeriod, project?: string): Promise<DurationMetrics> {
    return computeDurationMetrics(this.telemetryDir, period, project);
  }

  async getAllMetrics(
    period: MetricsPeriod = '24h',
    project?: string
  ): Promise<{
    tasks: TaskMetrics;
    runs: RunMetrics;
    tokens: TokenMetrics;
    duration: DurationMetrics;
    trends: TrendComparison;
  }> {
    return computeAllMetrics(this.taskService, this.telemetryDir, period, project);
  }

  async getTrends(period: '7d' | '30d', project?: string): Promise<TrendsData> {
    return computeTrends(this.telemetryDir, period, project);
  }

  async getBudgetMetrics(
    tokenBudget: number,
    costBudget: number,
    warningThreshold: number,
    project?: string
  ): Promise<BudgetMetrics> {
    return computeBudgetMetrics(
      this.telemetryDir,
      tokenBudget,
      costBudget,
      warningThreshold,
      project
    );
  }

  async getAgentComparison(
    period: MetricsPeriod,
    project?: string,
    minRuns = 3
  ): Promise<AgentComparisonResult> {
    return computeAgentComparison(this.telemetryDir, period, project, minRuns);
  }

  async getVelocityMetrics(project?: string, limit = 10): Promise<VelocityMetrics> {
    return computeVelocityMetrics(this.taskService, project, limit);
  }

  async getFailedRuns(
    period: MetricsPeriod,
    project?: string,
    limit = 50
  ): Promise<FailedRunDetails[]> {
    return computeFailedRuns(this.telemetryDir, period, project, limit);
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
