/**
 * Cost Prediction Service
 *
 * Predicts task costs before execution based on historical telemetry data.
 * Tracks prediction accuracy over time for continuous improvement.
 *
 * Prediction factors:
 * - Task type (bug, feature, research, etc.)
 * - Task priority
 * - Project
 * - Description length (proxy for complexity)
 * - Subtask count
 * - Historical averages for similar tasks
 */

import { getTelemetryService } from './telemetry-service.js';
import { getTaskService } from './task-service.js';
import { createLogger } from '../lib/logger.js';
import type { Task, TaskType, TaskPriority } from '@veritas-kanban/shared';

const log = createLogger('cost-prediction');

// ─── Types ───────────────────────────────────────────────────────

export interface CostPrediction {
  /** Predicted cost in USD */
  estimatedCost: number;
  /** Confidence level: low | medium | high */
  confidence: 'low' | 'medium' | 'high';
  /** Number of historical tasks used for prediction */
  sampleSize: number;
  /** Breakdown of prediction factors */
  factors: {
    baseCost: number;
    typeMultiplier: number;
    priorityMultiplier: number;
    complexityMultiplier: number;
    projectAdjustment: number;
  };
  /** ISO timestamp of prediction */
  predictedAt: string;
}

export interface CostAccuracy {
  taskId: string;
  taskTitle: string;
  taskType?: string;
  predicted: number;
  actual: number;
  /** Accuracy as percentage (100% = perfect, >100% = over-predicted, <100% = under-predicted) */
  accuracy: number;
  /** Absolute error in USD */
  error: number;
  completedAt: string;
}

export interface AccuracyStats {
  /** Total tasks with both prediction and actual cost */
  totalTracked: number;
  /** Mean absolute error in USD */
  meanAbsoluteError: number;
  /** Mean accuracy percentage */
  meanAccuracy: number;
  /** Median accuracy percentage */
  medianAccuracy: number;
  /** Tasks within 20% of prediction */
  within20Percent: number;
  /** Tasks within 50% of prediction */
  within50Percent: number;
  /** Per-type accuracy breakdown */
  byType: Record<string, { count: number; meanAccuracy: number; meanError: number }>;
}

// ─── Cost Model Constants ────────────────────────────────────────

/** Base cost per task (USD) — derived from historical average */
const DEFAULT_BASE_COST = 0.15;

/** Type multipliers — how much more/less expensive each type tends to be */
const TYPE_MULTIPLIERS: Record<string, number> = {
  bug: 0.8,
  feature: 1.2,
  research: 1.5,
  chore: 0.5,
  documentation: 0.6,
  refactor: 1.0,
  security: 1.3,
  performance: 1.1,
  test: 0.7,
};

/** Priority multipliers */
const PRIORITY_MULTIPLIERS: Record<string, number> = {
  low: 0.7,
  medium: 1.0,
  high: 1.4,
};

/** Description length thresholds for complexity estimation */
const COMPLEXITY_THRESHOLDS = {
  simple: 100, // < 100 chars
  moderate: 500, // 100-500 chars
  complex: 1500, // 500-1500 chars
  // > 1500 = very complex
};

const COMPLEXITY_MULTIPLIERS = {
  simple: 0.6,
  moderate: 1.0,
  complex: 1.5,
  veryComplex: 2.0,
};

// ─── Service ─────────────────────────────────────────────────────

