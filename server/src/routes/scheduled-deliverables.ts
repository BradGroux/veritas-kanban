/**
 * Scheduled Deliverables API Routes
 *
 * GET    /api/deliverables              — List all deliverables
 * POST   /api/deliverables              — Create deliverable
 * GET    /api/deliverables/:id          — Get deliverable + recent runs
 * PATCH  /api/deliverables/:id          — Update deliverable
 * DELETE /api/deliverables/:id          — Delete deliverable
 * POST   /api/deliverables/:id/runs     — Record a run
 * GET    /api/deliverables/:id/runs     — Get run history
 */

import { Router, type Router as RouterType } from 'express';
import { z } from 'zod';
import { getScheduledDeliverablesService } from '../services/scheduled-deliverables-service.js';
import { asyncHandler } from '../middleware/async-handler.js';
import { NotFoundError } from '../middleware/error-handler.js';

const router: RouterType = Router();

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const service = getScheduledDeliverablesService();
    const deliverables = await service.list({
      enabled:
        req.query.enabled === 'true' ? true : req.query.enabled === 'false' ? false : undefined,
      agent: String(req.query.agent || ''),
      tag: req.query.tag as string,
    });
    res.json(deliverables);
  })
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const schema = z.object({
      name: z.string().min(1),
      description: z.string().min(1),
      schedule: z.enum(['daily', 'weekly', 'biweekly', 'monthly', 'custom']),
      cronExpr: z.string().optional(),
      scheduleDescription: z.string().optional(),
      agent: z.string().optional(),
      outputPath: z.string().optional(),
      tags: z.array(z.string()).optional(),
      enabled: z.boolean().optional(),
    });
    const data = schema.parse(req.body);
    const service = getScheduledDeliverablesService();
    const deliverable = await service.create(data);
    res.status(201).json(deliverable);
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const service = getScheduledDeliverablesService();
    const result = await service.get(String(req.params.id));
    if (!result) throw new NotFoundError('Deliverable not found');
    res.json(result);
  })
);

router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const schema = z.object({
      name: z.string().optional(),
      description: z.string().optional(),
      schedule: z.enum(['daily', 'weekly', 'biweekly', 'monthly', 'custom']).optional(),
      cronExpr: z.string().optional(),
      scheduleDescription: z.string().optional(),
      enabled: z.boolean().optional(),
      agent: z.string().optional(),
      outputPath: z.string().optional(),
      tags: z.array(z.string()).optional(),
    });
    const update = schema.parse(req.body);
    const service = getScheduledDeliverablesService();
    const result = await service.update(String(req.params.id), update);
    if (!result) throw new NotFoundError('Deliverable not found');
    res.json(result);
  })
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const service = getScheduledDeliverablesService();
    const success = await service.delete(String(req.params.id));
    if (!success) throw new NotFoundError('Deliverable not found');
    res.json({ success: true });
  })
);

router.post(
  '/:id/runs',
  asyncHandler(async (req, res) => {
    const schema = z.object({
      status: z.enum(['success', 'failed', 'skipped']),
      outputFile: z.string().optional(),
      summary: z.string().optional(),
      durationMs: z.number().optional(),
      error: z.string().optional(),
      sourceRunId: z.string().optional(),
      workflowId: z.string().optional(),
      snapshotMetadata: z
        .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
        .optional(),
    });
    const data = schema.parse(req.body);
    const service = getScheduledDeliverablesService();
    const run = await service.recordRun({ ...data, deliverableId: String(req.params.id) });
    res.status(201).json(run);
  })
);

router.get(
  '/:id/runs',
  asyncHandler(async (req, res) => {
    const service = getScheduledDeliverablesService();
    const runs = await service.getRuns(
      String(req.params.id),
      req.query.limit ? Number(String(req.query.limit)) : undefined
    );
    res.json(runs);
  })
);

export { router as scheduledDeliverablesRoutes };
