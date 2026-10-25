/**
 * Request ID Middleware Tests
 * Verifies that every request gets a unique X-Request-ID and that
 * client-supplied IDs are preserved for distributed tracing.
 */
import { describe, it, expect, vi } from 'vitest';
import type { Request, Response } from 'express';
import { requestIdMiddleware } from '../../middleware/request-id.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function mockRequest(headers: Record<string, string | string[] | undefined> = {}): Request {
  return { headers } as unknown as Request;
}

function mockResponse(): Response & { locals: Record<string, unknown> } {
  return {
    locals: {},
    setHeader: vi.fn(),
  } as unknown as Response & { locals: Record<string, unknown> };
}

describe('Request ID Middleware', () => {
  it('should generate a UUID when no X-Request-ID header is present', () => {
    const req = mockRequest();
    const res = mockResponse();
    const next = vi.fn();

    requestIdMiddleware(req, res, next);

    expect(res.locals.requestId).toMatch(UUID_RE);
    expect(res.setHeader).toHaveBeenCalledWith('X-Request-ID', res.locals.requestId);
    expect(next).toHaveBeenCalled();
  });

  it('should preserve a client-supplied X-Request-ID header', () => {
    const clientId = 'my-trace-abc-123';
    const req = mockRequest({ 'x-request-id': clientId });
    const res = mockResponse();
    const next = vi.fn();

    requestIdMiddleware(req, res, next);

    expect(res.locals.requestId).toBe(clientId);
    expect(res.setHeader).toHaveBeenCalledWith('X-Request-ID', clientId);
    expect(next).toHaveBeenCalled();
  });

  it('should generate a new ID when X-Request-ID is an empty string', () => {
    const req = mockRequest({ 'x-request-id': '' });
    const res = mockResponse();
    const next = vi.fn();

    requestIdMiddleware(req, res, next);

    expect(res.locals.requestId).toMatch(UUID_RE);
    expect(next).toHaveBeenCalled();
  });

  it('should generate unique IDs across calls', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const req = mockRequest();
      const res = mockResponse();
      const next = vi.fn();
      requestIdMiddleware(req, res, next);
      ids.add(res.locals.requestId as string);
    }
    expect(ids.size).toBe(50);
  });
});
