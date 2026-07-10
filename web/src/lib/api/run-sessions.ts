import type {
  CreateRunSessionShareInput,
  ForkRunSessionInput,
  RunSessionApprovalResponseInput,
  RunSessionEvent,
  RunSessionFork,
  RunSessionShare,
  RunSessionShareListFilters,
  SendRunSessionMessageInput,
  Task,
  UpdateRunSessionShareInput,
} from '@veritas-kanban/shared';
import { API_BASE, apiFetch } from './helpers';

function queryFromFilters(filters: RunSessionShareListFilters): string {
  const params = new URLSearchParams();
  if (filters.taskId) params.set('taskId', filters.taskId);
  if (filters.status) params.set('status', filters.status);
  return params.toString();
}

export const runSessionsApi = {
  list: async (filters: RunSessionShareListFilters = {}): Promise<RunSessionShare[]> => {
    const query = queryFromFilters(filters);
    return apiFetch<RunSessionShare[]>(`${API_BASE}/run-sessions${query ? `?${query}` : ''}`);
  },

  create: async (input: CreateRunSessionShareInput): Promise<RunSessionShare> => {
    return apiFetch<RunSessionShare>(`${API_BASE}/run-sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  },

  get: async (shareId: string): Promise<RunSessionShare> => {
    return apiFetch<RunSessionShare>(`${API_BASE}/run-sessions/${encodeURIComponent(shareId)}`);
  },

  events: async (shareId: string): Promise<RunSessionEvent[]> => {
    return apiFetch<RunSessionEvent[]>(
      `${API_BASE}/run-sessions/${encodeURIComponent(shareId)}/events`
    );
  },

  update: async (shareId: string, input: UpdateRunSessionShareInput): Promise<RunSessionShare> => {
    return apiFetch<RunSessionShare>(`${API_BASE}/run-sessions/${encodeURIComponent(shareId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  },

  revoke: async (shareId: string, reason?: string): Promise<RunSessionShare> => {
    return apiFetch<RunSessionShare>(
      `${API_BASE}/run-sessions/${encodeURIComponent(shareId)}/revoke`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      }
    );
  },

  sendMessage: async (
    shareId: string,
    input: SendRunSessionMessageInput
  ): Promise<RunSessionEvent> => {
    return apiFetch<RunSessionEvent>(
      `${API_BASE}/run-sessions/${encodeURIComponent(shareId)}/messages`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      }
    );
  },

  respondToApproval: async (
    shareId: string,
    input: RunSessionApprovalResponseInput
  ): Promise<RunSessionEvent> => {
    return apiFetch<RunSessionEvent>(
      `${API_BASE}/run-sessions/${encodeURIComponent(shareId)}/approvals`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      }
    );
  },

  fork: async (
    shareId: string,
    input: ForkRunSessionInput
  ): Promise<{ fork: RunSessionFork; task: Task }> => {
    return apiFetch<{ fork: RunSessionFork; task: Task }>(
      `${API_BASE}/run-sessions/${encodeURIComponent(shareId)}/fork`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      }
    );
  },
};
