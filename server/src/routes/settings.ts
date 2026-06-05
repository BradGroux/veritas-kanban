import { Router, type Router as RouterType } from 'express';
import { ConfigService } from '../services/config-service.js';
import { CodexHealthService } from '../services/codex-health-service.js';
import { ContextProviderHealthService } from '../services/context-provider-health-service.js';
import { getTelemetryService } from '../services/telemetry-service.js';
import { getAttachmentService } from '../services/attachment-service.js';
import { setEnforcementSettings, setHooksSettings } from '../services/hook-service.js';
import { setWatcherContinuationSettings } from '../services/watcher-policy-service.js';
import type {
  FeatureSettings,
  HookConfig,
  HooksSettings,
  NotificationSettings,
  SquadWebhookSettings,
} from '@veritas-kanban/shared';
import { FeatureSettingsPatchSchema } from '../schemas/feature-settings-schema.js';
import { strictRateLimit } from '../middleware/rate-limit.js';
import { asyncHandler } from '../middleware/async-handler.js';
import { ValidationError } from '../middleware/error-handler.js';
import { auditLog } from '../services/audit-service.js';
import { authorize, hasPermission, type AuthenticatedRequest } from '../middleware/auth.js';
import { getOutboundIntegrationService } from '../services/outbound-integration-service.js';
import { createLogger } from '../lib/logger.js';

const router: RouterType = Router();
const configService = new ConfigService();
const codexHealthService = new CodexHealthService();
const contextProviderHealthService = new ContextProviderHealthService();
const log = createLogger('settings-routes');

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

  // Sync watcher continuation policy settings
  setWatcherContinuationSettings(settings.watcherContinuations);

  // Register outbound endpoints from legacy feature settings without exposing secrets.
  void getOutboundIntegrationService()
    .syncFeatureSettings(settings)
    .catch((err) => {
      log.warn({ err }, 'Failed to sync outbound integration endpoints from feature settings');
    });
}

const HOOK_KEYS = ['onCreated', 'onStarted', 'onBlocked', 'onCompleted', 'onArchived'] as const;

function hasConfiguredValue(value?: string): boolean {
  return Boolean(value?.trim());
}

function sanitizeNotificationSettings(
  settings: NotificationSettings,
  includeSensitiveUrls: boolean
): NotificationSettings {
  const sanitized: NotificationSettings = { ...settings };
  const webhookUrlConfigured = hasConfiguredValue(sanitized.webhookUrl);
  sanitized.webhookUrlConfigured = webhookUrlConfigured;
  sanitized.webhookUrlRedacted = webhookUrlConfigured && !includeSensitiveUrls;
  if (sanitized.webhookUrlRedacted) {
    delete sanitized.webhookUrl;
  }
  return sanitized;
}

function sanitizeHookConfig(
  hook: HookConfig | undefined,
  includeSensitiveUrls: boolean
): HookConfig | undefined {
  if (!hook) return hook;
  const sanitized: HookConfig = { ...hook };
  const webhookConfigured = hasConfiguredValue(sanitized.webhook);
  sanitized.webhookConfigured = webhookConfigured;
  sanitized.webhookRedacted = webhookConfigured && !includeSensitiveUrls;
  if (sanitized.webhookRedacted) {
    delete sanitized.webhook;
  }
  return sanitized;
}

function sanitizeHooksSettings(
  settings: HooksSettings,
  includeSensitiveUrls: boolean
): HooksSettings {
  const sanitized: HooksSettings = { ...settings };
  for (const key of HOOK_KEYS) {
    sanitized[key] = sanitizeHookConfig(settings[key], includeSensitiveUrls);
  }
  return sanitized;
}

function sanitizeSquadWebhookSettings(
  settings: SquadWebhookSettings,
  includeSensitiveUrls: boolean
): SquadWebhookSettings {
  const sanitized: SquadWebhookSettings = { ...settings };

  const urlConfigured = hasConfiguredValue(sanitized.url);
  sanitized.urlConfigured = urlConfigured;
  sanitized.urlRedacted = urlConfigured && !includeSensitiveUrls;
  if (sanitized.urlRedacted) {
    delete sanitized.url;
  }

  const openclawGatewayUrlConfigured = hasConfiguredValue(sanitized.openclawGatewayUrl);
  sanitized.openclawGatewayUrlConfigured = openclawGatewayUrlConfigured;
  sanitized.openclawGatewayUrlRedacted = openclawGatewayUrlConfigured && !includeSensitiveUrls;
  if (sanitized.openclawGatewayUrlRedacted) {
    delete sanitized.openclawGatewayUrl;
  }

  sanitized.secretConfigured = hasConfiguredValue(sanitized.secret);
  sanitized.secretRedacted = sanitized.secretConfigured;
  if ('secret' in sanitized) {
    delete sanitized.secret;
  }

  sanitized.openclawGatewayTokenConfigured = hasConfiguredValue(sanitized.openclawGatewayToken);
  sanitized.openclawGatewayTokenRedacted = sanitized.openclawGatewayTokenConfigured;
  if ('openclawGatewayToken' in sanitized) {
    delete sanitized.openclawGatewayToken;
  }

  return sanitized;
}

function canViewSensitiveFeatureUrls(req: AuthenticatedRequest): boolean {
  return hasPermission(req.auth, 'settings:write') || hasPermission(req.auth, 'admin:manage');
}

function sanitizeFeatureSettings(
  settings: FeatureSettings,
  includeSensitiveUrls = false
): FeatureSettings {
  const sanitized: FeatureSettings = {
    ...settings,
    notifications: sanitizeNotificationSettings(settings.notifications, includeSensitiveUrls),
    hooks: sanitizeHooksSettings(settings.hooks, includeSensitiveUrls),
    squadWebhook: settings.squadWebhook
      ? sanitizeSquadWebhookSettings(settings.squadWebhook, includeSensitiveUrls)
      : settings.squadWebhook,
  };

  return sanitized;
}

// GET /api/settings/features — returns full feature settings with defaults merged
router.get(
  '/features',
  asyncHandler(async (req, res) => {
    const features = await configService.getFeatureSettings();
    res.json(
      sanitizeFeatureSettings(features, canViewSensitiveFeatureUrls(req as AuthenticatedRequest))
    );
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

// GET /api/settings/provider-health — shared context-provider/MCP posture summary
router.get(
  '/provider-health',
  asyncHandler(async (_req, res) => {
    const health = await contextProviderHealthService.getHealth();
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

    // Audit log
    const authReq = req as AuthenticatedRequest;
    const sanitized = sanitizeFeatureSettings(updated, canViewSensitiveFeatureUrls(authReq));
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
