/**
 * Response Envelope Middleware Tests
 *
 * Verifies that the middleware wraps JSON responses in the
 * standard API envelope format for both success and error cases.
 */
import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { responseEnvelopeMiddleware } from '../../middleware/response-envelope.js';
import { requestIdMiddleware } from '../../middleware/request-id.js';
import { errorHandler } from '../../middleware/error-handler.js';

/**
 * Helper: create an Express app with request-id + envelope middleware,
 * plus a route handler and error handler.
 */
function createApp() {
  const app = express();
  app.use(express.json());
  app.use(requestIdMiddleware);
  app.use(responseEnvelopeMiddleware);
  return app;
}

describe('responseEnvelopeMiddleware', () => {
  // ── Success Responses ───────────────────────────────────────

  describe('success envelope', () => {
    it('should wrap a simple JSON object', async () => {
      const app = createApp();
      app.get('/test', (_req, res) => res.json({ id: 1, name: 'Task A' }));

      const res = await request(app).get('/test');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual({ id: 1, name: 'Task A' });
      expect(res.body.meta).toBeDefined();
      expect(res.body.meta.timestamp).toBeDefined();
      expect(res.body.meta.requestId).toBeDefined();
    });

    it('should wrap an array', async () => {
      const app = createApp();
      app.get('/test', (_req, res) => res.json([1, 2, 3]));

      const res = await request(app).get('/test');
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual([1, 2, 3]);
    });

    it('should wrap null data', async () => {
      const app = createApp();
      app.get('/test', (_req, res) => res.json(null));

      const res = await request(app).get('/test');
      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeNull();
    });

    it('should wrap 201 responses as success', async () => {
      const app = createApp();
      app.post('/test', (_req, res) => res.status(201).json({ id: 'new' }));

      const res = await request(app).post('/test');
      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual({ id: 'new' });
    });

    it('should not wrap 204 responses (no body)', async () => {
      const app = createApp();
      app.delete('/test', (_req, res) => res.status(204).send());

      const res = await request(app).delete('/test');
      expect(res.status).toBe(204);
      expect(res.body).toEqual({});
    });

    it('should include requestId from request-id middleware', async () => {
      const app = createApp();
      app.get('/test', (_req, res) => res.json({ ok: true }));

      const res = await request(app).get('/test').set('X-Request-ID', 'custom-id-123');

      expect(res.body.meta.requestId).toBe('custom-id-123');
    });

    it('should include task identity diagnostics from response locals', async () => {
      const app = createApp();
      app.get('/test', (_req, res) => {
        res.locals.taskIdentityDiagnostics = {
          hasConflicts: true,
          conflictCount: 1,
          conflicts: [{ kind: 'task-id', id: 'task_1', sources: [] }],
        };
        res.json([]);
      });

      const res = await request(app).get('/test');

      expect(res.body.meta.taskIdentityDiagnostics).toMatchObject({
        hasConflicts: true,
        conflictCount: 1,
      });
    });
  });

  // ── Error Responses ─────────────────────────────────────────

  describe('error envelope', () => {
    it('should wrap inline route error { error: "message" }', async () => {
      const app = createApp();
      app.get('/test', (_req, res) => res.status(400).json({ error: 'Bad request' }));

      const res = await request(app).get('/test');
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toEqual({
        code: 'ERROR',
        message: 'Bad request',
      });
      expect(res.body.meta).toBeDefined();
    });

    it('should wrap inline route error with code and details', async () => {
      const app = createApp();
      app.get('/test', (_req, res) =>
        res.status(400).json({
          error: 'Validation failed',
          code: 'VALIDATION_ERROR',
          details: [{ field: 'name' }],
        })
      );

      const res = await request(app).get('/test');
      expect(res.body.success).toBe(false);
      expect(res.body.error).toEqual({
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        details: [{ field: 'name' }],
      });
    });

    it('should wrap error handler { code, message } output', async () => {
      const app = createApp();
      app.get('/test', (_req, res) =>
        res.status(404).json({ code: 'NOT_FOUND', message: 'Task not found' })
      );

      const res = await request(app).get('/test');
      expect(res.body.success).toBe(false);
      expect(res.body.error).toEqual({
        code: 'NOT_FOUND',
        message: 'Task not found',
      });
    });

    it('should wrap 500 errors', async () => {
      const app = createApp();
      app.get('/test', (_req, res) => res.status(500).json({ error: 'Internal server error' }));

      const res = await request(app).get('/test');
      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toBe('Internal server error');
    });

    it('should handle unknown error shapes gracefully', async () => {
      const app = createApp();
      app.get('/test', (_req, res) => res.status(400).json({ foo: 'bar' }));

      const res = await request(app).get('/test');
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('UNKNOWN_ERROR');
    });
  });

  // ── Integration with Error Handler ──────────────────────────

  describe('integration with error handler', () => {
    it('should produce a complete error envelope for thrown AppErrors', async () => {
      const { AppError } = await import('../../middleware/error-handler.js');
      const app = createApp();
      app.get('/test', (_req, _res, next) => {
        next(new AppError(422, 'Unprocessable', 'UNPROCESSABLE'));
      });
      app.use(errorHandler);

      const res = await request(app).get('/test');
      expect(res.status).toBe(422);
      expect(res.body).toMatchObject({
        success: false,
        error: {
          code: 'UNPROCESSABLE',
          message: 'Unprocessable',
        },
        meta: expect.objectContaining({
          timestamp: expect.any(String),
          requestId: expect.any(String),
        }),
      });
    });
  });

  // ── Non-API routes (should NOT be wrapped) ──────────────────

  describe('non-wrapped routes', () => {
    it('should not affect non-JSON responses (text)', async () => {
      const app = createApp();
      app.get('/test', (_req, res) => res.type('text/plain').send('Hello world'));

      const res = await request(app).get('/test');
      expect(res.text).toBe('Hello world');
    });

    it('should not affect sendFile / send', async () => {
      const app = createApp();
      app.get('/test', (_req, res) => res.send('raw html'));

      const res = await request(app).get('/test');
      expect(res.text).toBe('raw html');
    });
  });
});
