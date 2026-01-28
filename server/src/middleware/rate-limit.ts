import expressRateLimit from 'express-rate-limit';
import type { Request } from 'express';

/**
 * Rate limiting middleware using express-rate-limit.
 *
 * Uses the built-in MemoryStore which:
 *  - Automatically cleans up expired entries (no memory leaks)
 *  - Uses a precise sliding window counter algorithm
 *  - Is the right choice for a single-instance local dev tool
 *
 * State resets on server restart, which is acceptable for this use case.
 * If persistence is ever needed, swap MemoryStore for a file or Redis store.
 *
 * Defaults are tuned for a local dev tool accessed by a single user + AI agent.
 * Override via RATE_LIMIT_MAX env var (requests per minute).
 */

// ── Configuration ──────────────────────────────────────────────────────────────

/** Default rate limit (requests per minute) for general API access. */
const DEFAULT_API_LIMIT = 300;

/** Read override from environment, falling back to the default. */
const API_LIMIT: number = (() => {
  const env = process.env.RATE_LIMIT_MAX;
  if (env) {
    const parsed = Number(env);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return DEFAULT_API_LIMIT;
})();

/** Strict limit for sensitive endpoints (auth, settings). */
const STRICT_LIMIT = 15;

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Returns true when the request originates from localhost / loopback. */
function isLocalhost(req: Request): boolean {
  const ip = req.ip ?? req.socket?.remoteAddress ?? '';
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

// ── Factory ────────────────────────────────────────────────────────────────────

/**
 * Create a rate limiting middleware with the given options.
 * Wraps express-rate-limit for consistency.
 */
export function rateLimit(
  options: {
    limit?: number;
    windowMs?: number;
    message?: string;
    skip?: (req: Request) => boolean;
  } = {}
) {
  const {
    limit = API_LIMIT,
    windowMs = 60_000,
    message = 'Too many requests, please try again later.',
    skip,
  } = options;

  return expressRateLimit({
    windowMs,
    limit,
    message: { error: message },
    standardHeaders: 'draft-7', // RateLimit-* headers (IETF standard)
    legacyHeaders: true, // X-RateLimit-* headers (backward compat)
    skip,
    // validate: false would disable warnings — keep enabled for dev safety
  });
}

// ── Pre-configured limiters ────────────────────────────────────────────────────

/**
 * Pre-configured rate limiter for general API use.
 * Default: 300 req/min per IP (override with RATE_LIMIT_MAX env var).
 * Localhost requests are exempt — this is a local dev tool.
 */
export const apiRateLimit = rateLimit({
  limit: API_LIMIT,
  windowMs: 60_000,
  message: 'Too many API requests. Please slow down.',
  skip: isLocalhost,
});

/**
 * Stricter rate limiter for sensitive operations (15 req/min per IP).
 * Applied to: auth endpoints, settings mutations.
 * Localhost is NOT exempt — protects against runaway scripts.
 */
export const strictRateLimit = rateLimit({
  limit: STRICT_LIMIT,
  windowMs: 60_000,
  message: `Too many requests. Max ${STRICT_LIMIT} per minute for this endpoint.`,
});
