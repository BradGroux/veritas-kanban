import { Router, type Router as RouterType } from 'express';
import { z } from 'zod';
import { getTaskService } from '../services/task-service.js';
import { activityService } from '../services/activity-service.js';
import { broadcastTaskChange } from '../services/broadcast-service.js';
import { asyncHandler } from '../middleware/async-handler.js';
import { NotFoundError, ValidationError } from '../middleware/error-handler.js';
import { auditLog } from '../services/audit-service.js';
import type { AuthenticatedRequest } from '../middleware/auth.js';

const router: RouterType = Router();
const taskService = getTaskService();

// Validation schemas
const bulkArchiveSchema = z.object({
  sprint: z.string().min(1, 'Sprint is required'),
});

// GET /api/tasks/archived - List archived tasks
router.get(
  '/archived',
  asyncHandler(async (_req, res) => {
    const tasks = await taskService.listArchivedTasks();
    res.json(tasks);
  })
);

// GET /api/tasks/archive/suggestions - Get sprints ready to archive
router.get(
  '/archive/suggestions',
  asyncHandler(async (_req, res) => {
    const suggestions = await taskService.getArchiveSuggestions();
    res.json(suggestions);
  })
);

// POST /api/tasks/archive/sprint/:sprint - Archive all tasks in a sprint
router.post(
  '/archive/sprint/:sprint',
  asyncHandler(async (req, res) => {
    const result = await taskService.archiveSprint(req.params.sprint as string);

    // Log activity
    await activityService.logActivity(
      'sprint_archived',
      req.params.sprint as string,
      req.params.sprint as string,
      {
        taskCount: result.archived,
      }
    );

    res.json(result);
  })
);

// POST /api/tasks/bulk-archive - Archive multiple tasks by sprint
router.post(
  '/bulk-archive',
  asyncHandler(async (req, res) => {
    let sprint: string;
    try {
      ({ sprint } = bulkArchiveSchema.parse(req.body));
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new ValidationError('Validation failed', error.errors);
      }
      throw error;
    }

    const tasks = await taskService.listTasks();
    const sprintTasks = tasks.filter((t) => t.sprint === sprint && t.status === 'done');

    if (sprintTasks.length === 0) {
      throw new ValidationError('No completed tasks found for this sprint');
    }

    const archived: string[] = [];
    for (const task of sprintTasks) {
      const success = await taskService.archiveTask(task.id);
      if (success) {
        archived.push(task.id);
        await activityService.logActivity(
          'task_archived',
          task.id,
          task.title,
          undefined,
          task.agent
        );
      }
    }

    res.json({ archived, count: archived.length });
  })
);

// POST /api/tasks/:id/archive - Archive task
router.post(
  '/:id/archive',
  asyncHandler(async (req, res) => {
    const task = await taskService.getTask(req.params.id as string);
    const success = await taskService.archiveTask(req.params.id as string);
    if (!success) {
      throw new NotFoundError('Task not found');
    }
    broadcastTaskChange('archived', req.params.id as string);

    // Log activity
    if (task) {
      await activityService.logActivity(
        'task_archived',
        task.id,
        task.title,
        undefined,
        task.agent
      );
    }

    // Audit log
    const authReq = req as AuthenticatedRequest;
    await auditLog({
      action: 'task.archive',
      actor: authReq.auth?.keyName || 'unknown',
      resource: req.params.id as string,
      details: task ? { title: task.title } : undefined,
    });

    res.json({ archived: true });
  })
);

// POST /api/tasks/:id/restore - Restore task from archive
router.post(
  '/:id/restore',
  asyncHandler(async (req, res) => {
    const task = await taskService.restoreTask(req.params.id as string);
    if (!task) {
      throw new NotFoundError('Archived task not found');
    }
    broadcastTaskChange('restored', task.id);

    // Log activity
    await activityService.logActivity(
      'status_changed',
      task.id,
      task.title,
      {
        from: 'archived',
        status: 'done',
      },
      task.agent
    );

    res.json(task);
  })
);

export { router as taskArchiveRoutes };
