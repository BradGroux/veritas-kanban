import type { Request, Response, NextFunction } from 'express';

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

interface RateLimitOptions {
  /** Max requests per window */
  limit: number;
  /** Window duration in milliseconds */
  windowMs: number;
  /** Message to return when rate limited */
  message?: string;
  /** Skip rate limiting for this request (e.g., health checks) */
  skip?: (req: Request) => boolean;
}

const DEFAULT_OPTIONS: RateLimitOptions = {
  limit: 100,
  windowMs: 60_000, // 1 minute
  message: 'Too many requests, please try again later.',
};

/**
 * Create a rate limiting middleware
 */
export function rateLimit(options: Partial<RateLimitOptions> = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const store = new Map<string, RateLimitEntry>();

  // Cleanup old entries periodically
  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store.entries()) {
      if (now > entry.resetAt) {
        store.delete(key);
      }
    }
  }, opts.windowMs);

  // Prevent the interval from blocking process exit
  cleanupInterval.unref();

  return (req: Request, res: Response, next: NextFunction) => {
    // Allow skipping certain requests
    if (opts.skip?.(req)) {
      return next();
    }

    const key = getClientKey(req);
    const now = Date.now();
    const entry = store.get(key);

    // New window or expired window
    if (!entry || now > entry.resetAt) {
      store.set(key, { count: 1, resetAt: now + opts.windowMs });
      setRateLimitHeaders(res, opts.limit, opts.limit - 1, now + opts.windowMs);
      return next();
    }

    // Within window
    if (entry.count >= opts.limit) {
      setRateLimitHeaders(res, opts.limit, 0, entry.resetAt);
      return res.status(429).json({ error: opts.message });
    }

    entry.count++;
    setRateLimitHeaders(res, opts.limit, opts.limit - entry.count, entry.resetAt);
    next();
  };
}

/**
 * Get a unique key for the client (IP-based)
 */
function getClientKey(req: Request): string {
  // Check X-Forwarded-For for proxied requests
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    const ip = Array.isArray(forwarded) ? forwarded[0] : forwarded.split(',')[0];
    return ip.trim();
  }
  return req.ip || req.socket.remoteAddress || 'unknown';
}

/**
 * Set standard rate limit headers
 */
function setRateLimitHeaders(res: Response, limit: number, remaining: number, resetAt: number): void {
  res.setHeader('X-RateLimit-Limit', limit);
  res.setHeader('X-RateLimit-Remaining', Math.max(0, remaining));
  res.setHeader('X-RateLimit-Reset', Math.ceil(resetAt / 1000));
}

/**
 * Pre-configured rate limiter for general API use
 * 100 requests per minute
 */
export const apiRateLimit = rateLimit({
  limit: 100,
  windowMs: 60_000,
  message: 'Too many API requests. Please slow down.',
});

/**
 * Stricter rate limiter for sensitive operations
 * 10 requests per minute (e.g., auth, config changes)
 */
export const strictRateLimit = rateLimit({
  limit: 10,
  windowMs: 60_000,
  message: 'Too many requests. Max 10 per minute for this endpoint.',
});
