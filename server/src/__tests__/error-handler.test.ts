/**
 * Error Handler Tests
 * Tests all error classes and the Express error handler middleware.
 */
import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import {
  AppError,
  NotFoundError,
  ValidationError,
  ConflictError,
  errorHandler,
} from '../middleware/error-handler.js';

describe('Error Handler', () => {
  describe('Error classes', () => {
    it('should create AppError with statusCode, message, code, and details', () => {
      const err = new AppError(422, 'Invalid input', 'INVALID', { field: 'name' });
      expect(err.statusCode).toBe(422);
      expect(err.message).toBe('Invalid input');
      expect(err.code).toBe('INVALID');
      expect(err.details).toEqual({ field: 'name' });
      expect(err.name).toBe('AppError');
    });

    it('should create NotFoundError with 404 status', () => {
      const err = new NotFoundError();
      expect(err.statusCode).toBe(404);
      expect(err.message).toBe('Not found');
      expect(err.code).toBe('NOT_FOUND');
    });

    it('should create NotFoundError with custom message', () => {
      const err = new NotFoundError('Task not found');
      expect(err.message).toBe('Task not found');
    });

    it('should create ValidationError with 400 status and details', () => {
      const details = [{ path: 'title', message: 'Required' }];
      const err = new ValidationError('Bad input', details);
      expect(err.statusCode).toBe(400);
      expect(err.message).toBe('Bad input');
      expect(err.code).toBe('VALIDATION_ERROR');
      expect(err.details).toEqual(details);
    });

    it('should create ConflictError with 409 status', () => {
      const err = new ConflictError('Already exists');
      expect(err.statusCode).toBe(409);
      expect(err.message).toBe('Already exists');
      expect(err.code).toBe('CONFLICT');
    });
  });

  describe('errorHandler middleware', () => {
    function createApp(thrower: () => never | void) {
      const app = express();
      app.get('/test', (_req, _res, next) => {
        try { thrower(); } catch (err) { next(err); }
      });
      app.use(errorHandler);
      return app;
    }

    it('should handle AppError', async () => {
      const app = createApp(() => { throw new AppError(418, "I'm a teapot", 'TEAPOT'); });
      const res = await request(app).get('/test');
      expect(res.status).toBe(418);
      expect(res.body.error).toBe("I'm a teapot");
      expect(res.body.code).toBe('TEAPOT');
    });

    it('should include details for AppError with details', async () => {
      const app = createApp(() => { throw new AppError(400, 'Bad', 'BAD', { fields: ['a'] }); });
      const res = await request(app).get('/test');
      expect(res.status).toBe(400);
      expect(res.body.details).toEqual({ fields: ['a'] });
    });

    it('should not include details when not present', async () => {
      const app = createApp(() => { throw new NotFoundError(); });
      const res = await request(app).get('/test');
      expect(res.status).toBe(404);
      expect(res.body.details).toBeUndefined();
    });

    it('should handle generic Error as 500', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const app = createApp(() => { throw new Error('Unexpected'); });
      const res = await request(app).get('/test');
      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Internal server error');
      consoleSpy.mockRestore();
    });

    it('should handle ValidationError', async () => {
      const app = createApp(() => { throw new ValidationError('Invalid', { msg: 'bad' }); });
      const res = await request(app).get('/test');
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });

    it('should handle ConflictError', async () => {
      const app = createApp(() => { throw new ConflictError('Duplicate'); });
      const res = await request(app).get('/test');
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('CONFLICT');
    });
  });
});
