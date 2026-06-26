/**
 * Integrations Status Route
 *
 * GET /api/integrations/status — Health check for configured Coolify services.
 * Pings each configured service and returns up/down/unconfigured status with response time.
 */
import { Router } from 'express';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { z } from 'zod';
import { ConfigService } from '../services/config-service.js';
import { asyncHandler } from '../middleware/async-handler.js';
import { ForbiddenError, NotFoundError } from '../middleware/error-handler.js';
import { hasPermission, type AuthenticatedRequest } from '../middleware/auth.js';
import type { CoolifyServiceConfig, CoolifyServicesConfig } from '@veritas-kanban/shared';
import { broadcastSquadMessage } from '../services/broadcast-service.js';
import {
  DEFAULT_ADAPTER_ID,
  getCommunicationAdapterService,
} from '../services/communication-adapter-service.js';
import { getOutboundIntegrationService } from '../services/outbound-integration-service.js';
import { safeFetch } from '../utils/url-validation.js';
import { createLogger } from '../lib/logger.js';

const log = createLogger('integrations');
const router = Router();
const configService = new ConfigService();
const outboundIntegrations = getOutboundIntegrationService();
const communicationAdapters = getCommunicationAdapterService();

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

const replyTargetSchema = z.object({
  kind: z.enum(['squad', 'task', 'run', 'approval', 'notification']),
  squadMessageId: z.string().optional(),
  taskId: z.string().optional(),
  runId: z.string().optional(),
  approvalId: z.string().optional(),
  notificationId: z.string().optional(),
});

const adapterConfigSchema = z.object({
  kind: z.enum(['msteams']).optional(),
  displayName: z.string().optional(),
  enabled: z.boolean().optional(),
  deliveryMode: z.enum(['manual', 'webhook']).optional(),
  destinationType: z.enum(['channel', 'direct']).optional(),
  tenantId: z.string().optional(),
  teamId: z.string().optional(),
  channelId: z.string().optional(),
  chatId: z.string().optional(),
  webhookUrl: z.string().optional(),
  credential: z.string().optional(),
});

const sendSchema = z.object({
  target: replyTargetSchema,
  message: z.string().min(1),
  actor: z.string().optional(),
  externalThreadId: z.string().optional(),
  externalUrl: z.string().optional(),
});

const replyIngestSchema = z.object({
  externalThreadId: z.string().min(1),
  externalReplyId: z.string().optional(),
  actor: z.string().min(1),
  displayName: z.string().optional(),
  message: z.string().min(1),
  target: replyTargetSchema.optional(),
  externalUrl: z.string().optional(),
});

function adapterIdParam(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value : DEFAULT_ADAPTER_ID;
}

async function ensureAdapterExists(adapterId: string): Promise<void> {
  const adapter = await communicationAdapters.getAdapter(adapterId);
  if (!adapter) {
    throw new NotFoundError(`Communication adapter ${adapterId} not found`);
  }
}

function enforceApprovalReplyPermission(
  req: AuthenticatedRequest,
  target?: { kind: string }
): void {
  if (target?.kind !== 'approval') return;
  if (
    hasPermission(req.auth, 'workflow:execute') ||
    hasPermission(req.auth, 'task:write') ||
    hasPermission(req.auth, 'admin:manage')
  ) {
    return;
  }

  throw new ForbiddenError('Approval replies require approval-capable permissions', {
    required: ['workflow:execute', 'task:write'],
  });
}

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
    const response = await safeFetch(
      validated.href,
      {
        method: 'HEAD',
        signal: controller.signal,
        redirect: 'manual',
      },
      { allowHttp: true }
    );
    if (!response) {
      return { status: 'down', error: 'blocked host' };
    }
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

// GET /api/integrations/outbound/endpoints
router.get(
  '/outbound/endpoints',
  asyncHandler(async (_req, res) => {
    res.json(await outboundIntegrations.listEndpoints());
  })
);

// GET /api/integrations/outbound/deliveries?limit=100
router.get(
  '/outbound/deliveries',
  asyncHandler(async (req, res) => {
    const rawLimit = typeof req.query.limit === 'string' ? Number(req.query.limit) : 100;
    const limit = Number.isFinite(rawLimit) ? rawLimit : 100;
    res.json(await outboundIntegrations.listDeliveries(limit));
  })
);

