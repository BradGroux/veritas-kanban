import { Router, type Router as RouterType } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/async-handler.js';
import { ValidationError } from '../middleware/error-handler.js';
import { getQueueIntakeMonitorService } from '../services/queue-intake-monitor-service.js';

const router: RouterType = Router();

const updateMonitorSchema = z.object({
  enabled: z.boolean().optional(),
  mode: z.enum(['dry-run', 'assign-only', 'draft-plan', 'execute']).optional(),
  runner: z.enum(['local', 'github-actions']).optional(),
  intervalMinutes: z
    .number()
    .int()
    .min(1)
    .max(24 * 60)
    .optional(),
  maxCandidates: z.number().int().min(1).max(100).optional(),
  workflowId: z.string().min(1).nullable().optional(),
  assignee: z.string().min(1).nullable().optional(),
  sandboxPresetId: z.string().min(1).nullable().optional(),
  budget: z.record(z.string(), z.unknown()).nullable().optional(),
  repo: z.string().min(1).optional(),
  state: z.enum(['open', 'closed', 'all']).optional(),
  labels: z.array(z.string().min(1)).optional(),
  includeIssues: z.boolean().optional(),
  includePullRequests: z.boolean().optional(),
  stopConditions: z
    .object({
      maxCandidates: z.number().int().min(1).max(100).optional(),
      maxFailureStreak: z.number().int().min(1).max(20).optional(),
      skipBlockedLabels: z.array(z.string().min(1)).optional(),
      skipDraftPullRequests: z.boolean().optional(),
      skipFailedChecks: z.boolean().optional(),
    })
    .optional(),
});

router.get(
  '/',
  asyncHandler(async (_req, res) => {
    res.json(await getQueueIntakeMonitorService().list());
  })
);

router.get(
  '/:monitorId',
  asyncHandler(async (req, res) => {
    res.json(await getQueueIntakeMonitorService().getMonitor(String(req.params.monitorId)));
  })
);

router.put(
  '/:monitorId',
  asyncHandler(async (req, res) => {
    let input;
    try {
      input = updateMonitorSchema.parse(req.body);
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new ValidationError('Validation failed', error.issues);
      }
      throw error;
    }
    res.json(
      await getQueueIntakeMonitorService().updateMonitor(String(req.params.monitorId), input)
    );
  })
);

router.get(
  '/:monitorId/health',
  asyncHandler(async (req, res) => {
    res.json(await getQueueIntakeMonitorService().health(String(req.params.monitorId)));
  })
);

router.get(
  '/:monitorId/explain',
  asyncHandler(async (req, res) => {
    res.json(await getQueueIntakeMonitorService().explain(String(req.params.monitorId)));
  })
);

router.post(
  '/:monitorId/run',
  asyncHandler(async (req, res) => {
    res.json(await getQueueIntakeMonitorService().runOnce(String(req.params.monitorId)));
  })
);

router.post(
  '/:monitorId/pause',
  asyncHandler(async (req, res) => {
    res.json(await getQueueIntakeMonitorService().pause(String(req.params.monitorId)));
  })
);

router.post(
  '/:monitorId/resume',
  asyncHandler(async (req, res) => {
    res.json(await getQueueIntakeMonitorService().resume(String(req.params.monitorId)));
  })
);

export { router as queueMonitorRoutes };
