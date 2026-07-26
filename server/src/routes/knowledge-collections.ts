import { Router, type Router as RouterType } from 'express';
import { z } from 'zod';
import type { KnowledgeAccessRole, KnowledgeLaunchContext } from '@veritas-kanban/shared';
import { asyncHandler } from '../middleware/async-handler.js';
import type { AuthenticatedRequest } from '../middleware/auth.js';
import { NotFoundError, ValidationError } from '../middleware/error-handler.js';
import { sendPaginated } from '../middleware/response-envelope.js';
import {
  CreateKnowledgeIngestionProposalBodySchema,
  CreateKnowledgeCitedExportBodySchema,
  CreateKnowledgeQueryPromotionBodySchema,
  CreateKnowledgeCollectionBodySchema,
  RegisterKnowledgeSourceBodySchema,
  RunKnowledgeIntegrityLintBodySchema,
  SearchKnowledgeCollectionBodySchema,
  TransitionKnowledgeClaimBodySchema,
  TransitionKnowledgeIntegrityFindingBodySchema,
  TransitionKnowledgeIngestionProposalBodySchema,
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

router.post(
  '/:collectionId/pages/:pageId/claims/:claimId/transitions',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const collectionId = parseIdentifier(req.params.collectionId);
    const pageId = parseIdentifier(req.params.pageId);
    const claimId = parseIdentifier(req.params.claimId);
    const input = parseBody(TransitionKnowledgeClaimBodySchema, req.body);
    const context = requestContext(req);
    const page = await getKnowledgeCollectionService().transitionClaim(
      context.workspaceId,
      collectionId,
      pageId,
      claimId,
      context.actor,
      input
    );
    res.json(page);
  })
);

router.post(
  '/:collectionId/integrity/lint',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const collectionId = parseIdentifier(req.params.collectionId);
    const input = parseBody(RunKnowledgeIntegrityLintBodySchema, req.body);
    const context = requestContext(req);
    const report = await getKnowledgeCollectionService().runIntegrityLint(
      context.workspaceId,
      collectionId,
      context.actor,
      input
    );
    res.json(report);
  })
);

router.get(
  '/:collectionId/integrity/findings',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const collectionId = parseIdentifier(req.params.collectionId);
    const pagination = parseQuery(paginationSchema, req.query);
    const context = requestContext(req);
    const findings = await getKnowledgeCollectionService().listIntegrityFindings(
      context.workspaceId,
      collectionId,
      context.actor
    );
    sendPaginated(res, paginate(findings, pagination), {
      ...pagination,
      total: findings.length,
    });
  })
);

router.get(
  '/:collectionId/integrity/health',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const collectionId = parseIdentifier(req.params.collectionId);
    const context = requestContext(req);
    res.json(
      await getKnowledgeCollectionService().getIntegrityHealth(
        context.workspaceId,
        collectionId,
        context.actor
      )
    );
  })
);

router.post(
  '/:collectionId/integrity/findings/:findingId/transitions',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const collectionId = parseIdentifier(req.params.collectionId);
    const findingId = parseIdentifier(req.params.findingId);
    const input = parseBody(TransitionKnowledgeIntegrityFindingBodySchema, req.body);
    const context = requestContext(req);
    const finding = await getKnowledgeCollectionService().transitionIntegrityFinding(
      context.workspaceId,
      collectionId,
      findingId,
      context.actor,
      input
    );
    res.json(finding);
  })
);

router.post(
  '/:collectionId/search',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const collectionId = parseIdentifier(req.params.collectionId);
    const input = parseBody(SearchKnowledgeCollectionBodySchema, req.body);
    const context = requestContext(req);
    const result = await getKnowledgeCollectionService().searchCollection(
      context.workspaceId,
      collectionId,
      context.actor,
      input
    );
    res.json(result);
  })
);

router.post(
  '/:collectionId/search/promotions',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const collectionId = parseIdentifier(req.params.collectionId);
    const input = parseBody(CreateKnowledgeQueryPromotionBodySchema, req.body);
    const context = requestContext(req);
    const proposal = await getKnowledgeCollectionService().createQueryPromotion(
      context.workspaceId,
      collectionId,
      context.actor,
      input
    );
    res.status(201).json(proposal);
  })
);

