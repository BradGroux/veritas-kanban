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
 * Tiered rate limits:
 *  - authRateLimit   — 10 req / 15 min (login, token refresh)
 *  - uploadRateLimit — 20 req / min   (file uploads)
 *  - writeRateLimit  — 60 req / min   (POST, PUT, PATCH, DELETE, configurable with RATE_LIMIT_WRITE_MAX)
 *  - readRateLimit   — 300 req / min  (GET requests, configurable with RATE_LIMIT_MAX)
 *  - apiRateLimit    — 300 req / min  (global fallback, configurable with RATE_LIMIT_MAX, localhost exempt)
 */

// ── Configuration ──────────────────────────────────────────────────────────────

/** Default rate limit (requests per minute) for general API access. */
const DEFAULT_API_LIMIT = 300;
const DEFAULT_WRITE_LIMIT = 60;

function readPositiveLimit(name: string, fallback: number): number {
  const env = process.env[name];
  if (env) {
    const parsed = Number(env);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return fallback;
}

/** API/read override from environment, falling back to the default. */
const API_LIMIT = readPositiveLimit('RATE_LIMIT_MAX', DEFAULT_API_LIMIT);
const WRITE_LIMIT = readPositiveLimit('RATE_LIMIT_WRITE_MAX', DEFAULT_WRITE_LIMIT);

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Returns true when the request originates from localhost / loopback. */
function isLocalhost(req: Request): boolean {
  // In production, never exempt localhost to avoid bypassing limits behind proxies.
  if (process.env.NODE_ENV === 'production') {
    return false;
  }
  const ip = req.ip ?? req.socket?.remoteAddress ?? '';
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

function isAuthStatusRequest(req: Request): boolean {
  return req.method === 'GET' && req.path === '/status';
}

// ── Factory ────────────────────────────────────────────────────────────────────

/**
 * Create a rate limiting middleware with the given options.
 * Wraps express-rate-limit for consistency.
 *
 * All limiters return proper 429 responses with Retry-After header.
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
 * Pre-configured rate limiter for general API use (global fallback).
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
 * Very strict rate limiter for auth operations: 10 req / 15 min per IP.
 * Applied to: login, token refresh, password setup endpoints.
 * Localhost requests are exempt — this is a local dev tool.
 */
export const authRateLimit = rateLimit({
  limit: 10,
  windowMs: 15 * 60_000, // 15 minutes
  message: 'Too many authentication attempts. Please try again later.',
  skip: (req) => isLocalhost(req) || isAuthStatusRequest(req),
});

/**
 * Read-style limiter for the auth status polling endpoint.
 * This endpoint is called on normal route loads and must not consume login/setup attempts.
 */
export const authStatusRateLimit = rateLimit({
  limit: 120,
  windowMs: 60_000,
  message: 'Too many auth status checks. Please slow down.',
  skip: isLocalhost,
});

/**
 * Moderate rate limiter for write operations: 60 req / min per IP by default.
 * Applied to: POST, PUT, PATCH, DELETE on resource endpoints.
 * Override with RATE_LIMIT_WRITE_MAX for high-volume test/dev scenarios.
 * Localhost is NOT exempt — protects against runaway scripts.
 */
export const writeRateLimit = rateLimit({
  limit: WRITE_LIMIT,
  windowMs: 60_000,
  message: 'Too many write requests. Please slow down.',
});

/**
 * Generous rate limiter for read operations: 300 req / min per IP by default.
 * Applied to: GET requests on resource endpoints.
 * Override with RATE_LIMIT_MAX for high-volume test/dev scenarios.
 * Localhost is NOT exempt — consistent with other tiered limiters.
 */
export const readRateLimit = rateLimit({
  limit: API_LIMIT,
  windowMs: 60_000,
  message: 'Too many read requests. Please slow down.',
});

/**
 * Strict rate limiter for file uploads: 20 req / min per IP.
 * Applied to: attachment/upload endpoints.
 * Localhost is NOT exempt — protects against disk exhaustion.
 */
export const uploadRateLimit = rateLimit({
  limit: 20,
  windowMs: 60_000,
  message: 'Too many upload requests. Please slow down.',
});

/**
 * Stricter rate limiter for sensitive operations (15 req/min per IP).
 * Applied to: settings mutations.
 * Localhost is NOT exempt — protects against runaway scripts.
 * @deprecated Use the specific tiered limiters (authRateLimit, writeRateLimit, etc.) instead.
 */
export const strictRateLimit = rateLimit({
  limit: 15,
  windowMs: 60_000,
  message: 'Too many requests. Max 15 per minute for this endpoint.',
});
