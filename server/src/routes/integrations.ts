/**
 * Integrations Status Route
 *
 * GET /api/integrations/status — Health check for configured Coolify services.
 * Pings each configured service and returns up/down/unconfigured status with response time.
 */
import { Router } from 'express';
import { ConfigService } from '../services/config-service.js';
import { asyncHandler } from '../middleware/async-handler.js';
import { createLogger } from '../lib/logger.js';
import type { CoolifyServiceConfig, CoolifyServicesConfig } from '@veritas-kanban/shared';

const log = createLogger('integrations');
const router = Router();
const configService = new ConfigService();

const SERVICE_NAMES = ['supabase', 'openpanel', 'n8n', 'plane', 'appsmith'] as const;
type ServiceName = (typeof SERVICE_NAMES)[number];

/** Timeout for health check pings (ms) */
const PING_TIMEOUT_MS = 5_000;

interface ServiceStatus {
  status: 'up' | 'down' | 'unconfigured';
  responseTimeMs?: number;
  error?: string;
}

/**
 * Ping a service URL and return its status.
 */
async function pingService(service: CoolifyServiceConfig): Promise<ServiceStatus> {
  const start = performance.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PING_TIMEOUT_MS);

  try {
    const response = await fetch(service.url, {
      method: 'HEAD',
      signal: controller.signal,
      redirect: 'follow',
    });
    const responseTimeMs = Math.round(performance.now() - start);

    // Any response (even 401/403) means the service is up
    return { status: 'up', responseTimeMs };
  } catch (err: unknown) {
    const responseTimeMs = Math.round(performance.now() - start);
    const message = err instanceof Error ? err.message : 'unknown error';
    return {
      status: 'down',
      responseTimeMs,
      error: message.includes('abort') ? 'timeout' : message,
    };
  } finally {
    clearTimeout(timeout);
  }
}

// GET /api/integrations/status
router.get(
  '/status',
  asyncHandler(async (_req, res) => {
    const config = await configService.getConfig();
    const services = config.coolify?.services ?? ({} as CoolifyServicesConfig);

    const results: Record<string, ServiceStatus> = {};

    // Ping all configured services in parallel
    const checks = SERVICE_NAMES.map(async (name: ServiceName) => {
      const svc = services[name];
      if (!svc?.url) {
        results[name] = { status: 'unconfigured' };
        return;
      }
      results[name] = await pingService(svc);
    });

    await Promise.all(checks);

    log.debug({ results }, 'Integration status check complete');
    res.json({ data: results });
  })
);

export { router as integrationsRoutes };
