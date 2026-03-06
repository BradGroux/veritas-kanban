/**
 * Agent Routing API Routes
 *
 * POST /api/agents/route       — Resolve the best agent for a task
 * GET  /api/agents/routing     — Get current routing configuration
 * PUT  /api/agents/routing     — Update routing configuration
 */

import { Router, type Router as RouterType } from 'express';
import { z } from 'zod';
import { getAgentRoutingService } from '../services/agent-routing-service.js';
import { getTaskService } from '../services/task-service.js';
import { asyncHandler } from '../middleware/async-handler.js';
import { NotFoundError, ValidationError } from '../middleware/error-handler.js';

const router: RouterType = Router();

// ─── Validation Schemas ──────────────────────────────────────────

const routeByTaskIdSchema = z.object({
  taskId: z.string().min(1),
});

const routeByMetadataSchema = z.object({
  type: z.string().optional(),
  priority: z.enum(['low', 'medium', 'high']).optional(),
  project: z.string().optional(),
  subtaskCount: z.number().int().nonnegative().optional(),
});

const routingMatchSchema = z.object({
  type: z.union([z.string(), z.array(z.string())]).optional(),
  priority: z
    .union([z.enum(['low', 'medium', 'high']), z.array(z.enum(['low', 'medium', 'high']))])
    .optional(),
  project: z.union([z.string(), z.array(z.string())]).optional(),
  minSubtasks: z.number().int().nonnegative().optional(),
});

const routingRuleSchema = z.object({
  id: z.string().min(1).max(50),
  name: z.string().min(1).max(200),
  match: routingMatchSchema,
  agent: z.string().min(1).max(50),
  model: z.string().max(50).optional(),
  fallback: z.string().max(50).optional(),
  enabled: z.boolean(),
});

const routingConfigSchema = z.object({
  enabled: z.boolean(),
  rules: z.array(routingRuleSchema),
  defaultAgent: z.string().min(1).max(50),
  defaultModel: z.string().max(50).optional(),
  fallbackOnFailure: z.boolean(),
  maxRetries: z.number().int().min(0).max(3),
});

// ─── Routes ──────────────────────────────────────────────────────

/**
 * POST /api/agents/route
 *
 * Resolve the best agent for a task. Accepts either:
 * - { taskId: "..." } to look up an existing task
 * - { type, priority, project, subtaskCount } for ad-hoc routing
 */
router.post(
  '/route',
  asyncHandler(async (req, res) => {
    const routing = getAgentRoutingService();

    // Try taskId first
    const taskIdParse = routeByTaskIdSchema.safeParse(req.body);
    if (taskIdParse.success) {
      const taskService = getTaskService();
      const task = await taskService.getTask(taskIdParse.data.taskId);
      if (!task) {
        throw new NotFoundError('Task not found');
      }
      const result = await routing.resolveAgent(task);
      return res.json(result);
    }

    // Fall back to metadata
    const metaParse = routeByMetadataSchema.safeParse(req.body);
    if (metaParse.success) {
      const { type, priority, project, subtaskCount } = metaParse.data;
      const result = await routing.resolveAgent({
        type: type || 'feature',
        priority: priority || 'medium',
        project,
        subtasks: subtaskCount
          ? Array.from({ length: subtaskCount }, (_, i) => ({
              id: `stub_${i}`,
              title: '',
              completed: false,
              created: new Date().toISOString(),
            }))
          : undefined,
      });
      return res.json(result);
    }

    throw new ValidationError('Provide either { taskId } or { type, priority, ... }');
  })
);

/**
 * GET /api/agents/routing
 *
 * Get the current routing configuration.
 */
router.get(
  '/routing',
  asyncHandler(async (_req, res) => {
    const routing = getAgentRoutingService();
    const config = await routing.getRoutingConfig();
    res.json(config);
  })
);

/**
 * PUT /api/agents/routing
 *
 * Replace the entire routing configuration.
 */
router.put(
  '/routing',
  asyncHandler(async (req, res) => {
    let parsed;
    try {
      parsed = routingConfigSchema.parse(req.body);
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new ValidationError('Invalid routing config', error.issues);
      }
      throw error;
    }

    const routing = getAgentRoutingService();
    const updated = await routing.updateRoutingConfig(parsed);
    res.json(updated);
  })
);

export { router as agentRoutingRoutes };
