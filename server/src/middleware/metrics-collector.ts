/**
 * Express middleware that records per-request Prometheus metrics.
 *
 * Captures:
 * - Request count by method, route, status code
 * - Request duration (histogram)
 * - Response size (histogram)
 */
import type { Request, Response, NextFunction } from 'express';
import { getPrometheusCollector } from '../services/metrics/prometheus.js';

/**
 * Derive a stable route label from an Express request.
 *
 * Uses `req.route?.path` (the matched Express route pattern, e.g. `/tasks/:id`)
 * when available, falling back to `req.path` (the raw URL path) otherwise.
 * This keeps cardinality manageable — we group by route pattern, not by
 * individual resource URL.
 */
function routeLabel(req: Request): string {
  // req.route is populated after a route handler matched
  if (req.route?.path) {
    // Prefix with the mount point (e.g. /api/v1) + the route pattern
    return req.baseUrl + (req.route.path === '/' ? '' : req.route.path);
  }
  // Fallback: normalise the raw path to avoid unbounded cardinality
  return req.baseUrl + req.path;
}

/**
 * Metrics collector middleware.
 *
 * Install early in the middleware chain (before route handlers) so that
 * the `res.on('finish')` callback fires for every response.
 */
export function metricsCollector() {
  return (req: Request, res: Response, next: NextFunction): void => {
    const startHrTime = process.hrtime.bigint();

    res.on('finish', () => {
      const collector = getPrometheusCollector();

      const method = req.method;
      const route = routeLabel(req);
      const statusCode = String(res.statusCode);

      // Request count
      collector.httpRequestsTotal.inc({ method, route, status_code: statusCode });

      // Duration (nanoseconds → seconds)
      const durationNs = Number(process.hrtime.bigint() - startHrTime);
      const durationSec = durationNs / 1e9;
      collector.httpRequestDurationSeconds.observe(
        { method, route, status_code: statusCode },
        durationSec
      );

      // Response size
      const contentLength = res.getHeader('content-length');
      if (contentLength) {
        const size =
          typeof contentLength === 'string'
            ? parseInt(contentLength, 10)
            : (contentLength as number);
        if (!Number.isNaN(size)) {
          collector.httpResponseSizeBytes.observe({ method, route, status_code: statusCode }, size);
        }
      }
    });

    next();
  };
}
