import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import compression from 'compression';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';
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
import { initBroadcast } from './services/broadcast-service.js';
import { runStartupMigrations } from './services/migration-service.js';
import { errorHandler, AppError } from './middleware/error-handler.js';
import { requestIdMiddleware } from './middleware/request-id.js';
import {
  authenticate,
  authorize,
  authenticateWebSocket,
  validateWebSocketOrigin,
  getAuthStatus,
  checkAdminKeyStrength,
  type AuthenticatedWebSocket,
} from './middleware/auth.js';
import authRoutes from './routes/auth.js';
import { checkJwtSecretConfig } from './config/security.js';
import { apiRateLimit } from './middleware/rate-limit.js';
import { apiVersionMiddleware } from './middleware/api-version.js';
import { apiCacheHeaders } from './middleware/cache-control.js';
import type { AgentOutput } from './services/clawdbot-agent-service.js';
import { taskArchiveRoutes } from './routes/task-archive.js';
import { taskTimeRoutes } from './routes/task-time.js';
import { taskRoutes } from './routes/tasks.js';
import { taskCommentRoutes } from './routes/task-comments.js';
import { taskSubtaskRoutes } from './routes/task-subtasks.js';
import attachmentRoutes from './routes/attachments.js';
import { configRoutes } from './routes/config.js';
import { agentRoutes } from './routes/agents.js';

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
const PORT = process.env.PORT || 3001;

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
//   scriptSrc   - Scripts: same-origin + inline (needed for Vite HMR in dev)
//   styleSrc    - Styles: same-origin + inline (Tailwind/JSX inline styles)
//   connectSrc  - XHR/fetch/WebSocket: same-origin + ws://localhost for dev WS
//   imgSrc      - Images: same-origin + data: URIs (inline SVGs, base64 images)
//   fontSrc     - Fonts: same-origin
//   objectSrc   - Plugins (Flash, etc.): blocked entirely
//   frameSrc    - Iframes: blocked entirely
//   baseUri     - <base> tag: only same-origin
//   formAction  - Form submissions: only same-origin
//   upgradeInsecureRequests - Auto-upgrade HTTP → HTTPS in production
//
// In development, connectSrc includes ws://localhost:* for WebSocket hot-reload.
// In production, tighten scriptSrc (remove 'unsafe-inline') and use nonces.
const isDev = process.env.NODE_ENV !== 'production';

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", ...(isDev ? ["'unsafe-inline'", "'unsafe-eval'"] : [])],
        styleSrc: ["'self'", "'unsafe-inline'"],
        connectSrc: [
          "'self'",
          ...(isDev
            ? ['ws://localhost:*', 'ws://127.0.0.1:*', 'http://localhost:*', 'http://127.0.0.1:*']
            : []),
        ],
        imgSrc: ["'self'", 'data:', 'blob:'],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        upgradeInsecureRequests: isDev ? null : [],
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
// Allowed origins from environment (comma-separated) or defaults for dev
const ALLOWED_ORIGINS = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map((o) => o.trim())
  : [
      'http://localhost:5173',
      'http://localhost:3000',
      'http://127.0.0.1:5173',
      'http://127.0.0.1:3000',
    ];

const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (e.g., mobile apps, curl, server-to-server)
    if (!origin) {
      callback(null, true);
      return;
    }

    if (ALLOWED_ORIGINS.includes(origin)) {
      callback(null, true);
    } else {
      log.warn({ origin }, 'CORS blocked request from disallowed origin');
      callback(new AppError(403, 'Origin not allowed by CORS', 'CORS_REJECTED'));
    }
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

// Middleware
app.use(cors(corsOptions));
app.use(cookieParser());

// ============================================
// Security: Request Size Limit (1MB)
// ============================================
app.use(express.json({ limit: '1mb' }));

// Health check (unauthenticated)
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

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
// ============================================
app.use('/api/v1/auth', authRoutes);
app.use('/api/auth', authRoutes);

// ============================================
// Security: Rate Limiting (100 req/min)
// Applies to both /api/* and /api/v1/* (since /api/v1 starts with /api)
// ============================================
app.use('/api', apiRateLimit);

// Apply authentication to all API routes (except /api/auth which is handled above)
app.use('/api', authenticate);

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

  // SPA fallback: serve index.html for any non-API route
  app.get('*', (_req, res, next) => {
    // Don't serve index.html for API routes or WebSocket
    if (_req.path.startsWith('/api') || _req.path.startsWith('/ws') || _req.path === '/health') {
      return next();
    }
    res.set('Cache-Control', 'no-cache');
    res.sendFile(path.join(webDistPath, 'index.html'));
  });
}

