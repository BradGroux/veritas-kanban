import 'dotenv/config';

// ============================================
// Environment Validation (fail-fast)
// ============================================
// Must run immediately after dotenv loads, before any other setup.
// If required env vars are missing or invalid, the process exits with
// a clear error message listing ALL issues at once.
import { validateEnv } from './config/env.js';
validateEnv();

import express from 'express';
import helmet from 'helmet';
import compression from 'compression';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';
import { readFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { createLogger } from './lib/logger.js';
import { v1Router } from './routes/v1/index.js';
import { agentService } from './routes/agents.js';
import { syncSettingsToServices } from './routes/settings.js';
import { initAgentStatus } from './routes/agent-status.js';
import { getTelemetryService } from './services/telemetry-service.js';
import { ConfigService } from './services/config-service.js';
import { disposeTaskService } from './services/task-service.js';
import {
  startScheduledDeliverablesRunner,
  stopScheduledDeliverablesRunner,
} from './services/scheduled-deliverables-runner-service.js';
import { initBroadcast, nextWebSocketEventSequence } from './services/broadcast-service.js';
import { runStartupMigrations } from './services/migration-service.js';
import { getPolicyService } from './services/policy-service.js';
import { createBackup, runIntegrityChecks } from './services/integrity-service.js';
import { errorHandler, AppError } from './middleware/error-handler.js';
import { requestIdMiddleware } from './middleware/request-id.js';
import { responseEnvelopeMiddleware } from './middleware/response-envelope.js';
import { requestTimeout } from './middleware/request-timeout.js';
import {
  authenticate,
  authorize,
  authorizeWrite,
  authenticateWebSocket,
  type AuthPermission,
  validateWebSocketOrigin,
  getAuthStatus,
  checkAdminKeyStrength,
  type AuthenticatedWebSocket,
} from './middleware/auth.js';
import authRoutes from './routes/auth.js';
import { checkJwtSecretConfig } from './config/security.js';
import swaggerUi from 'swagger-ui-express';
import { swaggerSpec } from './config/swagger.js';
import { apiRateLimit, authRateLimit } from './middleware/rate-limit.js';
import { apiVersionMiddleware } from './middleware/api-version.js';
import { apiCacheHeaders } from './middleware/cache-control.js';
import type { AgentOutput } from './services/clawdbot-agent-service.js';
import { webhookN8nRouter } from './routes/webhook-n8n.js';
import { cspNonceMiddleware, injectCspNonceAttributes } from './middleware/csp-nonce.js';
import { apiDocsCspOverride, buildCspDirectives } from './config/csp.js';
import { healthRouter, apiHealthRouter, setHealthWss } from './routes/health.js';
import { metricsCollector } from './middleware/metrics-collector.js';
import { prometheusMetricsRouter } from './routes/prometheus.js';
import { getStorageTypeFromEnv, initStorage, shutdownStorage } from './storage/index.js';
import {
  canReceiveWebSocketEvent,
  subscribeWebSocketChatSession,
  subscribeWebSocketChannel,
  unsubscribeWebSocketChatSession,
  type WebSocketEventChannel,
} from './services/websocket-permissions.js';

const log = createLogger('server');

// ============================================
// Process Error Handlers (register early)
// ============================================
// In Node.js 22+, unhandled promise rejections terminate the process.
// Catch both unhandledRejection and uncaughtException to ensure structured
// logging before exit. uncaughtException triggers graceful shutdown;
// unhandledRejection logs a fatal error and exits.

process.on('unhandledRejection', (reason: unknown) => {
  log.fatal({ err: reason }, 'Unhandled promise rejection — terminating');
  // Exit with failure; the gracefulShutdown function may not be available
  // this early, but we must not swallow the error.
  process.exitCode = 1;
  // Attempt graceful shutdown if the server is already running
  if (typeof gracefulShutdown === 'function') {
    gracefulShutdown('unhandledRejection').catch(() => process.exit(1));
  } else {
    process.exit(1);
  }
});

process.on('uncaughtException', (err: Error) => {
  log.fatal({ err }, 'Uncaught exception — terminating');
  // uncaughtException leaves the process in an undefined state;
  // attempt graceful shutdown then force-exit.
  if (typeof gracefulShutdown === 'function') {
    gracefulShutdown('uncaughtException').catch(() => process.exit(1));
  } else {
    process.exit(1);
  }
});

const app = express();

// ── Reverse-proxy trust ─────────────────────────────────────────────
// When deployed behind a reverse proxy (nginx, Caddy, Traefik, Synology DSM),
// set TRUST_PROXY to enable correct client IP detection for rate limiting
// and X-Forwarded-* header handling.  Disabled by default (Express default).
//
// Accepted values:
//   TRUST_PROXY=1              → trust one proxy hop (recommended)
//   TRUST_PROXY=2              → trust two hops (CDN + reverse proxy)
//   TRUST_PROXY=loopback       → trust loopback addresses only
//   TRUST_PROXY=linklocal      → trust link-local addresses
//   TRUST_PROXY=uniquelocal    → trust unique-local addresses
//   TRUST_PROXY=10.0.0.0/8     → trust a specific subnet
//
// ⚠️  TRUST_PROXY=true is intentionally rejected — it trusts ALL proxies
//     and is dangerous on public-facing deployments.
//
// See: https://expressjs.com/en/guide/behind-proxies.html
const trustProxy = process.env.TRUST_PROXY;
if (trustProxy !== undefined && trustProxy !== '') {
  // Block dangerous wildcard trust
  if (trustProxy === 'true') {
    log.warn(
      'TRUST_PROXY=true is not allowed (trusts all proxies, unsafe for production). ' +
        'Use a numeric hop count (e.g. TRUST_PROXY=1) or a specific subnet instead. ' +
        'Falling back to default (no trust).'
    );
  } else {
    const parsed = Number(trustProxy);
    const value = trustProxy === 'false' ? false : isNaN(parsed) ? trustProxy : parsed;
    app.set('trust proxy', value);
    log.info(`Trust proxy configured: ${JSON.stringify(value)}`);
  }
}

const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST?.trim() || undefined;

// ============================================
// Performance: ETag Generation
// ============================================
// Express generates weak ETags for JSON responses by default.
// Explicitly enable for clarity and to support conditional requests
// (If-None-Match → 304 Not Modified).
app.set('etag', 'weak');

// ============================================
// Security: HTTP Headers (Helmet)
// ============================================
// Helmet sets various HTTP headers to help protect the app.
// Content-Security-Policy (CSP) restricts which resources the browser
// is allowed to load, mitigating XSS and data-injection attacks.
//
// CSP Directives:
//   defaultSrc  - Fallback for all resource types: only same-origin
//   scriptSrc   - Scripts: same-origin only (+ unsafe-inline in dev for Vite HMR)
//   styleSrc    - Stylesheets and nonce-tagged style elements only in production
//   styleSrcAttr - React runtime style attributes only
//   connectSrc  - XHR/fetch/WebSocket: same-origin + ws://localhost for dev WS
//   imgSrc      - Images: same-origin + data: URIs (inline SVGs, base64 images)
//   fontSrc     - Fonts: same-origin
//   objectSrc   - Plugins (Flash, etc.): blocked entirely
//   frameSrc    - Iframes: blocked entirely
//   baseUri     - <base> tag: only same-origin
//   formAction  - Form submissions: only same-origin
//   upgradeInsecureRequests - Auto-upgrade HTTP → HTTPS in production
//
// == Dev vs Production CSP ==
//
// DEVELOPMENT ('unsafe-inline' only, NO 'unsafe-eval'):
//   Vite HMR injects inline <script> tags for hot module replacement.
//   Nonce-based CSP would require Vite's dev server to know the nonce at
//   script injection time, which it doesn't support (Vite generates HMR
//   client scripts independently of Express). See:
//     https://github.com/vitejs/vite/issues/12086
//
//   'unsafe-eval' was previously included but is NOT required. Vite uses
//   dynamic import() (works under 'self') and does NOT rely on eval() or
//   new Function() for module evaluation.
//
//   Note: In dev, Vite (port 3000) serves the frontend and proxies /api
//   to Express (port 3001). These CSP headers apply to Express responses
//   only, not to Vite-served HTML. They still matter for any HTML served
//   directly by Express (e.g., error pages) and as defense-in-depth.
//
// PRODUCTION:
//   Scripts require same-origin + nonce. The cspNonceMiddleware generates
//   a per-request nonce available via res.locals.cspNonce. Server-served HTML
//   receives nonce attributes on <script> and <style> tags in the SPA fallback
//   handler. Inline style attributes remain allowed through style-src-attr only
//   because the current React UI still uses dynamic style props for progress,
//   drag/drop transforms, chart widths, and color indicators.
//
// == CSP Report-Only Mode ==
//
// Set CSP_REPORT_ONLY=true to use Content-Security-Policy-Report-Only
// instead of enforcing. Violations are reported (if CSP_REPORT_URI is set)
// but not blocked — useful for testing policy changes without breakage.
//
// Set CSP_REPORT_URI to a URL to receive violation reports (e.g.,
// https://your-domain.com/csp-report or a service like report-uri.com).
const isDev = process.env.NODE_ENV !== 'production';
const isDesktopRuntime = process.env.VERITAS_DESKTOP_RUNTIME === '1';
const cspReportOnly = process.env.CSP_REPORT_ONLY === 'true';
const cspReportUri = process.env.CSP_REPORT_URI || null;

// CSP nonce generation — must run before Helmet so the per-request nonce
// is available when Helmet builds the Content-Security-Policy header.
app.use(cspNonceMiddleware);

app.use(
  helmet({
    contentSecurityPolicy: {
      // Report-Only mode: log violations without enforcing (for safe rollout)
      reportOnly: cspReportOnly,
      directives: {
        ...buildCspDirectives({
          isDev,
          isDesktopRuntime,
          reportUri: cspReportUri,
        }),
      },
    },
    // Cross-Origin-Embedder-Policy can break loading of cross-origin resources;
    // disable it for now since we serve an API, not embedded content.
    crossOriginEmbedderPolicy: false,
  })
);

// ============================================
// Performance: Response Compression (gzip/deflate)
// ============================================
// Compress responses > 1KB at level 6 (good balance of speed vs size).
// Placed after Helmet so security headers are set first.
app.use(compression({ level: 6, threshold: 1024 }));

// ============================================
// Security: CORS Configuration
// ============================================
const normalizeOrigin = (origin: string): string => origin.trim().replace(/\/+$/, '');

const parseCorsOrigins = (value: string): string[] =>
  value
    .split(',')
    .map((origin) => normalizeOrigin(origin))
    .filter(Boolean);

const buildDefaultDevOrigins = (): string[] => {
  const hosts = new Set<string>(['localhost', '127.0.0.1']);
  const hostname = os.hostname().trim().toLowerCase();

  if (hostname) {
    hosts.add(hostname);
    if (!hostname.includes('.')) {
      hosts.add(`${hostname}.local`);
    }
  }

  const configuredHost = process.env.HOST?.trim().toLowerCase();
  if (configuredHost && configuredHost !== '0.0.0.0' && configuredHost !== '::') {
    hosts.add(configuredHost);
  }

  const serverPort = process.env.PORT || '3001';
  const origins: string[] = [];
  for (const host of hosts) {
    origins.push(`http://${host}:5173`, `http://${host}:3000`, `http://${host}:${serverPort}`);
  }

  return origins;
};

// Allowed origins from environment (comma-separated) or defaults for dev
const ALLOWED_ORIGINS = process.env.CORS_ORIGINS
  ? parseCorsOrigins(process.env.CORS_ORIGINS)
  : buildDefaultDevOrigins();

const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (e.g., mobile apps, curl, server-to-server)
    if (!origin) {
      callback(null, true);
      return;
    }

    if (ALLOWED_ORIGINS.includes(normalizeOrigin(origin))) {
      callback(null, true);
      return;
    }

    // In dev mode, allow any localhost/127.0.0.1 origin (any port).
    // Mirrors the WebSocket origin validation logic in auth.ts
    const isDev = process.env.NODE_ENV !== 'production';
    if (isDev) {
      try {
        const url = new URL(origin);
        if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
          callback(null, true);
          return;
        }
      } catch {
        // invalid origin URL — fall through to rejection
      }
    }

    log.warn({ origin }, 'CORS blocked request from disallowed origin');
    callback(new AppError(403, 'Origin not allowed by CORS', 'CORS_REJECTED'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key', 'X-API-Version', 'X-Request-ID'],
};

// ============================================
// Tracing: Request ID (X-Request-ID)
// ============================================
// Generates (or preserves) a unique request ID for every request.
// Placed right after Helmet + compression so the ID is available
// to all downstream middleware and route handlers.
app.use(requestIdMiddleware);

// ============================================
// Stability: Request Timeout (30 s default, 120 s uploads)
// ============================================
// Prevents hung connections from piling up and exhausting server
// resources.  Must be registered after request-id (so timeout
// responses include the trace ID) and before routes.
app.use(requestTimeout());

// Middleware
app.use(cors(corsOptions));
app.use(cookieParser());

// ============================================
// Security: Request Size Limit (1MB)
// ============================================
app.use(express.json({ limit: '1mb' }));

// Health checks (liveness, readiness, deep diagnostics)
app.use('/health', healthRouter);

// Canonical VK API health signal (unauthenticated; used by dev tooling/watchdogs)
app.use('/api/health', apiHealthRouter);

// Prometheus exposition endpoint. Public only for explicit loopback development
// binds or PROMETHEUS_METRICS_PUBLIC=true; exposed/remote modes require normal
// auth with telemetry:read or PROMETHEUS_METRICS_TOKEN.
app.use(prometheusMetricsRouter);

// Metrics collection middleware — records per-request HTTP metrics.
// Placed after health/metrics endpoints so those aren't self-instrumented
// (avoids metric noise from scraping itself).
app.use(metricsCollector());

// ============================================
// API Documentation (Swagger UI) — unauthenticated
// ============================================
// Serve the raw OpenAPI JSON spec
app.get('/api-docs/swagger.json', (_req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.send(swaggerSpec);
});

// Swagger UI needs inline scripts/styles, so override CSP for /api-docs only.
app.use('/api-docs', apiDocsCspOverride);
app.use(
  '/api-docs',
  swaggerUi.serve,
  swaggerUi.setup(swaggerSpec, {
    customSiteTitle: 'Veritas Kanban API Docs',
    explorer: true,
  })
);

// Auth diagnostic endpoint (admin-only, requires authentication)
// Available at both /api/auth/diagnostics and /api/v1/auth/diagnostics
app.get('/api/auth/diagnostics', authenticate, authorize('admin'), (_req, res) => {
  res.json(getAuthStatus());
});
app.get('/api/v1/auth/diagnostics', authenticate, authorize('admin'), (_req, res) => {
  res.json(getAuthStatus());
});

// ============================================
// Auth Routes (unauthenticated - for login/setup)
// Available at both /api/auth and /api/v1/auth
// Auth rate limit: 10 req / 15 min (very strict)
// ============================================
app.use('/api/v1/auth', authRateLimit, authRoutes);
app.use('/api/auth', authRateLimit, authRoutes);

// ============================================
// Security: Rate Limiting (100 req/min)
// Applies to both /api/* and /api/v1/* (since /api/v1 starts with /api)
// ============================================
app.use('/api', apiRateLimit);

// Unauthenticated webhook routes (registered BEFORE authenticate middleware)
app.use('/api/webhook', webhookN8nRouter);

// Apply authentication to all API routes (except /api/auth which is handled above)
app.use('/api', authenticate);

// ============================================
// Authorization: write access enforcement
// Read-only roles can perform only GET/HEAD/OPTIONS on API routes.
// ============================================
app.use('/api', authorizeWrite);

// ============================================
// API Versioning Middleware
// Sets X-API-Version response header and validates requested version
// ============================================
app.use('/api', apiVersionMiddleware);

// ============================================
// Performance: Cache-Control Headers
// ============================================
// Route-pattern middleware that sets Cache-Control, ETag, and related
// headers for all API responses.  See middleware/cache-control.ts for
// profile definitions.  Static asset caching is configured separately
// in the express.static() section below.
app.use('/api', apiCacheHeaders);

// ============================================
// Response Envelope (wraps res.json for /api)
// ============================================
// Standardises all JSON responses into { success, data|error, meta }.
// Must be applied AFTER auth / cache-control but BEFORE routes and
// the error handler so that both route responses and errors are wrapped.
app.use('/api', responseEnvelopeMiddleware);

// ============================================
// API Routes — Versioned
// Canonical:  /api/v1/...
// Alias:      /api/...  (backwards-compatible, same handlers)
// ============================================
app.use('/api/v1', v1Router);
app.use('/api', v1Router);

// ============================================
// Static File Serving (Production SPA)
// ============================================
// In production, serve the built frontend from web/dist.
// All non-API routes fall through to index.html for client-side routing.
if (process.env.NODE_ENV === 'production') {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const webDistPath = path.resolve(__dirname, '../../web/dist');
  const indexHtmlPath = path.join(webDistPath, 'index.html');
  const sendSpaIndex = async (
    _req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) => {
    try {
      const html = await readFile(indexHtmlPath, 'utf-8');
      res.set('Cache-Control', 'no-cache');
      res.type('html').send(injectCspNonceAttributes(html, res.locals.cspNonce));
    } catch (error) {
      next(error);
    }
  };

  // Hashed assets (JS/CSS/images in /assets/) — immutable, 1 year cache
  app.use(
    '/assets',
    express.static(path.join(webDistPath, 'assets'), {
      maxAge: '365d',
      immutable: true,
      etag: true,
      lastModified: true,
    })
  );

  // All other static files (index.html, favicon, manifest) — always revalidate
  app.use(
    express.static(webDistPath, {
      index: false,
      maxAge: 0,
      etag: true,
      lastModified: true,
      setHeaders(res, filePath) {
        // index.html must never be cached stale — it references hashed bundles
        if (filePath.endsWith('.html')) {
          res.set('Cache-Control', 'no-cache');
        }
      },
    })
  );

  app.get('/', sendSpaIndex);

  // SPA fallback: serve index.html for any non-API route
  // Express 5 / path-to-regexp v8+ requires named wildcards (fixes #150)
  app.get('{*path}', (_req, res, next) => {
    // Don't serve index.html for API routes or WebSocket
    if (_req.path.startsWith('/api') || _req.path.startsWith('/ws') || _req.path === '/health') {
      return next();
    }
    void sendSpaIndex(_req, res, next);
  });
}

// Error handling middleware (must be last)
app.use(errorHandler);

// Module-level config service instance (shared with shutdown handler)
let configService: ConfigService | null = null;
let storageInitialized = false;

// Initialize services on startup
(async () => {
  try {
    // 1. Backup + integrity checks on the data directory
    const dataDir =
      process.env.VERITAS_DATA_DIR || path.join(process.cwd(), '..', '.veritas-kanban');
    let backupPath = '';
    try {
      backupPath = await createBackup(dataDir);
    } catch (backupErr) {
      log.warn({ err: backupErr }, 'Startup backup failed — continuing without backup');
    }

    const integrityReport = await runIntegrityChecks(dataDir);
    log.info(
      {
        backup: backupPath || '(skipped)',
        filesChecked: integrityReport.filesChecked,
        issues: integrityReport.issuesFound,
        recovered: integrityReport.recoveredCount,
      },
      `Startup: backup ${backupPath ? 'created' : 'skipped'}, integrity: ${integrityReport.filesChecked} files checked, ${integrityReport.issuesFound} issues found`
    );

    // 2. Run data migrations (idempotent)
    await runStartupMigrations();

    // 3. Initialize telemetry service and sync with feature settings
    configService = new ConfigService();
    const featureSettings = await configService.getFeatureSettings();
    syncSettingsToServices(featureSettings);
    await getTelemetryService().init();
    await getPolicyService().waitForInit();

    const storageType = getStorageTypeFromEnv();
    if (storageType === 'sqlite') {
      await initStorage('sqlite');
      storageInitialized = true;
      log.info('SQLite storage initialized');
    }
  } catch (err) {
    log.fatal({ err }, 'Failed to initialize services — server cannot start safely');
    process.exit(1);
  }
})();

// Create HTTP server
const server = createServer(app);

// ============================================
// WebSocket Server — Real-time Updates
// ============================================
// verifyClient validates the Origin header BEFORE the upgrade handshake completes,
// blocking cross-site WebSocket hijacking (CSWSH) from malicious pages.

/** Maximum concurrent WebSocket connections. New connections are rejected with 1013 when at capacity. */
const WS_MAX_CONNECTIONS = 50;
/** Interval between server→client ping frames (ms). */
const WS_HEARTBEAT_INTERVAL_MS = 30_000;
/** Time after ping to wait for pong before terminating the connection (ms). */
const WS_PONG_TIMEOUT_MS = 10_000;

/** Extended WebSocket with heartbeat tracking. */
interface HeartbeatWebSocket extends AuthenticatedWebSocket {
  isAlive?: boolean;
  heartbeatTimer?: ReturnType<typeof setTimeout>;
  subscribedChannels?: Set<WebSocketEventChannel>;
}

const wss = new WebSocketServer({
  server,
  path: '/ws',
  verifyClient: (info, callback) => {
    const origin = info.origin || info.req.headers.origin;
    const result = validateWebSocketOrigin(origin, ALLOWED_ORIGINS);

    if (!result.allowed) {
      log.warn({ origin, reason: result.reason }, 'WebSocket origin rejected');
      callback(false, 403, 'Forbidden: origin not allowed');
      return;
    }

    callback(true);
  },
});

// Initialize broadcast service for task change notifications
initBroadcast(wss);

// Initialize agent status service for WebSocket broadcasts
initAgentStatus(wss);

// Provide WSS reference to health checks for connection counting
setHealthWss(wss);

// Track subscriptions: taskId -> Set of WebSocket clients
const agentSubscriptions = new Map<string, Set<WebSocket>>();
// Track chat subscriptions: sessionId -> Set of WebSocket clients
const chatSubscriptions = new Map<string, Set<WebSocket>>();

function getMessageWorkspaceId(message: Record<string, unknown>): string {
  return typeof message.workspaceId === 'string' && message.workspaceId.trim()
    ? message.workspaceId
    : 'local';
}

function sendWebSocketForbidden(
  ws: HeartbeatWebSocket,
  requestType: string,
  permissions: AuthPermission[],
  workspaceId: string
): void {
  if (ws.readyState !== WebSocket.OPEN) return;

  ws.send(
    JSON.stringify({
      type: 'error',
      requestType,
      code: 'FORBIDDEN',
      message: 'Insufficient permissions',
      required: permissions,
      workspaceId,
    })
  );
}

// ---- Heartbeat: server pings every WS_HEARTBEAT_INTERVAL_MS ----
const heartbeatInterval = setInterval(() => {
  for (const client of wss.clients) {
    const hbClient = client as HeartbeatWebSocket;
    if (hbClient.isAlive === false) {
      // No pong received since last ping — terminate
      log.warn('WebSocket client failed heartbeat — terminating');
      hbClient.terminate();
      continue;
    }
    // Mark as waiting-for-pong, then send ping
    hbClient.isAlive = false;
    hbClient.ping();
    // Safety net: if pong doesn't arrive within WS_PONG_TIMEOUT_MS, terminate
    hbClient.heartbeatTimer = setTimeout(() => {
      if (hbClient.isAlive === false && hbClient.readyState === WebSocket.OPEN) {
        log.warn('WebSocket client pong timeout — terminating');
        hbClient.terminate();
      }
    }, WS_PONG_TIMEOUT_MS);
  }
}, WS_HEARTBEAT_INTERVAL_MS);

// Stop heartbeat when the WSS itself closes
wss.on('close', () => {
  clearInterval(heartbeatInterval);
});

wss.on('connection', (ws: HeartbeatWebSocket, req) => {
  // ---- Connection limit enforcement ----
  if (wss.clients.size > WS_MAX_CONNECTIONS) {
    log.warn(
      { current: wss.clients.size, max: WS_MAX_CONNECTIONS },
      'WebSocket connection limit reached — rejecting'
    );
    ws.close(1013, 'Try again later');
    return;
  }

  // Authenticate WebSocket connection
  const authResult = authenticateWebSocket(req);

  if (!authResult.authenticated || !authResult.role) {
    log.warn({ error: authResult.error }, 'WebSocket connection rejected');
    ws.close(4001, authResult.error || 'Authentication required');
    return;
  }

  // Attach auth info to WebSocket for later use
  ws.auth = {
    role: authResult.role,
    keyName: authResult.keyName,
    isLocalhost: authResult.isLocalhost,
    userId: authResult.userId,
    workspaceId: authResult.workspaceId,
    actorType: authResult.actorType,
    authMethod: authResult.authMethod,
    tokenName: authResult.tokenName,
    permissions: authResult.permissions,
    apiTokenId: authResult.apiTokenId,
    deviceSessionId: authResult.deviceSessionId,
    deviceId: authResult.deviceId,
    clientId: authResult.clientId,
    clientMode: authResult.clientMode,
    capabilities: authResult.capabilities,
    degradedReason: authResult.degradedReason,
  };

  // ---- Heartbeat: mark alive on connect and on pong ----
  ws.isAlive = true;
  ws.on('pong', () => {
    ws.isAlive = true;
    if (ws.heartbeatTimer) {
      clearTimeout(ws.heartbeatTimer);
      ws.heartbeatTimer = undefined;
    }
  });

  log.info(
    { role: authResult.role, localhost: authResult.isLocalhost, clients: wss.clients.size },
    'WebSocket client connected'
  );

  let subscribedTaskId: string | null = null;
  let subscribedChatSession: string | null = null;

  // Track current emitter listeners for cleanup on re-subscribe or close
  let currentEmitter: import('events').EventEmitter | null = null;
  let currentOutputHandler: ((output: AgentOutput) => void) | null = null;
  let currentCompleteHandler:
    | ((result: { code: number; signal: string | null; status: string }) => void)
    | null = null;
  let currentErrorHandler: ((error: Error) => void) | null = null;

  const cleanupEmitterListeners = () => {
    if (currentEmitter) {
      if (currentOutputHandler) {
        currentEmitter.off('output', currentOutputHandler);
      }
      if (currentCompleteHandler) {
        currentEmitter.off('complete', currentCompleteHandler);
      }
      if (currentErrorHandler) {
        currentEmitter.off('error', currentErrorHandler);
      }
      currentEmitter = null;
      currentOutputHandler = null;
      currentCompleteHandler = null;
      currentErrorHandler = null;
    }
  };

  // ---- Message rate limiting ----
  let messageCount = 0;
  let messageWindowStart = Date.now();
  const WS_MESSAGE_RATE_LIMIT = 30; // messages per window
  const WS_MESSAGE_RATE_WINDOW_MS = 10_000; // 10 second window

  ws.on('message', (data) => {
    // Rate limit check
    const now = Date.now();
    if (now - messageWindowStart > WS_MESSAGE_RATE_WINDOW_MS) {
      messageCount = 0;
      messageWindowStart = now;
    }
    messageCount++;
    if (messageCount > WS_MESSAGE_RATE_LIMIT) {
      log.warn({ count: messageCount }, 'WebSocket message rate limit exceeded');
      ws.close(4008, 'Rate limit exceeded');
      return;
    }

    try {
      const message = JSON.parse(data.toString());

      if (message.type === 'subscribe:tasks') {
        const workspaceId = getMessageWorkspaceId(message);
        const permissions: AuthPermission[] = ['task:read'];
        if (!canReceiveWebSocketEvent(ws, { workspaceId, permissions })) {
          sendWebSocketForbidden(ws, 'subscribe:tasks', permissions, workspaceId);
          return;
        }

        subscribeWebSocketChannel(ws, 'tasks');
        ws.send(
          JSON.stringify({
            type: 'tasks:subscribed',
            workspaceId,
            sequence: nextWebSocketEventSequence(),
            timestamp: new Date().toISOString(),
          })
        );
      }

      if (message.type === 'workflow:subscribe') {
        const workspaceId = getMessageWorkspaceId(message);
        const permissions: AuthPermission[] = ['workflow:read'];
        if (!canReceiveWebSocketEvent(ws, { workspaceId, permissions })) {
          sendWebSocketForbidden(ws, 'workflow:subscribe', permissions, workspaceId);
          return;
        }

        subscribeWebSocketChannel(ws, 'workflows');
        ws.send(
          JSON.stringify({
            type: 'workflow:subscribed',
            workspaceId,
            sequence: nextWebSocketEventSequence(),
            timestamp: new Date().toISOString(),
          })
        );
      }

      // Handle subscription to chat session
      if (message.type === 'chat:subscribe' && message.sessionId) {
        const workspaceId = getMessageWorkspaceId(message);
        const permissions: AuthPermission[] = ['task:read'];
        if (!canReceiveWebSocketEvent(ws, { workspaceId, permissions })) {
          sendWebSocketForbidden(ws, 'chat:subscribe', permissions, workspaceId);
          return;
        }

        // Unsubscribe from previous chat session
        if (subscribedChatSession) {
          unsubscribeWebSocketChatSession(ws, subscribedChatSession);
          const subs = chatSubscriptions.get(subscribedChatSession);
          if (subs) {
            subs.delete(ws);
            if (subs.size === 0) {
              chatSubscriptions.delete(subscribedChatSession);
            }
          }
        }

        // Subscribe to new chat session
        const sessionId: string = message.sessionId;
        subscribedChatSession = sessionId;
        subscribeWebSocketChatSession(ws, sessionId);
        let sessionSubscribers = chatSubscriptions.get(sessionId);
        if (!sessionSubscribers) {
          sessionSubscribers = new Set();
          chatSubscriptions.set(sessionId, sessionSubscribers);
        }
        sessionSubscribers.add(ws);

        // Send confirmation
        ws.send(
          JSON.stringify({
            type: 'chat:subscribed',
            sessionId,
          })
        );

        log.debug({ sessionId, clients: sessionSubscribers.size }, 'Chat subscription added');
      }

      if (message.type === 'subscribe' && message.channel === 'agent:status') {
        const workspaceId = getMessageWorkspaceId(message);
        const permissions: AuthPermission[] = ['agent:read'];
        if (!canReceiveWebSocketEvent(ws, { workspaceId, permissions })) {
          sendWebSocketForbidden(ws, 'subscribe', permissions, workspaceId);
          return;
        }

        subscribeWebSocketChannel(ws, 'agent-status');
        ws.send(
          JSON.stringify({
            type: 'agent:status:subscribed',
            workspaceId,
            sequence: nextWebSocketEventSequence(),
            timestamp: new Date().toISOString(),
          })
        );
      }

      // Handle subscription to agent output
      if (message.type === 'subscribe' && message.taskId) {
        const workspaceId = getMessageWorkspaceId(message);
        const permissions: AuthPermission[] = ['task:read'];
        if (!canReceiveWebSocketEvent(ws, { workspaceId, permissions })) {
          sendWebSocketForbidden(ws, 'subscribe', permissions, workspaceId);
          return;
        }
        subscribeWebSocketChannel(ws, 'agent-output');

        // Unsubscribe from previous task
        if (subscribedTaskId) {
          const subs = agentSubscriptions.get(subscribedTaskId);
          if (subs) {
            subs.delete(ws);
            if (subs.size === 0) {
              agentSubscriptions.delete(subscribedTaskId);
            }
          }
        }

        // Subscribe to new task
        const newTaskId: string = message.taskId;
        subscribedTaskId = newTaskId;
        let taskSubscribers = agentSubscriptions.get(newTaskId);
        if (!taskSubscribers) {
          taskSubscribers = new Set();
          agentSubscriptions.set(newTaskId, taskSubscribers);
        }
        taskSubscribers.add(ws);

        // Clean up previous emitter listeners before subscribing to new task
        cleanupEmitterListeners();

        // Set up listener for agent output
        const emitter = agentService.getAgentEmitter(newTaskId);
        if (emitter) {
          const taskIdForHandlers = newTaskId;

          currentOutputHandler = (output: AgentOutput) => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(
                JSON.stringify({
                  type: 'agent:output',
                  taskId: taskIdForHandlers,
                  outputType: output.type,
                  content: output.content,
                  timestamp: output.timestamp,
                })
              );
            }
          };

          currentCompleteHandler = (result: {
            code: number;
            signal: string | null;
            status: string;
          }) => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(
                JSON.stringify({
                  type: 'agent:complete',
                  taskId: taskIdForHandlers,
                  ...result,
                })
              );
            }
          };

          currentErrorHandler = (error: Error) => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(
                JSON.stringify({
                  type: 'agent:error',
                  taskId: taskIdForHandlers,
                  error: error.message,
                })
              );
            }
          };

          currentEmitter = emitter;
          emitter.on('output', currentOutputHandler);
          emitter.on('complete', currentCompleteHandler);
          emitter.on('error', currentErrorHandler);
        }

        // Send confirmation
        ws.send(
          JSON.stringify({
            type: 'subscribed',
            taskId: subscribedTaskId,
            running: !!emitter,
          })
        );
      }
    } catch (error) {
      log.error({ err: error }, 'WebSocket message error');
    }
  });

  ws.on('close', () => {
    log.info({ clients: wss.clients.size }, 'WebSocket client disconnected');

    // Clean up heartbeat timer
    if (ws.heartbeatTimer) {
      clearTimeout(ws.heartbeatTimer);
      ws.heartbeatTimer = undefined;
    }

    // Clean up emitter listeners
    cleanupEmitterListeners();

    // Clean up agent subscriptions
    if (subscribedTaskId) {
      const subs = agentSubscriptions.get(subscribedTaskId);
      if (subs) {
        subs.delete(ws);
        if (subs.size === 0) {
          agentSubscriptions.delete(subscribedTaskId);
        }
      }
    }

    // Clean up chat subscriptions
    if (subscribedChatSession) {
      unsubscribeWebSocketChatSession(ws, subscribedChatSession);
      const subs = chatSubscriptions.get(subscribedChatSession);
      if (subs) {
        subs.delete(ws);
        if (subs.size === 0) {
          chatSubscriptions.delete(subscribedChatSession);
        }
      }
    }
  });
});

