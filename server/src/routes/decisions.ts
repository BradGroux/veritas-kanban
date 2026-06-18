import { Router, type IRouter } from 'express';
import { asyncHandler } from '../middleware/async-handler.js';
import { validate, type ValidatedRequest } from '../middleware/validate.js';
import { NotFoundError } from '../middleware/error-handler.js';
import { getDecisionService } from '../services/decision-service.js';
import { getDecisionReviewService } from '../services/decision-review-service.js';
import {
  assumptionParamsSchema,
  createDecisionSchema,
  createDecisionReviewSessionSchema,
  decisionIdParamsSchema,
  decisionListQuerySchema,
  decisionReviewListQuerySchema,
  decisionReviewSessionParamsSchema,
  finalizeDecisionReviewSessionSchema,
  recordDecisionReviewCritiqueSchema,
  recordDecisionReviewTurnSchema,
  updateAssumptionSchema,
  type AssumptionParams,
  type CreateDecisionSchema,
  type CreateDecisionReviewSessionSchema,
  type DecisionIdParams,
  type DecisionListQuerySchema,
  type DecisionReviewListQuerySchema,
  type DecisionReviewSessionParams,
  type FinalizeDecisionReviewSessionSchema,
  type RecordDecisionReviewCritiqueSchema,
  type RecordDecisionReviewTurnSchema,
  type UpdateAssumptionSchema,
} from '../schemas/decision-schemas.js';

const router: IRouter = Router();
const decisionService = getDecisionService();
const decisionReviewService = getDecisionReviewService();

router.get(
  '/reviews',
  validate({ query: decisionReviewListQuerySchema }),
  asyncHandler(async (req: ValidatedRequest<unknown, DecisionReviewListQuerySchema>, res) => {
    const query = req.validated.query as DecisionReviewListQuerySchema | undefined;
    res.json(await decisionReviewService.list(query));
  })
);

router.post(
  '/reviews',
  validate({ body: createDecisionReviewSessionSchema }),
  asyncHandler(
    async (req: ValidatedRequest<unknown, unknown, CreateDecisionReviewSessionSchema>, res) => {
      const body = req.validated.body as CreateDecisionReviewSessionSchema;
      const session = await decisionReviewService.create(body);
      res.status(201).json(session);
    }
  )
);

router.get(
  '/reviews/:sessionId',
  validate({ params: decisionReviewSessionParamsSchema }),
  asyncHandler(async (req: ValidatedRequest<DecisionReviewSessionParams>, res) => {
    const params = req.validated.params as DecisionReviewSessionParams;
    const session = await decisionReviewService.get(params.sessionId);
    if (!session) {
      throw new NotFoundError('Decision review session not found');
    }
    res.json(session);
  })
);

router.get(
  '/reviews/:sessionId/export',
  validate({ params: decisionReviewSessionParamsSchema }),
  asyncHandler(async (req: ValidatedRequest<DecisionReviewSessionParams>, res) => {
    const params = req.validated.params as DecisionReviewSessionParams;
    const session = await decisionReviewService.get(params.sessionId);
    if (!session) {
      throw new NotFoundError('Decision review session not found');
    }
    res.type('text/markdown').send(decisionReviewService.exportMarkdown(session));
  })
);

router.post(
  '/reviews/:sessionId/responses',
  validate({ params: decisionReviewSessionParamsSchema, body: recordDecisionReviewTurnSchema }),
  asyncHandler(
    async (
      req: ValidatedRequest<DecisionReviewSessionParams, unknown, RecordDecisionReviewTurnSchema>,
      res
    ) => {
      const params = req.validated.params as DecisionReviewSessionParams;
      const body = req.validated.body as RecordDecisionReviewTurnSchema;
      res.json(await decisionReviewService.recordInitialResponse(params.sessionId, body));
    }
  )
);

router.post(
  '/reviews/:sessionId/critiques',
  validate({ params: decisionReviewSessionParamsSchema, body: recordDecisionReviewCritiqueSchema }),
  asyncHandler(
    async (
      req: ValidatedRequest<
        DecisionReviewSessionParams,
        unknown,
        RecordDecisionReviewCritiqueSchema
      >,
      res
    ) => {
      const params = req.validated.params as DecisionReviewSessionParams;
      const body = req.validated.body as RecordDecisionReviewCritiqueSchema;
      res.json(await decisionReviewService.recordCritique(params.sessionId, body));
    }
  )
);

router.post(
  '/reviews/:sessionId/finalize',
  validate({
    params: decisionReviewSessionParamsSchema,
    body: finalizeDecisionReviewSessionSchema,
  }),
  asyncHandler(
    async (
      req: ValidatedRequest<
        DecisionReviewSessionParams,
        unknown,
        FinalizeDecisionReviewSessionSchema
      >,
      res
    ) => {
      const params = req.validated.params as DecisionReviewSessionParams;
      const body = req.validated.body as FinalizeDecisionReviewSessionSchema;
      res.json(await decisionReviewService.finalize(params.sessionId, body));
    }
  )
);

router.post(
  '/reviews/:sessionId/cancel',
  validate({ params: decisionReviewSessionParamsSchema }),
  asyncHandler(async (req: ValidatedRequest<DecisionReviewSessionParams>, res) => {
    const params = req.validated.params as DecisionReviewSessionParams;
    res.json(await decisionReviewService.cancel(params.sessionId));
  })
);

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
