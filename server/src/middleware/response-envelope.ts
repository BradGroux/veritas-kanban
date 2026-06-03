import { Request, Response, NextFunction } from 'express';

/**
 * Response Envelope Middleware
 *
 * Wraps all JSON API responses in a consistent envelope format:
 *
 * Success (status < 400):
 * ```json
 * {
 *   "success": true,
 *   "data": { ... },
 *   "meta": { "timestamp": "...", "requestId": "..." }
 * }
 * ```
 *
 * Error (status >= 400):
 * ```json
 * {
 *   "success": false,
 *   "error": { "code": "...", "message": "...", "details": [...] },
 *   "meta": { "timestamp": "...", "requestId": "..." }
 * }
 * ```
 *
 * Only applies to `/api/` routes. Health checks, static files, and Swagger
 * are not wrapped.
 */

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

interface EnvelopeMeta {
  timestamp: string;
  timezone: string;
  utcOffset: number;
  requestId?: string;
  pagination?: PaginationMeta;
  taskIdentityDiagnostics?: unknown;
}

interface SuccessEnvelope<T = unknown> {
  success: true;
  data: T;
  meta: EnvelopeMeta;
}

interface ErrorBody {
  code: string;
  message: string;
  details?: unknown;
}

interface ErrorEnvelope {
  success: false;
  error: ErrorBody;
  meta: EnvelopeMeta;
}

export type ApiEnvelope<T = unknown> = SuccessEnvelope<T> | ErrorEnvelope;

/**
 * Normalizes an error response body into the standard error shape.
 *
 * Handles:
 *   - `{ code, message }` — already in the right format (from error handler)
 *   - `{ error: "string" }` — inline route error responses
 *   - Other shapes — wrapped as UNKNOWN_ERROR
 */
function normalizeErrorBody(data: unknown): ErrorBody {
  if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>;

    // Already in the standard format (from error handler)
    if (typeof obj.code === 'string' && typeof obj.message === 'string') {
      return {
        code: obj.code,
        message: obj.message,
        ...(obj.details !== undefined ? { details: obj.details } : {}),
      };
    }

    // Inline route error format: { error: "message", details?: ... }
    if (typeof obj.error === 'string') {
      return {
        code: typeof obj.code === 'string' ? obj.code : 'ERROR',
        message: obj.error,
        ...(obj.details !== undefined ? { details: obj.details } : {}),
      };
    }
  }

  // Fallback
  return {
    code: 'UNKNOWN_ERROR',
    message: typeof data === 'string' ? data : 'An error occurred',
  };
}

/**
 * Middleware that intercepts `res.json()` to wrap responses in the
 * standard API envelope. Should only be applied to API routes.
 */
export function responseEnvelopeMiddleware(_req: Request, res: Response, next: NextFunction): void {
  // Store the original res.json so we can call it after wrapping
  const originalJson = res.json.bind(res);

  // Override res.json
  res.json = function envelopedJson(data?: unknown): Response {
    const now = new Date();
    const offsetMinutes = now.getTimezoneOffset(); // positive = west of UTC
    const offsetHours = -offsetMinutes / 60; // flip sign: CST = -6
    const sign = offsetHours >= 0 ? '+' : '-';
    const absH = String(Math.floor(Math.abs(offsetHours))).padStart(2, '0');
    const absM = String(Math.abs(offsetMinutes) % 60).padStart(2, '0');

    const meta: EnvelopeMeta = {
      timestamp: now.toISOString(),
      timezone: `UTC${sign}${absH}:${absM}`,
      utcOffset: offsetHours,
    };

    // Include requestId if available (set by request-id middleware)
    const requestId: string | undefined = res.locals.requestId;
    if (requestId) {
      meta.requestId = requestId;
    }

    // Include pagination metadata if set by sendPaginated()
    const pagination: PaginationMeta | undefined = res.locals.pagination;
    if (pagination) {
      meta.pagination = pagination;
    }
    if (res.locals.taskIdentityDiagnostics) {
      meta.taskIdentityDiagnostics = res.locals.taskIdentityDiagnostics;
    }

    const statusCode = res.statusCode;

    if (statusCode < 400) {
      // Success envelope
      const envelope: SuccessEnvelope = {
        success: true,
        data: data ?? null,
        meta,
      };
      return originalJson(envelope);
    } else {
      // Error envelope — normalize the error body
      const envelope: ErrorEnvelope = {
        success: false,
        error: normalizeErrorBody(data),
        meta,
      };
      return originalJson(envelope);
    }
  };

  next();
}

/**
 * Helper to send a paginated response with proper envelope metadata.
 *
 * Sets pagination info on res.locals so the envelope middleware
 * can include it in the `meta` field. Then sends the items as `data`.
 *
 * Usage:
 *   sendPaginated(res, items, { page: 1, limit: 50, total: 120 });
 */
export function sendPaginated<T>(
  res: Response,
  items: T[],
  opts: { page: number; limit: number; total: number }
): void {
  const totalPages = Math.ceil(opts.total / opts.limit);

  const pagination: PaginationMeta = {
    page: opts.page,
    limit: opts.limit,
    total: opts.total,
    totalPages,
  };

  // Store on res.locals so the envelope middleware picks it up
  res.locals.pagination = pagination;
  res.json(items);
}
