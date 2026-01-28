/**
 * Rate Limit Middleware Tests
 * Tests the rate limiting factory and pre-configured limiters.
 */
import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { rateLimit, apiRateLimit, strictRateLimit } from '../../middleware/rate-limit.js';

describe('Rate Limit Middleware', () => {
  describe('rateLimit factory', () => {
    it('should create middleware with default options', () => {
      const limiter = rateLimit();
      expect(typeof limiter).toBe('function');
    });

    it('should create middleware with custom options', () => {
      const limiter = rateLimit({
        limit: 5,
        windowMs: 1000,
        message: 'Custom message',
      });
      expect(typeof limiter).toBe('function');
    });

    it('should allow requests under the limit', async () => {
      const app = express();
      app.use(rateLimit({ limit: 3, windowMs: 10000 }));
      app.get('/', (_req, res) => res.json({ ok: true }));

      const res = await request(app).get('/');
      expect(res.status).toBe(200);
    });

    it('should block requests over the limit', async () => {
      const app = express();
      app.use(rateLimit({ limit: 2, windowMs: 10000 }));
      app.get('/', (_req, res) => res.json({ ok: true }));

      // First 2 should succeed
      await request(app).get('/');
      await request(app).get('/');
      // Third should be rate limited
      const res = await request(app).get('/');
      expect(res.status).toBe(429);
    });

    it('should return custom message when rate limited', async () => {
      const app = express();
      app.use(rateLimit({ limit: 1, windowMs: 10000, message: 'Slow down!' }));
      app.get('/', (_req, res) => res.json({ ok: true }));

      await request(app).get('/');
      const res = await request(app).get('/');
      expect(res.status).toBe(429);
      expect(res.body.error).toBe('Slow down!');
    });

    it('should support skip function', async () => {
      const app = express();
      app.use(rateLimit({
        limit: 1,
        windowMs: 10000,
        skip: (req) => req.path === '/health',
      }));
      app.get('/health', (_req, res) => res.json({ ok: true }));
      app.get('/api', (_req, res) => res.json({ ok: true }));

      // Both should be skipped since skip returns true for /health
      await request(app).get('/health');
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
    });

    it('should include rate limit headers', async () => {
      const app = express();
      app.use(rateLimit({ limit: 10, windowMs: 60000 }));
      app.get('/', (_req, res) => res.json({ ok: true }));

      const res = await request(app).get('/');
      // draft-7 uses combined RateLimit header; also check legacy X-RateLimit-* headers
      const hasStandard = 'ratelimit' in res.headers || 'ratelimit-limit' in res.headers;
      const hasLegacy = 'x-ratelimit-limit' in res.headers;
      expect(hasStandard || hasLegacy).toBe(true);
    });
  });

  describe('pre-configured limiters', () => {
    it('should export apiRateLimit', () => {
      expect(typeof apiRateLimit).toBe('function');
    });

    it('should export strictRateLimit', () => {
      expect(typeof strictRateLimit).toBe('function');
    });
  });
});
