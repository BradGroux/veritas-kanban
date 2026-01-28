import { Router, type Router as RouterType } from 'express';
import { getMetricsService, type MetricsPeriod } from '../services/metrics-service.js';

const router: RouterType = Router();

const VALID_PERIODS: MetricsPeriod[] = ['24h', '7d', '30d'];

function isValidPeriod(period: string): period is MetricsPeriod {
  return VALID_PERIODS.includes(period as MetricsPeriod);
}

/**
 * GET /api/metrics/tasks
 * Get task counts by status
 * 
 * Query params:
 *   - project: Filter by project
 */
router.get('/tasks', async (req, res, next) => {
  try {
    const metrics = getMetricsService();
    const project = req.query.project as string | undefined;
    const result = await metrics.getTaskMetrics(project);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/metrics/runs
 * Get run metrics (error rate, success rate) with per-agent breakdown
 * 
 * Query params:
 *   - period: '24h' | '7d' | '30d' (default: '24h')
 *   - project: Filter by project
 */
router.get('/runs', async (req, res, next) => {
  try {
    const metrics = getMetricsService();
    const period = (req.query.period as string) || '24h';
    const project = req.query.project as string | undefined;
    
    if (!isValidPeriod(period)) {
      return res.status(400).json({ error: 'period must be "24h", "7d", or "30d"' });
    }
    
    const result = await metrics.getRunMetrics(period, project);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/metrics/tokens
 * Get token usage metrics with per-agent breakdown
 * 
 * Query params:
 *   - period: '24h' | '7d' | '30d' (default: '24h')
 *   - project: Filter by project
 */
router.get('/tokens', async (req, res, next) => {
  try {
    const metrics = getMetricsService();
    const period = (req.query.period as string) || '24h';
    const project = req.query.project as string | undefined;
    
    if (!isValidPeriod(period)) {
      return res.status(400).json({ error: 'period must be "24h", "7d", or "30d"' });
    }
    
    const result = await metrics.getTokenMetrics(period, project);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/metrics/duration
 * Get run duration metrics with per-agent breakdown
 * 
 * Query params:
 *   - period: '24h' | '7d' | '30d' (default: '24h')
 *   - project: Filter by project
 */
router.get('/duration', async (req, res, next) => {
  try {
    const metrics = getMetricsService();
    const period = (req.query.period as string) || '24h';
    const project = req.query.project as string | undefined;
    
    if (!isValidPeriod(period)) {
      return res.status(400).json({ error: 'period must be "24h", "7d", or "30d"' });
    }
    
    const result = await metrics.getDurationMetrics(period, project);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/metrics/all
 * Get all metrics in one call (optimized for dashboard)
 * Uses single-pass streaming for performance (<500ms for 30-day queries)
 * 
 * Query params:
 *   - period: '24h' | '7d' | '30d' (default: '24h')
 *   - project: Filter by project
 */
router.get('/all', async (req, res, next) => {
  try {
    const metrics = getMetricsService();
    const period = (req.query.period as string) || '24h';
    const project = req.query.project as string | undefined;
    
    if (!isValidPeriod(period)) {
      return res.status(400).json({ error: 'period must be "24h", "7d", or "30d"' });
    }
    
    const result = await metrics.getAllMetrics(period, project);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

export default router;
