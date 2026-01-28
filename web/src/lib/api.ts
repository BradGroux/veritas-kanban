import type { 
  Task, 
  CreateTaskInput, 
  UpdateTaskInput, 
  AppConfig, 
  RepoConfig, 
  AgentConfig, 
  AgentType,
  TaskTemplate,
  CreateTemplateInput,
  UpdateTemplateInput,
  TaskTypeConfig,
  SprintConfig,
  FeatureSettings,
} from '@veritas-kanban/shared';

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

    listArchived: async (): Promise<Task[]> => {
      const response = await fetch(`${API_BASE}/tasks/archived`);
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

    bulkArchive: async (sprint: string): Promise<{ archived: string[]; count: number }> => {
      const response = await fetch(`${API_BASE}/tasks/bulk-archive`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sprint }),
      });
      return handleResponse(response);
    },

    restore: async (id: string): Promise<Task> => {
      const response = await fetch(`${API_BASE}/tasks/${id}/restore`, {
        method: 'POST',
      });
      return handleResponse<Task>(response);
    },

    getArchiveSuggestions: async (): Promise<ArchiveSuggestion[]> => {
      const response = await fetch(`${API_BASE}/tasks/archive/suggestions`);
      return handleResponse<ArchiveSuggestion[]>(response);
    },

    archiveSprint: async (sprint: string): Promise<{ archived: number; taskIds: string[] }> => {
      const response = await fetch(`${API_BASE}/tasks/archive/sprint/${encodeURIComponent(sprint)}`, {
        method: 'POST',
      });
      return handleResponse<{ archived: number; taskIds: string[] }>(response);
    },

    addSubtask: async (taskId: string, title: string): Promise<Task> => {
      const response = await fetch(`${API_BASE}/tasks/${taskId}/subtasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title }),
      });
      return handleResponse<Task>(response);
    },

    updateSubtask: async (taskId: string, subtaskId: string, updates: { title?: string; completed?: boolean }): Promise<Task> => {
      const response = await fetch(`${API_BASE}/tasks/${taskId}/subtasks/${subtaskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      return handleResponse<Task>(response);
    },

    deleteSubtask: async (taskId: string, subtaskId: string): Promise<Task> => {
      const response = await fetch(`${API_BASE}/tasks/${taskId}/subtasks/${subtaskId}`, {
        method: 'DELETE',
      });
      return handleResponse<Task>(response);
    },

    addComment: async (taskId: string, author: string, text: string): Promise<Task> => {
      const response = await fetch(`${API_BASE}/tasks/${taskId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ author, text }),
      });
      return handleResponse<Task>(response);
    },

    editComment: async (taskId: string, commentId: string, text: string): Promise<Task> => {
      const response = await fetch(`${API_BASE}/tasks/${taskId}/comments/${commentId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      return handleResponse<Task>(response);
    },

    deleteComment: async (taskId: string, commentId: string): Promise<Task> => {
      const response = await fetch(`${API_BASE}/tasks/${taskId}/comments/${commentId}`, {
        method: 'DELETE',
      });
      return handleResponse<Task>(response);
    },

    getBlockingStatus: async (taskId: string): Promise<{
      isBlocked: boolean;
      blockers: Array<{ id: string; title: string; status: string }>;
      completedBlockers: Array<{ id: string; title: string }>;
    }> => {
      const response = await fetch(`${API_BASE}/tasks/${taskId}/blocking-status`);
      return handleResponse(response);
    },

    reorder: async (orderedIds: string[]): Promise<{ updated: number }> => {
      const response = await fetch(`${API_BASE}/tasks/reorder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderedIds }),
      });
      return handleResponse<{ updated: number }>(response);
    },

    applyTemplate: async (taskId: string, templateId: string, templateName: string, fieldsChanged: string[]): Promise<void> => {
      const response = await fetch(`${API_BASE}/tasks/${taskId}/apply-template`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templateId, templateName, fieldsChanged }),
      });
      return handleResponse<void>(response);
    },
  },

  settings: {
    getFeatures: async (): Promise<FeatureSettings> => {
      const response = await fetch(`${API_BASE}/settings/features`);
      return handleResponse<FeatureSettings>(response);
    },

    updateFeatures: async (patch: Partial<FeatureSettings>): Promise<FeatureSettings> => {
      const response = await fetch(`${API_BASE}/settings/features`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      return handleResponse<FeatureSettings>(response);
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

  diff: {
    getSummary: async (taskId: string): Promise<DiffSummary> => {
      const response = await fetch(`${API_BASE}/diff/${taskId}`);
      return handleResponse<DiffSummary>(response);
    },

    getFileDiff: async (taskId: string, filePath: string): Promise<FileDiff> => {
      const response = await fetch(`${API_BASE}/diff/${taskId}/file?path=${encodeURIComponent(filePath)}`);
      return handleResponse<FileDiff>(response);
    },

    getFullDiff: async (taskId: string): Promise<FileDiff[]> => {
      const response = await fetch(`${API_BASE}/diff/${taskId}/full`);
      return handleResponse<FileDiff[]>(response);
    },
  },

  templates: {
    list: async (): Promise<TaskTemplate[]> => {
      const response = await fetch(`${API_BASE}/templates`);
      return handleResponse<TaskTemplate[]>(response);
    },

    get: async (id: string): Promise<TaskTemplate> => {
      const response = await fetch(`${API_BASE}/templates/${id}`);
      return handleResponse<TaskTemplate>(response);
    },

    create: async (input: CreateTemplateInput): Promise<TaskTemplate> => {
      const response = await fetch(`${API_BASE}/templates`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      return handleResponse<TaskTemplate>(response);
    },

    update: async (id: string, input: UpdateTemplateInput): Promise<TaskTemplate> => {
      const response = await fetch(`${API_BASE}/templates/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      return handleResponse<TaskTemplate>(response);
    },

    delete: async (id: string): Promise<void> => {
      const response = await fetch(`${API_BASE}/templates/${id}`, {
        method: 'DELETE',
      });
      return handleResponse<void>(response);
    },
  },

  taskTypes: {
    list: async (): Promise<TaskTypeConfig[]> => {
      const response = await fetch(`${API_BASE}/task-types`);
      return handleResponse<TaskTypeConfig[]>(response);
    },

    get: async (id: string): Promise<TaskTypeConfig> => {
      const response = await fetch(`${API_BASE}/task-types/${id}`);
      return handleResponse<TaskTypeConfig>(response);
    },

    create: async (input: { label: string; icon: string; color?: string }): Promise<TaskTypeConfig> => {
      const response = await fetch(`${API_BASE}/task-types`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      return handleResponse<TaskTypeConfig>(response);
    },

    update: async (id: string, patch: Partial<TaskTypeConfig>): Promise<TaskTypeConfig> => {
      const response = await fetch(`${API_BASE}/task-types/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      return handleResponse<TaskTypeConfig>(response);
    },

    delete: async (id: string, force = false): Promise<void> => {
      const url = force 
        ? `${API_BASE}/task-types/${id}?force=true`
        : `${API_BASE}/task-types/${id}`;
      const response = await fetch(url, {
        method: 'DELETE',
      });
      return handleResponse<void>(response);
    },

    canDelete: async (id: string): Promise<{ allowed: boolean; referenceCount: number; isDefault: boolean }> => {
      const response = await fetch(`${API_BASE}/task-types/${id}/can-delete`);
      return handleResponse(response);
    },

    reorder: async (orderedIds: string[]): Promise<TaskTypeConfig[]> => {
      const response = await fetch(`${API_BASE}/task-types/reorder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderedIds }),
      });
      return handleResponse<TaskTypeConfig[]>(response);
    },
  },

  sprints: {
    list: async (): Promise<SprintConfig[]> => {
      const response = await fetch(`${API_BASE}/sprints`);
      return handleResponse<SprintConfig[]>(response);
    },

    get: async (id: string): Promise<SprintConfig> => {
      const response = await fetch(`${API_BASE}/sprints/${id}`);
      return handleResponse<SprintConfig>(response);
    },

    create: async (input: { label: string; description?: string }): Promise<SprintConfig> => {
      const response = await fetch(`${API_BASE}/sprints`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      return handleResponse<SprintConfig>(response);
    },

    update: async (id: string, patch: Partial<SprintConfig>): Promise<SprintConfig> => {
      const response = await fetch(`${API_BASE}/sprints/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      return handleResponse<SprintConfig>(response);
    },

    delete: async (id: string, force = false): Promise<void> => {
      const url = force 
        ? `${API_BASE}/sprints/${id}?force=true`
        : `${API_BASE}/sprints/${id}`;
      const response = await fetch(url, {
        method: 'DELETE',
      });
      return handleResponse<void>(response);
    },

    canDelete: async (id: string): Promise<{ allowed: boolean; referenceCount: number; isDefault: boolean }> => {
      const response = await fetch(`${API_BASE}/sprints/${id}/can-delete`);
      return handleResponse(response);
    },

    reorder: async (orderedIds: string[]): Promise<SprintConfig[]> => {
      const response = await fetch(`${API_BASE}/sprints/reorder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderedIds }),
      });
      return handleResponse<SprintConfig[]>(response);
    },
  },
};

