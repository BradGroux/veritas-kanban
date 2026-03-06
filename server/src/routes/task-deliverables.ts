import { Router, type Router as RouterType } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { getTaskService } from '../services/task-service.js';
import { activityService } from '../services/activity-service.js';
import { asyncHandler } from '../middleware/async-handler.js';
import { NotFoundError, ValidationError } from '../middleware/error-handler.js';
import {
  AddDeliverableBodySchema,
  UpdateDeliverableBodySchema,
} from '../schemas/deliverable-schemas.js';
import type { Deliverable } from '@veritas-kanban/shared';

const router: RouterType = Router();
const taskService = getTaskService();

// GET /api/tasks/:id/deliverables - List all deliverables for a task
router.get(
  '/:id/deliverables',
  asyncHandler(async (req, res) => {
    const task = await taskService.getTask(req.params.id as string);
    if (!task) {
      throw new NotFoundError('Task not found');
    }

    res.json(task.deliverables || []);
  })
);

// POST /api/tasks/:id/deliverables - Add a deliverable
router.post(
  '/:id/deliverables',
  asyncHandler(async (req, res) => {
    let body;
    try {
      body = AddDeliverableBodySchema.parse(req.body);
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new ValidationError('Validation failed', error.issues);
      }
      throw error;
    }

    const task = await taskService.getTask(req.params.id as string);
    if (!task) {
      throw new NotFoundError('Task not found');
    }

    const deliverable: Deliverable = {
      id: `deliverable_${randomUUID()}`,
      title: body.title,
      type: body.type,
      path: body.path,
      status: 'pending',
      agent: body.agent,
      created: new Date().toISOString(),
      description: body.description,
    };

    const deliverables = [...(task.deliverables || []), deliverable];
    const updatedTask = await taskService.updateTask(req.params.id as string, { deliverables });

    // Log activity
    await activityService.logActivity(
      'deliverable_added',
      task.id,
      task.title,
      {
        deliverableId: deliverable.id,
        deliverableTitle: deliverable.title,
        deliverableType: deliverable.type,
        agent: deliverable.agent,
      },
      task.agent
    );

    res.status(201).json(updatedTask);
  })
);

// PATCH /api/tasks/:id/deliverables/:deliverableId - Update a deliverable
router.patch(
  '/:id/deliverables/:deliverableId',
  asyncHandler(async (req, res) => {
    let body;
    try {
      body = UpdateDeliverableBodySchema.parse(req.body);
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new ValidationError('Validation failed', error.issues);
      }
      throw error;
    }

    const task = await taskService.getTask(req.params.id as string);
    if (!task) {
      throw new NotFoundError('Task not found');
    }

    const deliverables = task.deliverables || [];
    const deliverableIndex = deliverables.findIndex(
      (d: {
        id: string;
        title: string;
        type: string;
        status: string;
        created: string;
        path?: string;
        agent?: string;
        description?: string;
      }) => d.id === (req.params.deliverableId as string)
    );
    if (deliverableIndex === -1) {
      throw new NotFoundError('Deliverable not found');
    }

    // Update deliverable with provided fields
    deliverables[deliverableIndex] = {
      ...deliverables[deliverableIndex],
      ...body,
    };

    const updatedTask = await taskService.updateTask(req.params.id as string, { deliverables });

    // Log activity
    await activityService.logActivity(
      'deliverable_updated',
      task.id,
      task.title,
      {
        deliverableId: req.params.deliverableId as string,
        deliverableTitle: deliverables[deliverableIndex].title,
        updates: body,
      },
      task.agent
    );

    res.json(updatedTask);
  })
);

// DELETE /api/tasks/:id/deliverables/:deliverableId - Remove a deliverable
router.delete(
  '/:id/deliverables/:deliverableId',
  asyncHandler(async (req, res) => {
    const task = await taskService.getTask(req.params.id as string);
    if (!task) {
      throw new NotFoundError('Task not found');
    }

    const deliverables = task.deliverables || [];
    const filtered = deliverables.filter(
      (d: {
        id: string;
        title: string;
        type: string;
        status: string;
        created: string;
        path?: string;
        agent?: string;
        description?: string;
      }) => d.id !== (req.params.deliverableId as string)
    );
    if (filtered.length === deliverables.length) {
      throw new NotFoundError('Deliverable not found');
    }

    const removed = deliverables.find(
      (d: {
        id: string;
        title: string;
        type: string;
        status: string;
        created: string;
        path?: string;
        agent?: string;
        description?: string;
      }) => d.id === (req.params.deliverableId as string)
    );
    const updatedTask = await taskService.updateTask(req.params.id as string, {
      deliverables: filtered,
    });

    // Log activity
    await activityService.logActivity(
      'deliverable_deleted',
      task.id,
      task.title,
      {
        deliverableId: req.params.deliverableId as string,
        deliverableTitle: removed?.title,
      },
      task.agent
    );

    res.json(updatedTask);
  })
);

export { router as taskDeliverableRoutes };
