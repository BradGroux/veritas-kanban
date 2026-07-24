import { Router, type Router as RouterType } from 'express';
import { z } from 'zod';
import type { RunApprovalActor } from '@veritas-kanban/shared';
import { asyncHandler } from '../middleware/async-handler.js';
import { authorize, type AuthenticatedRequest } from '../middleware/auth.js';
import { ValidationError } from '../middleware/error-handler.js';
import { RunApprovalDecisionInputSchema } from '../schemas/run-approval-schemas.js';
import { getRunApprovalBrokerService } from '../services/run-approval-broker-service.js';

const router: RouterType = Router();

const querySchema = z
  .object({
    status: z.enum(['pending', 'approved', 'rejected', 'expired', 'cancelled']).optional(),
    taskId: z.string().trim().min(1).max(240).optional(),
    attemptId: z.string().trim().min(1).max(240).optional(),
    agentId: z.string().trim().min(1).max(240).optional(),
  })
  .strict();

const paramsSchema = z.object({
  approvalId: z.string().regex(/^runapproval_[A-Za-z0-9_-]{12,32}$/),
});

function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown): T {
  try {
    return schema.parse(value);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new ValidationError('Validation failed.', error.issues);
    }
    throw error;
  }
}

function actorFromRequest(req: AuthenticatedRequest): RunApprovalActor {
  const auth = req.auth;
  const id =
    auth?.userId ||
    auth?.tokenName ||
    auth?.keyName ||
    auth?.clientId ||
    auth?.deviceId ||
    auth?.role ||
    'operator';
  return {
    id,
    label: auth?.tokenName || auth?.keyName || auth?.clientId || auth?.userId || id,
    type: auth?.actorType,
    authMethod: auth?.authMethod,
    authenticatedAt: auth?.authenticatedAt,
    clientMode: auth?.clientMode,
    workspaceId: auth?.workspaceId || 'local',
  };
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const query = parseOrThrow(querySchema, req.query);
    const actor = actorFromRequest(req);
    res.json(
      await getRunApprovalBrokerService().list({
        workspaceId: actor.workspaceId,
        ...query,
      })
    );
  })
);

router.get(
  '/:approvalId',
  asyncHandler(async (req, res) => {
    const { approvalId } = parseOrThrow(paramsSchema, req.params);
    const actor = actorFromRequest(req);
    res.json(await getRunApprovalBrokerService().get(approvalId, actor.workspaceId));
  })
);

router.post(
  '/:approvalId/decision',
  authorize('admin'),
  asyncHandler(async (req, res) => {
    const { approvalId } = parseOrThrow(paramsSchema, req.params);
    const decision = parseOrThrow(RunApprovalDecisionInputSchema, req.body);
    res.json(
      await getRunApprovalBrokerService().decide(approvalId, decision, actorFromRequest(req))
    );
  })
);

export { router as runApprovalRoutes };
