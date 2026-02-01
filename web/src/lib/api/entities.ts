/**
 * Entity management API endpoints: templates, task types, sprints, activity, attachments.
 */
import type {
  TaskTemplate,
  CreateTemplateInput,
  UpdateTemplateInput,
  TaskTypeConfig,
  SprintConfig,
  Attachment,
} from '@veritas-kanban/shared';
import { API_BASE, handleResponse } from './helpers';

export const templatesApi = {
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
      credentials: 'include',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    return handleResponse<TaskTemplate>(response);
  },

  update: async (id: string, input: UpdateTemplateInput): Promise<TaskTemplate> => {
    const response = await fetch(`${API_BASE}/templates/${id}`, {
      credentials: 'include',
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    return handleResponse<TaskTemplate>(response);
  },

  delete: async (id: string): Promise<void> => {
    const response = await fetch(`${API_BASE}/templates/${id}`, {
      credentials: 'include',
      method: 'DELETE',
    });
    return handleResponse<void>(response);
  },
};

export const taskTypesApi = {
  list: async (): Promise<TaskTypeConfig[]> => {
    const response = await fetch(`${API_BASE}/task-types`);
    return handleResponse<TaskTypeConfig[]>(response);
  },

  get: async (id: string): Promise<TaskTypeConfig> => {
    const response = await fetch(`${API_BASE}/task-types/${id}`);
    return handleResponse<TaskTypeConfig>(response);
  },

  create: async (input: {
    label: string;
    icon: string;
    color?: string;
  }): Promise<TaskTypeConfig> => {
    const response = await fetch(`${API_BASE}/task-types`, {
      credentials: 'include',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    return handleResponse<TaskTypeConfig>(response);
  },

  update: async (id: string, patch: Partial<TaskTypeConfig>): Promise<TaskTypeConfig> => {
    const response = await fetch(`${API_BASE}/task-types/${id}`, {
      credentials: 'include',
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    return handleResponse<TaskTypeConfig>(response);
  },

  delete: async (id: string, force = false): Promise<void> => {
    const url = force ? `${API_BASE}/task-types/${id}?force=true` : `${API_BASE}/task-types/${id}`;
    const response = await fetch(url, {
      credentials: 'include',
      method: 'DELETE',
    });
    return handleResponse<void>(response);
  },

  canDelete: async (
    id: string
  ): Promise<{ allowed: boolean; referenceCount: number; isDefault: boolean }> => {
    const response = await fetch(`${API_BASE}/task-types/${id}/can-delete`);
    return handleResponse(response);
  },

  reorder: async (orderedIds: string[]): Promise<TaskTypeConfig[]> => {
    const response = await fetch(`${API_BASE}/task-types/reorder`, {
      credentials: 'include',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderedIds }),
    });
    return handleResponse<TaskTypeConfig[]>(response);
  },
};

export const sprintsApi = {
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
      credentials: 'include',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    return handleResponse<SprintConfig>(response);
  },

  update: async (id: string, patch: Partial<SprintConfig>): Promise<SprintConfig> => {
    const response = await fetch(`${API_BASE}/sprints/${id}`, {
      credentials: 'include',
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    return handleResponse<SprintConfig>(response);
  },

  delete: async (id: string, force = false): Promise<void> => {
    const url = force ? `${API_BASE}/sprints/${id}?force=true` : `${API_BASE}/sprints/${id}`;
    const response = await fetch(url, {
      credentials: 'include',
      method: 'DELETE',
    });
    return handleResponse<void>(response);
  },

  canDelete: async (
    id: string
  ): Promise<{ allowed: boolean; referenceCount: number; isDefault: boolean }> => {
    const response = await fetch(`${API_BASE}/sprints/${id}/can-delete`);
    return handleResponse(response);
  },

  reorder: async (orderedIds: string[]): Promise<SprintConfig[]> => {
    const response = await fetch(`${API_BASE}/sprints/reorder`, {
      credentials: 'include',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderedIds }),
    });
    return handleResponse<SprintConfig[]>(response);
  },
};

export const activityApi = {
  list: async (
    limit: number = 50,
    filters?: ActivityFilters,
    page?: number
  ): Promise<Activity[]> => {
    const params = new URLSearchParams({ limit: String(limit) });
    if (page && page > 0) params.set('page', String(page));
    if (filters?.agent) params.set('agent', filters.agent);
    if (filters?.type) params.set('type', filters.type);
    if (filters?.taskId) params.set('taskId', filters.taskId);
    if (filters?.since) params.set('since', filters.since);
    if (filters?.until) params.set('until', filters.until);
    const response = await fetch(`${API_BASE}/activity?${params.toString()}`);
    return handleResponse<Activity[]>(response);
  },

  filters: async (): Promise<ActivityFilterOptions> => {
    const response = await fetch(`${API_BASE}/activity/filters`);
    return handleResponse<ActivityFilterOptions>(response);
  },

  clear: async (): Promise<void> => {
    const response = await fetch(`${API_BASE}/activity`, {
      credentials: 'include',
      method: 'DELETE',
    });
    return handleResponse<void>(response);
  },
};

export const attachmentsApi = {
  list: async (taskId: string): Promise<Attachment[]> => {
    const response = await fetch(`${API_BASE}/tasks/${taskId}/attachments`);
    return handleResponse<Attachment[]>(response);
  },

  upload: async (taskId: string, formData: FormData): Promise<AttachmentUploadResponse> => {
    const response = await fetch(`${API_BASE}/tasks/${taskId}/attachments`, {
      credentials: 'include',
      method: 'POST',
      body: formData,
    });
    return handleResponse<AttachmentUploadResponse>(response);
  },

  delete: async (taskId: string, attachmentId: string): Promise<void> => {
    const response = await fetch(`${API_BASE}/tasks/${taskId}/attachments/${attachmentId}`, {
      credentials: 'include',
      method: 'DELETE',
    });
    return handleResponse<void>(response);
  },

  getTaskContext: async (taskId: string): Promise<TaskContext> => {
    const response = await fetch(`${API_BASE}/tasks/${taskId}/context`);
    return handleResponse<TaskContext>(response);
  },
};

// Activity types
export type ActivityType =
  | 'task_created'
  | 'task_updated'
  | 'status_changed'
  | 'agent_started'
  | 'agent_stopped'
  | 'agent_completed'
  | 'task_archived'
  | 'task_deleted'
  | 'worktree_created'
  | 'worktree_merged'
  | 'project_archived'
  | 'sprint_archived'
  | 'template_applied'
  | 'comment_added'
  | 'comment_deleted';

export interface Activity {
  id: string;
  type: ActivityType;
  taskId: string;
  taskTitle: string;
  agent?: string;
  details?: Record<string, unknown>;
  timestamp: string;
}

export interface ActivityFilters {
  agent?: string;
  type?: ActivityType;
  taskId?: string;
  since?: string;
  until?: string;
}

export interface ActivityFilterOptions {
  agents: string[];
  types: ActivityType[];
}

// Attachment types
export interface AttachmentUploadResponse {
  success: boolean;
  attachments: Attachment[];
  task: unknown;
}

export interface TaskContext {
  taskId: string;
  title: string;
  description: string;
  type: string;
  status: string;
  priority: string;
  project?: string;
  tags?: string[];
  attachments: {
    count: number;
    documents: { filename: string; text: string }[];
    images: string[];
  };
  created: string;
  updated: string;
}
