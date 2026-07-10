/**
 * Agent, worktree, and preview API endpoints.
 */
import type {
  AgentHostCompatibilityResponse,
  AgentHostHealthResponse,
  AgentHostPreviewRequest,
  AgentType,
  AgentRoutingConfig,
  RoutingResult,
  AgentBudgetPolicy,
} from '@veritas-kanban/shared';
import { API_BASE, apiFetch } from './helpers';

export interface StartAgentRequest {
  agent?: AgentType;
  profileId?: string;
  overrideReason?: string;
  sandboxPresetId?: string;
  budget?: AgentBudgetPolicy;
}

export const worktreeApi = {
  create: async (taskId: string): Promise<WorktreeInfo> => {
    return apiFetch<WorktreeInfo>(`${API_BASE}/tasks/${taskId}/worktree`, {
      method: 'POST',
    });
  },

  status: async (taskId: string): Promise<WorktreeInfo> => {
    return apiFetch<WorktreeInfo>(`${API_BASE}/tasks/${taskId}/worktree`);
  },

  delete: async (taskId: string, force: boolean = false): Promise<void> => {
    return apiFetch<void>(`${API_BASE}/tasks/${taskId}/worktree?force=${force}`, {
      method: 'DELETE',
    });
  },

  rebase: async (taskId: string): Promise<WorktreeInfo> => {
    return apiFetch<WorktreeInfo>(`${API_BASE}/tasks/${taskId}/worktree/rebase`, {
      method: 'POST',
    });
  },

  merge: async (taskId: string): Promise<void> => {
    return apiFetch<void>(`${API_BASE}/tasks/${taskId}/worktree/merge`, {
      method: 'POST',
    });
  },

  getOpenCommand: async (taskId: string): Promise<{ command: string }> => {
    return apiFetch<{ command: string }>(`${API_BASE}/tasks/${taskId}/worktree/open`);
  },
};

export const agentApi = {
  // Global agent status (not per-task)
  globalStatus: async (): Promise<GlobalAgentStatus> => {
    return apiFetch<GlobalAgentStatus>(`${API_BASE}/agent/status`);
  },

  start: async (
    taskId: string,
    agentOrRequest?: AgentType | StartAgentRequest
  ): Promise<AgentStatus> => {
    const body =
      typeof agentOrRequest === 'string' ? { agent: agentOrRequest } : (agentOrRequest ?? {});
    return apiFetch<AgentStatus>(`${API_BASE}/agents/${taskId}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  },

  sendMessage: async (taskId: string, message: string): Promise<void> => {
    return apiFetch<void>(`${API_BASE}/agents/${taskId}/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    });
  },

  stop: async (taskId: string): Promise<void> => {
    return apiFetch<void>(`${API_BASE}/agents/${taskId}/stop`, {
      method: 'POST',
    });
  },

  status: async (taskId: string): Promise<AgentStatusResponse> => {
    return apiFetch<AgentStatusResponse>(`${API_BASE}/agents/${taskId}/status`);
  },

  listAttempts: async (taskId: string): Promise<string[]> => {
    return apiFetch<string[]>(`${API_BASE}/agents/${taskId}/attempts`);
  },

  getLog: async (taskId: string, attemptId: string): Promise<string> => {
    // Log endpoint returns plain text, not a JSON envelope — keep raw fetch.
    const response = await fetch(`${API_BASE}/agents/${taskId}/attempts/${attemptId}/log`, {
      credentials: 'include',
    });
    if (!response.ok) {
      throw new Error('Failed to fetch log');
    }
    return response.text();
  },
};

// ─── Agent Registry API ──────────────────────────────────────────

export interface RegisteredAgent {
  id: string;
  name: string;
  model?: string;
  provider?: string;
  capabilities?: Array<{ name: string; description?: string }>;
  version?: string;
  status: 'online' | 'offline' | 'busy' | 'idle';
  currentTask?: string;
  currentTaskTitle?: string;
  lastHeartbeat?: string;
  registeredAt: string;
}

export interface RegistryStats {
  total: number;
  online: number;
  busy: number;
  idle: number;
  offline: number;
  capabilities: string[];
}

export const registryApi = {
  /** List all registered agents */
  list: async (filters?: { status?: string; capability?: string }): Promise<RegisteredAgent[]> => {
    const params = new URLSearchParams();
    if (filters?.status) params.set('status', filters.status);
    if (filters?.capability) params.set('capability', filters.capability);
    const qs = params.toString();
    return apiFetch<RegisteredAgent[]>(`${API_BASE}/agents/register${qs ? `?${qs}` : ''}`);
  },

  /** Get registry statistics */
  stats: async (): Promise<RegistryStats> => {
    return apiFetch<RegistryStats>(`${API_BASE}/agents/register/stats`);
  },

  /** Get a specific agent */
  get: async (id: string): Promise<RegisteredAgent> => {
    return apiFetch<RegisteredAgent>(`${API_BASE}/agents/register/${id}`);
  },
};

export const routingApi = {
  /** Get current routing configuration */
  getConfig: async (): Promise<AgentRoutingConfig> => {
    return apiFetch<AgentRoutingConfig>(`${API_BASE}/agents/routing`);
  },

  /** Update routing configuration */
  updateConfig: async (config: AgentRoutingConfig): Promise<AgentRoutingConfig> => {
    return apiFetch<AgentRoutingConfig>(`${API_BASE}/agents/routing`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    });
  },

  /** Resolve the best agent for a task */
  resolveForTask: async (taskId: string): Promise<RoutingResult> => {
    return apiFetch<RoutingResult>(`${API_BASE}/agents/route`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId }),
    });
  },

  /** Resolve the best agent for metadata (ad-hoc, e.g. from create dialog) */
  resolveForMetadata: async (metadata: {
    type?: string;
    priority?: string;
    project?: string;
    subtaskCount?: number;
  }): Promise<RoutingResult> => {
    return apiFetch<RoutingResult>(`${API_BASE}/agents/route`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(metadata),
    });
  },
};

export const agentHostApi = {
  getHealth: async (): Promise<AgentHostHealthResponse> => {
    return apiFetch<AgentHostHealthResponse>(`${API_BASE}/agents/hosts`);
  },

  preview: async (request: AgentHostPreviewRequest): Promise<AgentHostCompatibilityResponse> => {
    return apiFetch<AgentHostCompatibilityResponse>(`${API_BASE}/agents/hosts/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
  },
};

export const previewApi = {
  getStatus: async (taskId: string): Promise<PreviewServer | { status: 'stopped' }> => {
    return apiFetch<PreviewServer | { status: 'stopped' }>(`${API_BASE}/preview/${taskId}`);
  },

  getOutput: async (taskId: string, lines: number = 50): Promise<{ output: string[] }> => {
    return apiFetch<{ output: string[] }>(`${API_BASE}/preview/${taskId}/output?lines=${lines}`);
  },

  start: async (taskId: string): Promise<PreviewServer> => {
    return apiFetch<PreviewServer>(`${API_BASE}/preview/${taskId}/start`, {
      method: 'POST',
    });
  },

  stop: async (taskId: string): Promise<void> => {
    return apiFetch<void>(`${API_BASE}/preview/${taskId}/stop`, {
      method: 'POST',
    });
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
