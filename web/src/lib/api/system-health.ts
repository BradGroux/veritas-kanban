/**
 * System Health API client
 *
 * Provides a typed fetch wrapper for the `GET /api/v1/system/health` endpoint.
 * Used by the `useSystemHealth` React Query hook.
 */
import { apiFetch } from './helpers';
import type { HealthStatus } from '@veritas-kanban/shared';

export const systemHealthApi = {
  /**
   * Fetch the current aggregated system health status.
   *
   * @param signal - Optional AbortSignal for request cancellation (passed by React Query)
   */
  getStatus: (signal?: AbortSignal): Promise<HealthStatus> =>
    apiFetch<HealthStatus>('/api/v1/system/health', { signal }),
};
