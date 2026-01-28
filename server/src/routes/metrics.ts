import { Router, type Router as RouterType } from 'express';
import { getMetricsService } from '../services/metrics-service.js';
import { asyncHandler } from '../middleware/async-handler.js';
import { validate, type ValidatedRequest } from '../middleware/validate.js';
import {
  MetricsQuerySchema,
  TaskMetricsQuerySchema,
  BudgetMetricsQuerySchema,
  AgentComparisonQuerySchema,
  VelocityQuerySchema,
  type MetricsQuery,
  type TaskMetricsQuery,
  type BudgetMetricsQuery,
  type AgentComparisonQuery,
  type VelocityQuery,
} from '../schemas/metrics-schemas.js';

const router: RouterType = Router();

/**
 * GET /api/metrics/tasks
 * Get task counts by status
 */
router.get(
  '/tasks',
  validate({ query: TaskMetricsQuerySchema }),
  asyncHandler(async (req: ValidatedRequest<unknown, TaskMetricsQuery>, res) => {
    const metrics = getMetricsService();
    const { project } = req.validated.query!;
    const result = await metrics.getTaskMetrics(project);
    res.json(result);
  })
);

/**
 * GET /api/metrics/runs
 * Get run metrics (error rate, success rate) with per-agent breakdown
 */
router.get(
  '/runs',
  validate({ query: MetricsQuerySchema }),
  asyncHandler(async (req: ValidatedRequest<unknown, MetricsQuery>, res) => {
    const metrics = getMetricsService();
    const { period, project } = req.validated.query!;
    const result = await metrics.getRunMetrics(period, project);
    res.json(result);
  })
);

/**
 * GET /api/metrics/tokens
 * Get token usage metrics with per-agent breakdown
 */
router.get(
  '/tokens',
  validate({ query: MetricsQuerySchema }),
  asyncHandler(async (req: ValidatedRequest<unknown, MetricsQuery>, res) => {
    const metrics = getMetricsService();
    const { period, project } = req.validated.query!;
    const result = await metrics.getTokenMetrics(period, project);
    res.json(result);
  })
);

/**
 * GET /api/metrics/duration
 * Get run duration metrics with per-agent breakdown
 */
router.get(
  '/duration',
  validate({ query: MetricsQuerySchema }),
  asyncHandler(async (req: ValidatedRequest<unknown, MetricsQuery>, res) => {
    const metrics = getMetricsService();
    const { period, project } = req.validated.query!;
    const result = await metrics.getDurationMetrics(period, project);
    res.json(result);
  })
);

/**
 * GET /api/metrics/all
 * Get all metrics in one call (optimized for dashboard)
 */
router.get(
  '/all',
  validate({ query: MetricsQuerySchema }),
  asyncHandler(async (req: ValidatedRequest<unknown, MetricsQuery>, res) => {
    const metrics = getMetricsService();
    const { period, project } = req.validated.query!;
    const result = await metrics.getAllMetrics(period, project);
    res.json(result);
  })
);

/**
 * GET /api/metrics/failed-runs
 * Get list of failed runs with details
 */
router.get(
  '/failed-runs',
  validate({ query: MetricsQuerySchema }),
  asyncHandler(async (req: ValidatedRequest<unknown, MetricsQuery>, res) => {
    const metrics = getMetricsService();
    const { period, project } = req.validated.query!;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;
    const result = await metrics.getFailedRuns(period, project, limit);
    res.json(result);
  })
);

/**
 * GET /api/metrics/trends
 * Get historical trends data aggregated by day
 */
router.get(
  '/trends',
  asyncHandler(async (req, res) => {
    const metrics = getMetricsService();
    const period = (req.query.period as '7d' | '30d') || '7d';
    const project = req.query.project as string | undefined;
    
    // Validate period
    if (period !== '7d' && period !== '30d') {
      res.status(400).json({ error: 'Period must be 7d or 30d' });
      return;
    }
    
    const result = await metrics.getTrends(period, project);
    res.json(result);
  })
);

/**
 * GET /api/metrics/budget
 * Get monthly budget metrics (current month token/cost usage and projections)
 */
router.get(
  '/budget',
  validate({ query: BudgetMetricsQuerySchema }),
  asyncHandler(async (req: ValidatedRequest<unknown, BudgetMetricsQuery>, res) => {
    const metrics = getMetricsService();
    const { project, tokenBudget, costBudget, warningThreshold } = req.validated.query!;
    const result = await metrics.getBudgetMetrics(tokenBudget, costBudget, warningThreshold, project);
    res.json(result);
  })
);

/**
 * GET /api/metrics/agents/comparison
 * Get agent performance comparison with recommendations
 */
router.get(
  '/agents/comparison',
  validate({ query: AgentComparisonQuerySchema }),
  asyncHandler(async (req: ValidatedRequest<unknown, AgentComparisonQuery>, res) => {
    const metrics = getMetricsService();
    const { period, project, minRuns } = req.validated.query!;
    const result = await metrics.getAgentComparison(period, project, minRuns);
    res.json(result);
  })
);

/**
 * GET /api/metrics/velocity
 * Get sprint velocity metrics (tasks completed per sprint with trends)
 */
router.get(
  '/velocity',
  validate({ query: VelocityQuerySchema }),
  asyncHandler(async (req: ValidatedRequest<unknown, VelocityQuery>, res) => {
    const metrics = getMetricsService();
    const { project, limit } = req.validated.query!;
    const result = await metrics.getVelocityMetrics(project, limit);
    res.json(result);
  })
);

export default router;
