import type { Task, CreateTaskInput, UpdateTaskInput, AppConfig, RepoConfig, AgentConfig, AgentType } from '@veritas-kanban/shared';

const API_BASE = '/api';

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || `HTTP ${response.status}`);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return response.json();
}

export const api = {
  tasks: {
    list: async (): Promise<Task[]> => {
      const response = await fetch(`${API_BASE}/tasks`);
      return handleResponse<Task[]>(response);
    },

    get: async (id: string): Promise<Task> => {
      const response = await fetch(`${API_BASE}/tasks/${id}`);
      return handleResponse<Task>(response);
    },

    create: async (input: CreateTaskInput): Promise<Task> => {
      const response = await fetch(`${API_BASE}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      return handleResponse<Task>(response);
    },

    update: async (id: string, input: UpdateTaskInput): Promise<Task> => {
      const response = await fetch(`${API_BASE}/tasks/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      return handleResponse<Task>(response);
    },

    delete: async (id: string): Promise<void> => {
      const response = await fetch(`${API_BASE}/tasks/${id}`, {
        method: 'DELETE',
      });
      return handleResponse<void>(response);
    },

    archive: async (id: string): Promise<void> => {
      const response = await fetch(`${API_BASE}/tasks/${id}/archive`, {
        method: 'POST',
      });
      return handleResponse<void>(response);
    },
  },

  config: {
    get: async (): Promise<AppConfig> => {
      const response = await fetch(`${API_BASE}/config`);
      return handleResponse<AppConfig>(response);
    },

    repos: {
      list: async (): Promise<RepoConfig[]> => {
        const response = await fetch(`${API_BASE}/config/repos`);
        return handleResponse<RepoConfig[]>(response);
      },

      add: async (repo: RepoConfig): Promise<AppConfig> => {
        const response = await fetch(`${API_BASE}/config/repos`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(repo),
        });
        return handleResponse<AppConfig>(response);
      },

      update: async (name: string, updates: Partial<RepoConfig>): Promise<AppConfig> => {
        const response = await fetch(`${API_BASE}/config/repos/${encodeURIComponent(name)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updates),
        });
        return handleResponse<AppConfig>(response);
      },

      remove: async (name: string): Promise<AppConfig> => {
        const response = await fetch(`${API_BASE}/config/repos/${encodeURIComponent(name)}`, {
          method: 'DELETE',
        });
        return handleResponse<AppConfig>(response);
      },

      validate: async (path: string): Promise<{ valid: boolean; branches: string[] }> => {
        const response = await fetch(`${API_BASE}/config/repos/validate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path }),
        });
        return handleResponse<{ valid: boolean; branches: string[] }>(response);
      },

      branches: async (name: string): Promise<string[]> => {
        const response = await fetch(`${API_BASE}/config/repos/${encodeURIComponent(name)}/branches`);
        return handleResponse<string[]>(response);
      },
    },

    agents: {
      update: async (agents: AgentConfig[]): Promise<AppConfig> => {
        const response = await fetch(`${API_BASE}/config/agents`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(agents),
        });
        return handleResponse<AppConfig>(response);
      },

      setDefault: async (agent: AgentType): Promise<AppConfig> => {
        const response = await fetch(`${API_BASE}/config/default-agent`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ agent }),
        });
        return handleResponse<AppConfig>(response);
      },
    },
  },

  worktree: {
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
  },

  agent: {
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
  },
};

// Types for agent
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

// Types for worktree
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
