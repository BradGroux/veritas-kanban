import { Router, type Router as RouterType } from 'express';
import { z } from 'zod';
import { DiffService } from '../services/diff-service.js';
import { CodexReviewService } from '../services/codex-review-service.js';
import { asyncHandler } from '../middleware/async-handler.js';
import { validate, type ValidatedRequest } from '../middleware/validate.js';
import { ValidationError } from '../middleware/error-handler.js';
import {
  DiffParamsSchema,
  DiffFileQuerySchema,
  type DiffParams,
  type DiffFileQuery,
} from '../schemas/diff-schemas.js';

const router: RouterType = Router();
const diffService = new DiffService();
const codexReviewService = new CodexReviewService();

const codexReviewSchema = z.object({
  model: z.string().optional(),
  instructions: z.string().optional(),
  save: z.boolean().optional(),
});

// GET /api/diff/:taskId - Get diff summary for task
router.get(
  '/:taskId',
  validate({ params: DiffParamsSchema }),
  asyncHandler(async (req: ValidatedRequest<DiffParams>, res) => {
    const { taskId } = req.validated.params!;
    const summary = await diffService.getDiffSummary(taskId);
    res.json(summary);
  })
);

// GET /api/diff/:taskId/file - Get diff for specific file
router.get(
  '/:taskId/file',
  validate({ params: DiffParamsSchema, query: DiffFileQuerySchema }),
  asyncHandler(async (req: ValidatedRequest<DiffParams, DiffFileQuery>, res) => {
    const { taskId } = req.validated.params!;
    const { path } = req.validated.query!;
    const diff = await diffService.getFileDiff(taskId, path);
    res.json(diff);
  })
);

// GET /api/diff/:taskId/full - Get full diff for all files
router.get(
  '/:taskId/full',
  validate({ params: DiffParamsSchema }),
  asyncHandler(async (req: ValidatedRequest<DiffParams>, res) => {
    const { taskId } = req.validated.params!;
    const diffs = await diffService.getFullDiff(taskId);
    res.json(diffs);
  })
);

// POST /api/diff/:taskId/codex-review - Run Codex against the task branch diff
router.post(
  '/:taskId/codex-review',
  validate({ params: DiffParamsSchema }),
  asyncHandler(async (req: ValidatedRequest<DiffParams>, res) => {
    let body;
    try {
      body = codexReviewSchema.parse(req.body || {});
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new ValidationError('Validation failed', error.issues);
      }
      throw error;
    }

    const { taskId } = req.validated.params!;
    const review = await codexReviewService.reviewTask({ taskId, ...body });
    res.status(201).json(review);
  })
);

export { router as diffRoutes };
