/**
 * Delegation API Routes
 *
 * Endpoints for managing approval delegation (vacation mode).
 */

import { Router, type Router as RouterType } from 'express';
import { asyncHandler } from '../middleware/async-handler.js';
import { getDelegationService } from '../services/delegation-service.js';
import { SetDelegationRequestSchema } from '../schemas/delegation-schemas.js';
import { ValidationError } from '../middleware/error-handler.js';
import { auditLog } from '../services/audit-service.js';
import type { AuthenticatedRequest } from '../middleware/auth.js';
import { authorize } from '../middleware/auth.js';

const router: RouterType = Router();
const delegationService = getDelegationService();

/**
 * GET /api/delegation
 * Get current delegation settings
 */
router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const delegation = await delegationService.getDelegation();
    res.json({ delegation });
  })
);

/**
 * POST /api/delegation
 * Set delegation settings
 */
router.post(
  '/',
  authorize('admin'), // Only admins can set delegation
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const parsed = SetDelegationRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError('Invalid delegation settings', parsed.error.issues);
    }

    const { delegateAgent, expires, scope, excludePriorities, excludeTags, createdBy } =
      parsed.data;

    // Validate expires is in the future
    const expiresDate = new Date(expires);
    if (expiresDate <= new Date()) {
      throw new ValidationError('Expiry date must be in the future');
    }

    const delegation = await delegationService.setDelegation({
      delegateAgent,
      expires,
      scope,
      excludePriorities,
      excludeTags,
      createdBy,
    });

    // Audit log
    await auditLog({
      action: 'delegation.set',
      resource: 'delegation:current',
      actor: req.auth?.keyName || 'unknown',
      details: {
        delegateAgent,
        expires,
        scope,
      },
    });

    res.json({ delegation });
  })
);

/**
 * DELETE /api/delegation
 * Revoke delegation immediately
 */
router.delete(
  '/',
  authorize('admin'),
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const revoked = await delegationService.revokeDelegation();

    if (!revoked) {
      res.status(404).json({ error: 'No active delegation to revoke' });
      return;
    }

    // Audit log
    await auditLog({
      action: 'delegation.revoke',
      resource: 'delegation:current',
      actor: req.auth?.keyName || 'unknown',
    });

    res.json({ success: true });
  })
);

/**
 * GET /api/delegation/log
 * Get delegation approval log
 */
router.get(
  '/log',
  asyncHandler(async (req, res) => {
    const { taskId, agent, limit } = req.query;

    const approvals = await delegationService.getApprovalLog({
      taskId: taskId as string | undefined,
      agent: agent as string | undefined,
      limit: limit ? parseInt(limit as string, 10) : undefined,
    });

    res.json({ approvals });
  })
);

export default router;
