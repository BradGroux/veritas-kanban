/**
 * Lifecycle Hooks API Routes
 *
 * GET    /api/hooks              — List all hooks
 * POST   /api/hooks              — Create custom hook
 * PATCH  /api/hooks/:id          — Update hook
 * DELETE /api/hooks/:id          — Delete hook (disable if built-in)
 * POST   /api/hooks/fire         — Manually fire an event
 * GET    /api/hooks/executions   — Recent hook executions
 */

import { Router, type Router as RouterType } from 'express';
import { z } from 'zod';
import {
  getLifecycleHooksService,
  type LifecycleEvent,
  type HookAction,
} from '../services/lifecycle-hooks-service.js';
import { asyncHandler } from '../middleware/async-handler.js';
import { NotFoundError } from '../middleware/error-handler.js';

const router: RouterType = Router();

const EVENTS: LifecycleEvent[] = [
  'task.created',
  'task.started',
  'task.blocked',
  'task.done',
  'task.cancelled',
  'task.assigned',
  'task.commented',
  'task.reviewed',
];

const ACTIONS: HookAction[] = [
  'notify',
  'log_activity',
  'start_time',
  'stop_time',
  'verify_checklist',
  'request_context',
  'emit_telemetry',
  'webhook',
  'custom',
];

/**
 * GET /api/hooks
 */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const service = getLifecycleHooksService();
    const hooks = await service.listHooks({
      event: req.query.event as LifecycleEvent | undefined,
      enabledOnly: req.query.enabled === 'true',
    });
    res.json(hooks);
  })
);

/**
 * GET /api/hooks/executions
 */
router.get(
  '/executions',
  asyncHandler(async (req, res) => {
    const service = getLifecycleHooksService();
    const executions = await service.getExecutions({
      hookId: String(req.query.hookId || ''),
      taskId: String(req.query.taskId || ''),
      limit: req.query.limit ? Number(String(req.query.limit)) : 50,
    });
    res.json(executions);
  })
);

/**
 * POST /api/hooks
 */
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const schema = z.object({
      name: z.string().min(1),
      event: z.enum(EVENTS as [string, ...string[]]),
      action: z.enum(ACTIONS as [string, ...string[]]),
      enabled: z.boolean().optional(),
      taskTypeFilter: z.array(z.string()).optional(),
      projectFilter: z.array(z.string()).optional(),
      priorityFilter: z.array(z.string()).optional(),
      config: z.record(z.string(), z.unknown()).optional(),
      order: z.number().int().optional(),
    });
    const data = schema.parse(req.body);
    const service = getLifecycleHooksService();
    const hook = await service.createHook(data as Parameters<typeof service.createHook>[0]);
    res.status(201).json(hook);
  })
);

/**
 * PATCH /api/hooks/:id
 */
router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const schema = z.object({
      name: z.string().optional(),
      enabled: z.boolean().optional(),
      taskTypeFilter: z.array(z.string()).optional(),
      projectFilter: z.array(z.string()).optional(),
      priorityFilter: z.array(z.string()).optional(),
      config: z.record(z.string(), z.unknown()).optional(),
      order: z.number().int().optional(),
    });
    const update = schema.parse(req.body);
    const service = getLifecycleHooksService();
    const hook = await service.updateHook(String(req.params.id), update);
    if (!hook) throw new NotFoundError('Hook not found');
    res.json(hook);
  })
);

/**
 * DELETE /api/hooks/:id
 */
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const service = getLifecycleHooksService();
    const success = await service.deleteHook(String(req.params.id));
    if (!success) throw new NotFoundError('Hook not found');
    res.json({ success: true });
  })
);

/**
 * POST /api/hooks/fire — Manually fire a lifecycle event
 */
router.post(
  '/fire',
  asyncHandler(async (req, res) => {
    const schema = z.object({
      event: z.enum(EVENTS as [string, ...string[]]),
      taskId: z.string().min(1),
      taskTitle: z.string().optional(),
      taskType: z.string().optional(),
      project: z.string().optional(),
      priority: z.string().optional(),
      agent: z.string().optional(),
      previousStatus: z.string().optional(),
      newStatus: z.string().optional(),
    });
    const data = schema.parse(req.body);
    const service = getLifecycleHooksService();
    const results = await service.fireEvent(data.event as LifecycleEvent, data);
    res.json({ hooksRun: results.length, results });
  })
);

export { router as lifecycleHooksRoutes };