class CostPredictionService {
  /**
   * Predict the cost of a task before execution.
   */
  async predict(task: {
    type?: TaskType | string;
    priority?: TaskPriority | string;
    project?: string;
    description?: string;
    subtasks?: Array<unknown>;
  }): Promise<CostPrediction> {
    // 1. Get historical base cost from telemetry
    const historicalBase = await this.getHistoricalBaseCost(task.type, task.project);
    const baseCost = historicalBase.avgCost > 0 ? historicalBase.avgCost : DEFAULT_BASE_COST;

    // 2. Apply type multiplier
    const typeKey = (task.type || 'feature').toLowerCase();
    const typeMultiplier = TYPE_MULTIPLIERS[typeKey] ?? 1.0;

    // 3. Apply priority multiplier
    const priorityKey = (task.priority || 'medium').toLowerCase();
    const priorityMultiplier = PRIORITY_MULTIPLIERS[priorityKey] ?? 1.0;

    // 4. Estimate complexity from description length + subtask count
    const descLength = (task.description || '').length;
    const subtaskCount = task.subtasks?.length || 0;
    let complexityMultiplier: number;
    if (descLength < COMPLEXITY_THRESHOLDS.simple && subtaskCount === 0) {
      complexityMultiplier = COMPLEXITY_MULTIPLIERS.simple;
    } else if (descLength < COMPLEXITY_THRESHOLDS.moderate && subtaskCount <= 2) {
      complexityMultiplier = COMPLEXITY_MULTIPLIERS.moderate;
    } else if (descLength < COMPLEXITY_THRESHOLDS.complex && subtaskCount <= 5) {
      complexityMultiplier = COMPLEXITY_MULTIPLIERS.complex;
    } else {
      complexityMultiplier = COMPLEXITY_MULTIPLIERS.veryComplex;
    }

    // 5. Project-specific adjustment
    const projectAdjustment = await this.getProjectCostAdjustment(task.project);

    // 6. Calculate final prediction
    const estimatedCost =
      baseCost * typeMultiplier * priorityMultiplier * complexityMultiplier * projectAdjustment;

    // 7. Determine confidence
    let confidence: 'low' | 'medium' | 'high';
    if (historicalBase.sampleSize >= 10) {
      confidence = 'high';
    } else if (historicalBase.sampleSize >= 3) {
      confidence = 'medium';
    } else {
      confidence = 'low';
    }

    const prediction: CostPrediction = {
      estimatedCost: Math.round(estimatedCost * 100) / 100,
      confidence,
      sampleSize: historicalBase.sampleSize,
      factors: {
        baseCost: Math.round(baseCost * 100) / 100,
        typeMultiplier,
        priorityMultiplier,
        complexityMultiplier,
        projectAdjustment: Math.round(projectAdjustment * 100) / 100,
      },
      predictedAt: new Date().toISOString(),
    };

    log.info(
      {
        type: task.type,
        priority: task.priority,
        estimatedCost: prediction.estimatedCost,
        confidence,
      },
      'Cost prediction generated'
    );

    return prediction;
  }

