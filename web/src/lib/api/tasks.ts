/**
 * Task API endpoints: CRUD, archive, subtasks, comments, blocking, reorder.
 */
import type { Task, CreateTaskInput, UpdateTaskInput } from '@veritas-kanban/shared';
import { API_BASE, handleResponse } from './helpers';

export const tasksApi = {
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

  updateSubtask: async (
    taskId: string,
    subtaskId: string,
    updates: { title?: string; completed?: boolean }
  ): Promise<Task> => {
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

  getBlockingStatus: async (
    taskId: string
  ): Promise<{
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

  applyTemplate: async (
    taskId: string,
    templateId: string,
    templateName: string,
    fieldsChanged: string[]
  ): Promise<void> => {
    const response = await fetch(`${API_BASE}/tasks/${taskId}/apply-template`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ templateId, templateName, fieldsChanged }),
    });
    return handleResponse<void>(response);
  },
};

// Types
export interface ArchiveSuggestion {
  sprint: string;
  taskCount: number;
  tasks: Task[];
}