router.post(
  '/:collectionId/exports',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const collectionId = parseIdentifier(req.params.collectionId);
    const input = parseBody(CreateKnowledgeCitedExportBodySchema, req.body);
    const context = requestContext(req);
    const product = await getKnowledgeCollectionService().createCitedExport(
      context.workspaceId,
      collectionId,
      context.actor,
      input
    );
    res.status(201).json(product);
  })
);

router.get(
  '/:collectionId/ingestion/proposals',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const collectionId = parseIdentifier(req.params.collectionId);
    const pagination = parseQuery(paginationSchema, req.query);
    const context = requestContext(req);
    const proposals = await getKnowledgeCollectionService().listIngestionProposals(
      context.workspaceId,
      collectionId,
      context.actor
    );
    sendPaginated(res, paginate(proposals, pagination), {
      ...pagination,
      total: proposals.length,
    });
  })
);

router.post(
  '/:collectionId/ingestion/proposals',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const collectionId = parseIdentifier(req.params.collectionId);
    const input = parseBody(CreateKnowledgeIngestionProposalBodySchema, req.body);
    const context = requestContext(req);
    const proposal = await getKnowledgeCollectionService().createIngestionProposal(
      context.workspaceId,
      collectionId,
      context.actor,
      input
    );
    res.status(201).json(proposal);
  })
);

router.get(
  '/:collectionId/ingestion/proposals/:proposalId',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const collectionId = parseIdentifier(req.params.collectionId);
    const proposalId = parseIdentifier(req.params.proposalId);
    const context = requestContext(req);
    const proposal = await getKnowledgeCollectionService().getIngestionProposal(
      context.workspaceId,
      collectionId,
      proposalId,
      context.actor
    );
    if (!proposal) throw new NotFoundError('Knowledge ingestion proposal not found.');
    res.json(proposal);
  })
);

for (const action of ['apply', 'reverse'] as const) {
  router.post(
    `/:collectionId/ingestion/proposals/:proposalId/${action}`,
    asyncHandler(async (req: AuthenticatedRequest, res) => {
      const collectionId = parseIdentifier(req.params.collectionId);
      const proposalId = parseIdentifier(req.params.proposalId);
      const input = parseBody(TransitionKnowledgeIngestionProposalBodySchema, req.body);
      const context = requestContext(req);
      const proposal =
        action === 'apply'
          ? await getKnowledgeCollectionService().applyIngestionProposal(
              context.workspaceId,
              collectionId,
              proposalId,
              context.actor,
              input
            )
          : await getKnowledgeCollectionService().reverseIngestionProposal(
              context.workspaceId,
              collectionId,
              proposalId,
              context.actor,
              input
            );
      res.json(proposal);
    })
  );
}

router.get(
  '/:collectionId/activity',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const collectionId = parseIdentifier(req.params.collectionId);
    const pagination = parseQuery(paginationSchema, req.query);
    const context = requestContext(req);
    const activity = await getKnowledgeCollectionService().listKnowledgeActivity(
      context.workspaceId,
      collectionId,
      context.actor
    );
    sendPaginated(res, paginate(activity, pagination), {
      ...pagination,
      total: activity.length,
    });
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
  const launchContext = parseLaunchContext(req);
  return {
    workspaceId: req.auth?.workspaceId ?? 'local',
    actor: {
      id: req.auth?.userId ?? req.auth?.keyName ?? role ?? 'unknown',
      role: role ?? 'read-only',
      ...(launchContext ? { launchContext } : {}),
    },
  };
}

function parseLaunchContext(req: AuthenticatedRequest): KnowledgeLaunchContext | undefined {
  const values = {
    taskId: req.header('x-veritas-task-id'),
    attemptId: req.header('x-veritas-attempt-id'),
    launchManifestDigest: req.header('x-veritas-launch-manifest-digest'),
  };
  const supplied = Object.values(values).filter(Boolean).length;
  if (supplied === 0) return undefined;
  if (
    supplied !== 3 ||
    !values.taskId ||
    !values.attemptId ||
    !values.launchManifestDigest ||
    !identifierSchema.safeParse(values.taskId).success ||
    !identifierSchema.safeParse(values.attemptId).success ||
    !/^sha256:[a-f0-9]{64}$/.test(values.launchManifestDigest)
  ) {
    throw new ValidationError('Invalid or incomplete knowledge launch evidence headers.');
  }
  return values as KnowledgeLaunchContext;
}

export { router as knowledgeCollectionRoutes };
