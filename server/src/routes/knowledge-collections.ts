import { Router, type Router as RouterType } from 'express';
import { z } from 'zod';
import type { KnowledgeAccessRole } from '@veritas-kanban/shared';
import { asyncHandler } from '../middleware/async-handler.js';
import type { AuthenticatedRequest } from '../middleware/auth.js';
import { NotFoundError, ValidationError } from '../middleware/error-handler.js';
import { sendPaginated } from '../middleware/response-envelope.js';
import {
  CreateKnowledgeCollectionBodySchema,
  RegisterKnowledgeSourceBodySchema,
} from '../schemas/knowledge-collection-schemas.js';
import {
  getKnowledgeCollectionService,
  type KnowledgeCollectionActor,
} from '../services/knowledge-collection-service.js';

const router: RouterType = Router();
const identifierSchema = z
  .string()
  .trim()
  .min(1)
  .max(240)
  .regex(/^[A-Za-z0-9._:-]+$/);
const paginationSchema = z
  .object({
    page: z.coerce.number().int().min(1).max(100_000).default(1),
    limit: z.coerce.number().int().min(1).max(500).default(100),
  })
  .strict();

router.get(
  '/',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const pagination = parseQuery(paginationSchema, req.query);
    const context = requestContext(req);
    const collections = await getKnowledgeCollectionService().listCollections(
      context.workspaceId,
      context.actor
    );
    sendPaginated(res, paginate(collections, pagination), {
      ...pagination,
      total: collections.length,
    });
  })
);

router.post(
  '/',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const input = parseBody(CreateKnowledgeCollectionBodySchema, req.body);
    const context = requestContext(req);
    const collection = await getKnowledgeCollectionService().createCollection(
      context.workspaceId,
      context.actor,
      input
    );
    res.status(201).json(collection);
  })
);

router.get(
  '/:collectionId',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const collectionId = parseIdentifier(req.params.collectionId);
    const context = requestContext(req);
    const collection = await getKnowledgeCollectionService().getCollection(
      context.workspaceId,
      collectionId,
      context.actor
    );
    if (!collection) throw new NotFoundError('Knowledge collection not found.');
    res.json(collection);
  })
);

router.get(
  '/:collectionId/sources',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const collectionId = parseIdentifier(req.params.collectionId);
    const pagination = parseQuery(paginationSchema, req.query);
    const context = requestContext(req);
    const sources = await getKnowledgeCollectionService().listSources(
      context.workspaceId,
      collectionId,
      context.actor
    );
    sendPaginated(res, paginate(sources, pagination), {
      ...pagination,
      total: sources.length,
    });
  })
);

router.post(
  '/:collectionId/sources',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const collectionId = parseIdentifier(req.params.collectionId);
    const input = parseBody(RegisterKnowledgeSourceBodySchema, req.body);
    const context = requestContext(req);
    const source = await getKnowledgeCollectionService().registerSource(
      context.workspaceId,
      collectionId,
      context.actor,
      input
    );
    res.status(201).json(source);
  })
);

router.get(
  '/:collectionId/sources/:sourceId',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const collectionId = parseIdentifier(req.params.collectionId);
    const sourceId = parseIdentifier(req.params.sourceId);
    const context = requestContext(req);
    const source = await getKnowledgeCollectionService().getSource(
      context.workspaceId,
      collectionId,
      sourceId,
      context.actor
    );
    if (!source) throw new NotFoundError('Knowledge source not found.');
    res.json(source);
  })
);

router.get(
  '/:collectionId/pages',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const collectionId = parseIdentifier(req.params.collectionId);
    const pagination = parseQuery(paginationSchema, req.query);
    const context = requestContext(req);
    const pages = await getKnowledgeCollectionService().listPages(
      context.workspaceId,
      collectionId,
      context.actor
    );
    sendPaginated(res, paginate(pages, pagination), {
      ...pagination,
      total: pages.length,
    });
  })
);

router.get(
  '/:collectionId/pages/:pageId',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const collectionId = parseIdentifier(req.params.collectionId);
    const pageId = parseIdentifier(req.params.pageId);
    const context = requestContext(req);
    const page = await getKnowledgeCollectionService().getPage(
      context.workspaceId,
      collectionId,
      pageId,
      context.actor
    );
    if (!page) throw new NotFoundError('Knowledge page not found.');
    res.json(page);
  })
);

function parseBody<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  throw new ValidationError(
    'Validation failed',
    parsed.error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    }))
  );
}

function parseQuery<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  throw new ValidationError(
    'Invalid knowledge collection query.',
    parsed.error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    }))
  );
}

function paginate<T>(items: T[], pagination: { page: number; limit: number }): T[] {
  const offset = (pagination.page - 1) * pagination.limit;
  return items.slice(offset, offset + pagination.limit);
}

function parseIdentifier(value: unknown): string {
  const parsed = identifierSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  throw new ValidationError('Invalid knowledge collection identifier.');
}

function requestContext(req: AuthenticatedRequest): {
  workspaceId: string;
  actor: KnowledgeCollectionActor;
} {
  const role = req.auth?.role as KnowledgeAccessRole | undefined;
  return {
    workspaceId: req.auth?.workspaceId ?? 'local',
    actor: {
      id: req.auth?.userId ?? req.auth?.keyName ?? role ?? 'unknown',
      role: role ?? 'read-only',
    },
  };
}

export { router as knowledgeCollectionRoutes };
