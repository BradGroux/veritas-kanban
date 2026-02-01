/**
 * Integration API routes.
 *
 * Endpoints:
 *   GET    /integrations/providers       — list available providers
 *   GET    /integrations                 — list configured integrations
 *   POST   /integrations/:providerId     — connect a provider
 *   DELETE /integrations/:providerId     — disconnect a provider
 *   POST   /integrations/:providerId/sync — trigger sync
 *   POST   /integrations/webhooks/:providerId — incoming webhooks
 */
import { Router, type Router as RouterType } from 'express';
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

/** Validate providerId param. */
function validateProviderId(id: string): IntegrationProviderId {
  if (!isValidProvider(id)) {
    throw new NotFoundError(`Unknown integration provider: ${id}`);
  }
  return id;
}

// GET /integrations/providers — list all available providers
router.get(
  '/providers',
  asyncHandler(async (_req, res) => {
    const providers = listProviders();
    res.json(providers);
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

    const params = req.body as Record<string, string>;
    if (!params || typeof params !== 'object') {
      throw new ValidationError('Request body must be an object with connection parameters');
    }

    const result = await provider.connect(params);

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

    // Merge any providerConfig from request body
    if (params.projectId) {
      config.providerConfig.projectId = params.projectId;
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

    const result = await provider.syncStatus(secrets, config);

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
