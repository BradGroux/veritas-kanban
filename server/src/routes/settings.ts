import { Router, type Router as RouterType } from 'express';
import { ConfigService } from '../services/config-service.js';
import { CodexHealthService } from '../services/codex-health-service.js';
import { getTelemetryService } from '../services/telemetry-service.js';
import { getAttachmentService } from '../services/attachment-service.js';
import { setEnforcementSettings, setHooksSettings } from '../services/hook-service.js';
import type { FeatureSettings } from '@veritas-kanban/shared';
import { FeatureSettingsPatchSchema } from '../schemas/feature-settings-schema.js';
import { strictRateLimit } from '../middleware/rate-limit.js';
import { asyncHandler } from '../middleware/async-handler.js';
import { ValidationError } from '../middleware/error-handler.js';
import { auditLog } from '../services/audit-service.js';
import { authorize, type AuthenticatedRequest } from '../middleware/auth.js';

const router: RouterType = Router();
const configService = new ConfigService();
const codexHealthService = new CodexHealthService();

/**
 * Sync feature settings to affected server-side services.
 * Called on PATCH and on server startup.
 */
export function syncSettingsToServices(settings: FeatureSettings): void {
  // Sync telemetry settings
  const telemetry = getTelemetryService();
  telemetry.configure({
    enabled: settings.telemetry.enabled,
    retention: settings.telemetry.retentionDays,
    traces: settings.telemetry.enableTraces,
  });

  // Sync attachment limits
  const attachments = getAttachmentService();
  attachments.setLimits({
    maxFileSize: settings.tasks.attachmentMaxFileSize,
    maxFilesPerTask: settings.tasks.attachmentMaxPerTask,
    maxTotalSize: settings.tasks.attachmentMaxTotalSize,
  });

  // Sync lifecycle hooks settings
  setHooksSettings(settings.hooks);

  // Sync enforcement settings
  setEnforcementSettings(settings.enforcement);
}

function sanitizeFeatureSettings(settings: FeatureSettings): FeatureSettings {
  const sanitized: FeatureSettings = {
    ...settings,
    squadWebhook: settings.squadWebhook ? { ...settings.squadWebhook } : settings.squadWebhook,
  };

  if (sanitized.squadWebhook) {
    if ('openclawGatewayToken' in sanitized.squadWebhook) {
      delete sanitized.squadWebhook.openclawGatewayToken;
    }
    if ('secret' in sanitized.squadWebhook) {
      delete sanitized.squadWebhook.secret;
    }
  }

  return sanitized;
}

// GET /api/settings/features — returns full feature settings with defaults merged
router.get(
  '/features',
  asyncHandler(async (_req, res) => {
    const features = await configService.getFeatureSettings();
    res.json(sanitizeFeatureSettings(features));
  })
);

// GET /api/settings/codex/health — checks Codex install/auth/SDK/profile readiness
router.get(
  '/codex/health',
  asyncHandler(async (_req, res) => {
    const health = await codexHealthService.getHealth();
    res.json(health);
  })
);

// PATCH /api/settings/features — deep merge partial updates
// strictRateLimit middleware: 10 req/min per IP
// authorize('admin') — settings mutations require admin role
router.patch(
  '/features',
  authorize('admin'),
  strictRateLimit,
  asyncHandler(async (req, res) => {
    // Validate with Zod — strips unknown keys, rejects dangerous ones
    const parseResult = FeatureSettingsPatchSchema.safeParse(req.body);
    if (!parseResult.success) {
      throw new ValidationError(
        'Invalid settings payload',
        parseResult.error.issues.map((i) => i.message)
      );
    }
    const patch = parseResult.data;

    if (Object.keys(patch).length === 0) {
      throw new ValidationError('No valid settings provided');
    }

    const updated = await configService.updateFeatureSettings(patch);
    syncSettingsToServices(updated);

    const sanitized = sanitizeFeatureSettings(updated);

    // Audit log
    const authReq = req as AuthenticatedRequest;
    await auditLog({
      action: 'settings.update',
      actor: authReq.auth?.keyName || 'unknown',
      resource: 'features',
      details: { keys: Object.keys(patch) },
    });

    res.json(sanitized);
  })
);

export { router as settingsRoutes };
