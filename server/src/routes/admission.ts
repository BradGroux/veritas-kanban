import { Router, type Router as RouterType } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/async-handler.js';
import { ValidationError } from '../middleware/error-handler.js';
import { AdmissionReservationListQuerySchema } from '../schemas/admission-control-schemas.js';
import { getAdmissionControlService } from '../services/admission-control-service.js';

const router: RouterType = Router();
const admission = getAdmissionControlService();

const listQuerySchema = z
  .object({
    workspaceId: z.string().trim().min(1).max(240).optional(),
    taskId: z.string().trim().min(1).max(240).optional(),
    rootTaskId: z.string().trim().min(1).max(240).optional(),
    provider: z.string().trim().min(1).max(80).optional(),
    hostId: z.string().trim().min(1).max(240).optional(),
    state: z
      .union([z.string(), z.array(z.string())])
      .optional()
      .transform((value) =>
        value === undefined ? undefined : Array.isArray(value) ? value : value.split(',')
      ),
    limit: z.coerce.number().int().min(1).max(1_000).optional(),
  })
  .strict();

router.get(
  '/',
  asyncHandler(async (req, res) => {
    try {
      const raw = listQuerySchema.parse(req.query);
      const query = AdmissionReservationListQuerySchema.parse({
        workspaceId: raw.workspaceId,
        taskId: raw.taskId,
        rootTaskId: raw.rootTaskId,
        provider: raw.provider,
        hostId: raw.hostId,
        states: raw.state,
        limit: raw.limit,
      });
      res.json({
        generatedAt: new Date().toISOString(),
        reservations: await admission.list(query),
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new ValidationError('Validation failed', error.issues);
      }
      throw error;
    }
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    try {
      const id = z.string().trim().min(1).max(240).parse(req.params.id);
      res.json(await admission.get(id));
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new ValidationError('Validation failed', error.issues);
      }
      throw error;
    }
  })
);

export { router as admissionRoutes };
