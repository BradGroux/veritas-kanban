/**
 * Entity management API endpoints: templates, task types, sprints, activity, attachments.
 */
import type {
  TaskTemplate,
  CreateTemplateInput,
  DistillTemplateFromRunInput,
  UpdateTemplateInput,
  TaskTypeConfig,
  SprintConfig,
  Attachment,
} from '@veritas-kanban/shared';
import { API_BASE, apiFetch } from './helpers';

export const templatesApi = {
  list: async (): Promise<TaskTemplate[]> => {
    return apiFetch<TaskTemplate[]>(`${API_BASE}/templates`);
  },

  get: async (id: string): Promise<TaskTemplate> => {
    return apiFetch<TaskTemplate>(`${API_BASE}/templates/${id}`);
  },

  create: async (input: CreateTemplateInput): Promise<TaskTemplate> => {
    return apiFetch<TaskTemplate>(`${API_BASE}/templates`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  },

  update: async (id: string, input: UpdateTemplateInput): Promise<TaskTemplate> => {
    return apiFetch<TaskTemplate>(`${API_BASE}/templates/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  },

  delete: async (id: string): Promise<void> => {
    return apiFetch<void>(`${API_BASE}/templates/${id}`, {
      method: 'DELETE',
    });
  },

  distillFromRun: async (input: DistillTemplateFromRunInput): Promise<TaskTemplate> => {
    return apiFetch<TaskTemplate>(`${API_BASE}/templates/distill-from-run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  },
};

export const taskTypesApi = {
  list: async (): Promise<TaskTypeConfig[]> => {
    return apiFetch<TaskTypeConfig[]>(`${API_BASE}/task-types`);
  },

  get: async (id: string): Promise<TaskTypeConfig> => {
    return apiFetch<TaskTypeConfig>(`${API_BASE}/task-types/${id}`);
  },

  create: async (input: {
    label: string;
    icon: string;
    color?: string;
  }): Promise<TaskTypeConfig> => {
    return apiFetch<TaskTypeConfig>(`${API_BASE}/task-types`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  },

  update: async (id: string, patch: Partial<TaskTypeConfig>): Promise<TaskTypeConfig> => {
    return apiFetch<TaskTypeConfig>(`${API_BASE}/task-types/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
  },

  delete: async (id: string, force = false): Promise<void> => {
    const url = force ? `${API_BASE}/task-types/${id}?force=true` : `${API_BASE}/task-types/${id}`;
    return apiFetch<void>(url, {
      method: 'DELETE',
    });
  },

  canDelete: async (
    id: string
  ): Promise<{ allowed: boolean; referenceCount: number; isDefault: boolean }> => {
    return apiFetch(`${API_BASE}/task-types/${id}/can-delete`);
  },

  reorder: async (orderedIds: string[]): Promise<TaskTypeConfig[]> => {
    return apiFetch<TaskTypeConfig[]>(`${API_BASE}/task-types/reorder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderedIds }),
    });
  },
};

export const sprintsApi = {
  list: async (): Promise<SprintConfig[]> => {
    return apiFetch<SprintConfig[]>(`${API_BASE}/sprints`);
  },

  get: async (id: string): Promise<SprintConfig> => {
    return apiFetch<SprintConfig>(`${API_BASE}/sprints/${id}`);
  },

  create: async (input: { label: string; description?: string }): Promise<SprintConfig> => {
    return apiFetch<SprintConfig>(`${API_BASE}/sprints`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  },

  update: async (id: string, patch: Partial<SprintConfig>): Promise<SprintConfig> => {
    return apiFetch<SprintConfig>(`${API_BASE}/sprints/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
  },

  delete: async (id: string, force = false): Promise<void> => {
    const url = force ? `${API_BASE}/sprints/${id}?force=true` : `${API_BASE}/sprints/${id}`;
    return apiFetch<void>(url, {
      method: 'DELETE',
    });
  },

  canDelete: async (
    id: string
  ): Promise<{ allowed: boolean; referenceCount: number; isDefault: boolean }> => {
    return apiFetch(`${API_BASE}/sprints/${id}/can-delete`);
  },

  reorder: async (orderedIds: string[]): Promise<SprintConfig[]> => {
    return apiFetch<SprintConfig[]>(`${API_BASE}/sprints/reorder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderedIds }),
    });
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
    return apiFetch<Activity[]>(`${API_BASE}/activity?${params.toString()}`);
  },

  filters: async (): Promise<ActivityFilterOptions> => {
    return apiFetch<ActivityFilterOptions>(`${API_BASE}/activity/filters`);
  },

  clear: async (): Promise<void> => {
    return apiFetch<void>(`${API_BASE}/activity`, {
      method: 'DELETE',
    });
  },
};

export const attachmentsApi = {
  list: async (taskId: string): Promise<Attachment[]> => {
    return apiFetch<Attachment[]>(`${API_BASE}/tasks/${taskId}/attachments`);
  },

  upload: async (taskId: string, formData: FormData): Promise<AttachmentUploadResponse> => {
    return apiFetch<AttachmentUploadResponse>(`${API_BASE}/tasks/${taskId}/attachments`, {
      method: 'POST',
      body: formData,
    });
  },

  delete: async (taskId: string, attachmentId: string): Promise<void> => {
    return apiFetch<void>(`${API_BASE}/tasks/${taskId}/attachments/${attachmentId}`, {
      method: 'DELETE',
    });
  },

  getTaskContext: async (taskId: string): Promise<TaskContext> => {
    return apiFetch<TaskContext>(`${API_BASE}/tasks/${taskId}/context`);
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
  | 'agent_event'
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
