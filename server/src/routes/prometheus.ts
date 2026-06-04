import crypto from 'crypto';
import { Router, type NextFunction, type Request, type Response } from 'express';
import {
  authenticate,
  authorizePermission,
  type AuthenticatedRequest,
} from '../middleware/auth.js';
import { getPrometheusCollector } from '../services/metrics/prometheus.js';

export const prometheusMetricsRouter = Router();

function envFlagEnabled(name: string): boolean {
  return process.env[name]?.trim().toLowerCase() === 'true';
}

function publicMetricsAllowed(): boolean {
  return process.env.NODE_ENV !== 'production' || envFlagEnabled('PROMETHEUS_METRICS_PUBLIC');
}

function constantTimeEquals(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);

  return (
    actualBuffer.length === expectedBuffer.length &&
    crypto.timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

function hasMetricsBearerToken(req: Request): boolean {
  const expectedToken = process.env.PROMETHEUS_METRICS_TOKEN?.trim();
  if (!expectedToken) return false;

  const authorization = req.headers.authorization;
  if (!authorization?.startsWith('Bearer ')) return false;

  return constantTimeEquals(authorization.slice(7).trim(), expectedToken);
}

function protectPrometheusMetrics(req: Request, res: Response, next: NextFunction): void {
  if (publicMetricsAllowed() || hasMetricsBearerToken(req)) {
    next();
    return;
  }

  authenticate(req as AuthenticatedRequest, res, (authError?: unknown) => {
    if (authError) {
      next(authError);
      return;
    }

    authorizePermission('telemetry:read')(req as AuthenticatedRequest, res, next);
  });
}

prometheusMetricsRouter.get('/metrics', protectPrometheusMetrics, (_req, res) => {
  const collector = getPrometheusCollector();
  res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
  res.send(collector.scrape());
});
