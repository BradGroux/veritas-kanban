import type { Request, Response, NextFunction } from 'express';

/**
 * Cache-Control middleware for HTTP responses.
 *
 * Provides named cache profiles that map to Cache-Control header values,
 * plus a route-pattern middleware that applies the correct profile based on
 * the request URL.  This keeps caching policy centralised and easy to audit.
 *
 * Profiles:
 *   static-immutable  – Vite hashed assets (1 year, immutable)
 *   static-html       – SPA shell (must revalidate every request)
 *   task-list          – GET /api/tasks (private, revalidate)
 *   task-detail        – GET /api/tasks/:id (private, revalidate)
 *   config             – GET /api/config (always revalidate)
 *   no-store           – Mutating responses / sensitive data
 */

export type CacheProfile =
  'static-immutable' | 'static-html' | 'task-list' | 'task-detail' | 'config' | 'no-store';

const CACHE_PROFILES: Record<CacheProfile, string> = {
  'static-immutable': 'public, max-age=31536000, immutable',
  'static-html': 'no-cache',
  // Subresource mutations (such as /tasks/:id/move) do not invalidate the
  // browser's cached parent URL. Revalidate mutable task data using its ETag.
  'task-list': 'private, no-cache',
  'task-detail': 'private, no-cache',
  config: 'private, no-cache',
  'no-store': 'no-store',
};

/**
 * Returns middleware that sets Cache-Control for a given profile.
 * Only applies to GET/HEAD requests; mutating methods get no-store.
 */
export function cacheControl(profile: CacheProfile) {
  const headerValue = CACHE_PROFILES[profile];

  return (_req: Request, res: Response, next: NextFunction): void => {
    if (_req.method === 'GET' || _req.method === 'HEAD') {
      res.set('Cache-Control', headerValue);
    } else {
      res.set('Cache-Control', 'no-store');
    }
    next();
  };
}

/**
 * Route-pattern middleware applied once at the app level.
 * Matches the request path against known API patterns and sets the
 * appropriate Cache-Control header for GET/HEAD requests.
 *
 * Non-GET/HEAD requests always receive `no-store`.
 */
export function apiCacheHeaders(req: Request, res: Response, next: NextFunction): void {
  // Only cache GET/HEAD; everything else is no-store
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.set('Cache-Control', 'no-store');
    return next();
  }

  const path = req.path; // path relative to the mount point

  // --- Task routes ---
  // /api/tasks exactly → task list
  if (path === '/tasks' || path === '/tasks/') {
    res.set('Cache-Control', CACHE_PROFILES['task-list']);
    return next();
  }

  // /api/tasks/:id (single segment after /tasks/) → task detail
  // Matches /tasks/task_123 but NOT /tasks/task_123/comments
  if (/^\/tasks\/[^/]+\/?$/.test(path)) {
    res.set('Cache-Control', CACHE_PROFILES['task-detail']);
    return next();
  }

  // --- Config routes ---
  if (path.startsWith('/config')) {
    res.set('Cache-Control', CACHE_PROFILES['config']);
    return next();
  }

  // --- Settings routes ---
  if (path.startsWith('/settings')) {
    res.set('Cache-Control', CACHE_PROFILES['config']);
    return next();
  }

  // --- Default for all other GET API routes: short private cache ---
  res.set('Cache-Control', 'private, no-cache');
  next();
}

/**
 * Sets a Last-Modified header from an ISO date string.
 * Call from route handlers: `setLastModified(res, task.updated)`.
 */
export function setLastModified(res: Response, isoDate: string | undefined): void {
  if (isoDate) {
    res.set('Last-Modified', new Date(isoDate).toUTCString());
  }
}
