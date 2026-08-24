import { Router, type Router as RouterType } from 'express';
import { getAnalyticsService } from '../services/analytics-service.js';
import { asyncHandler } from '../middleware/async-handler.js';
import { validate, type ValidatedRequest } from '../middleware/validate.js';
import {
  TimelineQuerySchema,
  MetricsQuerySchema,
  type TimelineQuery,
  type MetricsQuery,
} from '../schemas/analytics-schemas.js';

const router: RouterType = Router();
const analyticsService = getAnalyticsService();

/**
 * GET /api/analytics/timeline
 *
 * Returns timeline data showing which tasks ran at what time, including:
 * - Start/end times from time tracking
 * - Task assignments and status
 * - Parallelism snapshots (concurrent tasks over time)
 *
 * Query parameters:
 *   - from (ISO 8601): Start date
 *   - to (ISO 8601): End date
 *   - agent: Filter by agent type
 *   - project: Filter by project
 *   - sprint: Filter by sprint
 */
router.get(
  '/timeline',
  validate({ query: TimelineQuerySchema }),
  asyncHandler(async (req: ValidatedRequest<unknown, TimelineQuery>, res) => {
    const timeline = await analyticsService.getTimeline(req.validated.query);
    res.json(timeline);
  })
);

/**
 * GET /api/analytics/metrics
 *
 * Returns aggregate metrics for a time period:
 * - Parallelism factor (average concurrent tasks)
 * - Throughput (tasks completed per period)
 * - Lead time (time from creation to completion)
 * - Agent utilization (working time per agent)
 * - Efficiency metrics (tracked time vs total period)
 *
 * Query parameters:
 *   - sprint: Filter by sprint ID
 *   - from (ISO 8601): Start date
 *   - to (ISO 8601): End date
 *   - project: Filter by project
 */
router.get(
  '/metrics',
  validate({ query: MetricsQuerySchema }),
  asyncHandler(async (req: ValidatedRequest<unknown, MetricsQuery>, res) => {
    const metrics = await analyticsService.getMetrics(req.validated.query);
    res.json(metrics);
  })
);

/**
 * GET /api/analytics/health
 *
 * Health check endpoint for the analytics service
 */
router.get(
  '/health',
  asyncHandler(async (_req, res) => {
    res.json({ status: 'ok', service: 'analytics' });
  })
);

export { router as analyticsRoutes };