// GET /api/integrations/communication/adapters
router.get(
  '/communication/adapters',
  asyncHandler(async (_req, res) => {
    res.json(await communicationAdapters.listAdapters());
  })
);

// PUT /api/integrations/communication/adapters/:adapterId
router.put(
  '/communication/adapters/:adapterId',
  asyncHandler(async (req, res) => {
    const adapterId = adapterIdParam(req.params.adapterId);
    const input = adapterConfigSchema.parse(req.body);
    res.json(await communicationAdapters.configureAdapter(adapterId, input));
  })
);

// GET /api/integrations/communication/adapters/:adapterId/health
router.get(
  '/communication/adapters/:adapterId/health',
  asyncHandler(async (req, res) => {
    const adapterId = adapterIdParam(req.params.adapterId);
    await ensureAdapterExists(adapterId);
    res.json(await communicationAdapters.checkHealth(adapterId));
  })
);

// POST /api/integrations/communication/adapters/:adapterId/test
router.post(
  '/communication/adapters/:adapterId/test',
  asyncHandler(async (req, res) => {
    const adapterId = adapterIdParam(req.params.adapterId);
    await ensureAdapterExists(adapterId);
    const message =
      typeof req.body?.message === 'string' && req.body.message.trim()
        ? req.body.message
        : 'Veritas communication adapter test';
    const result = await communicationAdapters.send(adapterId, {
      target: { kind: 'notification', notificationId: 'adapter-test' },
      message,
      actor: 'system',
    });
    res.json(result);
  })
);

// POST /api/integrations/communication/adapters/:adapterId/send
router.post(
  '/communication/adapters/:adapterId/send',
  asyncHandler(async (req, res) => {
    const adapterId = adapterIdParam(req.params.adapterId);
    await ensureAdapterExists(adapterId);
    const input = sendSchema.parse(req.body);
    const result = await communicationAdapters.send(adapterId, input);
    res.status(result.delivery.status === 'blocked' ? 409 : 202).json(result);
  })
);

// POST /api/integrations/communication/adapters/:adapterId/replies
router.post(
  '/communication/adapters/:adapterId/replies',
  asyncHandler(async (req, res) => {
    const adapterId = adapterIdParam(req.params.adapterId);
    await ensureAdapterExists(adapterId);
    const input = replyIngestSchema.parse(req.body);
    enforceApprovalReplyPermission(req as AuthenticatedRequest, input.target);
    const result = await communicationAdapters.ingestReply(adapterId, input);
    if (result.squadMessage) {
      broadcastSquadMessage(result.squadMessage);
    }
    res.status(result.delivery.status === 'success' ? 201 : 400).json(result);
  })
);

// POST /api/integrations/communication/adapters/:adapterId/poll
router.post(
  '/communication/adapters/:adapterId/poll',
  asyncHandler(async (req, res) => {
    const adapterId = adapterIdParam(req.params.adapterId);
    await ensureAdapterExists(adapterId);
    res.json(await communicationAdapters.pollReplies(adapterId));
  })
);

// POST /api/integrations/communication/adapters/:adapterId/disconnect
router.post(
  '/communication/adapters/:adapterId/disconnect',
  asyncHandler(async (req, res) => {
    const adapterId = adapterIdParam(req.params.adapterId);
    await ensureAdapterExists(adapterId);
    res.json(await communicationAdapters.disconnectAdapter(adapterId));
  })
);

// GET /api/integrations/communication/mappings?adapterId=msteams-default
router.get(
  '/communication/mappings',
  asyncHandler(async (req, res) => {
    const adapterId = typeof req.query.adapterId === 'string' ? req.query.adapterId : undefined;
    res.json(await communicationAdapters.listMappings(adapterId));
  })
);

// GET /api/integrations/communication/deliveries?adapterId=msteams-default&limit=100
router.get(
  '/communication/deliveries',
  asyncHandler(async (req, res) => {
    const rawLimit = typeof req.query.limit === 'string' ? Number(req.query.limit) : 100;
    const limit = Number.isFinite(rawLimit) ? rawLimit : 100;
    const adapterId = typeof req.query.adapterId === 'string' ? req.query.adapterId : undefined;
    res.json(await communicationAdapters.listDeliveries(limit, adapterId));
  })
);

export { router as integrationsRoutes };
