import { Router, type Router as RouterType } from 'express';
import { getMetricsService } from '../services/metrics-service.js';
import { asyncHandler } from '../middleware/async-handler.js';
import { validate, type ValidatedRequest } from '../middleware/validate.js';
import {
  MetricsQuerySchema,
  TaskMetricsQuerySchema,
  type MetricsQuery,
  type TaskMetricsQuery,
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

export default router;
