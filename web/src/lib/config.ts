/**
 * Shared configuration for the application.
 *
 * When deployed under a sub-path (e.g., /kanban/), Vite sets
 * import.meta.env.BASE_URL to that path. We derive API_BASE from it
 * so all fetch calls hit the correct prefix automatically.
 */
const basePath = (import.meta.env.BASE_URL || '/').replace(/\/$/, '');

export function normalizeApiBase(rawBase: string): string {
  const trimmed = rawBase.replace(/\/$/, '');
  if (/^https?:\/\/[^/]+$/i.test(trimmed)) {
    return `${trimmed}/api`;
  }
  return trimmed;
}

export const API_BASE = normalizeApiBase(import.meta.env.VITE_API_URL || `${basePath}/api`);
