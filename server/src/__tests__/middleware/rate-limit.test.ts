/**
 * Rate Limit Middleware Tests
 *
 * Tests the rate limiting factory, pre-configured tiered limiters,
 * Retry-After header on 429 responses, and route-level differentiation.
 */
import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import {
  rateLimit,
  apiRateLimit,
  authRateLimit,
  writeRateLimit,
  readRateLimit,
  uploadRateLimit,
  strictRateLimit,
} from '../../middleware/rate-limit.js';

// ── Helper ─────────────────────────────────────────────────────────────────────

function expectConfiguredLimit(response: request.Response, expected: number): void {
  expect(response.headers['x-ratelimit-limit']).toBe(String(expected));
}

function configuredLimit(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function createWriteLimiter(limit = 2) {
  return rateLimit({
    limit,
    windowMs: 60_000,
    message: 'Too many write requests. Please slow down.',
  });
}

function createUploadLimiter(limit = 2) {
  return rateLimit({
    limit,
    windowMs: 60_000,
    message: 'Too many upload requests. Please slow down.',
  });
}

// ── Factory tests ──────────────────────────────────────────────────────────────

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

      await request(app).get('/');
      await request(app).get('/');
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
      app.use(
        rateLimit({
          limit: 1,
          windowMs: 10000,
          skip: (req) => req.path === '/health',
        })
      );
      app.get('/health', (_req, res) => res.json({ ok: true }));
      app.get('/api', (_req, res) => res.json({ ok: true }));

      await request(app).get('/health');
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
    });

    it('should include rate limit headers on successful responses', async () => {
      const app = express();
      app.use(rateLimit({ limit: 10, windowMs: 60000 }));
      app.get('/', (_req, res) => res.json({ ok: true }));

      const res = await request(app).get('/');
      const hasStandard = 'ratelimit' in res.headers || 'ratelimit-limit' in res.headers;
      const hasLegacy = 'x-ratelimit-limit' in res.headers;
      expect(hasStandard || hasLegacy).toBe(true);
    });

    it('should include Retry-After header on 429 responses', async () => {
      const app = express();
      app.use(rateLimit({ limit: 1, windowMs: 60000 }));
      app.get('/', (_req, res) => res.json({ ok: true }));

      await request(app).get('/');
      const res = await request(app).get('/');
      expect(res.status).toBe(429);
      // express-rate-limit sets retry-after as seconds remaining
      expect(res.headers['retry-after']).toBeDefined();
      const retryAfter = Number(res.headers['retry-after']);
      expect(retryAfter).toBeGreaterThan(0);
      expect(retryAfter).toBeLessThanOrEqual(60);
    });
  });

  // ── Pre-configured limiter exports ─────────────────────────────────────────

  describe('pre-configured limiters', () => {
    it('should export apiRateLimit', () => {
      expect(typeof apiRateLimit).toBe('function');
    });

    it('should export strictRateLimit', () => {
      expect(typeof strictRateLimit).toBe('function');
    });

    it('should export authRateLimit', () => {
      expect(typeof authRateLimit).toBe('function');
    });

    it('should export writeRateLimit', () => {
      expect(typeof writeRateLimit).toBe('function');
    });

    it('should export readRateLimit', () => {
      expect(typeof readRateLimit).toBe('function');
    });

    it('should export uploadRateLimit', () => {
      expect(typeof uploadRateLimit).toBe('function');
    });
  });

  // ── Tiered limit enforcement ───────────────────────────────────────────────

  describe('authRateLimit (10 req / 15 min)', () => {
    it('should exempt localhost requests (skip rate limiting)', async () => {
      const app = express();
      app.use(authRateLimit);
      app.post('/login', (_req, res) => res.json({ ok: true }));

      // Supertest sends from 127.0.0.1 — all requests should pass
      // even beyond the 10-request limit (localhost exempt)
      for (let i = 0; i < 15; i++) {
        const res = await request(app).post('/login').send({});
        expect(res.status).toBe(200);
      }
    });
  });

  describe('writeRateLimit (60 req / min)', () => {
    it('should expose the configured limit and allow an initial request', async () => {
      const app = express();
      app.use(writeRateLimit);
      app.post('/items', (_req, res) => res.json({ ok: true }));

      const res = await request(app).post('/items').send({});
      expect(res.status).toBe(200);
      expectConfiguredLimit(res, configuredLimit('RATE_LIMIT_WRITE_MAX', 60));
    });

    it('should block writes over the configured limit', async () => {
      const app = express();
      app.use(createWriteLimiter());
      app.post('/items', (_req, res) => res.json({ ok: true }));

      await request(app).post('/items').send({});
      await request(app).post('/items').send({});
      const res = await request(app).post('/items').send({});
      expect(res.status).toBe(429);
      expect(res.body.error).toContain('write');
    });

    it('should include Retry-After header on 429', async () => {
      const app = express();
      app.use(createWriteLimiter(1));
      app.post('/items', (_req, res) => res.json({ ok: true }));

      await request(app).post('/items').send({});
      const res = await request(app).post('/items').send({});
      expect(res.status).toBe(429);
      expect(res.headers['retry-after']).toBeDefined();
    });
  });

  describe('readRateLimit (300 req / min)', () => {
    it('should expose the configured limit and allow an initial request', async () => {
      const app = express();
      app.use(readRateLimit);
      app.get('/items', (_req, res) => res.json({ ok: true }));

      const res = await request(app).get('/items');
      expect(res.status).toBe(200);
      expectConfiguredLimit(res, configuredLimit('RATE_LIMIT_MAX', 300));
    });

    it('should return proper error message when limited', async () => {
      // Use a small-limit clone to test behavior without 300 requests
      const app = express();
      app.use(
        rateLimit({
          limit: 2,
          windowMs: 60000,
          message: 'Too many read requests. Please slow down.',
        })
      );
      app.get('/items', (_req, res) => res.json({ ok: true }));

      await request(app).get('/items');
      await request(app).get('/items');
      const res = await request(app).get('/items');
      expect(res.status).toBe(429);
      expect(res.body.error).toContain('read');
    });
  });

  describe('uploadRateLimit (20 req / min)', () => {
    it('should expose the configured limit and allow an initial request', async () => {
      const app = express();
      app.use(uploadRateLimit);
      app.post('/upload', (_req, res) => res.json({ ok: true }));

      const res = await request(app).post('/upload').send({});
      expect(res.status).toBe(200);
      expectConfiguredLimit(res, 20);
    });

    it('should block uploads over the configured limit', async () => {
      const app = express();
      app.use(createUploadLimiter());
      app.post('/upload', (_req, res) => res.json({ ok: true }));

      await request(app).post('/upload').send({});
      await request(app).post('/upload').send({});
      const res = await request(app).post('/upload').send({});
      expect(res.status).toBe(429);
      expect(res.body.error).toContain('upload');
    });

    it('should include Retry-After header on 429', async () => {
      const app = express();
      app.use(createUploadLimiter(1));
      app.post('/upload', (_req, res) => res.json({ ok: true }));

      await request(app).post('/upload').send({});
      const res = await request(app).post('/upload').send({});
      expect(res.status).toBe(429);
      expect(res.headers['retry-after']).toBeDefined();
      const retryAfter = Number(res.headers['retry-after']);
      expect(retryAfter).toBeGreaterThan(0);
      expect(retryAfter).toBeLessThanOrEqual(60);
    });
  });

  // ── Route-level differentiation ────────────────────────────────────────────

  describe('different routes get different limits', () => {
    it('should apply stricter limit to auth vs general read', async () => {
      // Use fresh limiter instances to avoid cross-test MemoryStore bleed
      const freshAuth = rateLimit({ limit: 3, windowMs: 60000, message: 'Auth limited' });
      const freshRead = rateLimit({ limit: 20, windowMs: 60000, message: 'Read limited' });

      const app = express();

      // Auth routes
      app.use('/auth', freshAuth);
      app.post('/auth/login', (_req, res) => res.json({ ok: true }));

      // Read routes
      app.use('/api', freshRead);
      app.get('/api/items', (_req, res) => res.json({ ok: true }));

      // Exhaust auth limit (3 requests)
      for (let i = 0; i < 3; i++) {
        await request(app).post('/auth/login').send({});
      }
      // Auth should now be blocked
      const authRes = await request(app).post('/auth/login').send({});
      expect(authRes.status).toBe(429);

      // Read should still work fine (separate limiter, only used 0 of its 20 limit)
      const readRes = await request(app).get('/api/items');
      expect(readRes.status).toBe(200);
    });

    it('should apply stricter limit to uploads vs general writes', async () => {
      // Use fresh limiter instances to avoid cross-test MemoryStore bleed
      const freshUpload = rateLimit({ limit: 3, windowMs: 60000, message: 'Upload limited' });
      const freshWrite = rateLimit({ limit: 10, windowMs: 60000, message: 'Write limited' });

      const app = express();

      app.use('/upload', freshUpload);
      app.post('/upload/file', (_req, res) => res.json({ ok: true }));

      app.use('/write', freshWrite);
      app.post('/write/item', (_req, res) => res.json({ ok: true }));

      // Exhaust upload limit (3 requests)
      for (let i = 0; i < 3; i++) {
        await request(app).post('/upload/file').send({});
      }
      // Upload should be blocked
      const uploadRes = await request(app).post('/upload/file').send({});
      expect(uploadRes.status).toBe(429);

      // Write should still work (separate limiter, only used 0 of its 10 limit)
      const writeRes = await request(app).post('/write/item').send({});
      expect(writeRes.status).toBe(200);
    });

    it('should enforce write limit independent of read limit', async () => {
      const app = express();

      // Use small limits for fast testing
      const testWrite = rateLimit({ limit: 3, windowMs: 60000, message: 'Write limited' });
      const testRead = rateLimit({ limit: 5, windowMs: 60000, message: 'Read limited' });

      app.post('/items', testWrite, (_req, res) => res.json({ ok: true }));
      app.get('/items', testRead, (_req, res) => res.json({ ok: true }));

      // Exhaust write limit
      for (let i = 0; i < 3; i++) {
        await request(app).post('/items').send({});
      }
      const writeRes = await request(app).post('/items').send({});
      expect(writeRes.status).toBe(429);

      // Read should still work (separate limiter instance)
      const readRes = await request(app).get('/items');
      expect(readRes.status).toBe(200);
    });
  });

  // ── 429 response format ────────────────────────────────────────────────────

  describe('429 response format', () => {
    it('should return JSON error body', async () => {
      const app = express();
      app.use(rateLimit({ limit: 1, windowMs: 60000 }));
      app.get('/', (_req, res) => res.json({ ok: true }));

      await request(app).get('/');
      const res = await request(app).get('/');

      expect(res.status).toBe(429);
      expect(res.body).toHaveProperty('error');
      expect(typeof res.body.error).toBe('string');
    });

    it('should set Content-Type to application/json on 429', async () => {
      const app = express();
      app.use(rateLimit({ limit: 1, windowMs: 60000 }));
      app.get('/', (_req, res) => res.json({ ok: true }));

      await request(app).get('/');
      const res = await request(app).get('/');

      expect(res.status).toBe(429);
      expect(res.headers['content-type']).toMatch(/application\/json/);
    });

    it('should include Retry-After as integer seconds', async () => {
      const app = express();
      app.use(rateLimit({ limit: 1, windowMs: 30000 }));
      app.get('/', (_req, res) => res.json({ ok: true }));

      await request(app).get('/');
      const res = await request(app).get('/');

      expect(res.status).toBe(429);
      const retryAfter = res.headers['retry-after'];
      expect(retryAfter).toBeDefined();
      // Should be a numeric string representing seconds
      expect(Number(retryAfter)).toBeGreaterThan(0);
      expect(Number(retryAfter)).toBeLessThanOrEqual(30);
    });
  });
});
