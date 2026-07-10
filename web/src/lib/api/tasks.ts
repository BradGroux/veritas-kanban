/**
 * Task API endpoints: CRUD, archive, subtasks, comments, blocking, reorder.
 */
import type { Task, CreateTaskInput, UpdateTaskInput } from '@veritas-kanban/shared';
import { API_BASE, apiFetch } from './helpers';

export const tasksApi = {
  list: async (): Promise<Task[]> => {
    return apiFetch<Task[]>(`${API_BASE}/tasks`);
  },

  listArchived: async (): Promise<Task[]> => {
    return apiFetch<Task[]>(`${API_BASE}/tasks/archived`);
  },

  get: async (id: string): Promise<Task> => {
    return apiFetch<Task>(`${API_BASE}/tasks/${id}`);
  },

  create: async (input: CreateTaskInput): Promise<Task> => {
    return apiFetch<Task>(`${API_BASE}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  },

  update: async (id: string, input: UpdateTaskInput, expectedRevision?: number): Promise<Task> => {
    const { expectedRevision: bodyExpectedRevision, ...body } = input;
    const revision = expectedRevision ?? bodyExpectedRevision;
    return apiFetch<Task>(`${API_BASE}/tasks/${id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        ...(typeof revision === 'number' ? { 'If-Match': `"task:${id}:${revision}"` } : {}),
      },
      body: JSON.stringify(body),
    });
  },

  delete: async (id: string): Promise<void> => {
    return apiFetch<void>(`${API_BASE}/tasks/${id}`, {
      method: 'DELETE',
    });
  },

  archive: async (id: string): Promise<void> => {
    return apiFetch<void>(`${API_BASE}/tasks/${id}/archive`, {
      method: 'POST',
    });
  },

  bulkArchive: async (sprint: string): Promise<{ archived: string[]; count: number }> => {
    return apiFetch(`${API_BASE}/tasks/bulk-archive`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sprint }),
    });
  },

  restore: async (id: string): Promise<Task> => {
    return apiFetch<Task>(`${API_BASE}/tasks/${id}/restore`, {
      method: 'POST',
    });
  },

  getArchiveSuggestions: async (): Promise<ArchiveSuggestion[]> => {
    return apiFetch<ArchiveSuggestion[]>(`${API_BASE}/tasks/archive/suggestions`);
  },

  archiveSprint: async (sprint: string): Promise<{ archived: number; taskIds: string[] }> => {
    return apiFetch<{ archived: number; taskIds: string[] }>(
      `${API_BASE}/tasks/archive/sprint/${encodeURIComponent(sprint)}`,
      {
        method: 'POST',
      }
    );
  },

  addSubtask: async (
    taskId: string,
    title: string,
    acceptanceCriteria?: string[]
  ): Promise<Task> => {
    return apiFetch<Task>(`${API_BASE}/tasks/${taskId}/subtasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, acceptanceCriteria }),
    });
  },

  updateSubtask: async (
    taskId: string,
    subtaskId: string,
    updates: { title?: string; completed?: boolean }
  ): Promise<Task> => {
    return apiFetch<Task>(`${API_BASE}/tasks/${taskId}/subtasks/${subtaskId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
  },

  deleteSubtask: async (taskId: string, subtaskId: string): Promise<Task> => {
    return apiFetch<Task>(`${API_BASE}/tasks/${taskId}/subtasks/${subtaskId}`, {
      method: 'DELETE',
    });
  },

  toggleSubtaskCriteria: async (
    taskId: string,
    subtaskId: string,
    criteriaIndex: number
  ): Promise<Task> => {
    return apiFetch<Task>(
      `${API_BASE}/tasks/${taskId}/subtasks/${subtaskId}/criteria/${criteriaIndex}`,
      {
        method: 'PATCH',
      }
    );
  },

  addVerificationStep: async (taskId: string, description: string): Promise<Task> => {
    return apiFetch<Task>(`${API_BASE}/tasks/${taskId}/verification`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description }),
    });
  },

  updateVerificationStep: async (
    taskId: string,
    stepId: string,
    updates: { description?: string; checked?: boolean }
  ): Promise<Task> => {
    return apiFetch<Task>(`${API_BASE}/tasks/${taskId}/verification/${stepId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
  },

  deleteVerificationStep: async (taskId: string, stepId: string): Promise<Task> => {
    return apiFetch<Task>(`${API_BASE}/tasks/${taskId}/verification/${stepId}`, {
      method: 'DELETE',
    });
  },

  addComment: async (
    taskId: string,
    author: string,
    text: string,
    expectedRevision?: number
  ): Promise<Task> => {
    return apiFetch<Task>(`${API_BASE}/tasks/${taskId}/comments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(typeof expectedRevision === 'number'
          ? { 'If-Match': `"task:${taskId}:${expectedRevision}"` }
          : {}),
      },
      body: JSON.stringify({ author, text }),
    });
  },

  editComment: async (
    taskId: string,
    commentId: string,
    text: string,
    expectedRevision?: number
  ): Promise<Task> => {
    return apiFetch<Task>(`${API_BASE}/tasks/${taskId}/comments/${commentId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        ...(typeof expectedRevision === 'number'
          ? { 'If-Match': `"task:${taskId}:${expectedRevision}"` }
          : {}),
      },
      body: JSON.stringify({ text }),
    });
  },

  deleteComment: async (
    taskId: string,
    commentId: string,
    expectedRevision?: number
  ): Promise<Task> => {
    return apiFetch<Task>(`${API_BASE}/tasks/${taskId}/comments/${commentId}`, {
      method: 'DELETE',
      headers:
        typeof expectedRevision === 'number'
          ? { 'If-Match': `"task:${taskId}:${expectedRevision}"` }
          : undefined,
    });
  },

  // Observations
  addObservation: async (
    taskId: string,
    data: {
      type: 'decision' | 'blocker' | 'insight' | 'context';
      content: string;
      score?: number;
      agent?: string;
    }
  ): Promise<Task> => {
    return apiFetch<Task>(`${API_BASE}/tasks/${taskId}/observations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
  },

  deleteObservation: async (taskId: string, observationId: string): Promise<Task> => {
    return apiFetch<Task>(`${API_BASE}/tasks/${taskId}/observations/${observationId}`, {
      method: 'DELETE',
    });
  },

  // Deliverables
  addDeliverable: async (
    taskId: string,
    deliverable: {
      title: string;
      type: 'document' | 'code' | 'report' | 'artifact' | 'other';
      path?: string;
      description?: string;
      agent?: string;
    }
  ): Promise<Task> => {
    return apiFetch<Task>(`${API_BASE}/tasks/${taskId}/deliverables`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(deliverable),
    });
  },

  updateDeliverable: async (
    taskId: string,
    deliverableId: string,
    updates: {
      title?: string;
      type?: 'document' | 'code' | 'report' | 'artifact' | 'other';
      path?: string;
      status?: 'pending' | 'attached' | 'reviewed' | 'accepted';
      description?: string;
      agent?: string;
    }
  ): Promise<Task> => {
    return apiFetch<Task>(`${API_BASE}/tasks/${taskId}/deliverables/${deliverableId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
  },

  deleteDeliverable: async (taskId: string, deliverableId: string): Promise<Task> => {
    return apiFetch<Task>(`${API_BASE}/tasks/${taskId}/deliverables/${deliverableId}`, {
      method: 'DELETE',
    });
  },

  getBlockingStatus: async (
    taskId: string
  ): Promise<{
    isBlocked: boolean;
    blockers: Array<{ id: string; title: string; status: string }>;
    completedBlockers: Array<{ id: string; title: string }>;
  }> => {
    return apiFetch(`${API_BASE}/tasks/${taskId}/blocking-status`);
  },

  reorder: async (orderedIds: string[]): Promise<{ updated: number }> => {
    return apiFetch<{ updated: number }>(`${API_BASE}/tasks/reorder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderedIds }),
    });
  },

  applyTemplate: async (
    taskId: string,
    templateId: string,
    templateName: string,
    fieldsChanged: string[]
  ): Promise<void> => {
    return apiFetch<void>(`${API_BASE}/tasks/${taskId}/apply-template`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ templateId, templateName, fieldsChanged }),
    });
  },

  bulkUpdate: async (
    ids: string[],
    status: Task['status']
  ): Promise<{ updated: string[]; count: number; failed: string[] }> => {
    return apiFetch(`${API_BASE}/tasks/bulk-update`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids, status }),
    });
  },

  bulkArchiveByIds: async (
    ids: string[]
  ): Promise<{ archived: string[]; count: number; failed: string[] }> => {
    return apiFetch(`${API_BASE}/tasks/bulk-archive-by-ids`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    });
  },

  // Progress
  fetchProgress: async (taskId: string): Promise<string> => {
    const data = await apiFetch<{ content: string }>(`${API_BASE}/tasks/${taskId}/progress`);
    return data.content;
  },

  updateProgress: async (taskId: string, content: string): Promise<void> => {
    return apiFetch<void>(`${API_BASE}/tasks/${taskId}/progress`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });
  },

  appendProgress: async (taskId: string, section: string, content: string): Promise<void> => {
    return apiFetch<void>(`${API_BASE}/tasks/${taskId}/progress/append`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ section, content }),
    });
  },
};

// Types
export interface ArchiveSuggestion {
  sprint: string;
  taskCount: number;
  tasks: Task[];
}
