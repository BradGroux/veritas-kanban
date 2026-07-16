import { Router, type Router as RouterType } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/async-handler.js';
import {
  AppError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../middleware/error-handler.js';
import type { AuthenticatedRequest } from '../middleware/auth.js';
import { getMaintenanceService } from '../services/maintenance-service.js';
import { getSqlitePortabilityService } from '../services/sqlite-portability-service.js';
import {
  getSqliteJournalMaintenanceService,
  SqliteJournalMaintenanceError,
} from '../storage/sqlite/journal-maintenance-service.js';
import { auditLog } from '../services/audit-service.js';
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

const sqliteJournalPreviewSchema = z
  .object({
    targetMode: z.enum(['wal', 'delete']),
    singleHost: z.boolean().optional(),
    overrideReason: z.string().trim().min(8).max(1000).optional(),
    expiresAt: z.string().datetime({ offset: true }).optional(),
  })
  .strict();

const sqliteJournalApplySchema = z
  .object({
    previewId: z.string().uuid(),
    previewToken: z.string().regex(/^[a-f0-9]{64}$/i),
    confirm: z.string().uuid(),
    acknowledgeRisks: z.literal(true),
  })
  .strict();

const sqliteJournalRevokeSchema = z.object({ reason: z.string().trim().min(8).max(1000) }).strict();

const operationIdSchema = z.string().uuid();

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

function actorFromRequest(req: AuthenticatedRequest): string {
  const auth = req.auth;
  if (!auth) return 'operator';
  if (auth.authMethod === 'api-key') {
    return auth.apiTokenId
      ? `api-token:${auth.apiTokenId}`
      : `api-key:${auth.tokenName || auth.keyName || 'unnamed'}`;
  }
  if (auth.authMethod === 'device-session') {
    return `device-session:${auth.deviceSessionId || auth.deviceId || auth.clientId || 'unnamed'}`;
  }
  if (auth.authMethod === 'session') return `user:${auth.userId || 'local-user'}`;
  return `auth:${auth.authMethod || auth.role}`;
}

function requireDurableAdminAuthentication(req: AuthenticatedRequest): void {
  if (!req.auth || ['disabled', 'localhost-bypass'].includes(req.auth.authMethod ?? 'disabled')) {
    throw new ForbiddenError(
      'SQLite journal maintenance requires an authenticated admin session or admin API key.'
    );
  }
}

function translateSqliteMaintenanceError(error: unknown): never {
  if (error instanceof SqliteJournalMaintenanceError) {
    throw new AppError(error.statusCode, error.message, error.code);
  }
  throw error;
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
  '/sqlite/journal/preview',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const input = parse(sqliteJournalPreviewSchema, req.body);
    try {
      const actor = actorFromRequest(req);
      const preview = await getSqliteJournalMaintenanceService().preview(input, actor);
      await auditLog({
        action: 'sqlite.journal.previewed',
        actor,
        resource: preview.id,
        details: {
          currentMode: preview.currentMode,
          targetMode: preview.targetMode,
          filesystemPosture: preview.filesystemPosture,
          overrideRequired: preview.overrideRequired,
        },
      });
      res.json(preview);
    } catch (error) {
      translateSqliteMaintenanceError(error);
    }
  })
);

router.post(
  '/sqlite/journal/apply',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    requireDurableAdminAuthentication(req);
    const input = parse(sqliteJournalApplySchema, req.body);
    try {
      const actor = actorFromRequest(req);
      const operation = await getSqliteJournalMaintenanceService().schedule(input, actor);
      await auditLog({
        action: 'sqlite.journal.scheduled',
        actor,
        resource: operation.id,
        details: { targetMode: operation.targetMode, restartRequired: true },
      });
      res.status(202).json(operation);
    } catch (error) {
      translateSqliteMaintenanceError(error);
    }
  })
);

router.get(
  '/sqlite/journal/operations/:id',
  asyncHandler(async (req, res) => {
    const id = parse(operationIdSchema, req.params.id);
    try {
      const operation = getSqliteJournalMaintenanceService().getOperation(id);
      if (!operation) throw new NotFoundError('SQLite maintenance operation not found.');
      res.json(operation);
    } catch (error) {
      translateSqliteMaintenanceError(error);
    }
  })
);

router.get(
  '/sqlite/journal/status',
  asyncHandler(async (_req, res) => {
    res.json({
      operation: getSqliteJournalMaintenanceService().getOperation(),
      policy: getSqliteJournalMaintenanceService().getPolicySummary(),
    });
  })
);

router.post(
  '/sqlite/journal/override/revoke',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    requireDurableAdminAuthentication(req);
    const input = parse(sqliteJournalRevokeSchema, req.body);
    try {
      const actor = actorFromRequest(req);
      const policy = await getSqliteJournalMaintenanceService().revoke(input, actor);
      await auditLog({
        action: 'sqlite.journal.override_revoked',
        actor,
        resource: policy.id,
        details: { mode: policy.mode, status: policy.status, restartRequired: true },
      });
      res.json(policy);
    } catch (error) {
      translateSqliteMaintenanceError(error);
    }
  })
);

router.post(
  '/skill-security/scan',
  asyncHandler(async (req, res) => {
    res.status(201).json(await scanSkill(req.body));
  })
);

export { router as maintenanceRoutes };
