import type {
  QueueMonitorExplainResult,
  QueueMonitorHealthResult,
  QueueMonitorListResponse,
  QueueMonitorRunResult,
  QueueMonitorSnapshot,
  QueueMonitorUpdateInput,
} from '@veritas-kanban/shared';
import { API_BASE, apiFetch } from './helpers';

function monitorPath(monitorId: string, action?: string): string {
  const encoded = encodeURIComponent(monitorId);
  return `${API_BASE}/queue-monitors/${encoded}${action ? `/${action}` : ''}`;
}

export const queueMonitorsApi = {
  list: () => apiFetch<QueueMonitorListResponse>(`${API_BASE}/queue-monitors`),

  get: (monitorId: string) => apiFetch<QueueMonitorSnapshot>(monitorPath(monitorId)),

  update: (monitorId: string, input: QueueMonitorUpdateInput) =>
    apiFetch<QueueMonitorSnapshot>(monitorPath(monitorId), {
      method: 'PUT',
      body: JSON.stringify(input),
    }),

  health: (monitorId: string) =>
    apiFetch<QueueMonitorHealthResult>(monitorPath(monitorId, 'health')),

  explain: (monitorId: string) =>
    apiFetch<QueueMonitorExplainResult>(monitorPath(monitorId, 'explain')),

  run: (monitorId: string) =>
    apiFetch<QueueMonitorRunResult>(monitorPath(monitorId, 'run'), {
      method: 'POST',
    }),

  pause: (monitorId: string) =>
    apiFetch<QueueMonitorRunResult>(monitorPath(monitorId, 'pause'), {
      method: 'POST',
    }),

  resume: (monitorId: string) =>
    apiFetch<QueueMonitorRunResult>(monitorPath(monitorId, 'resume'), {
      method: 'POST',
    }),
};
