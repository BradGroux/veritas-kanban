/**
 * Integrations Status Route
 *
 * GET /api/integrations/status — Health check for configured Coolify services.
 * Pings each configured service and returns up/down/unconfigured status with response time.
 */
import { Router } from 'express';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
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

const BLOCKED_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split('.').map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return false;
  const [a, b] = parts;
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    a === 169 ||
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

function isPrivateIpv6(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return (
    normalized === '::1' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('fe80')
  );
}

function isBlockedIp(hostname: string): boolean {
  const ipVersion = isIP(hostname);
  if (ipVersion === 4) return isPrivateIpv4(hostname);
  if (ipVersion === 6) return isPrivateIpv6(hostname);
  return false;
}

async function validateServiceUrl(
  url: string
): Promise<{ ok: true; href: string } | { ok: false; reason: string }> {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { ok: false, reason: 'unsupported protocol' };
    }

    const host = parsed.hostname.toLowerCase();
    if (BLOCKED_HOSTS.has(host) || isBlockedIp(host) || host.endsWith('.local')) {
      return { ok: false, reason: 'blocked host' };
    }

    // Prevent DNS rebinding/indirection to private addresses.
    const resolutions = await lookup(host, { all: true });
    if (resolutions.some((entry) => isBlockedIp(entry.address))) {
      return { ok: false, reason: 'blocked host' };
    }

    return { ok: true, href: parsed.href };
  } catch {
    return { ok: false, reason: 'invalid url' };
  }
}

/**
 * Ping a service URL and return its status.
 */
async function pingService(service: CoolifyServiceConfig): Promise<ServiceStatus> {
  const validated = await validateServiceUrl(service.url);
  if (!validated.ok) {
    return { status: 'down', error: validated.reason };
  }

  const start = performance.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PING_TIMEOUT_MS);

  try {
    const response = await fetch(validated.href, {
      method: 'HEAD',
      signal: controller.signal,
      redirect: 'manual',
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
