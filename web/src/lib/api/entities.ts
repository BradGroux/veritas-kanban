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
    const url = force ? `${API_BASE}/task-types/${id}?force=true` : `${API_BASE}/task-types/${id}`;
    const response = await fetch(url, {
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
    const url = force ? `${API_BASE}/sprints/${id}?force=true` : `${API_BASE}/sprints/${id}`;
    const response = await fetch(url, {
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
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderedIds }),
    });
    return handleResponse<SprintConfig[]>(response);
  },
};

export const activityApi = {
  list: async (limit: number = 50): Promise<Activity[]> => {
    const response = await fetch(`${API_BASE}/activity?limit=${limit}`);
    return handleResponse<Activity[]>(response);
  },

  clear: async (): Promise<void> => {
    const response = await fetch(`${API_BASE}/activity`, {
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
      method: 'POST',
      body: formData,
    });
    return handleResponse<AttachmentUploadResponse>(response);
  },

  delete: async (taskId: string, attachmentId: string): Promise<void> => {
    const response = await fetch(`${API_BASE}/tasks/${taskId}/attachments/${attachmentId}`, {
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
  | 'worktree_merged';

export interface Activity {
  id: string;
  type: ActivityType;
  taskId: string;
  taskTitle: string;
  details?: Record<string, unknown>;
  timestamp: string;
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
