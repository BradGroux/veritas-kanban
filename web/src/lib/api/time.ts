/**
 * Time tracking and status history API endpoints.
 */
import type { Task } from '@veritas-kanban/shared';
import { API_BASE, apiFetch } from './helpers';

export const timeApi = {
  getSummary: async (): Promise<TimeSummary> => {
    return apiFetch<TimeSummary>(`${API_BASE}/tasks/time/summary`);
  },

  start: async (taskId: string): Promise<Task> => {
    return apiFetch<Task>(`${API_BASE}/tasks/${taskId}/time/start`, {
      method: 'POST',
    });
  },

  stop: async (taskId: string): Promise<Task> => {
    return apiFetch<Task>(`${API_BASE}/tasks/${taskId}/time/stop`, {
      method: 'POST',
    });
  },

  addEntry: async (taskId: string, duration: number, description?: string): Promise<Task> => {
    return apiFetch<Task>(`${API_BASE}/tasks/${taskId}/time/entry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ duration, description }),
    });
  },

  deleteEntry: async (taskId: string, entryId: string): Promise<Task> => {
    return apiFetch<Task>(`${API_BASE}/tasks/${taskId}/time/entry/${entryId}`, {
      method: 'DELETE',
    });
  },
};

export const statusHistoryApi = {
  list: async (limit: number = 100, offset: number = 0): Promise<StatusHistoryEntry[]> => {
    return apiFetch<StatusHistoryEntry[]>(
      `${API_BASE}/status-history?limit=${limit}&offset=${offset}`
    );
  },

  getDailySummary: async (date?: string): Promise<DailySummary> => {
    const url = date
      ? `${API_BASE}/status-history/summary/daily?date=${date}`
      : `${API_BASE}/status-history/summary/daily`;
    return apiFetch<DailySummary>(url);
  },

  getWeeklySummary: async (): Promise<DailySummary[]> => {
    return apiFetch<DailySummary[]>(`${API_BASE}/status-history/summary/weekly`);
  },

  getByDateRange: async (startDate: string, endDate: string): Promise<StatusHistoryEntry[]> => {
    return apiFetch<StatusHistoryEntry[]>(
      `${API_BASE}/status-history/range?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`
    );
  },

  clear: async (): Promise<void> => {
    return apiFetch<void>(`${API_BASE}/status-history`, {
      method: 'DELETE',
    });
  },
};

// Time types
export interface TimeSummary {
  byProject: { project: string; totalSeconds: number; taskCount: number }[];
  total: number;
}

// Status history types
export type AgentStatusState = 'idle' | 'working' | 'thinking' | 'sub-agent' | 'error';

export interface StatusHistoryEntry {
  id: string;
  timestamp: string;
  previousStatus: AgentStatusState;
  newStatus: AgentStatusState;
  taskId?: string;
  taskTitle?: string;
  subAgentCount?: number;
  durationMs?: number;
}

export interface StatusPeriod {
  status: AgentStatusState;
  startTime: string;
  endTime: string;
  durationMs: number;
  taskId?: string;
  taskTitle?: string;
}

export interface DailySummary {
  date: string;
  activeMs: number;
  idleMs: number;
  errorMs: number;
  transitions: number;
  periods: StatusPeriod[];
}
