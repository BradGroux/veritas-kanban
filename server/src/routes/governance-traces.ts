import { Router, type Router as RouterType } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/async-handler.js';
import { validate, type ValidatedRequest } from '../middleware/validate.js';
import { getGovernanceTraceService } from '../services/governance-trace-service.js';

const router: RouterType = Router();

const traceListQuerySchema = z.object({
  kind: z
    .enum([
      'policy',
      'tool-policy',
      'sandbox-policy',
      'budget-policy',
      'agent-permission',
      'routing',
      'workflow-gate',
      'ceremony',
    ])
    .optional(),
  outcome: z
    .enum(['allowed', 'warned', 'blocked', 'approval-required', 'routed', 'fallback', 'skipped'])
    .optional(),
  agent: z.string().optional(),
  taskId: z.string().optional(),
  actionType: z.string().optional(),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

const traceIdParamsSchema = z.object({
  id: z.string().min(1),
});

type TraceListQuery = z.infer<typeof traceListQuerySchema>;
type TraceIdParams = z.infer<typeof traceIdParamsSchema>;

router.get(
  '/',
  validate({ query: traceListQuerySchema }),
  asyncHandler(async (req: ValidatedRequest<unknown, TraceListQuery>, res) => {
    const query = req.validated.query as TraceListQuery | undefined;
    const traces = await getGovernanceTraceService().list(query);
    res.json(traces);
  })
);

router.get(
  '/:id',
  validate({ params: traceIdParamsSchema }),
  asyncHandler(async (req: ValidatedRequest<TraceIdParams>, res) => {
    const params = req.validated.params as TraceIdParams;
    const trace = await getGovernanceTraceService().get(params.id);
    res.json(trace);
  })
);

export { router as governanceTraceRoutes };
