import { Router, type Router as RouterType } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/async-handler.js';
import { authorize } from '../middleware/auth.js';
import { ValidationError } from '../middleware/error-handler.js';
import { getSqlitePortabilityService } from '../services/sqlite-portability-service.js';
import { listDataLifecyclePolicies } from '../services/data-lifecycle-policy.js';

const router: RouterType = Router();

const pathSchema = z.string().min(1).max(4096);

const migrationSchema = z.object({
  sourceRoot: pathSchema.optional(),
  sqlitePath: pathSchema,
  backupDir: pathSchema.optional(),
  journalPath: pathSchema.optional(),
});

const exportSchema = z.object({
  sqlitePath: pathSchema,
  outputDir: pathSchema,
  workspaceId: z.string().min(1).max(200).optional(),
});

const importSchema = z.object({
  sqlitePath: pathSchema,
  bundleDir: pathSchema,
  replaceExisting: z.boolean().optional(),
});

const recoveryQuerySchema = z.object({
  sourceRoot: pathSchema.optional(),
  sqlitePath: pathSchema.optional(),
  journalPath: pathSchema.optional(),
});

const restoreBackupSchema = z.object({
  backupPath: pathSchema,
  targetRoot: pathSchema.optional(),
  journalPath: pathSchema.optional(),
  replaceExisting: z.boolean().optional(),
  dryRun: z.boolean().optional(),
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

router.get(
  '/migration/recovery',
  authorize('admin'),
  asyncHandler(async (req, res) => {
    const input = parseBody(recoveryQuerySchema, req.query);
    const state = await getSqlitePortabilityService().getMigrationRecoveryState(input);
    res.json(state);
  })
);

router.post(
  '/migration/restore-backup',
  authorize('admin'),
  asyncHandler(async (req, res) => {
    const input = parseBody(restoreBackupSchema, req.body);
    const report = await getSqlitePortabilityService().restorePreMigrationBackup(input);
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

router.get(
  '/lifecycle-policy',
  authorize('admin'),
  asyncHandler(async (_req, res) => {
    res.json({
      formatVersion: 1,
      dataClasses: listDataLifecyclePolicies(),
    });
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