// Export for use in other modules
export { wss, chatSubscriptions };

// Graceful shutdown handler
async function gracefulShutdown(signal: string) {
  log.info({ signal }, 'Shutting down gracefully');

  // 1. Stop heartbeat interval and close WebSocket connections
  clearInterval(heartbeatInterval);
  log.info({ clients: wss.clients.size }, 'Closing WebSocket connections');
  wss.clients.forEach((client) => {
    const hbClient = client as HeartbeatWebSocket;
    if (hbClient.heartbeatTimer) {
      clearTimeout(hbClient.heartbeatTimer);
      hbClient.heartbeatTimer = undefined;
    }
    client.close(1001, 'Server going away');
  });

  // Close the WebSocket server itself (stop accepting new connections)
  // Timeout: if clients don't close within 3s, continue shutdown
  await Promise.race([
    new Promise<void>((resolve) => {
      wss.close((err) => {
        if (err) log.error({ err }, 'Error closing WebSocket server');
        else log.info('WebSocket server closed');
        resolve();
      });
    }),
    new Promise<void>((resolve) =>
      setTimeout(() => {
        log.warn('WebSocket server close timed out after 3s — continuing shutdown');
        resolve();
      }, 3000)
    ),
  ]);

  // 2. Dispose services (release file watchers, flush buffers)
  try {
    log.info('Disposing services');

    stopScheduledDeliverablesRunner();
    log.info('Scheduled deliverables runner stopped');

    // Flush pending telemetry writes (timeout: 5s)
    await Promise.race([
      getTelemetryService().flush(),
      new Promise<void>((resolve) =>
        setTimeout(() => {
          log.warn('Telemetry flush timed out after 5s — continuing shutdown');
          resolve();
        }, 5000)
      ),
    ]);
    log.info('Telemetry flushed');

    // Dispose task service (closes file watchers, clears cache)
    disposeTaskService();
    log.info('Task service disposed');

    // Dispose config service (closes file watcher, clears cache)
    if (configService) {
      configService.dispose();
      configService = null;
      log.info('Config service disposed');
    }

    if (storageInitialized) {
      await shutdownStorage();
      storageInitialized = false;
      log.info('Storage provider shut down');
    }
  } catch (err) {
    log.error({ err }, 'Error during service disposal');
  }

  // 3. Close HTTP server last
  server.close(() => {
    log.info('HTTP server closed');
    process.exit(0);
  });

  // Force exit after 10 seconds
  setTimeout(() => {
    log.fatal('Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
}

// Register shutdown handlers
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Start server
server.listen(Number(PORT), HOST, () => {
  const authStatus = getAuthStatus();
  const localhostInfo = authStatus.localhostBypass
    ? `, localhost bypass [${authStatus.localhostRole}]`
    : '';
  const authLine = authStatus.enabled
    ? `Auth: ON (${authStatus.configuredKeys} keys${localhostInfo})`
    : 'Auth: OFF (dev mode)';
  const corsLine = `CORS: ${ALLOWED_ORIGINS.length} origins`;

  log.info(
    {
      port: PORT,
      host: HOST || 'default',
      api: `http://${HOST || 'localhost'}:${PORT}`,
      ws: `ws://${HOST || 'localhost'}:${PORT}/ws`,
      auth: authLine,
      cors: corsLine,
      helmet: true,
      compression: true,
      rateLimit: `${process.env.RATE_LIMIT_MAX || 300} req/min (localhost exempt)`,
      bodyLimit: '1MB',
    },
    'Veritas Kanban Server started'
  );

  // Security warnings for localhost bypass
  if (authStatus.localhostBypass) {
    if (authStatus.localhostRole === 'admin') {
      log.warn(
        { localhostRole: 'admin' },
        'Localhost bypass is active with ADMIN role — any local process has full access without authentication'
      );
    } else {
      log.info(
        { localhostRole: authStatus.localhostRole },
        'Localhost bypass active — local connections can read data without authentication'
      );
    }
  }

  // Security warnings for weak admin keys
  const keyWarnings = checkAdminKeyStrength();
  for (const warning of keyWarnings) {
    if (warning.level === 'critical') {
      log.warn({ security: 'admin-key' }, `⚠️  SECURITY: ${warning.message}`);
    } else {
      log.warn({ security: 'admin-key' }, warning.message);
    }
  }

  // Security warnings for JWT secret configuration
  const jwtWarnings = checkJwtSecretConfig();
  for (const warning of jwtWarnings) {
    if (warning.level === 'critical') {
      log.warn({ security: 'jwt-secret' }, `⚠️  SECURITY: ${warning.message}`);
    } else if (warning.level === 'warning') {
      log.warn({ security: 'jwt-secret' }, warning.message);
    } else {
      log.info({ security: 'jwt-secret' }, warning.message);
    }
  }

  startScheduledDeliverablesRunner();
});
