import type { AgentRunTrace } from '@veritas-kanban/shared';
import { API_BASE, handleResponse } from './helpers';

export interface TraceStatus {
  enabled: boolean;
}

export const tracesApi = {
  status: async (): Promise<TraceStatus> => {
    const response = await fetch(`${API_BASE}/traces/status`, {
      credentials: 'include',
    });
    return handleResponse<TraceStatus>(response);
  },

  get: async (attemptId: string): Promise<AgentRunTrace> => {
    const response = await fetch(`${API_BASE}/traces/${encodeURIComponent(attemptId)}`, {
      credentials: 'include',
    });
    return handleResponse<AgentRunTrace>(response);
  },

  listForTask: async (taskId: string): Promise<AgentRunTrace[]> => {
    const response = await fetch(`${API_BASE}/traces/task/${encodeURIComponent(taskId)}`, {
      credentials: 'include',
    });
    return handleResponse<AgentRunTrace[]>(response);
  },
};
