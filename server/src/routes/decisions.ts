import { Router, type IRouter } from 'express';
import { asyncHandler } from '../middleware/async-handler.js';
import { validate, type ValidatedRequest } from '../middleware/validate.js';
import { NotFoundError } from '../middleware/error-handler.js';
import { getDecisionService } from '../services/decision-service.js';
import {
  assumptionParamsSchema,
  createDecisionSchema,
  decisionIdParamsSchema,
  decisionListQuerySchema,
  updateAssumptionSchema,
  type AssumptionParams,
  type CreateDecisionSchema,
  type DecisionIdParams,
  type DecisionListQuerySchema,
  type UpdateAssumptionSchema,
} from '../schemas/decision-schemas.js';

const router: IRouter = Router();
const decisionService = getDecisionService();

router.post(
  '/',
  validate({ body: createDecisionSchema }),
  asyncHandler(async (req: ValidatedRequest<unknown, unknown, CreateDecisionSchema>, res) => {
    const body = req.validated.body as CreateDecisionSchema;
    const decision = await decisionService.create(body);
    res.status(201).json(decision);
  })
);

router.get(
  '/',
  validate({ query: decisionListQuerySchema }),
  asyncHandler(async (req: ValidatedRequest<unknown, DecisionListQuerySchema>, res) => {
    const query = req.validated.query as DecisionListQuerySchema | undefined;
    const decisions = await decisionService.list(query);
    res.json(decisions);
  })
);

router.get(
  '/:id',
  validate({ params: decisionIdParamsSchema }),
  asyncHandler(async (req: ValidatedRequest<DecisionIdParams>, res) => {
    const params = req.validated.params as DecisionIdParams;
    const decision = await decisionService.getById(params.id);
    if (!decision) {
      throw new NotFoundError('Decision not found');
    }

    const chain = await decisionService.getChain(decision.id);
    res.json({ decision, chain });
  })
);

router.patch(
  '/:id/assumptions/:idx',
  validate({ params: assumptionParamsSchema, body: updateAssumptionSchema }),
  asyncHandler(
    async (req: ValidatedRequest<AssumptionParams, unknown, UpdateAssumptionSchema>, res) => {
      const params = req.validated.params as AssumptionParams;
      const body = req.validated.body as UpdateAssumptionSchema;
      const decision = await decisionService.updateAssumption(params.id, params.idx, body);
      res.json(decision);
    }
  )
);

export { router as decisionRoutes };
