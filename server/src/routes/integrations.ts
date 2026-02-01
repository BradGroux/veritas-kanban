/**
 * Integration API routes.
 *
 * Endpoints:
 *   GET    /integrations/providers       — list available providers
 *   GET    /integrations                 — list configured integrations
 *   GET    /integrations/oauth-config/:providerId — get public OAuth config
 *   POST   /integrations/:providerId     — connect a provider
 *   DELETE /integrations/:providerId     — disconnect a provider
 *   POST   /integrations/:providerId/sync — trigger sync
 *   POST   /integrations/webhooks/:providerId — incoming webhooks
 */
import { Router, type Router as RouterType } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/async-handler.js';
import { NotFoundError, ValidationError } from '../middleware/error-handler.js';
import { getProvider, listProviders, isValidProvider } from '../integrations/index.js';
import type { IntegrationProviderId } from '../integrations/index.js';
import {
  getIntegrationsConfig,
  getIntegrationConfig,
  saveIntegrationConfig,
  removeIntegrationConfig,
  getSecrets,
  saveSecrets,
  deleteSecrets,
  createDefaultConfig,
} from '../services/integration-service.js';
import { createLogger } from '../lib/logger.js';

const log = createLogger('routes:integrations');
const router: RouterType = Router();

/** Regex for valid provider IDs (defense-in-depth for file path usage). */
const PROVIDER_ID_REGEX = /^[a-z0-9-]+$/;

/** Zod schema for providerId path param. */
const providerIdSchema = z
  .string()
  .min(1)
  .regex(PROVIDER_ID_REGEX, 'Provider ID must be lowercase alphanumeric with hyphens');

/** Zod schema for connect request body. */
const connectBodySchema = z.object({
  code: z.string().min(1, 'OAuth authorization code is required'),
  projectId: z.string().optional(),
});

/** Validate and sanitize providerId param. */
function validateProviderId(id: string): IntegrationProviderId {
  const parsed = providerIdSchema.safeParse(id);
  if (!parsed.success) {
    throw new ValidationError(`Invalid provider ID: ${parsed.error.issues[0].message}`);
  }
  if (!isValidProvider(parsed.data)) {
    throw new NotFoundError(`Unknown integration provider: ${parsed.data}`);
  }
  return parsed.data;
}

// GET /integrations/providers — list all available providers
router.get(
  '/providers',
  asyncHandler(async (_req, res) => {
    const providers = listProviders();
    res.json(providers);
  })
);

// GET /integrations/oauth-config/:providerId — get public OAuth config (client_id, scopes)
router.get(
  '/oauth-config/:providerId',
  asyncHandler(async (req, res) => {
    const providerId = validateProviderId(req.params.providerId);
    const provider = getProvider(providerId);

    // Only expose non-secret OAuth config
    const oauthConfig: Record<string, string> = {};

    if (providerId === 'todoist') {
      const clientId = process.env.TODOIST_CLIENT_ID;
      if (!clientId) {
        throw new ValidationError('TODOIST_CLIENT_ID not configured on server');
      }
      oauthConfig.clientId = clientId;
      oauthConfig.scope = 'data:read_write';
      oauthConfig.oauthUrl = provider.info.oauthUrl || '';
    }

    res.json(oauthConfig);
  })
);

// GET /integrations — list configured integrations with status
router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const config = await getIntegrationsConfig();
    res.json(config.integrations);
  })
);

// POST /integrations/:providerId — connect
router.post(
  '/:providerId',
  asyncHandler(async (req, res) => {
    const providerId = validateProviderId(req.params.providerId);
    const provider = getProvider(providerId);

    const parsed = connectBodySchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues.map((i) => i.message).join('; '));
    }

    const { code, projectId } = parsed.data;
    const result = await provider.connect({ code });

    // Save secrets
    await saveSecrets(providerId, {
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      expiresAt: result.expiresAt,
    });

    // Save config
    let config = await getIntegrationConfig(providerId);
    if (!config) {
      config = createDefaultConfig(providerId);
    }
    config.status = 'connected';
    config.connectedAt = new Date().toISOString();
    config.enabled = true;

    if (projectId) {
      config.providerConfig.projectId = projectId;
    }

    await saveIntegrationConfig(config);

    log.info({ providerId }, 'Integration connected');
    res.json({ status: 'connected', providerId });
  })
);

// DELETE /integrations/:providerId — disconnect
router.delete(
  '/:providerId',
  asyncHandler(async (req, res) => {
    const providerId = validateProviderId(req.params.providerId);
    const provider = getProvider(providerId);
    const secrets = await getSecrets(providerId);

    try {
      await provider.disconnect(secrets);
    } catch (err) {
      log.warn({ providerId, err }, 'Provider disconnect callback failed (continuing)');
    }

    await deleteSecrets(providerId);
    await removeIntegrationConfig(providerId);

    log.info({ providerId }, 'Integration disconnected');
    res.json({ status: 'disconnected', providerId });
  })
);

// POST /integrations/:providerId/sync — trigger sync
router.post(
  '/:providerId/sync',
  asyncHandler(async (req, res) => {
    const providerId = validateProviderId(req.params.providerId);
    const provider = getProvider(providerId);
    const secrets = await getSecrets(providerId);
    const config = await getIntegrationConfig(providerId);

    if (!config || config.status !== 'connected') {
      throw new ValidationError(`Integration ${providerId} is not connected`);
    }

    const result = await provider.checkConnection(secrets, config);

    // Update last sync time
    config.lastSyncAt = new Date().toISOString();
    await saveIntegrationConfig(config);

    res.json(result);
  })
);

// POST /integrations/webhooks/:providerId — incoming webhook
router.post(
  '/webhooks/:providerId',
  asyncHandler(async (req, res) => {
    const providerId = validateProviderId(req.params.providerId);
    const provider = getProvider(providerId);

    const affectedIds = await provider.handleWebhook(req.body, req.headers);
    log.info({ providerId, affected: affectedIds.length }, 'Webhook processed');

    res.json({ received: true, affectedIds });
  })
);

export { router as integrationRoutes };
