import { Router, type Router as RouterType } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/async-handler.js';
import {
  authorizePermission,
  type AuthenticatedRequest,
  type AuthPermission,
} from '../middleware/auth.js';
import { ValidationError } from '../middleware/error-handler.js';
import {
  getApiTokenService,
  SCOPED_API_TOKEN_PERMISSIONS,
  type ApiTokenService,
} from '../services/api-token-service.js';
import {
  getIdentityService,
  type IdentityActor,
  type IdentityService,
} from '../services/identity-service.js';
import { WORKSPACE_ROLES } from '../storage/sqlite/identity-repository.js';

const roleSchema = z.enum(WORKSPACE_ROLES);

const createInvitationSchema = z.object({
  email: z.string().email().optional(),
  role: roleSchema,
  expiresAt: z.string().datetime().optional(),
});

const acceptInvitationSchema = z.object({
  token: z.string().min(32),
  displayName: z.string().min(1).max(120).optional(),
  email: z.string().email().optional(),
});

const updateRoleSchema = z.object({
  role: roleSchema,
});

const createApiTokenSchema = z.object({
  name: z.string().trim().min(1).max(80),
  scopes: z.array(z.enum(SCOPED_API_TOKEN_PERMISSIONS)).min(1),
  expiresAt: z.string().datetime().optional().nullable(),
});

export function createIdentityRoutes(
  service?: IdentityService,
  apiTokenService?: ApiTokenService
): RouterType {
  const router: RouterType = Router();
  const serviceForRequest = () => service ?? getIdentityService();
  const tokenServiceForRequest = () => apiTokenService ?? getApiTokenService();

  router.get(
    '/profile',
    asyncHandler(async (req, res) => {
      res.json(serviceForRequest().getProfile(actorFromRequest(req as AuthenticatedRequest)));
    })
  );

  router.get(
    '/workspaces',
    asyncHandler(async (req, res) => {
      res.json(serviceForRequest().listWorkspaces(actorFromRequest(req as AuthenticatedRequest)));
    })
  );

  router.post(
    '/workspaces/switch',
    asyncHandler(async (req, res) => {
      const schema = z.object({ workspaceId: z.string().min(1) });
      const { workspaceId } = parseBody(schema, req.body);
      res.json(
        serviceForRequest().switchWorkspace(
          workspaceId,
          actorFromRequest(req as AuthenticatedRequest)
        )
      );
    })
  );

  router.get(
    '/workspaces/:workspaceId/members',
    asyncHandler(async (req, res) => {
      res.json(
        serviceForRequest().listMembers(
          String(req.params.workspaceId),
          actorFromRequest(req as AuthenticatedRequest)
        )
      );
    })
  );

  router.get(
    '/workspaces/:workspaceId/invitations',
    authorizePermission('admin:manage'),
    asyncHandler(async (req, res) => {
      res.json(
        serviceForRequest().listInvitations(
          String(req.params.workspaceId),
          actorFromRequest(req as AuthenticatedRequest)
        )
      );
    })
  );

  router.post(
    '/workspaces/:workspaceId/invitations',
    authorizePermission('admin:manage'),
    asyncHandler(async (req, res) => {
      const body = parseBody(createInvitationSchema, req.body);
      const result = await serviceForRequest().createInvitation(
        {
          workspaceId: String(req.params.workspaceId),
          email: body.email,
          role: body.role,
          expiresAt: body.expiresAt,
        },
        actorFromRequest(req as AuthenticatedRequest)
      );
      res.status(201).json(result);
    })
  );

  router.post(
    '/invitations/accept',
    asyncHandler(async (req, res) => {
      const body = parseBody(acceptInvitationSchema, req.body);
      const result = await serviceForRequest().acceptInvitation(body);
      res.status(201).json(result);
    })
  );

  router.post(
    '/invitations/:id/revoke',
    authorizePermission('admin:manage'),
    asyncHandler(async (req, res) => {
      const invitation = await serviceForRequest().revokeInvitation(
        String(req.params.id),
        actorFromRequest(req as AuthenticatedRequest)
      );
      res.json(invitation);
    })
  );

  router.patch(
    '/workspaces/:workspaceId/members/:userId',
    authorizePermission('admin:manage'),
    asyncHandler(async (req, res) => {
      const body = parseBody(updateRoleSchema, req.body);
      const membership = await serviceForRequest().updateMemberRole(
        String(req.params.workspaceId),
        String(req.params.userId),
        body.role,
        actorFromRequest(req as AuthenticatedRequest)
      );
      res.json(membership);
    })
  );

  router.delete(
    '/workspaces/:workspaceId/members/:userId',
    authorizePermission('admin:manage'),
    asyncHandler(async (req, res) => {
      const membership = await serviceForRequest().removeMember(
        String(req.params.workspaceId),
        String(req.params.userId),
        actorFromRequest(req as AuthenticatedRequest)
      );
      res.json(membership);
    })
  );

  router.get(
    '/workspaces/:workspaceId/api-tokens',
    authorizePermission('admin:manage'),
    asyncHandler(async (req, res) => {
      res.json(
        tokenServiceForRequest().listTokens(
          String(req.params.workspaceId),
          actorFromRequest(req as AuthenticatedRequest)
        )
      );
    })
  );

  router.post(
    '/workspaces/:workspaceId/api-tokens',
    authorizePermission('admin:manage'),
    asyncHandler(async (req, res) => {
      const body = parseBody(createApiTokenSchema, req.body);
      const result = await tokenServiceForRequest().createToken(
        {
          workspaceId: String(req.params.workspaceId),
          name: body.name,
          scopes: body.scopes as AuthPermission[],
          expiresAt: body.expiresAt,
        },
        actorFromRequest(req as AuthenticatedRequest)
      );
      res.status(201).json(result);
    })
  );

  router.post(
    '/workspaces/:workspaceId/api-tokens/:tokenId/revoke',
    authorizePermission('admin:manage'),
    asyncHandler(async (req, res) => {
      const token = await tokenServiceForRequest().revokeToken(
        String(req.params.tokenId),
        actorFromRequest(req as AuthenticatedRequest),
        String(req.params.workspaceId)
      );
      res.json(token);
    })
  );

  router.post(
    '/workspaces/:workspaceId/api-tokens/:tokenId/rotate',
    authorizePermission('admin:manage'),
    asyncHandler(async (req, res) => {
      const result = await tokenServiceForRequest().rotateToken(
        String(req.params.tokenId),
        actorFromRequest(req as AuthenticatedRequest),
        String(req.params.workspaceId)
      );
      res.status(201).json(result);
    })
  );

  return router;
}

function actorFromRequest(req: AuthenticatedRequest): IdentityActor {
  const role = req.auth?.role;
  const userId = req.auth?.userId ?? 'local-user';
  return {
    userId,
    role: role === 'agent' ? 'agent' : role === 'read-only' ? 'read-only' : 'owner',
    displayName: req.auth?.tokenName ?? req.auth?.keyName ?? userId,
    permissions: req.auth?.permissions,
  };
}

function parseBody<T extends z.ZodTypeAny>(schema: T, body: unknown): z.infer<T> {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError(
      'Invalid identity request',
      parsed.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      }))
    );
  }
  return parsed.data;
}

export const identityRoutes = createIdentityRoutes();
