import { Router, type Router as RouterType } from 'express';
import {
  activityService,
  type ActivityType,
  type ActivityFilters,
} from '../services/activity-service.js';
import { asyncHandler } from '../middleware/async-handler.js';
import { sendPaginated } from '../middleware/response-envelope.js';
import { authorize } from '../middleware/auth.js';
import { qStr, qNumD } from '../lib/query-helpers.js';

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
    const limit = qNumD(req.query.limit, 50);
    const page = qNumD(req.query.page, 0);

    const filters: ActivityFilters = {};
    const agent = qStr(req.query.agent);
    const type = qStr(req.query.type);
    const taskId = qStr(req.query.taskId);
    const since = qStr(req.query.since);
    const until = qStr(req.query.until);
    if (agent) filters.agent = agent;
    if (type) filters.type = type as ActivityType;
    if (taskId) filters.taskId = taskId;
    if (since) filters.since = since;
    if (until) filters.until = until;

    const hasFilters = Object.keys(filters).length > 0;

    // If pagination is requested, use the sendPaginated helper
    if (page > 0) {
      const total = await activityService.countActivities(hasFilters ? filters : undefined);
      const offset = (page - 1) * limit;
      const paged = await activityService.getActivities(
        limit,
        hasFilters ? filters : undefined,
        offset
      );
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
  authorize('admin'),
  asyncHandler(async (_req, res) => {
    await activityService.clearActivities();
    res.status(204).send();
  })
);

export default router;
