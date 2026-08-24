import { Router, type Router as RouterType } from 'express';
import { PreviewService } from '../services/preview-service.js';
import { asyncHandler } from '../middleware/async-handler.js';
import { validate, type ValidatedRequest } from '../middleware/validate.js';
import {
  PreviewParamsSchema,
  PreviewOutputQuerySchema,
  type PreviewParams,
  type PreviewOutputQuery,
} from '../schemas/preview-schemas.js';

const router: RouterType = Router();
const previewService = new PreviewService();

// GET /api/preview - List all running previews
router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const previews = previewService.getAllPreviews();
    res.json(previews);
  })
);

// GET /api/preview/:taskId - Get preview status for a task
router.get(
  '/:taskId',
  validate({ params: PreviewParamsSchema }),
  asyncHandler(async (req: ValidatedRequest<PreviewParams>, res) => {
    const { taskId } = req.validated.params;
    const status = previewService.getPreviewStatus(taskId);
    if (!status) {
      return res.json({ status: 'stopped' });
    }
    res.json(status);
  })
);

// GET /api/preview/:taskId/output - Get preview server output
router.get(
  '/:taskId/output',
  validate({ params: PreviewParamsSchema, query: PreviewOutputQuerySchema }),
  asyncHandler(async (req: ValidatedRequest<PreviewParams, PreviewOutputQuery>, res) => {
    const { taskId } = req.validated.params;
    const { lines } = req.validated.query;
    const output = previewService.getPreviewOutput(taskId, lines);
    res.json({ output });
  })
);

// POST /api/preview/:taskId/start - Start preview for a task
router.post(
  '/:taskId/start',
  validate({ params: PreviewParamsSchema }),
  asyncHandler(async (req: ValidatedRequest<PreviewParams>, res) => {
    const { taskId } = req.validated.params;
    const preview = await previewService.startPreview(taskId);
    res.status(201).json(preview);
  })
);

// POST /api/preview/:taskId/stop - Stop preview for a task
router.post(
  '/:taskId/stop',
  validate({ params: PreviewParamsSchema }),
  asyncHandler(async (req: ValidatedRequest<PreviewParams>, res) => {
    const { taskId } = req.validated.params;
    await previewService.stopPreview(taskId);
    res.json({ success: true });
  })
);

export default router;