  /**
   * Get accuracy tracking for completed tasks.
   */
  async getAccuracy(options?: { limit?: number; type?: string }): Promise<CostAccuracy[]> {
    const taskService = getTaskService();
    const allTasks = await taskService.listTasks();
    const completedTasks = allTasks.filter(
      (t: Task) => t.status === 'done' && t.costPrediction && t.actualCost !== undefined
    );

    let results: CostAccuracy[] = completedTasks.map((t: Task) => {
      const predicted = t.costPrediction?.estimatedCost || 0;
      const actual = t.actualCost || 0;
      const accuracy = predicted > 0 ? (actual / predicted) * 100 : 0;
      const error = Math.abs(predicted - actual);

      return {
        taskId: t.id,
        taskTitle: t.title,
        taskType: t.type,
        predicted,
        actual,
        accuracy: Math.round(accuracy * 10) / 10,
        error: Math.round(error * 100) / 100,
        completedAt: t.updated,
      };
    });

    if (options?.type) {
      results = results.filter((r) => r.taskType === options.type);
    }

    results.sort((a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime());

    if (options?.limit) {
      results = results.slice(0, options.limit);
    }

    return results;
  }

  /**
   * Get aggregate accuracy statistics.
   */
  async getAccuracyStats(): Promise<AccuracyStats> {
    const accuracy = await this.getAccuracy();

    if (accuracy.length === 0) {
      return {
        totalTracked: 0,
        meanAbsoluteError: 0,
        meanAccuracy: 0,
        medianAccuracy: 0,
        within20Percent: 0,
        within50Percent: 0,
        byType: {},
      };
    }

    const errors = accuracy.map((a) => a.error);
    const accuracies = accuracy.map((a) => a.accuracy);
    const sortedAccuracies = [...accuracies].sort((a, b) => a - b);

    const meanAbsoluteError = errors.reduce((sum, e) => sum + e, 0) / errors.length;
    const meanAccuracy = accuracies.reduce((sum, a) => sum + a, 0) / accuracies.length;
    const medianAccuracy =
      sortedAccuracies.length % 2 === 0
        ? (sortedAccuracies[sortedAccuracies.length / 2 - 1]! +
            sortedAccuracies[sortedAccuracies.length / 2]!) /
          2
        : sortedAccuracies[Math.floor(sortedAccuracies.length / 2)]!;

    const within20 = accuracy.filter((a) => a.accuracy >= 80 && a.accuracy <= 120).length;
    const within50 = accuracy.filter((a) => a.accuracy >= 50 && a.accuracy <= 150).length;

    // Per-type breakdown
    const byType: AccuracyStats['byType'] = {};
    for (const item of accuracy) {
      const type = item.taskType || 'unknown';
      if (!byType[type]) {
        byType[type] = { count: 0, meanAccuracy: 0, meanError: 0 };
      }
      byType[type].count++;
      byType[type].meanAccuracy += item.accuracy;
      byType[type].meanError += item.error;
    }
    for (const type of Object.keys(byType)) {
      byType[type].meanAccuracy =
        Math.round((byType[type].meanAccuracy / byType[type].count) * 10) / 10;
      byType[type].meanError =
        Math.round((byType[type].meanError / byType[type].count) * 100) / 100;
    }

    return {
      totalTracked: accuracy.length,
      meanAbsoluteError: Math.round(meanAbsoluteError * 100) / 100,
      meanAccuracy: Math.round(meanAccuracy * 10) / 10,
      medianAccuracy: Math.round(medianAccuracy * 10) / 10,
      within20Percent: within20,
      within50Percent: within50,
      byType,
    };
  }

  /**
   * Get historical average cost for similar tasks.
   */
  private async getHistoricalBaseCost(
    _type?: string,
    _project?: string
  ): Promise<{ avgCost: number; sampleSize: number }> {
    try {
      const telemetry = getTelemetryService();
      const events = await telemetry.getEvents({
        type: 'run.tokens',
        limit: 500,
      });

      if (!events || events.length === 0) {
        return { avgCost: 0, sampleSize: 0 };
      }

      // Filter by type/project if available and calculate average cost per task
      const taskCosts = new Map<string, number>();
      for (const event of events) {
        const e = event as unknown as Record<string, unknown>;
        const taskId = e.taskId as string;
        if (!taskId) continue;

        const inputTokens = (e.inputTokens as number) || 0;
        const outputTokens = (e.outputTokens as number) || 0;
        const eventCost = (e.cost as number) || inputTokens * 0.00001 + outputTokens * 0.00003;

        taskCosts.set(taskId, (taskCosts.get(taskId) || 0) + eventCost);
      }

      const costs = Array.from(taskCosts.values());
      if (costs.length === 0) return { avgCost: 0, sampleSize: 0 };

      const avgCost = costs.reduce((sum, c) => sum + c, 0) / costs.length;
      return { avgCost, sampleSize: costs.length };
    } catch (err) {
      log.warn({ err }, 'Failed to get historical base cost');
      return { avgCost: 0, sampleSize: 0 };
    }
  }

  /**
   * Get project-specific cost adjustment factor.
   */
  private async getProjectCostAdjustment(project?: string): Promise<number> {
    if (!project) return 1.0;

    try {
      const telemetry = getTelemetryService();
      const events = await telemetry.getEvents({
        type: 'run.tokens',
        limit: 200,
      });

      if (!events || events.length === 0) return 1.0;

      const projectCosts: number[] = [];
      const otherCosts: number[] = [];

      for (const event of events) {
        const e = event as unknown as Record<string, unknown>;
        const inputTokens = (e.inputTokens as number) || 0;
        const outputTokens = (e.outputTokens as number) || 0;
        const cost = (e.cost as number) || inputTokens * 0.00001 + outputTokens * 0.00003;

        if (e.project === project) {
          projectCosts.push(cost);
        } else {
          otherCosts.push(cost);
        }
      }

      if (projectCosts.length < 3 || otherCosts.length < 3) return 1.0;

      const projectAvg = projectCosts.reduce((s, c) => s + c, 0) / projectCosts.length;
      const otherAvg = otherCosts.reduce((s, c) => s + c, 0) / otherCosts.length;

      if (otherAvg === 0) return 1.0;

      // Clamp between 0.5x and 2.0x
      return Math.max(0.5, Math.min(2.0, projectAvg / otherAvg));
    } catch {
      return 1.0;
    }
  }
}

// Singleton
let instance: CostPredictionService | null = null;

export function getCostPredictionService(): CostPredictionService {
  if (!instance) {
    instance = new CostPredictionService();
  }
  return instance;
}
