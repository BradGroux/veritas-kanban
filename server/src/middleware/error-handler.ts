import { Request, Response, NextFunction } from 'express';
import { createLogger } from '../lib/logger.js';

const log = createLogger('error-handler');

// Custom error classes
export class AppError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public code?: string,
    public details?: unknown
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Not found') {
    super(404, message, 'NOT_FOUND');
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super(400, message, 'VALIDATION_ERROR', details);
  }
}

export class ConflictError extends AppError {
  constructor(message: string, details?: unknown) {
    super(409, message, 'CONFLICT', details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Authentication required') {
    super(401, message, 'AUTH_REQUIRED');
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Insufficient permissions', details?: unknown) {
    super(403, message, 'FORBIDDEN', details);
  }
}

export class BadRequestError extends AppError {
  constructor(message: string, details?: unknown) {
    super(400, message, 'BAD_REQUEST', details);
  }
}

export class InternalError extends AppError {
  constructor(message = 'Internal server error') {
    super(500, message, 'INTERNAL_ERROR');
  }
}

// Express error handling middleware (4 args)
export function errorHandler(err: Error, req: Request, res: Response, _next: NextFunction) {
  const requestId: string | undefined = res.locals.requestId;

  if (err instanceof AppError) {
    // Produce a standardised error object that the response-envelope
    // middleware will wrap in { success: false, error: ..., meta: ... }.
    const errorBody: { code: string; message: string; details?: unknown } = {
      code: err.code ?? 'APP_ERROR',
      message: err.message,
    };
    if (err.details) {
      errorBody.details = err.details;
    }
    return res.status(err.statusCode).json(errorBody);
  }

  log.error({ err, requestId, method: req.method, path: req.path }, 'Unhandled error');
  res.status(500).json({
    code: 'INTERNAL_ERROR',
    message: 'Internal server error',
  });
}
