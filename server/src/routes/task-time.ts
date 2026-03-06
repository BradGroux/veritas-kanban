import { Router, type Router as RouterType } from 'express';
import { z } from 'zod';
import { getTaskService } from '../services/task-service.js';
import { broadcastTaskChange } from '../services/broadcast-service.js';
import { asyncHandler } from '../middleware/async-handler.js';
import { ValidationError } from '../middleware/error-handler.js';

const router: RouterType = Router();
const taskService = getTaskService();

// Validation schemas
const addTimeEntrySchema = z.object({
  duration: z.number().positive('Duration must be a positive number (in seconds)'),
  description: z.string().optional(),
});

// GET /api/tasks/time/summary - Get time summary by project
router.get(
  '/time/summary',
  asyncHandler(async (_req, res) => {
    const summary = await taskService.getTimeSummary();
    res.json(summary);
  })
);

// POST /api/tasks/:id/time/start - Start timer for a task
router.post(
  '/:id/time/start',
  asyncHandler(async (req, res) => {
    const task = await taskService.startTimer(req.params.id as string);
    broadcastTaskChange('updated', task.id);
    res.json(task);
  })
);

// POST /api/tasks/:id/time/stop - Stop timer for a task
router.post(
  '/:id/time/stop',
  asyncHandler(async (req, res) => {
    const task = await taskService.stopTimer(req.params.id as string);
    broadcastTaskChange('updated', task.id);
    res.json(task);
  })
);

// POST /api/tasks/:id/time/entry - Add manual time entry
router.post(
  '/:id/time/entry',
  asyncHandler(async (req, res) => {
    let duration: number;
    let description: string | undefined;
    try {
      ({ duration, description } = addTimeEntrySchema.parse(req.body));
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new ValidationError('Validation failed', error.issues);
      }
      throw error;
    }
    const task = await taskService.addTimeEntry(req.params.id as string, duration, description);
    broadcastTaskChange('updated', task.id);
    res.json(task);
  })
);

// DELETE /api/tasks/:id/time/entry/:entryId - Delete a time entry
router.delete(
  '/:id/time/entry/:entryId',
  asyncHandler(async (req, res) => {
    const task = await taskService.deleteTimeEntry(
      req.params.id as string,
      req.params.entryId as string
    );
    broadcastTaskChange('updated', task.id);
    res.json(task);
  })
);

export { router as taskTimeRoutes };
