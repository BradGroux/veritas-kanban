import { Router, type Router as RouterType } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/async-handler.js';
import { authorize } from '../middleware/auth.js';
import { ValidationError } from '../middleware/error-handler.js';
import { getSqlitePortabilityService } from '../services/sqlite-portability-service.js';

const router: RouterType = Router();

const pathSchema = z.string().min(1).max(4096);

const migrationSchema = z.object({
  sourceRoot: pathSchema.optional(),
  sqlitePath: pathSchema,
  backupDir: pathSchema.optional(),
});

const exportSchema = z.object({
  sqlitePath: pathSchema,
  outputDir: pathSchema,
});

const importSchema = z.object({
  sqlitePath: pathSchema,
  bundleDir: pathSchema,
  replaceExisting: z.boolean().optional(),
});

function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new ValidationError('Validation failed', result.error.issues);
  }
  return result.data;
}

router.post(
  '/migration/dry-run',
  authorize('admin'),
  asyncHandler(async (req, res) => {
    const input = parseBody(migrationSchema, req.body);
    const report = await getSqlitePortabilityService().migrateFilesToSqlite({
      ...input,
      dryRun: true,
    });
    res.json(report);
  })
);

router.post(
  '/migration/run',
  authorize('admin'),
  asyncHandler(async (req, res) => {
    const input = parseBody(migrationSchema, req.body);
    const report = await getSqlitePortabilityService().migrateFilesToSqlite({
      ...input,
      dryRun: false,
    });
    res.json(report);
  })
);

router.post(
  '/export',
  authorize('admin'),
  asyncHandler(async (req, res) => {
    const input = parseBody(exportSchema, req.body);
    const report = await getSqlitePortabilityService().exportSqliteBackup(input);
    res.json(report);
  })
);

router.post(
  '/import',
  authorize('admin'),
  asyncHandler(async (req, res) => {
    const input = parseBody(importSchema, req.body);
    const report = await getSqlitePortabilityService().importSqliteBackup(input);
    res.json(report);
  })
);

export { router as sqlitePortabilityRoutes };
