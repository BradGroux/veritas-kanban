import { Router, type Router as RouterType } from 'express';
import { z } from 'zod';
import { getTaskService } from '../services/task-service.js';
import { getAutomationService } from '../services/automation-service.js';
import { asyncHandler } from '../middleware/async-handler.js';
import { NotFoundError, ValidationError } from '../middleware/error-handler.js';

const router: RouterType = Router();
const taskService = getTaskService();
const automationService = getAutomationService();

// Validation schemas
const startAutomationSchema = z.object({
  sessionKey: z.string().optional(),
});

const completeAutomationSchema = z.object({
  result: z.string().optional(),
  status: z.enum(['complete', 'failed']).default('complete'),
});

// POST /api/automation/:taskId/start - Start automation task via Veritas sub-agent
router.post(
  '/:taskId/start',
  asyncHandler(async (req, res) => {
    const task = await taskService.getTask(req.params.taskId as string);
    if (!task) {
      throw new NotFoundError('Task not found');
    }

    // Validate task can start automation
    const validation = automationService.validateCanStart(task);
    if (!validation.valid) {
      throw new ValidationError(validation.error!);
    }

    // Parse input
    let input;
    try {
      input = startAutomationSchema.parse(req.body);
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new ValidationError('Validation failed', error.issues);
      }
      throw error;
    }

    // Get update payload and update task
    const payload = automationService.getStartPayload(input.sessionKey);
    const updated = await taskService.updateTask(task.id, payload);

    // Build and return result
    const result = automationService.buildStartResult(updated!, payload.attempt!.id);
    res.json(result);
  })
);

// POST /api/automation/:taskId/complete - Mark automation task as complete
router.post(
  '/:taskId/complete',
  asyncHandler(async (req, res) => {
    const task = await taskService.getTask(req.params.taskId as string);
    if (!task) {
      throw new NotFoundError('Task not found');
    }

    // Validate task can be completed
    const validation = automationService.validateCanComplete(task);
    if (!validation.valid) {
      throw new ValidationError(validation.error!);
    }

    // Parse input
    let input;
    try {
      input = completeAutomationSchema.parse(req.body);
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new ValidationError('Validation failed', error.issues);
      }
      throw error;
    }

    // Get update payload and update task
    const payload = automationService.getCompletePayload(
      task.attempt,
      task.automation,
      input.result,
      input.status
    );
    const updated = await taskService.updateTask(task.id, payload);

    // Build and return result
    const result = automationService.buildCompleteResult(updated!, input.status);
    res.json(result);
  })
);

// GET /api/automation/pending - List automation tasks pending execution
router.get(
  '/pending',
  asyncHandler(async (_req, res) => {
    const tasks = await taskService.listTasks();
    const pending = automationService.getPendingTasks(tasks);
    res.json(pending);
  })
);

// GET /api/automation/running - List currently running automation tasks
router.get(
  '/running',
  asyncHandler(async (_req, res) => {
    const tasks = await taskService.listTasks();
    const running = automationService.getRunningTasks(tasks);
    res.json(running);
  })
);

export { router as automationRoutes };
