import { Router, type Router as RouterType } from 'express';
import {
  activityService,
  type ActivityType,
  type ActivityFilters,
} from '../services/activity-service.js';
import { asyncHandler } from '../middleware/async-handler.js';
import { sendPaginated } from '../middleware/response-envelope.js';

const router: RouterType = Router();

// GET /api/activity - Get activities with optional filters
// Query params:
//   ?limit=50        — max items to return (default 50)
//   ?page=1          — page number (1-indexed; 0 or omitted = no pagination wrapper)
//   ?agent=Veritas   — filter by agent name
//   ?type=task_created — filter by activity type
//   ?taskId=task_123 — filter by specific task
//   ?since=ISO       — only activities at or after this timestamp
//   ?until=ISO       — only activities at or before this timestamp
// All filters are combinable.
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const limit = parseInt(req.query.limit as string) || 50;
    const page = parseInt(req.query.page as string) || 0;

    const filters: ActivityFilters = {};
    if (req.query.agent) filters.agent = req.query.agent as string;
    if (req.query.type) filters.type = req.query.type as ActivityType;
    if (req.query.taskId) filters.taskId = req.query.taskId as string;
    if (req.query.since) filters.since = req.query.since as string;
    if (req.query.until) filters.until = req.query.until as string;

    const hasFilters = Object.keys(filters).length > 0;

    // If pagination is requested, use the sendPaginated helper
    if (page > 0) {
      const total = await activityService.countActivities(hasFilters ? filters : undefined);
      // Fetch enough items to cover the requested page
      const fetchLimit = page * limit;
      const allMatching = await activityService.getActivities(
        fetchLimit,
        hasFilters ? filters : undefined
      );
      const start = (page - 1) * limit;
      const paged = allMatching.slice(start, start + limit);
      sendPaginated(res, paged, { page, limit, total });
    } else {
      const activities = await activityService.getActivities(
        limit,
        hasFilters ? filters : undefined
      );
      res.json(activities);
    }
  })
);

// GET /api/activity/filters - Get available filter options (distinct agents and types)
router.get(
  '/filters',
  asyncHandler(async (_req, res) => {
    const [agents, types] = await Promise.all([
      activityService.getDistinctAgents(),
      activityService.getDistinctTypes(),
    ]);
    res.json({ agents, types });
  })
);

// DELETE /api/activity - Clear all activities
router.delete(
  '/',
  asyncHandler(async (_req, res) => {
    await activityService.clearActivities();
    res.status(204).send();
  })
);

export default router;
