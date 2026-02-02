/**
 * Backlog Routes - API endpoints for backlog task management
 *
 * GET    /api/backlog          - List backlog tasks (paginated, filterable)
 * GET    /api/backlog/:id      - Get single backlog task
 * POST   /api/backlog          - Create task directly in backlog
 * PATCH  /api/backlog/:id      - Update a backlog task
 * DELETE /api/backlog/:id      - Delete a backlog task
 * POST   /api/backlog/:id/promote - Move task to active board
 * POST   /api/backlog/bulk-promote - Bulk promote tasks
 */

import { Router, type Router as RouterType } from 'express';
import { z } from 'zod';
import { getBacklogService } from '../services/backlog-service.js';
import { broadcastTaskChange } from '../services/broadcast-service.js';
import { asyncHandler } from '../middleware/async-handler.js';
import { NotFoundError, ValidationError } from '../middleware/error-handler.js';
import { auditLog } from '../services/audit-service.js';
import type { AuthenticatedRequest } from '../middleware/auth.js';
import { sendPaginated } from '../middleware/response-envelope.js';

const router: RouterType = Router();
const backlogService = getBacklogService();

// Validation schemas
const createBacklogTaskSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  description: z.string().optional(),
  type: z.string().optional(),
  priority: z.enum(['low', 'medium', 'high']).optional(),
  project: z.string().optional(),
  sprint: z.string().optional(),
  agent: z.string().optional(),
  subtasks: z.array(z.any()).optional(),
  blockedBy: z.array(z.string()).optional(),
});

const updateBacklogTaskSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  type: z.string().optional(),
  priority: z.enum(['low', 'medium', 'high']).optional(),
  project: z.string().optional(),
  sprint: z.string().optional(),
  agent: z.string().optional(),
  subtasks: z.array(z.any()).optional(),
  verificationSteps: z.array(z.any()).optional(),
  blockedBy: z.array(z.string()).optional(),
});

const bulkPromoteSchema = z.object({
  ids: z.array(z.string()).min(1, 'At least one task ID is required'),
});

// GET /api/backlog - List backlog tasks
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const project = req.query.project as string | undefined;
    const type = req.query.type as string | undefined;
    const search = req.query.search as string | undefined;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 100;
    const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;

    const offset = (page - 1) * limit;

    const result = await backlogService.listBacklogTasks({
      project,
      type,
      search,
      limit,
      offset,
    });

    sendPaginated(res, result.tasks, { page, limit, total: result.total });
  })
);

// GET /api/backlog/count - Get backlog count
router.get(
  '/count',
  asyncHandler(async (_req, res) => {
    const count = await backlogService.getBacklogCount();
    res.json({ success: true, data: { count } });
  })
);

// GET /api/backlog/:id - Get single backlog task
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const task = await backlogService.getBacklogTask(req.params.id as string);
    if (!task) {
      throw new NotFoundError('Backlog task not found');
    }
    res.json({ success: true, data: task });
  })
);

// POST /api/backlog - Create task directly in backlog
router.post(
  '/',
  asyncHandler(async (req, res) => {
    let input;
    try {
      input = createBacklogTaskSchema.parse(req.body);
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new ValidationError('Validation failed', error.errors);
      }
      throw error;
    }

    const task = await backlogService.createBacklogTask(input);

    // Audit log
    const authReq = req as AuthenticatedRequest;
    await auditLog({
      action: 'backlog.create',
      actor: authReq.auth?.keyName || 'unknown',
      resource: task.id,
      details: { title: task.title },
    });

    res.status(201).json({ success: true, data: task });
  })
);

// PATCH /api/backlog/:id - Update a backlog task
router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    let updates;
    try {
      updates = updateBacklogTaskSchema.parse(req.body);
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new ValidationError('Validation failed', error.errors);
      }
      throw error;
    }

    const task = await backlogService.updateBacklogTask(req.params.id as string, updates);

    // Audit log
    const authReq = req as AuthenticatedRequest;
    await auditLog({
      action: 'backlog.update',
      actor: authReq.auth?.keyName || 'unknown',
      resource: task.id,
      details: { title: task.title, updates },
    });

    res.json({ success: true, data: task });
  })
);

// DELETE /api/backlog/:id - Delete a backlog task
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const task = await backlogService.getBacklogTask(req.params.id as string);
    if (!task) {
      throw new NotFoundError('Backlog task not found');
    }

    const deleted = await backlogService.deleteBacklogTask(req.params.id as string);

    // Audit log
    const authReq = req as AuthenticatedRequest;
    await auditLog({
      action: 'backlog.delete',
      actor: authReq.auth?.keyName || 'unknown',
      resource: req.params.id as string,
      details: { title: task.title },
    });

    res.json({ success: true, data: { deleted } });
  })
);

// POST /api/backlog/:id/promote - Promote task to active board
router.post(
  '/:id/promote',
  asyncHandler(async (req, res) => {
    const task = await backlogService.promoteToActive(req.params.id as string);

    // Broadcast change to websocket clients
    broadcastTaskChange('created', task.id);

    // Audit log
    const authReq = req as AuthenticatedRequest;
    await auditLog({
      action: 'task.promoted',
      actor: authReq.auth?.keyName || 'unknown',
      resource: task.id,
      details: { title: task.title },
    });

    res.json({ success: true, data: task });
  })
);

// POST /api/backlog/bulk-promote - Bulk promote tasks
router.post(
  '/bulk-promote',
  asyncHandler(async (req, res) => {
    let input;
    try {
      input = bulkPromoteSchema.parse(req.body);
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new ValidationError('Validation failed', error.errors);
      }
      throw error;
    }

    const result = await backlogService.bulkPromote(input.ids);

    // Broadcast changes for successfully promoted tasks
    for (const id of result.promoted) {
      broadcastTaskChange('created', id);
    }

    // Audit log
    const authReq = req as AuthenticatedRequest;
    await auditLog({
      action: 'backlog.bulk_promote',
      actor: authReq.auth?.keyName || 'unknown',
      resource: 'bulk',
      details: { promoted: result.promoted.length, failed: result.failed.length },
    });

    res.json({ success: true, data: result });
  })
);

export { router as backlogRoutes };
