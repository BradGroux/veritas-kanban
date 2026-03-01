/**
 * Tool Policy API Routes
 * GitHub Issue: #110
 *
 * CRUD operations for role-based tool access policies.
 *
 * NOTE: The responseEnvelopeMiddleware auto-wraps all res.json() calls in
 * { success, data, meta }. Do NOT manually wrap responses here.
 */

import express from 'express';
import { z } from 'zod';
import { getToolPolicyService } from '../services/tool-policy-service.js';
import { createLogger } from '../lib/logger.js';

const router = express.Router();
const log = createLogger('routes:tool-policies');
const toolPolicyService = getToolPolicyService();

// ==================== Validation Schemas ====================

const ToolPolicySchema = z.object({
  role: z.string().min(1).max(50),
  allowed: z.array(z.string()).max(100),
  denied: z.array(z.string()).max(100),
  description: z.string().max(500),
});

const RoleParamSchema = z.object({
  role: z.string().min(1),
});

// ==================== Helper: Async handler wrapper ====================

type AsyncHandler = (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) => Promise<void>;

function asyncHandler(fn: AsyncHandler): express.RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

// ==================== Routes ====================

/**
 * GET /api/tool-policies
 * List all tool policies
 */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const policies = await toolPolicyService.listPolicies();
    res.json(policies);
  })
);

/**
 * GET /api/tool-policies/:role
 * Get a specific tool policy by role
 */
router.get(
  '/:role',
  asyncHandler(async (req, res) => {
    const { role } = RoleParamSchema.parse(req.params);
    const policy = await toolPolicyService.getToolPolicy(role);

    if (!policy) {
      res.status(404).json({ error: `Tool policy not found for role: ${role}` });
      return;
    }

    res.json(policy);
  })
);

/**
 * POST /api/tool-policies
 * Create a new custom tool policy
 */
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const policy = ToolPolicySchema.parse(req.body);
    await toolPolicyService.savePolicy(policy);
    res.status(201).json(policy);
  })
);

/**
 * PUT /api/tool-policies/:role
 * Update an existing tool policy
 */
router.put(
  '/:role',
  asyncHandler(async (req, res) => {
    const { role } = RoleParamSchema.parse(req.params);
    const policyData = ToolPolicySchema.parse(req.body);

    if (policyData.role.toLowerCase() !== role.toLowerCase()) {
      res.status(400).json({ error: 'Role in URL does not match role in request body' });
      return;
    }

    const existing = await toolPolicyService.getToolPolicy(role);
    if (!existing) {
      res.status(404).json({ error: `Tool policy not found for role: ${role}` });
      return;
    }

    await toolPolicyService.savePolicy(policyData);
    res.json(policyData);
  })
);

/**
 * DELETE /api/tool-policies/:role
 * Delete a custom tool policy (cannot delete default policies)
 */
router.delete(
  '/:role',
  asyncHandler(async (req, res) => {
    const { role } = RoleParamSchema.parse(req.params);
    await toolPolicyService.deletePolicy(role);
    res.json({ deleted: role });
  })
);

/**
 * POST /api/tool-policies/:role/validate
 * Validate tool access for a specific role and tool
 */
router.post(
  '/:role/validate',
  asyncHandler(async (req, res) => {
    const { role } = RoleParamSchema.parse(req.params);
    const { tool } = z.object({ tool: z.string().min(1) }).parse(req.body);
    const allowed = await toolPolicyService.validateToolAccess(role, tool);
    res.json({ role, tool, allowed });
  })
);

// ==================== Error Handler ====================

router.use(
  (err: Error, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    log.error({ err, path: req.path, method: req.method }, 'Tool policy route error');

    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation failed', details: err.issues });
      return;
    }

    if (err.name === 'ValidationError') {
      res.status(400).json({ error: err.message });
      return;
    }

    res.status(500).json({ error: 'Internal server error' });
  }
);

export default router;
