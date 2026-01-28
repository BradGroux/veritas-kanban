/**
 * Agent, worktree, and preview API endpoints.
 */
import type { AgentType } from '@veritas-kanban/shared';
import { API_BASE, handleResponse } from './helpers';

export const worktreeApi = {
  create: async (taskId: string): Promise<WorktreeInfo> => {
    const response = await fetch(`${API_BASE}/tasks/${taskId}/worktree`, {
      method: 'POST',
    });
    return handleResponse<WorktreeInfo>(response);
  },

  status: async (taskId: string): Promise<WorktreeInfo> => {
    const response = await fetch(`${API_BASE}/tasks/${taskId}/worktree`);
    return handleResponse<WorktreeInfo>(response);
  },

  delete: async (taskId: string, force: boolean = false): Promise<void> => {
    const response = await fetch(`${API_BASE}/tasks/${taskId}/worktree?force=${force}`, {
      method: 'DELETE',
    });
    return handleResponse<void>(response);
  },

  rebase: async (taskId: string): Promise<WorktreeInfo> => {
    const response = await fetch(`${API_BASE}/tasks/${taskId}/worktree/rebase`, {
      method: 'POST',
    });
    return handleResponse<WorktreeInfo>(response);
  },

  merge: async (taskId: string): Promise<void> => {
    const response = await fetch(`${API_BASE}/tasks/${taskId}/worktree/merge`, {
      method: 'POST',
    });
    return handleResponse<void>(response);
  },

  getOpenCommand: async (taskId: string): Promise<{ command: string }> => {
    const response = await fetch(`${API_BASE}/tasks/${taskId}/worktree/open`);
    return handleResponse<{ command: string }>(response);
  },
};

export const agentApi = {
  // Global agent status (not per-task)
  globalStatus: async (): Promise<GlobalAgentStatus> => {
    const response = await fetch(`${API_BASE}/agent/status`);
    return handleResponse<GlobalAgentStatus>(response);
  },

  start: async (taskId: string, agent?: AgentType): Promise<AgentStatus> => {
    const response = await fetch(`${API_BASE}/agents/${taskId}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent }),
    });
    return handleResponse<AgentStatus>(response);
  },

  sendMessage: async (taskId: string, message: string): Promise<void> => {
    const response = await fetch(`${API_BASE}/agents/${taskId}/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    });
    return handleResponse<void>(response);
  },

  stop: async (taskId: string): Promise<void> => {
    const response = await fetch(`${API_BASE}/agents/${taskId}/stop`, {
      method: 'POST',
    });
    return handleResponse<void>(response);
  },

  status: async (taskId: string): Promise<AgentStatusResponse> => {
    const response = await fetch(`${API_BASE}/agents/${taskId}/status`);
    return handleResponse<AgentStatusResponse>(response);
  },

  listAttempts: async (taskId: string): Promise<string[]> => {
    const response = await fetch(`${API_BASE}/agents/${taskId}/attempts`);
    return handleResponse<string[]>(response);
  },

  getLog: async (taskId: string, attemptId: string): Promise<string> => {
    const response = await fetch(`${API_BASE}/agents/${taskId}/attempts/${attemptId}/log`);
    if (!response.ok) {
      throw new Error('Failed to fetch log');
    }
    return response.text();
  },
};

export const previewApi = {
  getStatus: async (taskId: string): Promise<PreviewServer | { status: 'stopped' }> => {
    const response = await fetch(`${API_BASE}/preview/${taskId}`);
    return handleResponse<PreviewServer | { status: 'stopped' }>(response);
  },

  getOutput: async (taskId: string, lines: number = 50): Promise<{ output: string[] }> => {
    const response = await fetch(`${API_BASE}/preview/${taskId}/output?lines=${lines}`);
    return handleResponse<{ output: string[] }>(response);
  },

  start: async (taskId: string): Promise<PreviewServer> => {
    const response = await fetch(`${API_BASE}/preview/${taskId}/start`, {
      method: 'POST',
    });
    return handleResponse<PreviewServer>(response);
  },

  stop: async (taskId: string): Promise<void> => {
    const response = await fetch(`${API_BASE}/preview/${taskId}/stop`, {
      method: 'POST',
    });
    return handleResponse<void>(response);
  },
};

// Types
export interface AgentStatus {
  taskId: string;
  attemptId: string;
  agent: AgentType;
  status: string;
  pid?: number;
  startedAt?: string;
}

export interface AgentStatusResponse {
  running: boolean;
  taskId?: string;
  attemptId?: string;
  agent?: AgentType;
  status?: string;
  pid?: number;
}

export interface AgentOutput {
  type: 'stdout' | 'stderr' | 'stdin' | 'system';
  content: string;
  timestamp: string;
}

// Global agent status (not per-task)
export interface GlobalAgentStatus {
  status: 'idle' | 'working' | 'thinking' | 'sub-agent' | 'error';
  subAgentCount: number;
  activeTask?: string;
  activeTaskTitle?: string;
  lastUpdated: string;
  error?: string;
}

export interface WorktreeInfo {
  path: string;
  branch: string;
  baseBranch: string;
  aheadBehind: {
    ahead: number;
    behind: number;
  };
  hasChanges: boolean;
  changedFiles: number;
}

export interface PreviewServer {
  taskId: string;
  repoName: string;
  pid: number;
  port: number;
  url: string;
  status: 'starting' | 'running' | 'stopped' | 'error';
  startedAt: string;
  output: string[];
  error?: string;
}
