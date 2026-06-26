import { Router, type Router as RouterType } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/async-handler.js';
import type { AuthenticatedRequest } from '../middleware/auth.js';
import { ValidationError } from '../middleware/error-handler.js';
import { getCeremonyService } from '../services/ceremony-service.js';

const router: RouterType = Router();

const ceremonyKindSchema = z.enum(['design_review', 'failure_retrospective']);
const ceremonyStatusSchema = z.enum(['pending', 'completed', 'cancelled']);
const ceremonyModeSchema = z.enum(['off', 'warn', 'block']);
const participantRoleSchema = z.enum([
  'coordinator',
  'implementer',
  'reviewer',
  'security-owner',
  'qa-owner',
  'human-approver',
]);
const artifactKindSchema = z.enum([
  'decision-packet',
  'risk-list',
  'retrospective',
  'action-items',
  'github-issues',
]);

const targetSchema = z
  .object({
    taskId: z.string().min(1).optional(),
    runId: z.string().min(1).optional(),
    workflowId: z.string().min(1).optional(),
    prUrl: z.string().url().optional(),
    ciUrl: z.string().url().optional(),
  })
  .refine((target) => Object.values(target).some(Boolean), {
    message: 'At least one ceremony target identifier is required',
  });

const participantSchema = z.object({
  role: participantRoleSchema,
  name: z.string().min(1).optional(),
  agent: z.string().min(1).optional(),
});

const createCeremonySchema = z.object({
  kind: ceremonyKindSchema,
  enforcementMode: ceremonyModeSchema.optional(),
  title: z.string().min(1).max(200).optional(),
  reason: z.string().min(1).max(2000),
  target: targetSchema,
  trigger: z.string().min(1).max(120),
  dueAt: z.string().datetime().optional(),
  participants: z.array(participantSchema).max(20).optional(),
  requiredArtifacts: z.array(artifactKindSchema).max(12).optional(),
});

const completeCeremonySchema = z.object({
  completedBy: z.string().min(1).optional(),
  artifacts: z
    .array(
      z.object({
        kind: artifactKindSchema,
        title: z.string().min(1).max(200),
        body: z.string().min(1).max(10000),
        url: z.string().url().optional(),
        createdAt: z.string().datetime().optional(),
      })
    )
    .max(20)
    .optional(),
  actionItems: z
    .array(
      z.object({
        title: z.string().min(1).max(200),
        assignee: z.string().min(1).optional(),
        priority: z.enum(['low', 'medium', 'high', 'critical']).optional(),
        dueAt: z.string().datetime().optional(),
        taskId: z.string().min(1).optional(),
        issueUrl: z.string().url().optional(),
        createdAt: z.string().datetime().optional(),
      })
    )
    .max(50)
    .optional(),
});

const listQuerySchema = z.object({
  status: ceremonyStatusSchema.optional(),
  kind: ceremonyKindSchema.optional(),
  taskId: z.string().min(1).optional(),
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
  '/',
  asyncHandler(async (req, res) => {
    const query = parseOrThrow(listQuerySchema, req.query);
    res.json(await getCeremonyService().list(query));
  })
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const body = parseOrThrow(createCeremonySchema, req.body);
    const requirement = await getCeremonyService().create(body);
    res.status(201).json(requirement);
  })
);

router.post(
  '/:id/complete',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const id = String(req.params.id);
    const body = parseOrThrow(completeCeremonySchema, req.body);
    const requirement = await getCeremonyService().complete(id, {
      ...body,
      completedBy: body.completedBy ?? actorFromRequest(req),
    });
    res.json(requirement);
  })
);

export { router as ceremonyRoutes };
