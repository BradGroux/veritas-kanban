import { Router, type Router as RouterType } from 'express';
import { z } from 'zod';
import { getTaskService } from '../services/task-service.js';
import { asyncHandler } from '../middleware/async-handler.js';
import { NotFoundError, ValidationError } from '../middleware/error-handler.js';

const router: RouterType = Router();
const taskService = getTaskService();

// Validation schemas
const addVerificationStepSchema = z.object({
  description: z.string().min(1).max(500),
});

const updateVerificationStepSchema = z.object({
  description: z.string().min(1).max(500).optional(),
  checked: z.boolean().optional(),
});

// POST /api/tasks/:id/verification - Add a verification step
router.post(
  '/:id/verification',
  asyncHandler(async (req, res) => {
    let description: string;
    try {
      ({ description } = addVerificationStepSchema.parse(req.body));
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new ValidationError('Validation failed', error.errors);
      }
      throw error;
    }

    const task = await taskService.getTask(req.params.id as string);
    if (!task) {
      throw new NotFoundError('Task not found');
    }

    const step = {
      id: `vstep_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      description,
      checked: false,
    };

    const verificationSteps = [...(task.verificationSteps || []), step];
    const updatedTask = await taskService.updateTask(req.params.id as string, {
      verificationSteps,
    });

    res.status(201).json(updatedTask);
  })
);

// PATCH /api/tasks/:id/verification/:stepId - Toggle or update a verification step
router.patch(
  '/:id/verification/:stepId',
  asyncHandler(async (req, res) => {
    let updates;
    try {
      updates = updateVerificationStepSchema.parse(req.body);
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new ValidationError('Validation failed', error.errors);
      }
      throw error;
    }

    const task = await taskService.getTask(req.params.id as string);
    if (!task) {
      throw new NotFoundError('Task not found');
    }

    const verificationSteps = task.verificationSteps || [];
    const stepIndex = verificationSteps.findIndex((s) => s.id === (req.params.stepId as string));
    if (stepIndex === -1) {
      throw new NotFoundError('Verification step not found');
    }

    const existingStep = verificationSteps[stepIndex];
    const updatedStep = { ...existingStep, ...updates };

    // Set/clear checkedAt timestamp when checked state changes
    if (updates.checked !== undefined && updates.checked !== existingStep.checked) {
      updatedStep.checkedAt = updates.checked ? new Date().toISOString() : undefined;
    }

    verificationSteps[stepIndex] = updatedStep;

    const updatedTask = await taskService.updateTask(req.params.id as string, {
      verificationSteps,
    });

    res.json(updatedTask);
  })
);

// DELETE /api/tasks/:id/verification/:stepId - Remove a verification step
router.delete(
  '/:id/verification/:stepId',
  asyncHandler(async (req, res) => {
    const task = await taskService.getTask(req.params.id as string);
    if (!task) {
      throw new NotFoundError('Task not found');
    }

    const verificationSteps = (task.verificationSteps || []).filter(
      (s) => s.id !== (req.params.stepId as string)
    );
    const updatedTask = await taskService.updateTask(req.params.id as string, {
      verificationSteps,
    });

    res.json(updatedTask);
  })
);

export { router as taskVerificationRoutes };
