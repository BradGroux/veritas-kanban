/**
 * Validate Middleware Tests
 * Tests Zod schema validation for request params, query, and body.
 */
import { describe, it, expect, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { validate } from '../../middleware/validate.js';
import { ValidationError } from '../../middleware/error-handler.js';

function mockRequest(overrides: Partial<Request> = {}): Request {
  return {
    params: {},
    query: {},
    body: {},
    ...overrides,
  } as unknown as Request;
}

function mockResponse(): Response {
  return {} as unknown as Response;
}

describe('validate middleware', () => {
  it('should pass when no schemas provided', () => {
    const middleware = validate({});
    const req = mockRequest();
    const res = mockResponse();
    const next = vi.fn();

    middleware(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('should validate params successfully', () => {
    const schema = z.object({ id: z.string().min(1) });
    const middleware = validate({ params: schema });
    const req = mockRequest({ params: { id: 'task_123' } });
    const res = mockResponse();
    const next = vi.fn();

    middleware(req, res, next);
    expect(next).toHaveBeenCalled();
    expect((req as any).validated.params).toEqual({ id: 'task_123' });
  });

  it('should validate query successfully', () => {
    const schema = z.object({ limit: z.coerce.number().int().positive() });
    const middleware = validate({ query: schema });
    const req = mockRequest({ query: { limit: '10' } });
    const res = mockResponse();
    const next = vi.fn();

    middleware(req, res, next);
    expect(next).toHaveBeenCalled();
    expect((req as any).validated.query).toEqual({ limit: 10 });
  });

  it('should validate body successfully', () => {
    const schema = z.object({
      title: z.string().min(1),
      priority: z.enum(['low', 'medium', 'high']),
    });
    const middleware = validate({ body: schema });
    const req = mockRequest({
      body: { title: 'Test task', priority: 'high' },
    });
    const res = mockResponse();
    const next = vi.fn();

    middleware(req, res, next);
    expect(next).toHaveBeenCalled();
    expect((req as any).validated.body).toEqual({ title: 'Test task', priority: 'high' });
  });

  it('should validate multiple schemas simultaneously', () => {
    const paramsSchema = z.object({ id: z.string() });
    const bodySchema = z.object({ status: z.string() });
    const middleware = validate({ params: paramsSchema, body: bodySchema });
    const req = mockRequest({
      params: { id: 'task_1' },
      body: { status: 'done' },
    });
    const res = mockResponse();
    const next = vi.fn();

    middleware(req, res, next);
    expect(next).toHaveBeenCalled();
    expect((req as any).validated.params).toEqual({ id: 'task_1' });
    expect((req as any).validated.body).toEqual({ status: 'done' });
  });

  it('should throw ValidationError on params validation failure', () => {
    const schema = z.object({ id: z.string().min(5) });
    const middleware = validate({ params: schema });
    const req = mockRequest({ params: { id: 'ab' } });
    const res = mockResponse();
    const next = vi.fn();

    expect(() => middleware(req, res, next)).toThrow(ValidationError);
    expect(next).not.toHaveBeenCalled();
  });

  it('should throw ValidationError on body validation failure', () => {
    const schema = z.object({
      title: z.string().min(1),
      priority: z.enum(['low', 'medium', 'high']),
    });
    const middleware = validate({ body: schema });
    const req = mockRequest({
      body: { title: '', priority: 'invalid' },
    });
    const res = mockResponse();
    const next = vi.fn();

    expect(() => middleware(req, res, next)).toThrow(ValidationError);
  });

  it('should throw ValidationError on query validation failure', () => {
    const schema = z.object({ limit: z.coerce.number().int().positive() });
    const middleware = validate({ query: schema });
    const req = mockRequest({ query: { limit: '-5' } });
    const res = mockResponse();
    const next = vi.fn();

    expect(() => middleware(req, res, next)).toThrow(ValidationError);
  });

  it('should re-throw non-Zod errors', () => {
    // Create a schema that throws a non-Zod error
    const badSchema = {
      parse: () => { throw new Error('Something unexpected'); },
    } as any;
    const middleware = validate({ body: badSchema });
    const req = mockRequest({ body: {} });
    const res = mockResponse();
    const next = vi.fn();

    expect(() => middleware(req, res, next)).toThrow('Something unexpected');
  });
});
