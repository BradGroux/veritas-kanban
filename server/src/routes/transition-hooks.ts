/**
 * Transition Hooks API Routes
 *
 * Endpoints for managing transition hook configuration (quality gates).
 */

import { Router, type Router as RouterType } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/async-handler.js';
import { ValidationError } from '../middleware/error-handler.js';
import { authorize } from '../middleware/auth.js';
import {
  getTransitionHooksConfig,
  updateTransitionHooksConfig,
  validateTransition,
} from '../services/transition-hooks-service.js';
import { getTaskService } from '../services/task-service.js';
import type { TransitionHooksConfig, TransitionRule } from '@veritas-kanban/shared';

const router: RouterType = Router();

// ---------------------------------------------------------------------------
// Validation Schemas
// ---------------------------------------------------------------------------

const gateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: z.enum([
    'require-agent',
    'require-plan',
    'require-verification-complete',
    'require-time-tracked',
    'require-closing-comment',
    'require-subtasks-complete',
    'require-blocker-reason',
  ]),
  enabled: z.boolean(),
  projects: z.array(z.string()).optional(),
  taskTypes: z.array(z.string()).optional(),
  errorMessage: z.string().optional(),
});

const actionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: z.enum([
    'auto-start-timer',
    'auto-stop-timer',
    'send-webhook',
    'send-notification',
    'prompt-lessons-learned',
    'log-activity',
  ]),
  enabled: z.boolean(),
  projects: z.array(z.string()).optional(),
  taskTypes: z.array(z.string()).optional(),
  webhookUrl: z.string().url().optional(),
  notificationChannel: z.string().optional(),
});

const ruleSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  enabled: z.boolean(),
  from: z.union([
    z.enum(['todo', 'in-progress', 'blocked', 'done', 'cancelled']),
    z.array(z.enum(['todo', 'in-progress', 'blocked', 'done', 'cancelled'])),
    z.literal('*'),
  ]),
  to: z.union([
    z.enum(['todo', 'in-progress', 'blocked', 'done', 'cancelled']),
    z.array(z.enum(['todo', 'in-progress', 'blocked', 'done', 'cancelled'])),
    z.literal('*'),
  ]),
  gates: z.array(gateSchema),
  actions: z.array(actionSchema),
  projects: z.array(z.string()).optional(),
  taskTypes: z.array(z.string()).optional(),
});

const configSchema = z.object({
  enabled: z.boolean(),
  rules: z.array(ruleSchema),
  defaultGates: z.array(gateSchema).optional(),
  defaultActions: z.array(actionSchema).optional(),
});

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/**
 * GET /api/settings/transition-hooks
 * Get the current transition hooks configuration.
 */
router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const config = await getTransitionHooksConfig();
    res.json({
      success: true,
      data: config,
    });
  })
);

/**
 * PUT /api/settings/transition-hooks
 * Update the transition hooks configuration.
 * Requires admin role.
 */
router.put(
  '/',
  authorize('admin'),
  asyncHandler(async (req, res) => {
    let config: TransitionHooksConfig;
    try {
      config = configSchema.parse(req.body);
    } catch (err) {
      if (err instanceof z.ZodError) {
        throw new ValidationError('Invalid configuration', err.errors);
      }
      throw err;
    }

    const updated = await updateTransitionHooksConfig(config);
    res.json({
      success: true,
      data: updated,
    });
  })
);

/**
 * PATCH /api/settings/transition-hooks
 * Partially update the transition hooks configuration.
 * Requires admin role.
 */
router.patch(
  '/',
  authorize('admin'),
  asyncHandler(async (req, res) => {
    const current = await getTransitionHooksConfig();
    const merged = { ...current, ...req.body };

    let config: TransitionHooksConfig;
    try {
      config = configSchema.parse(merged);
    } catch (err) {
      if (err instanceof z.ZodError) {
        throw new ValidationError('Invalid configuration', err.errors);
      }
      throw err;
    }

    const updated = await updateTransitionHooksConfig(config);
    res.json({
      success: true,
      data: updated,
    });
  })
);

/**
 * POST /api/settings/transition-hooks/validate
 * Validate a proposed transition without making changes.
 * Useful for UI feedback before attempting a status change.
 */
router.post(
  '/validate',
  asyncHandler(async (req, res) => {
    const { taskId, toStatus } = req.body;

    if (!taskId || typeof taskId !== 'string') {
      throw new ValidationError('taskId is required');
    }
    if (!toStatus || typeof toStatus !== 'string') {
      throw new ValidationError('toStatus is required');
    }

    const taskService = getTaskService();
    const task = await taskService.getTask(taskId);

    if (!task) {
      throw new ValidationError('Task not found');
    }

    const result = await validateTransition(task, task.status, toStatus as any);

    res.json({
      success: true,
      data: result,
    });
  })
);

/**
 * GET /api/settings/transition-hooks/rules/:id
 * Get a specific rule by ID.
 */
router.get(
  '/rules/:id',
  asyncHandler(async (req, res) => {
    const config = await getTransitionHooksConfig();
    const rule = config.rules.find((r: TransitionRule) => r.id === req.params.id);

    if (!rule) {
      res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Rule not found',
        },
      });
      return;
    }

    res.json({
      success: true,
      data: rule,
    });
  })
);

/**
 * PUT /api/settings/transition-hooks/rules/:id
 * Update a specific rule by ID.
 * Requires admin role.
 */
router.put(
  '/rules/:id',
  authorize('admin'),
  asyncHandler(async (req, res) => {
    const config = await getTransitionHooksConfig();
    const ruleIndex = config.rules.findIndex((r: TransitionRule) => r.id === req.params.id);

    if (ruleIndex === -1) {
      res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Rule not found',
        },
      });
      return;
    }

    let rule;
    try {
      rule = ruleSchema.parse(req.body);
    } catch (err) {
      if (err instanceof z.ZodError) {
        throw new ValidationError('Invalid rule', err.errors);
      }
      throw err;
    }

    config.rules[ruleIndex] = rule;
    await updateTransitionHooksConfig(config);

    res.json({
      success: true,
      data: rule,
    });
  })
);

/**
 * POST /api/settings/transition-hooks/rules
 * Create a new rule.
 * Requires admin role.
 */
router.post(
  '/rules',
  authorize('admin'),
  asyncHandler(async (req, res) => {
    let rule;
    try {
      rule = ruleSchema.parse(req.body);
    } catch (err) {
      if (err instanceof z.ZodError) {
        throw new ValidationError('Invalid rule', err.errors);
      }
      throw err;
    }

    const config = await getTransitionHooksConfig();

    // Check for duplicate ID
    if (config.rules.some((r: TransitionRule) => r.id === rule.id)) {
      throw new ValidationError('Rule with this ID already exists');
    }

    config.rules.push(rule);
    await updateTransitionHooksConfig(config);

    res.status(201).json({
      success: true,
      data: rule,
    });
  })
);

/**
 * DELETE /api/settings/transition-hooks/rules/:id
 * Delete a rule by ID.
 * Requires admin role.
 */
router.delete(
  '/rules/:id',
  authorize('admin'),
  asyncHandler(async (req, res) => {
    const config = await getTransitionHooksConfig();
    const ruleIndex = config.rules.findIndex((r: TransitionRule) => r.id === req.params.id);

    if (ruleIndex === -1) {
      res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Rule not found',
        },
      });
      return;
    }

    config.rules.splice(ruleIndex, 1);
    await updateTransitionHooksConfig(config);

    res.status(204).send();
  })
);

export default router;
