import { Router, type Router as RouterType } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/async-handler.js';
import type { AuthenticatedRequest } from '../middleware/auth.js';
import { ValidationError } from '../middleware/error-handler.js';
import { getExternalTrackerService } from '../services/external-tracker-service.js';
import type { Task } from '@veritas-kanban/shared';

const router: RouterType = Router();

const providerSchema = z.literal('mock');

const connectionSchema = z.object({
  provider: providerSchema.default('mock'),
  displayName: z.string().max(120).optional(),
  baseUrl: z.string().url().optional(),
  organization: z.string().max(120).optional(),
  project: z.string().max(120).optional(),
  token: z.string().max(4000).optional(),
});

const mappingSourceSchema = z.enum([
  'id',
  'title',
  'description',
  'type',
  'status',
  'priority',
  'project',
  'sprint',
  'github.url',
  'literal',
]);

const fieldMappingSchema = z.object({
  trackerFieldId: z.string().min(1).max(120),
  source: mappingSourceSchema,
  literalValue: z.string().max(4000).optional(),
  required: z.boolean().optional(),
});

const valueMappingsSchema = z
  .object({
    priority: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
    status: z.record(z.string(), z.string()).optional(),
    type: z.record(z.string(), z.string()).optional(),
  })
  .optional();

const profileSchema = z.object({
  id: z.string().min(1).max(120).optional(),
  name: z.string().min(1).max(120),
  provider: providerSchema.default('mock'),
  enabled: z.boolean().optional(),
  workspaceId: z.string().max(120).optional(),
  project: z.string().max(200).optional(),
  defaultWorkItemType: z.string().min(1).max(120),
  defaultProjectPath: z.string().max(200).optional(),
  defaultAreaPath: z.string().max(200).optional(),
  defaultTeamPath: z.string().max(200).optional(),
  defaultIterationPath: z.string().max(200).optional(),
  fieldMappings: z.array(fieldMappingSchema).min(1).max(50),
  valueMappings: valueMappingsSchema,
  backlinkFieldId: z.string().max(120).optional(),
});

const dryRunSchema = z
  .object({
    taskId: z.string().min(1).max(200).optional(),
    task: z.custom<Task>().optional(),
  })
  .refine((value) => value.taskId || value.task, {
    message: 'taskId or task is required',
  });

const createSchema = dryRunSchema.and(
  z.object({
    approvedBy: z.string().min(1).max(120),
  })
);

const auditQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

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

function actorFromRequest(req: AuthenticatedRequest): string {
  return (
    req.auth?.userId ||
    req.auth?.tokenName ||
    req.auth?.keyName ||
    req.auth?.clientId ||
    req.auth?.deviceId ||
    req.auth?.role ||
    'operator'
  );
}

router.get(
  '/connection',
  asyncHandler(async (_req, res) => {
    res.json(await getExternalTrackerService().getConnection());
  })
);

router.put(
  '/connection',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const body = parseOrThrow(connectionSchema, req.body);
    res.json(await getExternalTrackerService().saveConnection(body, actorFromRequest(req)));
  })
);

router.get(
  '/schema',
  asyncHandler(async (req, res) => {
    const provider = parseOrThrow(providerSchema.optional().default('mock'), req.query.provider);
    res.json(await getExternalTrackerService().getSchema(provider));
  })
);

router.post(
  '/introspect',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const body = parseOrThrow(
      connectionSchema.partial().extend({ provider: providerSchema.default('mock') }),
      req.body ?? {}
    );
    res.json(await getExternalTrackerService().introspect(body, actorFromRequest(req)));
  })
);

router.get(
  '/profiles',
  asyncHandler(async (_req, res) => {
    res.json(await getExternalTrackerService().listProfiles());
  })
);

router.put(
  '/profiles/:profileId',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const body = parseOrThrow(profileSchema, {
      ...req.body,
      id: req.params.profileId,
    });
    res.json(await getExternalTrackerService().saveProfile(body, actorFromRequest(req)));
  })
);

router.post(
  '/profiles/:profileId/validate',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    res.json(
      await getExternalTrackerService().validateProfile(
        String(req.params.profileId),
        actorFromRequest(req)
      )
    );
  })
);

router.post(
  '/profiles/:profileId/dry-run-create',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const body = parseOrThrow(dryRunSchema, req.body);
    res.json(
      await getExternalTrackerService().dryRunCreate(
        {
          ...body,
          profileId: String(req.params.profileId),
        },
        actorFromRequest(req)
      )
    );
  })
);

router.post(
  '/profiles/:profileId/create',
  asyncHandler(async (req, res) => {
    const body = parseOrThrow(createSchema, req.body);
    const result = await getExternalTrackerService().createWorkItem({
      ...body,
      profileId: String(req.params.profileId),
    });
    res.status(201).json(result);
  })
);

router.get(
  '/audits',
  asyncHandler(async (req, res) => {
    const query = parseOrThrow(auditQuerySchema, req.query);
    res.json(await getExternalTrackerService().listAudits(query.limit));
  })
);

export { router as externalTrackerRoutes };
