/**
 * Time tracking and status history API endpoints.
 */
import type { Task } from '@veritas-kanban/shared';
import { API_BASE, handleResponse } from './helpers';

export const timeApi = {
  getSummary: async (): Promise<TimeSummary> => {
    const response = await fetch(`${API_BASE}/tasks/time/summary`);
    return handleResponse<TimeSummary>(response);
  },

  start: async (taskId: string): Promise<Task> => {
    const response = await fetch(`${API_BASE}/tasks/${taskId}/time/start`, {
      method: 'POST',
    });
    return handleResponse<Task>(response);
  },

  stop: async (taskId: string): Promise<Task> => {
    const response = await fetch(`${API_BASE}/tasks/${taskId}/time/stop`, {
      method: 'POST',
    });
    return handleResponse<Task>(response);
  },

  addEntry: async (taskId: string, duration: number, description?: string): Promise<Task> => {
    const response = await fetch(`${API_BASE}/tasks/${taskId}/time/entry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ duration, description }),
    });
    return handleResponse<Task>(response);
  },

  deleteEntry: async (taskId: string, entryId: string): Promise<Task> => {
    const response = await fetch(`${API_BASE}/tasks/${taskId}/time/entry/${entryId}`, {
      method: 'DELETE',
    });
    return handleResponse<Task>(response);
  },
};

export const statusHistoryApi = {
  list: async (limit: number = 100, offset: number = 0): Promise<StatusHistoryEntry[]> => {
    const response = await fetch(`${API_BASE}/status-history?limit=${limit}&offset=${offset}`);
    return handleResponse<StatusHistoryEntry[]>(response);
  },

  getDailySummary: async (date?: string): Promise<DailySummary> => {
    const url = date
      ? `${API_BASE}/status-history/summary/daily?date=${date}`
      : `${API_BASE}/status-history/summary/daily`;
    const response = await fetch(url);
    return handleResponse<DailySummary>(response);
  },

  getWeeklySummary: async (): Promise<DailySummary[]> => {
    const response = await fetch(`${API_BASE}/status-history/summary/weekly`);
    return handleResponse<DailySummary[]>(response);
  },

  getByDateRange: async (startDate: string, endDate: string): Promise<StatusHistoryEntry[]> => {
    const response = await fetch(
      `${API_BASE}/status-history/range?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`
    );
    return handleResponse<StatusHistoryEntry[]>(response);
  },

  clear: async (): Promise<void> => {
    const response = await fetch(`${API_BASE}/status-history`, {
      method: 'DELETE',
    });
    return handleResponse<void>(response);
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
