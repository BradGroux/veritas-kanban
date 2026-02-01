import { Router, type Router as RouterType } from 'express';
import { getTaskService } from '../services/task-service.js';
import { getSummaryService } from '../services/summary-service.js';
import { activityService } from '../services/activity-service.js';
import { asyncHandler } from '../middleware/async-handler.js';

const router: RouterType = Router();
const taskService = getTaskService();
const summaryService = getSummaryService();

// GET /api/summary - Get overall task summary
router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const tasks = await taskService.listTasks();
    const summary = summaryService.getOverallSummary(tasks);
    res.json(summary);
  })
);

// GET /api/summary/recent - Get recently completed tasks (for memory sync)
router.get(
  '/recent',
  asyncHandler(async (req, res) => {
    const hours = parseInt(req.query.hours as string) || 24;
    const tasks = await taskService.listTasks();
    const recentActivity = summaryService.getRecentActivity(tasks, hours);
    res.json(recentActivity);
  })
);

// GET /api/summary/memory - Get formatted summary for memory file
router.get(
  '/memory',
  asyncHandler(async (req, res) => {
    const hours = parseInt(req.query.hours as string) || 24;
    const tasks = await taskService.listTasks();
    const markdown = summaryService.generateMemoryMarkdown(tasks, hours);
    res.type('text/markdown').send(markdown);
  })
);

// GET /api/summary/standup - Get daily standup report
router.get(
  '/standup',
  asyncHandler(async (req, res) => {
    const dateParam = req.query.date as string | undefined;
    const format = (req.query.format as string) || 'json';

    // Parse target date (defaults to today)
    let targetDate: Date;
    if (dateParam) {
      targetDate = new Date(dateParam + 'T00:00:00');
      if (isNaN(targetDate.getTime())) {
        res.status(400).json({
          error: 'Invalid date format. Use YYYY-MM-DD.',
        });
        return;
      }
    } else {
      targetDate = new Date();
    }

    const tasks = await taskService.listTasks();
    // Fetch enough activities to cover the target date
    const activities = await activityService.getActivities(500);

    const standupData = summaryService.getStandupData(tasks, activities, targetDate);

    switch (format) {
      case 'markdown':
        res.type('text/markdown').send(summaryService.generateStandupMarkdown(standupData));
        break;
      case 'text':
        res.type('text/plain').send(summaryService.generateStandupText(standupData));
        break;
      case 'json':
      default:
        res.json(standupData);
        break;
    }
  })
);

export { router as summaryRoutes };
