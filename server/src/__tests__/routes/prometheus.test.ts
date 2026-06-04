import { afterEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const originalEnv = { ...process.env };

async function buildApp(env: Record<string, string | undefined>) {
  vi.resetModules();
  process.env = { ...originalEnv };

  delete process.env.NODE_ENV;
  delete process.env.PROMETHEUS_METRICS_PUBLIC;
  delete process.env.PROMETHEUS_METRICS_TOKEN;
  delete process.env.VERITAS_ADMIN_KEY;
  delete process.env.VERITAS_API_KEYS;
  delete process.env.VERITAS_AUTH_ENABLED;
  delete process.env.VERITAS_AUTH_LOCALHOST_BYPASS;

  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  vi.doMock('../../config/security.js', () => ({
    getSecurityConfig: vi.fn(() => ({
      authEnabled: false,
      passwordHash: null,
    })),
    getJwtSecret: vi.fn(() => 'test-jwt-secret'),
    getValidJwtSecrets: vi.fn(() => ['test-jwt-secret']),
  }));

  vi.doMock('../../services/metrics/prometheus.js', () => ({
    getPrometheusCollector: () => ({
      scrape: () => '# HELP veritas_test_metric Test metric\nveritas_test_metric 1\n',
    }),
  }));

  const { prometheusMetricsRouter } = await import('../../routes/prometheus.js');
  const app = express();
  app.use(prometheusMetricsRouter);
  return app;
}

describe('Prometheus metrics route', () => {
  afterEach(() => {
    process.env = { ...originalEnv };
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('allows unauthenticated local development scrapes', async () => {
    const app = await buildApp({
      NODE_ENV: 'development',
      VERITAS_ADMIN_KEY: 'dev-admin-key',
    });

    const res = await request(app).get('/metrics');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
    expect(res.text).toContain('veritas_test_metric 1');
  });

  it('requires authentication in production by default', async () => {
    const app = await buildApp({
      NODE_ENV: 'production',
      VERITAS_ADMIN_KEY: 'production-admin-key',
    });

    const res = await request(app).get('/metrics');

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('AUTH_REQUIRED');
  });

  it('allows production scrapes with an authenticated telemetry reader', async () => {
    const app = await buildApp({
      NODE_ENV: 'production',
      VERITAS_ADMIN_KEY: 'production-admin-key',
      VERITAS_API_KEYS: 'prometheus:metrics-reader:read-only',
    });

    const res = await request(app).get('/metrics').set('Authorization', 'Bearer metrics-reader');

    expect(res.status).toBe(200);
    expect(res.text).toContain('veritas_test_metric 1');
  });

  it('rejects production API keys without telemetry read permission', async () => {
    const app = await buildApp({
      NODE_ENV: 'production',
      VERITAS_ADMIN_KEY: 'production-admin-key',
      VERITAS_API_KEYS: 'agent:agent-key:agent',
    });

    const res = await request(app).get('/metrics').set('Authorization', 'Bearer agent-key');

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });

  it('allows production scrapes with the dedicated Prometheus bearer token', async () => {
    const app = await buildApp({
      NODE_ENV: 'production',
      VERITAS_ADMIN_KEY: 'production-admin-key',
      PROMETHEUS_METRICS_TOKEN: 'prometheus-secret',
    });

    const res = await request(app).get('/metrics').set('Authorization', 'Bearer prometheus-secret');

    expect(res.status).toBe(200);
    expect(res.text).toContain('veritas_test_metric 1');
  });

  it('allows explicit public production scrapes only when opted in', async () => {
    const app = await buildApp({
      NODE_ENV: 'production',
      VERITAS_ADMIN_KEY: 'production-admin-key',
      PROMETHEUS_METRICS_PUBLIC: 'true',
    });

    const res = await request(app).get('/metrics');

    expect(res.status).toBe(200);
    expect(res.text).toContain('veritas_test_metric 1');
  });
});
