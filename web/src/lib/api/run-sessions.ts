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
import { API_BASE, handleResponse } from './helpers';

function queryFromFilters(filters: RunSessionShareListFilters): string {
  const params = new URLSearchParams();
  if (filters.taskId) params.set('taskId', filters.taskId);
  if (filters.status) params.set('status', filters.status);
  return params.toString();
}

export const runSessionsApi = {
  list: async (filters: RunSessionShareListFilters = {}): Promise<RunSessionShare[]> => {
    const query = queryFromFilters(filters);
    const response = await fetch(`${API_BASE}/run-sessions${query ? `?${query}` : ''}`, {
      credentials: 'include',
    });
    return handleResponse<RunSessionShare[]>(response);
  },

  create: async (input: CreateRunSessionShareInput): Promise<RunSessionShare> => {
    const response = await fetch(`${API_BASE}/run-sessions`, {
      credentials: 'include',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    return handleResponse<RunSessionShare>(response);
  },

  get: async (shareId: string): Promise<RunSessionShare> => {
    const response = await fetch(`${API_BASE}/run-sessions/${encodeURIComponent(shareId)}`, {
      credentials: 'include',
    });
    return handleResponse<RunSessionShare>(response);
  },

  events: async (shareId: string): Promise<RunSessionEvent[]> => {
    const response = await fetch(`${API_BASE}/run-sessions/${encodeURIComponent(shareId)}/events`, {
      credentials: 'include',
    });
    return handleResponse<RunSessionEvent[]>(response);
  },

  update: async (shareId: string, input: UpdateRunSessionShareInput): Promise<RunSessionShare> => {
    const response = await fetch(`${API_BASE}/run-sessions/${encodeURIComponent(shareId)}`, {
      credentials: 'include',
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    return handleResponse<RunSessionShare>(response);
  },

  revoke: async (shareId: string, reason?: string): Promise<RunSessionShare> => {
    const response = await fetch(`${API_BASE}/run-sessions/${encodeURIComponent(shareId)}/revoke`, {
      credentials: 'include',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
    });
    return handleResponse<RunSessionShare>(response);
  },

  sendMessage: async (
    shareId: string,
    input: SendRunSessionMessageInput
  ): Promise<RunSessionEvent> => {
    const response = await fetch(
      `${API_BASE}/run-sessions/${encodeURIComponent(shareId)}/messages`,
      {
        credentials: 'include',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      }
    );
    return handleResponse<RunSessionEvent>(response);
  },

  respondToApproval: async (
    shareId: string,
    input: RunSessionApprovalResponseInput
  ): Promise<RunSessionEvent> => {
    const response = await fetch(
      `${API_BASE}/run-sessions/${encodeURIComponent(shareId)}/approvals`,
      {
        credentials: 'include',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      }
    );
    return handleResponse<RunSessionEvent>(response);
  },

  fork: async (
    shareId: string,
    input: ForkRunSessionInput
  ): Promise<{ fork: RunSessionFork; task: Task }> => {
    const response = await fetch(`${API_BASE}/run-sessions/${encodeURIComponent(shareId)}/fork`, {
      credentials: 'include',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    return handleResponse<{ fork: RunSessionFork; task: Task }>(response);
  },
};
