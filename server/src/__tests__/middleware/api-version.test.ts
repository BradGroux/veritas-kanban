/**
 * API Version Middleware Tests
 * Tests version stamping and validation.
 */
import { describe, it, expect, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import {
  apiVersionMiddleware,
  CURRENT_API_VERSION,
  SUPPORTED_VERSIONS,
} from '../../middleware/api-version.js';

function mockRequest(overrides: Partial<Request> = {}): Request {
  return {
    headers: {},
    ...overrides,
  } as unknown as Request;
}

function mockResponse(): Response {
  const res = {
    setHeader: vi.fn(),
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
  } as unknown as Response;
  return res;
}

describe('API Version Middleware', () => {
  it('should export v1 as current version', () => {
    expect(CURRENT_API_VERSION).toBe('v1');
    expect(SUPPORTED_VERSIONS).toContain('v1');
  });

  it('should set X-API-Version header on every response', () => {
    const req = mockRequest();
    const res = mockResponse();
    const next = vi.fn();

    apiVersionMiddleware(req, res, next);
    expect(res.setHeader).toHaveBeenCalledWith('X-API-Version', 'v1');
    expect(next).toHaveBeenCalled();
  });

  it('should pass through when no version requested', () => {
    const req = mockRequest();
    const res = mockResponse();
    const next = vi.fn();

    apiVersionMiddleware(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('should pass through for supported version', () => {
    const req = mockRequest({
      headers: { 'x-api-version': 'v1' },
    });
    const res = mockResponse();
    const next = vi.fn();

    apiVersionMiddleware(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('should reject unsupported version with 400', () => {
    const req = mockRequest({
      headers: { 'x-api-version': 'v99' },
    });
    const res = mockResponse();
    const next = vi.fn();

    apiVersionMiddleware(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'Unsupported API version',
        requested: 'v99',
        supported: SUPPORTED_VERSIONS,
        current: CURRENT_API_VERSION,
      })
    );
  });
});
