import { Router, type Router as RouterType } from 'express';
import { z } from 'zod';
import {
  SKILL_CAPABILITY_TAXONOMY,
  getSkillCapabilityService,
} from '../services/skill-capability-service.js';
import { asyncHandler } from '../middleware/async-handler.js';
import { NotFoundError, ValidationError } from '../middleware/error-handler.js';
import type { AuthenticatedRequest } from '../middleware/auth.js';
import { actorFromRequest } from '../utils/concurrency.js';
import type { SkillCapabilityId, SkillCapabilityListFilters } from '@veritas-kanban/shared';

const router: RouterType = Router();

const capabilityIds = SKILL_CAPABILITY_TAXONOMY.map((definition) => definition.id) as [
  string,
  ...string[],
];

const listQuerySchema = z.object({
  status: z.enum(['aligned', 'mismatch', 'missing-declaration']).optional(),
  severity: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  capability: z.enum(capabilityIds).optional(),
  q: z.string().min(1).max(120).optional(),
});

const remediationSchema = z.object({
  project: z.string().min(1).max(100).optional(),
  sprint: z.string().min(1).max(100).optional(),
  priority: z.enum(['low', 'medium', 'high']).optional(),
});

router.get(
  '/taxonomy',
  asyncHandler(async (_req, res) => {
    const service = getSkillCapabilityService();
    res.json(service.getTaxonomy());
  })
);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    let query;
    try {
      query = listQuerySchema.parse(req.query);
    } catch (err: unknown) {
      if (err instanceof z.ZodError) {
        throw new ValidationError('Validation error', err.issues);
      }
      throw err;
    }

    const service = getSkillCapabilityService();
    const filters: SkillCapabilityListFilters = {
      ...query,
      capability: query.capability as SkillCapabilityId | undefined,
    };
    res.json(await service.listProfiles(filters));
  })
);

router.get(
  '/:skillId',
  asyncHandler(async (req, res) => {
    const service = getSkillCapabilityService();
    const profile = await service.getProfile(String(req.params.skillId));
    if (!profile) throw new NotFoundError('Skill capability profile not found');
    res.json(profile);
  })
);

router.post(
  '/:skillId/remediation-task',
  asyncHandler(async (req, res) => {
    let input;
    try {
      input = remediationSchema.parse(req.body ?? {});
    } catch (err: unknown) {
      if (err instanceof z.ZodError) {
        throw new ValidationError('Validation error', err.issues);
      }
      throw err;
    }

    const service = getSkillCapabilityService();
    try {
      const result = await service.createRemediationTask(
        String(req.params.skillId),
        input,
        actorFromRequest(req as AuthenticatedRequest)
      );
      res.status(201).json(result);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Skill capability remediation failed';
      if (message.includes('not found')) {
        throw new NotFoundError(message);
      }
      throw new ValidationError(message);
    }
  })
);

export { router as skillCapabilityRoutes };
