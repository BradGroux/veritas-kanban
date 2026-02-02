/**
 * Agent, worktree, and preview API endpoints.
 */
import type { AgentType, AgentRoutingConfig, RoutingResult } from '@veritas-kanban/shared';
import { API_BASE, handleResponse } from './helpers';

export const worktreeApi = {
  create: async (taskId: string): Promise<WorktreeInfo> => {
    const response = await fetch(`${API_BASE}/tasks/${taskId}/worktree`, {
      credentials: 'include',
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
      credentials: 'include',
      method: 'DELETE',
    });
    return handleResponse<void>(response);
  },

  rebase: async (taskId: string): Promise<WorktreeInfo> => {
    const response = await fetch(`${API_BASE}/tasks/${taskId}/worktree/rebase`, {
      credentials: 'include',
      method: 'POST',
    });
    return handleResponse<WorktreeInfo>(response);
  },

  merge: async (taskId: string): Promise<void> => {
    const response = await fetch(`${API_BASE}/tasks/${taskId}/worktree/merge`, {
      credentials: 'include',
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
      credentials: 'include',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent }),
    });
    return handleResponse<AgentStatus>(response);
  },

  sendMessage: async (taskId: string, message: string): Promise<void> => {
    const response = await fetch(`${API_BASE}/agents/${taskId}/message`, {
      credentials: 'include',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    });
    return handleResponse<void>(response);
  },

  stop: async (taskId: string): Promise<void> => {
    const response = await fetch(`${API_BASE}/agents/${taskId}/stop`, {
      credentials: 'include',
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

export const routingApi = {
  /** Get current routing configuration */
  getConfig: async (): Promise<AgentRoutingConfig> => {
    const response = await fetch(`${API_BASE}/agents/routing`);
    return handleResponse<AgentRoutingConfig>(response);
  },

  /** Update routing configuration */
  updateConfig: async (config: AgentRoutingConfig): Promise<AgentRoutingConfig> => {
    const response = await fetch(`${API_BASE}/agents/routing`, {
      credentials: 'include',
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    });
    return handleResponse<AgentRoutingConfig>(response);
  },

  /** Resolve the best agent for a task */
  resolveForTask: async (taskId: string): Promise<RoutingResult> => {
    const response = await fetch(`${API_BASE}/agents/route`, {
      credentials: 'include',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId }),
    });
    return handleResponse<RoutingResult>(response);
  },

  /** Resolve the best agent for metadata (ad-hoc, e.g. from create dialog) */
  resolveForMetadata: async (metadata: {
    type?: string;
    priority?: string;
    project?: string;
    subtaskCount?: number;
  }): Promise<RoutingResult> => {
    const response = await fetch(`${API_BASE}/agents/route`, {
      credentials: 'include',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(metadata),
    });
    return handleResponse<RoutingResult>(response);
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
      credentials: 'include',
      method: 'POST',
    });
    return handleResponse<PreviewServer>(response);
  },

  stop: async (taskId: string): Promise<void> => {
    const response = await fetch(`${API_BASE}/preview/${taskId}/stop`, {
      credentials: 'include',
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

export interface ActiveAgentInfo {
  agent: string;
  status: 'idle' | 'working' | 'thinking' | 'sub-agent' | 'error';
  taskId?: string;
  taskTitle?: string;
  startedAt: string;
}

// Global agent status (not per-task)
export interface GlobalAgentStatus {
  status: 'idle' | 'working' | 'thinking' | 'sub-agent' | 'error';
  subAgentCount: number;
  activeTask?: string;
  activeTaskTitle?: string;
  activeAgents: ActiveAgentInfo[];
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
