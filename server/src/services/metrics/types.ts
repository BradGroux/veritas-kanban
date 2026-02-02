/**
 * Type definitions for the metrics service.
 * All metric interfaces and type aliases used across the metrics modules.
 */
import type {
  TaskStatus,
  BlockedCategory,
  TelemetryEventType,
  AnyTelemetryEvent,
} from '@veritas-kanban/shared';

// ── Period & Core Types ─────────────────────────────────────────────

export type MetricsPeriod =
  | 'today'
  | '24h'
  | '3d'
  | '7d'
  | '30d'
  | '3m'
  | '6m'
  | '12m'
  | 'wtd'
  | 'mtd'
  | 'ytd'
  | 'all'
  | 'custom';

export interface TaskMetrics {
  byStatus: Record<TaskStatus, number>;
  byBlockedReason: Record<BlockedCategory | 'unspecified', number>;
  total: number;
  completed: number; // done + archived
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
  errorRate: number; // (failures + errors) / runs
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

// ── Trend Types ─────────────────────────────────────────────────────

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

// ── Internal Accumulator Types ──────────────────────────────────────

export interface RunAccumulator {
  successes: number;
  failures: number;
  errors: number;
  durations: number[];
  byAgent: Map<
    string,
    {
      successes: number;
      failures: number;
      errors: number;
      durations: number[];
    }
  >;
}

export interface TokenAccumulator {
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  tokensPerRun: number[];
  byAgent: Map<
    string,
    {
      totalTokens: number;
      inputTokens: number;
      outputTokens: number;
      cacheTokens: number;
      runs: number;
    }
  >;
}

// ── Failed Runs ─────────────────────────────────────────────────────

export interface FailedRunDetails {
  timestamp: string;
  taskId?: string;
  project?: string;
  agent: string;
  success: boolean;
  errorMessage?: string;
  durationMs?: number;
}

// ── Daily Trends ────────────────────────────────────────────────────

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
  costEstimate: number;
  avgDurationMs: number;
  // Task activity counts
  tasksCreated: number;
  statusChanges: number;
  tasksArchived: number;
}

export interface TrendsData {
  period: MetricsPeriod;
  daily: DailyTrendPoint[];
}

// ── Budget Metrics ──────────────────────────────────────────────────

export interface BudgetMetrics {
  periodStart: string; // Start of current month (YYYY-MM-DD)
  periodEnd: string; // End of current month (YYYY-MM-DD)
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
  tokensPerDay: number; // Average tokens per day so far
  costPerDay: number; // Average cost per day

  // Projections
  projectedMonthlyTokens: number;
  projectedMonthlyCost: number;

  // Budget status
  tokenBudget: number; // From settings (0 = no limit)
  costBudget: number; // From settings (0 = no limit)
  tokenBudgetUsed: number; // Percentage used (0-100+)
  costBudgetUsed: number; // Percentage used (0-100+)
  projectedTokenOverage: number; // Percentage of projected vs budget (0-100+)
  projectedCostOverage: number; // Percentage of projected vs budget (0-100+)

  // Status indicator
  status: 'ok' | 'warning' | 'danger'; // Based on warningThreshold
}

// ── Agent Comparison ────────────────────────────────────────────────

/** Agent comparison data for a single agent */
export interface AgentComparisonData {
  agent: string;
  runs: number;
  successes: number;
  failures: number;
  successRate: number; // Percentage (0-100)
  avgDurationMs: number;
  avgTokensPerRun: number;
  totalTokens: number;
  avgCostPerRun: number; // Estimated cost per run
  totalCost: number; // Total estimated cost
}

/** Recommendation for best agent in a category */
export interface AgentRecommendation {
  category: 'reliability' | 'speed' | 'cost' | 'efficiency';
  agent: string;
  value: string; // Human-readable value (e.g., "95.5%", "2.3m")
  reason: string; // Explanation
}

/** Full agent comparison result */
export interface AgentComparisonResult {
  period: MetricsPeriod;
  minRuns: number;
  agents: AgentComparisonData[];
  recommendations: AgentRecommendation[];
  totalAgents: number; // Total agents found (before minRuns filter)
  qualifyingAgents: number; // Agents meeting minRuns threshold
}

// ── Sprint Velocity ─────────────────────────────────────────────────

export type VelocityTrend = 'accelerating' | 'steady' | 'slowing';

export interface SprintVelocityPoint {
  sprint: string; // Sprint identifier (e.g., "US-100")
  completed: number; // Tasks completed in this sprint
  total: number; // Total tasks in this sprint
  rollingAverage: number; // 3-sprint rolling average at this point
  byType: Record<string, number>; // Breakdown by task type
}

export interface CurrentSprintProgress {
  sprint: string;
  completed: number;
  total: number;
  percentComplete: number; // 0-100
  vsAverage: number; // Percentage vs historical average (-100 to +100+)
}

export interface VelocityMetrics {
  sprints: SprintVelocityPoint[]; // Sprint data (oldest to newest)
  averageVelocity: number; // Overall average tasks per sprint
  trend: VelocityTrend; // Current trend indicator
  currentSprint?: CurrentSprintProgress; // Progress on current/active sprint
}

// ── Cost per Task ───────────────────────────────────────────────────

export interface TaskCostEntry {
  taskId: string;
  taskTitle?: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCost: number;
  runs: number;
  avgCostPerRun: number;
}

export interface TaskCostMetrics {
  period: MetricsPeriod;
  tasks: TaskCostEntry[];
  totalCost: number;
  avgCostPerTask: number;
}

// ── Agent Utilization ───────────────────────────────────────────────

export interface UtilizationMetrics {
  period: MetricsPeriod;
  totalActiveMs: number;
  totalIdleMs: number;
  totalErrorMs: number;
  utilizationPercent: number; // active / (active + idle + error)
  daily: DailyUtilization[];
}

export interface DailyUtilization {
  date: string;
  activeMs: number;
  idleMs: number;
  errorMs: number;
  utilizationPercent: number;
}

// ── Stream Event Handler ────────────────────────────────────────────

export type StreamEventHandler<T> = (event: AnyTelemetryEvent, acc: T) => void;

// Re-export shared types used by consumers
export type { TelemetryEventType, AnyTelemetryEvent };
