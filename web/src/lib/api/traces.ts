import type { AgentRunTrace } from '@veritas-kanban/shared';
import { API_BASE, apiFetch } from './helpers';

export interface TraceStatus {
  enabled: boolean;
}

export const tracesApi = {
  status: async (): Promise<TraceStatus> => {
    return apiFetch<TraceStatus>(`${API_BASE}/traces/status`);
  },

  get: async (attemptId: string): Promise<AgentRunTrace> => {
    return apiFetch<AgentRunTrace>(`${API_BASE}/traces/${encodeURIComponent(attemptId)}`);
  },

  listForTask: async (taskId: string): Promise<AgentRunTrace[]> => {
    return apiFetch<AgentRunTrace[]>(`${API_BASE}/traces/task/${encodeURIComponent(taskId)}`);
  },
};
