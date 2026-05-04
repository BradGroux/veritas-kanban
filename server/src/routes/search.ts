import { Router, type Router as RouterType } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/async-handler.js';
import { ValidationError } from '../middleware/error-handler.js';
import { getSearchService } from '../services/search-service.js';
import type { SearchBackend, SearchCollection } from '../services/search-service.js';

const router: RouterType = Router();

const SearchBodySchema = z.object({
  query: z.string().trim().min(1).max(500),
  limit: z.number().int().min(1).max(50).optional(),
  collections: z
    .array(z.enum(['tasks-active', 'tasks-archive', 'docs']))
    .min(1)
    .max(3)
    .optional(),
  backend: z.enum(['auto', 'qmd', 'keyword']).optional(),
  minScore: z.number().min(0).max(1).optional(),
});

const RefreshBodySchema = z
  .object({
    embed: z.boolean().optional(),
  })
  .optional();

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const parsed = SearchBodySchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(
        'Validation failed',
        parsed.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        }))
      );
    }

    const body = parsed.data;
    const service = getSearchService();
    const result = await service.search({
      query: body.query,
      limit: body.limit,
      collections: body.collections as SearchCollection[] | undefined,
      backend: body.backend as SearchBackend | undefined,
      minScore: body.minScore,
    });
    res.json(result);
  })
);

router.post(
  '/index/refresh',
  asyncHandler(async (req, res) => {
    const parsed = RefreshBodySchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(
        'Validation failed',
        parsed.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        }))
      );
    }

    const result = await getSearchService().refreshIndex({ embed: parsed.data?.embed });
    res.json(result);
  })
);

export { router as searchRoutes };
