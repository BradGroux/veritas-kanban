/**
 * Cache Control Middleware Tests
 * Tests cache-control header management for API and static responses.
 */
import { describe, it, expect, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { cacheControl, apiCacheHeaders, setLastModified, type CacheProfile } from '../../middleware/cache-control.js';

function mockRequest(overrides: Partial<Request> = {}): Request {
  return {
    method: 'GET',
    path: '/',
    ...overrides,
  } as unknown as Request;
}

function mockResponse(): Response & { _headers: Record<string, string> } {
  const headers: Record<string, string> = {};
  return {
    _headers: headers,
    set: vi.fn((key: string, value: string) => { headers[key] = value; }),
  } as unknown as Response & { _headers: Record<string, string> };
}

describe('Cache Control Middleware', () => {
  describe('cacheControl(profile)', () => {
    it('should set static-immutable header for GET', () => {
      const middleware = cacheControl('static-immutable');
      const req = mockRequest({ method: 'GET' });
      const res = mockResponse();
      const next = vi.fn();

      middleware(req, res, next);
      expect(res.set).toHaveBeenCalledWith('Cache-Control', 'public, max-age=31536000, immutable');
      expect(next).toHaveBeenCalled();
    });

    it('should set static-html header for GET', () => {
      const middleware = cacheControl('static-html');
      const req = mockRequest({ method: 'GET' });
      const res = mockResponse();
      const next = vi.fn();

      middleware(req, res, next);
      expect(res.set).toHaveBeenCalledWith('Cache-Control', 'no-cache');
      expect(next).toHaveBeenCalled();
    });

    it('should set task-list cache for GET', () => {
      const middleware = cacheControl('task-list');
      const req = mockRequest({ method: 'GET' });
      const res = mockResponse();
      const next = vi.fn();

      middleware(req, res, next);
      expect(res.set).toHaveBeenCalledWith('Cache-Control', 'private, max-age=10, must-revalidate');
      expect(next).toHaveBeenCalled();
    });

    it('should set task-detail cache for HEAD', () => {
      const middleware = cacheControl('task-detail');
      const req = mockRequest({ method: 'HEAD' });
      const res = mockResponse();
      const next = vi.fn();

      middleware(req, res, next);
      expect(res.set).toHaveBeenCalledWith('Cache-Control', 'private, max-age=60');
      expect(next).toHaveBeenCalled();
    });

    it('should set config cache', () => {
      const middleware = cacheControl('config');
      const req = mockRequest({ method: 'GET' });
      const res = mockResponse();
      const next = vi.fn();

      middleware(req, res, next);
      expect(res.set).toHaveBeenCalledWith('Cache-Control', 'private, no-cache');
      expect(next).toHaveBeenCalled();
    });

    it('should set no-store for POST requests regardless of profile', () => {
      const middleware = cacheControl('task-list');
      const req = mockRequest({ method: 'POST' });
      const res = mockResponse();
      const next = vi.fn();

      middleware(req, res, next);
      expect(res.set).toHaveBeenCalledWith('Cache-Control', 'no-store');
      expect(next).toHaveBeenCalled();
    });

    it('should set no-store for DELETE requests', () => {
      const middleware = cacheControl('static-immutable');
      const req = mockRequest({ method: 'DELETE' });
      const res = mockResponse();
      const next = vi.fn();

      middleware(req, res, next);
      expect(res.set).toHaveBeenCalledWith('Cache-Control', 'no-store');
      expect(next).toHaveBeenCalled();
    });

    it('should set no-store profile for GET', () => {
      const middleware = cacheControl('no-store');
      const req = mockRequest({ method: 'GET' });
      const res = mockResponse();
      const next = vi.fn();

      middleware(req, res, next);
      expect(res.set).toHaveBeenCalledWith('Cache-Control', 'no-store');
      expect(next).toHaveBeenCalled();
    });
  });

  describe('apiCacheHeaders', () => {
    it('should set no-store for POST requests', () => {
      const req = mockRequest({ method: 'POST', path: '/tasks' });
      const res = mockResponse();
      const next = vi.fn();

      apiCacheHeaders(req, res, next);
      expect(res.set).toHaveBeenCalledWith('Cache-Control', 'no-store');
      expect(next).toHaveBeenCalled();
    });

    it('should set no-store for PATCH requests', () => {
      const req = mockRequest({ method: 'PATCH', path: '/tasks/123' });
      const res = mockResponse();
      const next = vi.fn();

      apiCacheHeaders(req, res, next);
      expect(res.set).toHaveBeenCalledWith('Cache-Control', 'no-store');
      expect(next).toHaveBeenCalled();
    });

    it('should set task-list cache for GET /tasks', () => {
      const req = mockRequest({ method: 'GET', path: '/tasks' });
      const res = mockResponse();
      const next = vi.fn();

      apiCacheHeaders(req, res, next);
      expect(res.set).toHaveBeenCalledWith('Cache-Control', 'private, max-age=10, must-revalidate');
      expect(next).toHaveBeenCalled();
    });

    it('should set task-list cache for GET /tasks/', () => {
      const req = mockRequest({ method: 'GET', path: '/tasks/' });
      const res = mockResponse();
      const next = vi.fn();

      apiCacheHeaders(req, res, next);
      expect(res.set).toHaveBeenCalledWith('Cache-Control', 'private, max-age=10, must-revalidate');
      expect(next).toHaveBeenCalled();
    });

    it('should set task-detail cache for GET /tasks/:id', () => {
      const req = mockRequest({ method: 'GET', path: '/tasks/task_123' });
      const res = mockResponse();
      const next = vi.fn();

      apiCacheHeaders(req, res, next);
      expect(res.set).toHaveBeenCalledWith('Cache-Control', 'private, max-age=60');
      expect(next).toHaveBeenCalled();
    });

    it('should NOT use task-detail for sub-resources', () => {
      const req = mockRequest({ method: 'GET', path: '/tasks/task_123/comments' });
      const res = mockResponse();
      const next = vi.fn();

      apiCacheHeaders(req, res, next);
      // Should fall through to default
      expect(res.set).toHaveBeenCalledWith('Cache-Control', 'private, no-cache');
      expect(next).toHaveBeenCalled();
    });

    it('should set config cache for /config paths', () => {
      const req = mockRequest({ method: 'GET', path: '/config' });
      const res = mockResponse();
      const next = vi.fn();

      apiCacheHeaders(req, res, next);
      expect(res.set).toHaveBeenCalledWith('Cache-Control', 'private, no-cache');
      expect(next).toHaveBeenCalled();
    });

    it('should set config cache for /settings paths', () => {
      const req = mockRequest({ method: 'GET', path: '/settings/features' });
      const res = mockResponse();
      const next = vi.fn();

      apiCacheHeaders(req, res, next);
      expect(res.set).toHaveBeenCalledWith('Cache-Control', 'private, no-cache');
      expect(next).toHaveBeenCalled();
    });

    it('should set default cache for other GET paths', () => {
      const req = mockRequest({ method: 'GET', path: '/agents' });
      const res = mockResponse();
      const next = vi.fn();

      apiCacheHeaders(req, res, next);
      expect(res.set).toHaveBeenCalledWith('Cache-Control', 'private, no-cache');
      expect(next).toHaveBeenCalled();
    });
  });

  describe('setLastModified', () => {
    it('should set Last-Modified header from ISO date', () => {
      const res = mockResponse();
      const date = '2026-01-28T12:00:00.000Z';
      setLastModified(res, date);
      expect(res.set).toHaveBeenCalledWith('Last-Modified', new Date(date).toUTCString());
    });

    it('should not set header for undefined date', () => {
      const res = mockResponse();
      setLastModified(res, undefined);
      expect(res.set).not.toHaveBeenCalled();
    });
  });
});
