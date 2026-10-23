import { Router, type Router as RouterType } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { getTaskService } from '../services/task-service.js';
import { asyncHandler } from '../middleware/async-handler.js';
import { NotFoundError, ValidationError } from '../middleware/error-handler.js';
import type { Subtask } from '@veritas-kanban/shared';
import { expectedRevisionFromRequest, setRevisionHeaders } from '../utils/concurrency.js';

const router: RouterType = Router();
const taskService = getTaskService();

// Validation schemas
const addSubtaskSchema = z.object({
  title: z.string().min(1).max(200),
  acceptanceCriteria: z.array(z.string()).optional(),
});

const updateSubtaskSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  completed: z.boolean().optional(),
  acceptanceCriteria: z.array(z.string()).optional(),
  criteriaChecked: z.array(z.boolean()).optional(),
});

// POST /api/tasks/:id/subtasks - Add subtask
router.post(
  '/:id/subtasks',
  asyncHandler(async (req, res) => {
    let title: string;
    let acceptanceCriteria: string[] | undefined;
    try {
      ({ title, acceptanceCriteria } = addSubtaskSchema.parse(req.body));
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new ValidationError('Validation failed', error.issues);
      }
      throw error;
    }

    const subtask = {
      id: `subtask_${randomUUID()}`,
      title,
      completed: false,
      created: new Date().toISOString(),
      ...(acceptanceCriteria && {
        acceptanceCriteria,
        criteriaChecked: new Array(acceptanceCriteria.length).fill(false),
      }),
    };

    const updatedTask = await taskService.mutateTaskChildren(
      req.params.id as string,
      (task) => ({ subtasks: [...(task.subtasks || []), subtask] }),
      { expectedRevision: expectedRevisionFromRequest(req) }
    );
    if (!updatedTask) throw new NotFoundError('Task not found');
    setRevisionHeaders(res, 'task', updatedTask.id, updatedTask);

    res.status(201).json(updatedTask);
  })
);

// PATCH /api/tasks/:id/subtasks/:subtaskId - Update subtask
router.patch(
  '/:id/subtasks/:subtaskId',
  asyncHandler(async (req, res) => {
    let updates;
    try {
      updates = updateSubtaskSchema.parse(req.body);
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new ValidationError('Validation failed', error.issues);
      }
      throw error;
    }

    const updatedTask = await taskService.mutateTaskChildren(
      req.params.id as string,
      (task) => {
        const subtasks = [...(task.subtasks || [])];
        const subtaskIndex = subtasks.findIndex((s) => s.id === req.params.subtaskId);
        if (subtaskIndex === -1) throw new NotFoundError('Subtask not found');
        subtasks[subtaskIndex] = { ...subtasks[subtaskIndex], ...updates };
        return { subtasks };
      },
      { expectedRevision: expectedRevisionFromRequest(req), completeOnSubtasks: true }
    );
    if (!updatedTask) throw new NotFoundError('Task not found');
    setRevisionHeaders(res, 'task', updatedTask.id, updatedTask);

    res.json(updatedTask);
  })
);

// DELETE /api/tasks/:id/subtasks/:subtaskId - Delete subtask
router.delete(
  '/:id/subtasks/:subtaskId',
  asyncHandler(async (req, res) => {
    const updatedTask = await taskService.mutateTaskChildren(
      req.params.id as string,
      (task) => {
        const subtasks = (task.subtasks || []).filter(
          (s: Subtask) => s.id !== (req.params.subtaskId as string)
        );
        return { subtasks };
      },
      { expectedRevision: expectedRevisionFromRequest(req) }
    );
    if (!updatedTask) throw new NotFoundError('Task not found');
    setRevisionHeaders(res, 'task', updatedTask.id, updatedTask);

    res.json(updatedTask);
  })
);

// PATCH /api/tasks/:id/subtasks/:subtaskId/criteria/:index - Toggle individual criterion
router.patch(
  '/:id/subtasks/:subtaskId/criteria/:index',
  asyncHandler(async (req, res) => {
    const criteriaIndex = parseInt(req.params.index as string, 10);
    if (isNaN(criteriaIndex) || criteriaIndex < 0) {
      throw new ValidationError('Invalid criteria index');
    }

    const updatedTask = await taskService.mutateTaskChildren(
      req.params.id as string,
      (task) => {
        const subtasks = [...(task.subtasks || [])];
        const subtaskIndex = subtasks.findIndex((s) => s.id === (req.params.subtaskId as string));
        if (subtaskIndex === -1) {
          throw new NotFoundError('Subtask not found');
        }

        const subtask = subtasks[subtaskIndex];
        if (!subtask.acceptanceCriteria || !subtask.criteriaChecked) {
          throw new ValidationError('Subtask has no acceptance criteria');
        }

        if (criteriaIndex >= subtask.acceptanceCriteria.length) {
          throw new ValidationError('Criteria index out of range');
        }

        // Toggle the specific criterion
        const newCriteriaChecked = [...subtask.criteriaChecked];
        newCriteriaChecked[criteriaIndex] = !newCriteriaChecked[criteriaIndex];

        subtasks[subtaskIndex] = {
          ...subtask,
          criteriaChecked: newCriteriaChecked,
        };
        return { subtasks };
      },
      { expectedRevision: expectedRevisionFromRequest(req) }
    );
    if (!updatedTask) throw new NotFoundError('Task not found');
    setRevisionHeaders(res, 'task', updatedTask.id, updatedTask);

    res.json(updatedTask);
  })
);

export { router as taskSubtaskRoutes };