// Types for archive suggestions
export interface ArchiveSuggestion {
  sprint: string;
  taskCount: number;
  tasks: Task[];
}

// Types for diff
export interface FileChange {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  additions: number;
  deletions: number;
  oldPath?: string;
}

export interface DiffSummary {
  files: FileChange[];
  totalAdditions: number;
  totalDeletions: number;
  totalFiles: number;
}

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}

export interface DiffLine {
  type: 'context' | 'add' | 'delete';
  content: string;
  oldNumber?: number;
  newNumber?: number;
}

export interface FileDiff {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  hunks: DiffHunk[];
  language: string;
  additions: number;
  deletions: number;
}

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

// Managed List API helpers
export const managedList = {
  /**
   * Create API helpers for a managed list endpoint
   */
  createHelpers: <T>(endpoint: string) => ({
    list: async (includeHidden = false): Promise<T[]> => {
      const url = includeHidden 
        ? `${API_BASE}${endpoint}?includeHidden=true`
        : `${API_BASE}${endpoint}`;
      const response = await fetch(url);
      return handleResponse<T[]>(response);
    },

    get: async (id: string): Promise<T> => {
      const response = await fetch(`${API_BASE}${endpoint}/${id}`);
      return handleResponse<T>(response);
    },

    create: async (input: any): Promise<T> => {
      const response = await fetch(`${API_BASE}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      return handleResponse<T>(response);
    },

    update: async (id: string, patch: any): Promise<T> => {
      const response = await fetch(`${API_BASE}${endpoint}/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      return handleResponse<T>(response);
    },

    remove: async (id: string, force = false): Promise<void> => {
      const url = force
        ? `${API_BASE}${endpoint}/${id}?force=true`
        : `${API_BASE}${endpoint}/${id}`;
      const response = await fetch(url, { method: 'DELETE' });
      return handleResponse<void>(response);
    },

    canDelete: async (id: string): Promise<{ allowed: boolean; referenceCount: number; isDefault: boolean }> => {
      const response = await fetch(`${API_BASE}${endpoint}/${id}/can-delete`);
      return handleResponse(response);
    },

    reorder: async (orderedIds: string[]): Promise<T[]> => {
      const response = await fetch(`${API_BASE}${endpoint}/reorder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderedIds }),
      });
      return handleResponse<T[]>(response);
    },
  }),
};
