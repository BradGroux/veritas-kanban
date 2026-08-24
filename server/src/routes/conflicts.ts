import { Router, type Router as RouterType } from 'express';
import { ConflictService } from '../services/conflict-service.js';
import { asyncHandler } from '../middleware/async-handler.js';
import { BadRequestError } from '../middleware/error-handler.js';
import { validate, type ValidatedRequest } from '../middleware/validate.js';
import {
  ConflictParamsSchema,
  ConflictFileQuerySchema,
  ResolveConflictBodySchema,
  ContinueMergeBodySchema,
  type ConflictParams,
  type ConflictFileQuery,
  type ResolveConflictBody,
  type ContinueMergeBody,
} from '../schemas/conflicts-schemas.js';

const router: RouterType = Router();
const conflictService = new ConflictService();

// GET /api/conflicts/:taskId - Get conflict status for a task
router.get(
  '/:taskId',
  validate({ params: ConflictParamsSchema }),
  asyncHandler(async (req: ValidatedRequest<ConflictParams>, res) => {
    const { taskId } = req.validated.params;
    const status = await conflictService.getConflictStatus(taskId);
    res.json(status);
  })
);

// GET /api/conflicts/:taskId/file - Get conflict details for a specific file
router.get(
  '/:taskId/file',
  validate({ params: ConflictParamsSchema, query: ConflictFileQuerySchema }),
  asyncHandler(async (req: ValidatedRequest<ConflictParams, ConflictFileQuery>, res) => {
    const { taskId } = req.validated.params;
    const { path } = req.validated.query;
    const conflict = await conflictService.getFileConflict(taskId, path);
    res.json(conflict);
  })
);

// POST /api/conflicts/:taskId/resolve - Resolve a file conflict
router.post(
  '/:taskId/resolve',
  validate({
    params: ConflictParamsSchema,
    query: ConflictFileQuerySchema,
    body: ResolveConflictBodySchema,
  }),
  asyncHandler(
    async (req: ValidatedRequest<ConflictParams, ConflictFileQuery, ResolveConflictBody>, res) => {
      const { taskId } = req.validated.params;
      const { path } = req.validated.query;
      const { resolution, manualContent } = req.validated.body;

      const result = await conflictService.resolveFile(taskId, path, resolution, manualContent);
      res.json(result);
    }
  )
);

// POST /api/conflicts/:taskId/abort - Abort rebase or merge
router.post(
  '/:taskId/abort',
  validate({ params: ConflictParamsSchema }),
  asyncHandler(async (req: ValidatedRequest<ConflictParams>, res) => {
    const { taskId } = req.validated.params;
    const status = await conflictService.getConflictStatus(taskId);

    if (status.rebaseInProgress) {
      await conflictService.abortRebase(taskId);
    } else if (status.mergeInProgress) {
      await conflictService.abortMerge(taskId);
    } else {
      throw new BadRequestError('No rebase or merge in progress');
    }

    res.json({ aborted: true });
  })
);

// POST /api/conflicts/:taskId/continue - Continue rebase or merge
router.post(
  '/:taskId/continue',
  validate({ params: ConflictParamsSchema, body: ContinueMergeBodySchema }),
  asyncHandler(async (req: ValidatedRequest<ConflictParams, unknown, ContinueMergeBody>, res) => {
    const { taskId } = req.validated.params;
    const { message } = req.validated.body;
    const status = await conflictService.getConflictStatus(taskId);

    let result;
    if (status.rebaseInProgress) {
      result = await conflictService.continueRebase(taskId);
    } else if (status.mergeInProgress) {
      result = await conflictService.continueMerge(taskId, message);
    } else {
      throw new BadRequestError('No rebase or merge in progress');
    }

    res.json(result);
  })
);

export default router;
