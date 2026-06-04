import { Router } from 'express';
import type { WatcherContinuationEvaluationRequest } from '@veritas-kanban/shared';
import { asyncHandler } from '../middleware/async-handler.js';
import { validate, type ValidatedRequest } from '../middleware/validate.js';
import { getWatcherPolicyService } from '../services/watcher-policy-service.js';
import { watcherContinuationEvaluationSchema } from '../schemas/watcher-policy-schemas.js';
import type { AuthenticatedRequest } from '../middleware/auth.js';

const router = Router();

router.get(
  '/',
  asyncHandler(async (_req, res) => {
    res.json(getWatcherPolicyService().getSettings());
  })
);

router.post(
  '/evaluate',
  validate({ body: watcherContinuationEvaluationSchema }),
  asyncHandler(
    async (req: ValidatedRequest<unknown, unknown, WatcherContinuationEvaluationRequest>, res) => {
      const authReq = req as AuthenticatedRequest;
      const actor =
        authReq.auth?.keyName ||
        authReq.auth?.tokenName ||
        authReq.auth?.userId ||
        authReq.auth?.role ||
        'unknown';

      const result = await getWatcherPolicyService().evaluateContinuation(
        req.validated.body as WatcherContinuationEvaluationRequest,
        { actor }
      );

      res.json(result);
    }
  )
);

export { router as watcherPolicyRoutes };
