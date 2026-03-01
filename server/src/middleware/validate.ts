import { Request, Response, NextFunction } from 'express';
import { z, ZodSchema, ZodError } from 'zod';
import { ValidationError } from './error-handler.js';

// Module augmentation: extend Express Request with validated data
declare module 'express-serve-static-core' {
  interface Request {
    validated?: Record<string, unknown>;
  }
}

/**
 * Validation middleware factory for request validation using Zod schemas.
 *
 * @example
 * // Validate query params
 * router.get('/items', validate({ query: ItemsQuerySchema }), handler);
 *
 * // Validate body
 * router.post('/items', validate({ body: CreateItemSchema }), handler);
 *
 * // Validate path params
 * router.get('/items/:id', validate({ params: ItemParamsSchema }), handler);
 *
 * // Validate multiple
 * router.put('/items/:id', validate({ params: ItemParamsSchema, body: UpdateItemSchema }), handler);
 */
export interface ValidationSchemas {
  params?: ZodSchema;
  query?: ZodSchema;
  body?: ZodSchema;
}

/**
 * Create validation middleware for Express routes.
 * Transforms valid data onto req.validated for type-safe access.
 */
export function validate(schemas: ValidationSchemas) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      const validated: Record<string, unknown> = {};

      if (schemas.params) {
        validated.params = schemas.params.parse(req.params);
      }

      if (schemas.query) {
        validated.query = schemas.query.parse(req.query);
      }

      if (schemas.body) {
        validated.body = schemas.body.parse(req.body);
      }

      // Attach validated data to request for type-safe access
      req.validated = validated;
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const details = error.issues.map((e) => ({
          path: e.path.join('.'),
          message: e.message,
        }));
        throw new ValidationError('Validation failed', details);
      }
      throw error;
    }
  };
}

/**
 * Type helper for accessing validated request data.
 * Use with type assertion: (req as ValidatedRequest<...>)
 */
export type ValidatedRequest<TParams = unknown, TQuery = unknown, TBody = unknown> = Request & {
  validated: {
    params?: TParams;
    query?: TQuery;
    body?: TBody;
  };
};
