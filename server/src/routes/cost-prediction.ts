/**
 * Cost Prediction API Routes
 *
 * POST /api/cost-prediction/predict         — Predict cost for a task (by ID or metadata)
 * GET  /api/cost-prediction/accuracy        — Get prediction accuracy for completed tasks
 * GET  /api/cost-prediction/accuracy/stats  — Get aggregate accuracy statistics
 */

import { Router, type Router as RouterType } from 'express';
import { z } from 'zod';
import { getCostPredictionService } from '../services/cost-prediction-service.js';
import { getTaskService } from '../services/task-service.js';
import { asyncHandler } from '../middleware/async-handler.js';
import { NotFoundError, ValidationError } from '../middleware/error-handler.js';

const router: RouterType = Router();

// ─── Validation Schemas ──────────────────────────────────────────

const predictByTaskIdSchema = z.object({
  taskId: z.string().min(1),
});

const predictByMetadataSchema = z.object({
  type: z.string().optional(),
  priority: z.enum(['low', 'medium', 'high']).optional(),
  project: z.string().optional(),
  description: z.string().optional(),
  subtaskCount: z.number().int().min(0).max(500).optional(),
});

// ─── Routes ──────────────────────────────────────────────────────

/**
 * POST /api/cost-prediction/predict
 *
 * Predict cost for a task. Accepts either:
 * - { taskId: "..." } to look up an existing task
 * - { type, priority, project, description, subtaskCount } for ad-hoc prediction
 */
router.post(
  '/predict',
  asyncHandler(async (req, res) => {
    const service = getCostPredictionService();

    // Try taskId first
    const taskIdParse = predictByTaskIdSchema.safeParse(req.body);
    if (taskIdParse.success) {
      const taskService = getTaskService();
      const task = await taskService.getTask(taskIdParse.data.taskId);
      if (!task) {
        throw new NotFoundError('Task not found');
      }

      const prediction = await service.predict({
        type: task.type,
        priority: task.priority,
        project: task.project,
        description: task.description,
        subtasks: task.subtasks,
      });

      // Store prediction on the task
      await taskService.updateTask(task.id, {
        costPrediction: prediction,
      } as Record<string, unknown>);

      return res.json(prediction);
    }

    // Fall back to metadata
    const metaParse = predictByMetadataSchema.safeParse(req.body);
    if (metaParse.success) {
      const { type, priority, project, description, subtaskCount } = metaParse.data;
      const prediction = await service.predict({
        type,
        priority,
        project,
        description,
        subtaskCount,
      });
      return res.json(prediction);
    }

    throw new ValidationError('Provide either { taskId } or { type, priority, ... }');
  })
);

/**
 * GET /api/cost-prediction/accuracy/stats
 * Get aggregate accuracy statistics (must be before /accuracy to avoid collision)
 */
router.get(
  '/accuracy/stats',
  asyncHandler(async (_req, res) => {
    const service = getCostPredictionService();
    const stats = await service.getAccuracyStats();
    res.json(stats);
  })
);

/**
 * GET /api/cost-prediction/accuracy
 * Get prediction accuracy for completed tasks
 */
router.get(
  '/accuracy',
  asyncHandler(async (req, res) => {
    const service = getCostPredictionService();
    const accuracy = await service.getAccuracy({
      limit: req.query.limit ? Number(req.query.limit) : undefined,
      type: req.query.type as string | undefined,
    });
    res.json(accuracy);
  })
);

export { router as costPredictionRoutes };
