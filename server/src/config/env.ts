/**
 * Environment Variable Validation
 *
 * Validates all environment variables at startup using Zod.
 * Fails fast with clear, actionable error messages if required
 * variables are missing or invalid.
 *
 * Usage:
 *   import { env, validateEnv } from './config/env.js';
 *
 *   // Call validateEnv() at startup (index.ts)
 *   // Then use `env` anywhere for typed access
 */
import { z } from 'zod';
import { createLogger } from '../lib/logger.js';

const log = createLogger('env');

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

/**
 * Coerces a string to a positive integer, or returns undefined if blank.
 * Used for PORT-like variables that arrive as strings from the environment.
 */
const portSchema = z
  .string()
  .optional()
  .transform((val) => (val ? parseInt(val, 10) : undefined))
  .pipe(z.number().int().min(1).max(65535).optional());

const positiveIntString = z
  .string()
  .optional()
  .transform((val) => (val ? parseInt(val, 10) : undefined))
  .pipe(z.number().int().positive().optional());

const booleanString = z
  .string()
  .optional()
  .transform((val) => {
    if (val === undefined || val === '') return undefined;
    return val === 'true';
  });

export const envSchema = z.object({
  // ── Server ──────────────────────────────────────────────────────────
  /** HTTP port the server listens on */
  PORT: portSchema.default(3001),

  /** Optional HTTP host/bind address */
  HOST: z.string().optional(),

  /** Node environment: development | production | test */
  NODE_ENV: z.enum(['development', 'production', 'test']).optional().default('development'),

  // ── Security ────────────────────────────────────────────────────────
  /** Admin API key — required. The server will not start without it. */
  VERITAS_ADMIN_KEY: z.string().min(1, 'VERITAS_ADMIN_KEY must not be empty'),

  /** JWT secret for auth tokens. Auto-generated if omitted, but
   *  setting it explicitly is recommended for production. */
  VERITAS_JWT_SECRET: z.string().optional(),

  /** Enable/disable the auth middleware (default: true) */
  VERITAS_AUTH_ENABLED: booleanString.default(true),

  /** Allow localhost requests to bypass authentication */
  VERITAS_AUTH_LOCALHOST_BYPASS: booleanString.default(false),

  /** Role assigned to localhost-bypass connections */
  VERITAS_AUTH_LOCALHOST_ROLE: z
    .enum(['admin', 'agent', 'read-only'])
    .optional()
    .default('read-only'),

  /** Comma-separated additional API keys (format: name:key:role,name:key:role) */
  VERITAS_API_KEYS: z.string().optional().default(''),

  // ── Data ────────────────────────────────────────────────────────────
  /** Root directory for data storage */
  VERITAS_DATA_DIR: z.string().optional(),

  /** Storage backend: file remains the default until the v5 migration completes */
  VERITAS_STORAGE: z.enum(['file', 'sqlite']).optional().default('file'),

  /** SQLite database file path when VERITAS_STORAGE=sqlite */
  VERITAS_SQLITE_PATH: z.string().optional(),

  /** Explicit topology required before single-host compatibility or override mode */
  VERITAS_SQLITE_TOPOLOGY: z.enum(['single-host', 'clustered']).optional(),

  /** Stable operator-provided host identity used by SQLite ownership policy */
  VERITAS_SQLITE_HOST_ID: z.string().min(8).optional(),

  // ── CORS ────────────────────────────────────────────────────────────
  /** Comma-separated list of allowed CORS origins */
  CORS_ORIGINS: z.string().optional(),

  // ── Logging ─────────────────────────────────────────────────────────
  /** Pino log level */
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .optional()
    .default('info'),

  // ── CSP ─────────────────────────────────────────────────────────────
  /** Use Content-Security-Policy-Report-Only instead of enforcing */
  CSP_REPORT_ONLY: booleanString.default(false),

  /** URL to receive CSP violation reports */
  CSP_REPORT_URI: z.string().url().optional(),

  // ── Rate Limiting ───────────────────────────────────────────────────
  /** Max requests per rate-limit window */
  RATE_LIMIT_MAX: positiveIntString.default(300),

  // ── Telemetry ───────────────────────────────────────────────────────
  /** Days to retain raw telemetry events */
  TELEMETRY_RETENTION_DAYS: positiveIntString,

  /** Days after which telemetry is compressed */
  TELEMETRY_COMPRESS_DAYS: positiveIntString,

  /** Allow unauthenticated Prometheus scraping in production */
  PROMETHEUS_METRICS_PUBLIC: booleanString.default(false),

  /** Dedicated bearer token for Prometheus scraping */
  PROMETHEUS_METRICS_TOKEN: z.string().optional(),

  // ── External Services ───────────────────────────────────────────────
  /** Clawdbot gateway URL */
  CLAWDBOT_GATEWAY: z.string().url().optional().default('http://127.0.0.1:18789'),
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The validated and typed environment object */
export type Env = z.infer<typeof envSchema>;

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** Module-level cache — populated by validateEnv() */
let _env: Env | null = null;

/**
 * Validate `process.env` against the schema.
 *
 * On success:
 *   - Logs the names of configured env vars (not values) at info level
 *   - Returns the typed env object
 *
 * On failure:
 *   - Logs ALL issues in a single error message
 *   - Calls `process.exit(1)`
 */
export function validateEnv(): Env {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => {
        const path = issue.path.join('.');
        return `  • ${path}: ${issue.message}`;
      })
      .join('\n');

    log.fatal(
      `\n╔══════════════════════════════════════════════════════════╗\n` +
        `║  ENVIRONMENT VALIDATION FAILED                          ║\n` +
        `╠══════════════════════════════════════════════════════════╣\n` +
        `║  The following environment variables are missing or     ║\n` +
        `║  invalid. Fix them and restart the server.              ║\n` +
        `╚══════════════════════════════════════════════════════════╝\n\n` +
        `${issues}\n`
    );

    process.exit(1);
  }

  _env = result.data;

  // Log which env vars are configured (names only, never values)
  const configuredVars = Object.keys(envSchema.shape)
    .filter((key) => process.env[key] !== undefined && process.env[key] !== '')
    .sort();

  log.info(
    { configured: configuredVars },
    `Environment validated — ${configuredVars.length} vars configured`
  );

  return _env;
}

/**
 * Access the validated environment. Throws if validateEnv() hasn't been called.
 */
export function getEnv(): Env {
  if (!_env) {
    throw new Error(
      'Environment not validated yet. Call validateEnv() at startup before accessing env.'
    );
  }
  return _env;
}

/**
 * Convenience accessor — same as getEnv() but shorter.
 * Use: `import { env } from './config/env.js'`
 */
export const env = new Proxy({} as Env, {
  get(_target, prop: string) {
    return getEnv()[prop as keyof Env];
  },
});
