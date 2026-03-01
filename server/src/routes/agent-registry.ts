/**
 * Agent Registry API Routes
 *
 * POST   /api/agents/register          — Register or update an agent
 * POST   /api/agents/register/:id/heartbeat — Send heartbeat
 * DELETE /api/agents/register/:id       — Deregister an agent
 * GET    /api/agents/register           — List all registered agents
 * GET    /api/agents/register/:id       — Get specific agent
 * GET    /api/agents/register/stats     — Get registry statistics
 * GET    /api/agents/register/capabilities/:capability — Find agents by capability
 */

import { Router, type Router as RouterType } from 'express';
import { z } from 'zod';
import { getAgentRegistryService } from '../services/agent-registry-service.js';
import { asyncHandler } from '../middleware/async-handler.js';
import { NotFoundError, ValidationError } from '../middleware/error-handler.js';

const router: RouterType = Router();

// ─── Validation Schemas ──────────────────────────────────────────

const capabilitySchema = z.object({
  name: z.string().min(1).max(50),
  description: z.string().max(200).optional(),
});

const registerSchema = z.object({
  id: z.string().min(1).max(50),
  name: z.string().min(1).max(100),
  model: z.string().max(100).optional(),
  provider: z.string().max(50).optional(),
  capabilities: z.array(capabilitySchema).optional(),
  version: z.string().max(50).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  sessionKey: z.string().max(200).optional(),
});

const heartbeatSchema = z.object({
  status: z.enum(['online', 'busy', 'idle']).optional(),
  currentTaskId: z.string().max(100).optional().nullable(),
  currentTaskTitle: z.string().max(200).optional().nullable(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

// ─── Routes ──────────────────────────────────────────────────────

/**
 * GET /api/agents/register/stats
 * Get registry statistics (must be before /:id to avoid collision)
 */
router.get(
  '/stats',
  asyncHandler(async (_req, res) => {
    const registry = getAgentRegistryService();
    res.json(registry.stats());
  })
);

/**
 * GET /api/agents/register/capabilities/:capability
 * Find agents that have a specific capability
 */
router.get(
  '/capabilities/:capability',
  asyncHandler(async (req, res) => {
    const registry = getAgentRegistryService();
    const agents = registry.findByCapability(req.params.capability as string);
    res.json(agents);
  })
);

/**
 * POST /api/agents/register
 * Register or update an agent
 */
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError('Invalid registration', parsed.error.issues);
    }

    const registry = getAgentRegistryService();
    const agent = registry.register(parsed.data);
    res.status(201).json(agent);
  })
);

/**
 * GET /api/agents/register
 * List all registered agents, with optional filters
 */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const registry = getAgentRegistryService();
    const agents = registry.list({
      status: req.query.status as string | undefined,
      capability: req.query.capability as string | undefined,
    });
    res.json(agents);
  })
);

/**
 * GET /api/agents/register/:id
 * Get a specific agent
 */
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const registry = getAgentRegistryService();
    const agent = registry.get(req.params.id as string);
    if (!agent) {
      throw new NotFoundError('Agent not found');
    }
    res.json(agent);
  })
);

/**
 * POST /api/agents/register/:id/heartbeat
 * Send heartbeat for an agent
 */
router.post(
  '/:id/heartbeat',
  asyncHandler(async (req, res) => {
    const parsed = heartbeatSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError('Invalid heartbeat', parsed.error.issues);
    }

    const registry = getAgentRegistryService();
    const agent = registry.heartbeat(req.params.id as string, {
      ...parsed.data,
      currentTaskId: parsed.data.currentTaskId ?? undefined,
      currentTaskTitle: parsed.data.currentTaskTitle ?? undefined,
    });

    if (!agent) {
      throw new NotFoundError('Agent not registered. Call POST /api/agents/register first.');
    }

    res.json(agent);
  })
);

/**
 * DELETE /api/agents/register/:id
 * Deregister an agent
 */
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const registry = getAgentRegistryService();
    const removed = registry.deregister(req.params.id as string);
    if (!removed) {
      throw new NotFoundError('Agent not found');
    }
    res.json({ removed: true });
  })
);

export { router as agentRegistryRoutes };
