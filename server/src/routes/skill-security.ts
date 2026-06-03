import { Router, type Router as RouterType } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/async-handler.js';
import { NotFoundError, ValidationError } from '../middleware/error-handler.js';
import { getSkillSecurityService } from '../services/skill-security-service.js';
import type { AuthenticatedRequest } from '../middleware/auth.js';
import { actorFromRequest } from '../utils/concurrency.js';

const router: RouterType = Router();

const pathSchema = z.string().min(1).max(4096);

const scanSchema = z.object({
  path: pathSchema,
  persist: z.boolean().optional(),
  includeReferencedFiles: z.boolean().optional(),
});

const exceptionSchema = z.object({
  owner: z.string().min(1).max(120),
  reason: z.string().min(8).max(1000),
  expiresAt: z.string().datetime(),
});

const remediationSchema = z.object({
  project: z.string().min(1).max(100).optional(),
  sprint: z.string().min(1).max(100).optional(),
  priority: z.enum(['low', 'medium', 'high', 'critical']).optional(),
});

function parse<T>(schema: z.ZodSchema<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  throw new ValidationError(
    'Validation failed',
    result.error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    }))
  );
}

async function scanSkill(input: unknown) {
  const parsed = parse(scanSchema, input);
  return getSkillSecurityService().scan(parsed);
}

router.get(
  '/patterns',
  asyncHandler(async (_req, res) => {
    res.json(getSkillSecurityService().getPatterns());
  })
);

router.get(
  '/inventory',
  asyncHandler(async (_req, res) => {
    res.json(await getSkillSecurityService().listInventory());
  })
);

router.post(
  '/inventory/:skillId/remediation-task',
  asyncHandler(async (req, res) => {
    const input = parse(remediationSchema, req.body ?? {});
    try {
      const result = await getSkillSecurityService().createRiskRemediationTask(
        String(req.params.skillId),
        input,
        actorFromRequest(req as AuthenticatedRequest)
      );
      res.status(201).json(result);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Skill security remediation failed';
      if (message.includes('not found')) throw new NotFoundError(message);
      throw new ValidationError(message);
    }
  })
);

router.post(
  '/inventory/:skillId/exceptions',
  asyncHandler(async (req, res) => {
    const input = parse(exceptionSchema, req.body ?? {});
    try {
      const result = await getSkillSecurityService().createException(
        String(req.params.skillId),
        input,
        actorFromRequest(req as AuthenticatedRequest)
      );
      res.status(201).json(result);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Skill security exception failed';
      if (message.includes('not found')) throw new NotFoundError(message);
      throw new ValidationError(message);
    }
  })
);

router.post(
  '/scan',
  asyncHandler(async (req, res) => {
    res.status(201).json(await scanSkill(req.body));
  })
);

router.get(
  '/scans',
  asyncHandler(async (_req, res) => {
    res.json(await getSkillSecurityService().listReports());
  })
);

router.get(
  '/scans/:id',
  asyncHandler(async (req, res) => {
    const report = await getSkillSecurityService().getReport(String(req.params.id));
    if (!report) throw new NotFoundError('Skill security scan report not found');
    res.json(report);
  })
);

export { router as skillSecurityRoutes, scanSkill };
