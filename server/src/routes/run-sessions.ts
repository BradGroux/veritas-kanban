import { Router, type Router as RouterType } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/async-handler.js';
import { ValidationError } from '../middleware/error-handler.js';
import type { AuthenticatedRequest } from '../middleware/auth.js';
import {
  createRunSessionShareSchema,
  forkRunSessionSchema,
  revokeRunSessionShareSchema,
  runSessionApprovalResponseSchema,
  runSessionShareListQuerySchema,
  runSessionShareParamsSchema,
  sendRunSessionMessageSchema,
  updateRunSessionShareSchema,
} from '../schemas/run-session-schemas.js';
import { getRunSessionShareService } from '../services/run-session-share-service.js';
import type { RunSessionActor } from '@veritas-kanban/shared';

const router: RouterType = Router();

function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown): T {
  try {
    return schema.parse(value);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new ValidationError('Validation failed', error.issues);
    }
    throw error;
  }
}

function actorFromRequest(req: AuthenticatedRequest): RunSessionActor {
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
    clientMode: auth?.clientMode,
    workspaceId: auth?.workspaceId || 'local',
  };
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const query = parseOrThrow(runSessionShareListQuerySchema, req.query);
    res.json(await getRunSessionShareService().list(query, actorFromRequest(req)));
  })
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const body = parseOrThrow(createRunSessionShareSchema, req.body);
    const share = await getRunSessionShareService().create(body, actorFromRequest(req));
    res.status(201).json(share);
  })
);

router.get(
  '/:shareId',
  asyncHandler(async (req, res) => {
    const { shareId } = parseOrThrow(runSessionShareParamsSchema, req.params);
    res.json(await getRunSessionShareService().get(shareId, { actor: actorFromRequest(req) }));
  })
);

router.get(
  '/:shareId/events',
  asyncHandler(async (req, res) => {
    const { shareId } = parseOrThrow(runSessionShareParamsSchema, req.params);
    res.json(await getRunSessionShareService().listEvents(shareId, actorFromRequest(req)));
  })
);

router.patch(
  '/:shareId',
  asyncHandler(async (req, res) => {
    const { shareId } = parseOrThrow(runSessionShareParamsSchema, req.params);
    const body = parseOrThrow(updateRunSessionShareSchema, req.body);
    res.json(await getRunSessionShareService().update(shareId, body, actorFromRequest(req)));
  })
);

router.post(
  '/:shareId/revoke',
  asyncHandler(async (req, res) => {
    const { shareId } = parseOrThrow(runSessionShareParamsSchema, req.params);
    const body = parseOrThrow(revokeRunSessionShareSchema, req.body);
    res.json(await getRunSessionShareService().revoke(shareId, actorFromRequest(req), body.reason));
  })
);

router.post(
  '/:shareId/messages',
  asyncHandler(async (req, res) => {
    const { shareId } = parseOrThrow(runSessionShareParamsSchema, req.params);
    const body = parseOrThrow(sendRunSessionMessageSchema, req.body);
    res
      .status(201)
      .json(await getRunSessionShareService().sendMessage(shareId, body, actorFromRequest(req)));
  })
);

router.post(
  '/:shareId/approvals',
  asyncHandler(async (req, res) => {
    const { shareId } = parseOrThrow(runSessionShareParamsSchema, req.params);
    const body = parseOrThrow(runSessionApprovalResponseSchema, req.body);
    res
      .status(201)
      .json(
        await getRunSessionShareService().respondToApproval(shareId, body, actorFromRequest(req))
      );
  })
);

router.post(
  '/:shareId/fork',
  asyncHandler(async (req, res) => {
    const { shareId } = parseOrThrow(runSessionShareParamsSchema, req.params);
    const body = parseOrThrow(forkRunSessionSchema, req.body);
    res
      .status(201)
      .json(await getRunSessionShareService().fork(shareId, body, actorFromRequest(req)));
  })
);

export { router as runSessionRoutes };