// Error handling middleware (must be last)
app.use(errorHandler);

// Module-level config service instance (shared with shutdown handler)
let configService: ConfigService | null = null;

// Initialize services on startup
(async () => {
  try {
    // Run data migrations first (idempotent)
    await runStartupMigrations();

    // Initialize telemetry service and sync with feature settings
    configService = new ConfigService();
    const featureSettings = await configService.getFeatureSettings();
    syncSettingsToServices(featureSettings);
    await getTelemetryService().init();
  } catch (err) {
    log.error({ err }, 'Failed to initialize services');
  }
})();

// Create HTTP server
const server = createServer(app);

// WebSocket server for real-time updates
// verifyClient validates the Origin header BEFORE the upgrade handshake completes,
// blocking cross-site WebSocket hijacking (CSWSH) from malicious pages.
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

// Track subscriptions: taskId -> Set of WebSocket clients
const agentSubscriptions = new Map<string, Set<WebSocket>>();

wss.on('connection', (ws: AuthenticatedWebSocket, req) => {
  // Authenticate WebSocket connection
  const authResult = authenticateWebSocket(req);

  if (!authResult.authenticated) {
    log.warn({ error: authResult.error }, 'WebSocket connection rejected');
    ws.close(4001, authResult.error || 'Authentication required');
    return;
  }

  // Attach auth info to WebSocket for later use
  ws.auth = {
    role: authResult.role!,
    keyName: authResult.keyName,
    isLocalhost: authResult.isLocalhost,
  };

  log.info(
    { role: authResult.role, localhost: authResult.isLocalhost },
    'WebSocket client connected'
  );

  let subscribedTaskId: string | null = null;

  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());

      // Handle subscription to agent output
      if (message.type === 'subscribe' && message.taskId) {
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
        if (!agentSubscriptions.has(newTaskId)) {
          agentSubscriptions.set(newTaskId, new Set());
        }
        agentSubscriptions.get(newTaskId)!.add(ws);

        // Set up listener for agent output
        const emitter = agentService.getAgentEmitter(newTaskId);
        if (emitter) {
          const currentTaskId = newTaskId;

          const outputHandler = (output: AgentOutput) => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(
                JSON.stringify({
                  type: 'agent:output',
                  taskId: currentTaskId,
                  outputType: output.type,
                  content: output.content,
                  timestamp: output.timestamp,
                })
              );
            }
          };

          const completeHandler = (result: {
            code: number;
            signal: string | null;
            status: string;
          }) => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(
                JSON.stringify({
                  type: 'agent:complete',
                  taskId: currentTaskId,
                  ...result,
                })
              );
            }
          };

          const errorHandler = (error: Error) => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(
                JSON.stringify({
                  type: 'agent:error',
                  taskId: currentTaskId,
                  error: error.message,
                })
              );
            }
          };

          emitter.on('output', outputHandler);
          emitter.on('complete', completeHandler);
          emitter.on('error', errorHandler);

          // Clean up listeners when WebSocket closes
          ws.on('close', () => {
            emitter.off('output', outputHandler);
            emitter.off('complete', completeHandler);
            emitter.off('error', errorHandler);
          });
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
    log.info('WebSocket client disconnected');

    // Clean up subscriptions
    if (subscribedTaskId) {
      const subs = agentSubscriptions.get(subscribedTaskId);
      if (subs) {
        subs.delete(ws);
        if (subs.size === 0) {
          agentSubscriptions.delete(subscribedTaskId);
        }
      }
    }
  });
});

// Export for use in other modules
export { wss };

// Graceful shutdown handler
async function gracefulShutdown(signal: string) {
  log.info({ signal }, 'Shutting down gracefully');

  // 1. Close WebSocket connections first (stop accepting new messages)
  log.info({ clients: wss.clients.size }, 'Closing WebSocket connections');
  wss.clients.forEach((client) => {
    client.close(1000, 'Server shutting down');
  });

  // Close the WebSocket server itself (stop accepting new connections)
  await new Promise<void>((resolve) => {
    wss.close((err) => {
      if (err) log.error({ err }, 'Error closing WebSocket server');
      else log.info('WebSocket server closed');
      resolve();
    });
  });

  // 2. Dispose services (release file watchers, flush buffers)
  try {
    log.info('Disposing services');

    // Flush pending telemetry writes
    await getTelemetryService().flush();
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
server.listen(PORT, () => {
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
      api: `http://localhost:${PORT}`,
      ws: `ws://localhost:${PORT}/ws`,
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
});
