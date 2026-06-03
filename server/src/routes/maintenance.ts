import { Router, type Router as RouterType } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/async-handler.js';
import { ValidationError } from '../middleware/error-handler.js';
import { getMaintenanceService } from '../services/maintenance-service.js';
import { getSqlitePortabilityService } from '../services/sqlite-portability-service.js';
import { scanSkill } from './skill-security.js';

const router: RouterType = Router();

const pathSchema = z.string().min(1).max(4096);

const logQuerySchema = z.object({
  source: z.string().min(1).max(80),
  tail: z.coerce.number().int().min(1).max(500).optional(),
});

const sqliteExportSchema = z.object({
  sqlitePath: pathSchema,
  outputDir: pathSchema,
  workspaceId: z.string().min(1).max(200).optional(),
});

const sqliteImportSchema = z.object({
  sqlitePath: pathSchema,
  bundleDir: pathSchema,
  replaceExisting: z.boolean().optional(),
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

router.get(
  '/summary',
  asyncHandler(async (_req, res) => {
    res.json(await getMaintenanceService().buildSummary());
  })
);

router.get(
  '/logs',
  asyncHandler(async (req, res) => {
    const query = parse(logQuerySchema, req.query);
    res.json(await getMaintenanceService().tailLog(query.source, query.tail));
  })
);

router.post(
  '/debug-bundle',
  asyncHandler(async (_req, res) => {
    res.status(201).json(await getMaintenanceService().createDebugBundle());
  })
);

router.post(
  '/sqlite/export',
  asyncHandler(async (req, res) => {
    const input = parse(sqliteExportSchema, req.body);
    res.status(201).json(await getSqlitePortabilityService().exportSqliteBackup(input));
  })
);

router.post(
  '/sqlite/import',
  asyncHandler(async (req, res) => {
    const input = parse(sqliteImportSchema, req.body);
    res.json(await getSqlitePortabilityService().importSqliteBackup(input));
  })
);

router.post(
  '/skill-security/scan',
  asyncHandler(async (req, res) => {
    res.status(201).json(await scanSkill(req.body));
  })
);

export { router as maintenanceRoutes };
