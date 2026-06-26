import { Router, type Router as RouterType } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/async-handler.js';
import type { AuthenticatedRequest } from '../middleware/auth.js';
import { ValidationError } from '../middleware/error-handler.js';
import { getReflectionService } from '../services/reflection-service.js';

const router: RouterType = Router();

const categorySchema = z.enum(['session', 'agent', 'team', 'policy', 'template']);
const statusSchema = z.enum(['pending', 'accepted', 'rejected', 'deleted']);
const sourceKindSchema = z.enum([
  'task-run',
  'chat-message',
  'error',
  'user-correction',
  'review-feedback',
  'task-observation',
]);
const promotionTargetSchema = z.enum([
  'task-lesson',
  'memory',
  'decision',
  'profile',
  'template',
  'policy',
]);

const sourceSchema = z
  .object({
    kind: sourceKindSchema,
    taskId: z.string().min(1).optional(),
    runId: z.string().min(1).optional(),
    messageId: z.string().min(1).optional(),
    errorId: z.string().min(1).optional(),
    observationId: z.string().min(1).optional(),
    reviewId: z.string().min(1).optional(),
    url: z.string().url().optional(),
  })
  .refine((source) => Object.entries(source).some(([key, value]) => key !== 'kind' && !!value), {
    message: 'At least one reflection source identifier is required',
  });

const evidenceSchema = z.object({
  kind: z.union([sourceKindSchema, z.literal('note')]),
  title: z.string().min(1).max(200),
  content: z.string().min(1).max(4000),
  url: z.string().url().optional(),
});

const createReflectionSchema = z.object({
  category: categorySchema,
  promotionTarget: promotionTargetSchema.optional(),
  confidence: z.number().min(0).max(1).optional(),
  source: sourceSchema,
  summary: z.string().min(1).max(4000),
  previousApproach: z.string().min(1).max(4000),
  correction: z.string().min(1).max(4000),
  nextAttempt: z.string().min(1).max(4000),
  evidence: z.array(evidenceSchema).max(10).optional(),
  tags: z.array(z.string().min(1).max(80)).max(20).optional(),
  duplicateKey: z.string().min(1).max(240).optional(),
  createdBy: z.string().min(1).max(120).optional(),
});

const listQuerySchema = z.object({
  status: statusSchema.optional(),
  category: categorySchema.optional(),
  sourceKind: sourceKindSchema.optional(),
  taskId: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

const acceptReflectionSchema = z.object({
  reviewedBy: z.string().min(1).max(120).optional(),
  promotionTarget: promotionTargetSchema.optional(),
  reviewerNote: z.string().max(2000).optional(),
});

const rejectReflectionSchema = z.object({
  reviewedBy: z.string().min(1).max(120).optional(),
  reason: z.string().min(1).max(2000),
});

const deleteReflectionSchema = z.object({
  deletedBy: z.string().min(1).max(120).optional(),
  reason: z.string().max(2000).optional(),
});

const mergeReflectionSchema = z.object({
  mergedBy: z.string().min(1).max(120).optional(),
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
    res.json(await getReflectionService().list(query));
  })
);

router.post(
  '/',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const body = parseOrThrow(createReflectionSchema, req.body);
    const candidate = await getReflectionService().create({
      ...body,
      createdBy: body.createdBy ?? actorFromRequest(req),
    });
    res.status(201).json(candidate);
  })
);

router.post(
  '/:id/accept',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const body = parseOrThrow(acceptReflectionSchema, req.body);
    const candidate = await getReflectionService().accept(String(req.params.id), {
      ...body,
      reviewedBy: body.reviewedBy ?? actorFromRequest(req),
    });
    res.json(candidate);
  })
);

router.post(
  '/:id/reject',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const body = parseOrThrow(rejectReflectionSchema, req.body);
    const candidate = await getReflectionService().reject(String(req.params.id), {
      ...body,
      reviewedBy: body.reviewedBy ?? actorFromRequest(req),
    });
    res.json(candidate);
  })
);

router.post(
  '/:id/merge',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const body = parseOrThrow(mergeReflectionSchema, req.body);
    const candidate = await getReflectionService().mergeDuplicate(String(req.params.id), {
      mergedBy: body.mergedBy ?? actorFromRequest(req),
    });
    res.json(candidate);
  })
);

router.delete(
  '/:id',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const body = parseOrThrow(deleteReflectionSchema, req.body ?? {});
    const candidate = await getReflectionService().delete(String(req.params.id), {
      ...body,
      deletedBy: body.deletedBy ?? actorFromRequest(req),
    });
    res.json(candidate);
  })
);

export { router as reflectionRoutes };
