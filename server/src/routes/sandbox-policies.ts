import { Router } from 'express';
import type { SandboxPolicyDryRunRequest, SandboxPolicyPreset } from '@veritas-kanban/shared';
import { asyncHandler } from '../middleware/async-handler.js';
import { authorize } from '../middleware/auth.js';
import { getGovernanceTraceService } from '../services/governance-trace-service.js';
import { getSandboxPolicyService } from '../services/sandbox-policy-service.js';
import { validate, type ValidatedRequest } from '../middleware/validate.js';
import {
  sandboxPolicyDryRunSchema,
  sandboxPolicyParamsSchema,
  sandboxPolicyPresetSchema,
} from '../schemas/sandbox-policy-schemas.js';

const router = Router();
const sandboxPolicyService = getSandboxPolicyService();

router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const presets = await sandboxPolicyService.listPresets();
    res.json(presets);
  })
);

router.get(
  '/:id',
  validate({ params: sandboxPolicyParamsSchema }),
  asyncHandler(async (req: ValidatedRequest<{ id: string }>, res) => {
    const { id } = req.validated.params as { id: string };
    const preset = await sandboxPolicyService.getPreset(id);
    if (!preset) {
      res.status(404).json({ error: 'Sandbox preset not found' });
      return;
    }
    res.json(preset);
  })
);

router.post(
  '/',
  authorize('admin'),
  validate({ body: sandboxPolicyPresetSchema }),
  asyncHandler(async (req: ValidatedRequest<unknown, unknown, SandboxPolicyPreset>, res) => {
    const preset = await sandboxPolicyService.createPreset(
      req.validated.body as SandboxPolicyPreset
    );
    res.status(201).json(preset);
  })
);

router.put(
  '/:id',
  authorize('admin'),
  validate({ params: sandboxPolicyParamsSchema, body: sandboxPolicyPresetSchema }),
  asyncHandler(async (req: ValidatedRequest<{ id: string }, unknown, SandboxPolicyPreset>, res) => {
    const { id } = req.validated.params as { id: string };
    const preset = await sandboxPolicyService.updatePreset(
      id,
      req.validated.body as SandboxPolicyPreset
    );
    res.json(preset);
  })
);

router.delete(
  '/:id',
  authorize('admin'),
  validate({ params: sandboxPolicyParamsSchema }),
  asyncHandler(async (req: ValidatedRequest<{ id: string }>, res) => {
    const { id } = req.validated.params as { id: string };
    await sandboxPolicyService.deletePreset(id);
    res.json({ deleted: id });
  })
);

router.post(
  '/validate',
  validate({ body: sandboxPolicyDryRunSchema }),
  asyncHandler(async (req: ValidatedRequest<unknown, unknown, SandboxPolicyDryRunRequest>, res) => {
    const evaluation = await sandboxPolicyService.dryRunWithTrace(
      req.validated.body as SandboxPolicyDryRunRequest
    );
    const trace = await getGovernanceTraceService().record(evaluation.trace);
    res.json({ ...evaluation.result, traceId: trace.id });
  })
);

export default router;
