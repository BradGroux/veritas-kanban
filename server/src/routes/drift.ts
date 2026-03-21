import { Router, type Router as RouterType } from 'express';
import { asyncHandler } from '../middleware/async-handler.js';
import { validate, type ValidatedRequest } from '../middleware/validate.js';
import {
  DriftAlertParamsSchema,
  DriftAlertsQuerySchema,
  DriftAnalyzeSchema,
  DriftBaselineResetSchema,
  DriftBaselinesQuerySchema,
  type DriftAlertParams,
  type DriftAlertsQuery,
  type DriftAnalyzeInput,
  type DriftBaselineReset,
  type DriftBaselinesQuery,
} from '../schemas/drift-schemas.js';
import { getDriftService } from '../services/drift-service.js';

const router: RouterType = Router();

router.get(
  '/alerts',
  validate({ query: DriftAlertsQuerySchema }),
  asyncHandler(async (req: ValidatedRequest<unknown, DriftAlertsQuery>, res) => {
    const alerts = await getDriftService().listAlerts(req.validated.query ?? {});
    res.json(alerts);
  })
);

router.post(
  '/alerts/:id/acknowledge',
  validate({ params: DriftAlertParamsSchema }),
  asyncHandler(async (req: ValidatedRequest<DriftAlertParams>, res) => {
    const params = req.validated.params;
    if (!params) {
      res.status(400).json({ code: 'INVALID_REQUEST', message: 'Missing alert id' });
      return;
    }

    const alert = await getDriftService().acknowledgeAlert(params.id);
    if (!alert) {
      res.status(404).json({ code: 'NOT_FOUND', message: 'Drift alert not found' });
      return;
    }
    res.json(alert);
  })
);

router.get(
  '/baselines',
  validate({ query: DriftBaselinesQuerySchema }),
  asyncHandler(async (req: ValidatedRequest<unknown, DriftBaselinesQuery>, res) => {
    const baselines = await getDriftService().listBaselines(req.validated.query ?? {});
    res.json(baselines);
  })
);

router.post(
  '/baselines/reset',
  validate({ body: DriftBaselineResetSchema }),
  asyncHandler(async (req: ValidatedRequest<unknown, unknown, DriftBaselineReset>, res) => {
    const body = req.validated.body;
    if (!body) {
      res.status(400).json({ code: 'INVALID_REQUEST', message: 'Missing reset payload' });
      return;
    }

    const result = await getDriftService().resetBaselines(body.agentId, body.metric);
    res.json(result);
  })
);

router.post(
  '/analyze',
  validate({ body: DriftAnalyzeSchema }),
  asyncHandler(async (req: ValidatedRequest<unknown, unknown, DriftAnalyzeInput>, res) => {
    const body = req.validated.body;
    if (!body) {
      res.status(400).json({ code: 'INVALID_REQUEST', message: 'Missing analyze payload' });
      return;
    }

    const result = await getDriftService().analyzeAgent(body.agentId);
    res.json(result);
  })
);

export default router;
