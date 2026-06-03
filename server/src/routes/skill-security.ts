import { Router, type Router as RouterType } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/async-handler.js';
import { NotFoundError, ValidationError } from '../middleware/error-handler.js';
import { getSkillSecurityService } from '../services/skill-security-service.js';

const router: RouterType = Router();

const pathSchema = z.string().min(1).max(4096);

const scanSchema = z.object({
  path: pathSchema,
  persist: z.boolean().optional(),
  includeReferencedFiles: z.boolean().optional(),
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
