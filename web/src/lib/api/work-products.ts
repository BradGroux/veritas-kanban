import type {
  UpdateWorkProductInput,
  WorkProduct,
  WorkProductPreview,
  WorkProductVersion,
} from '@veritas-kanban/shared';
import { API_BASE, handleResponse } from './helpers';

export type WorkProductExportFormat = 'markdown' | 'json';

export interface WorkProductExportOptions {
  format?: WorkProductExportFormat;
  redacted?: boolean;
}

function buildQuery(params: Record<string, string | number | boolean | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) {
      query.set(key, String(value));
    }
  }
  const serialized = query.toString();
  return serialized ? `?${serialized}` : '';
}

function getErrorMessage(body: unknown, status: number): string {
  if (body && typeof body === 'object') {
    const record = body as Record<string, unknown>;
    if (typeof record.message === 'string') {
      return record.message;
    }
    if (typeof record.error === 'string') {
      return record.error;
    }
    if (record.error && typeof record.error === 'object') {
      const error = record.error as Record<string, unknown>;
      if (typeof error.message === 'string') {
        return error.message;
      }
    }
  }
  return `HTTP ${status}`;
}

export const workProductsApi = {
  listForTask: async (
    taskId: string,
    options: { includeArchived?: boolean; limit?: number } = {}
  ): Promise<WorkProductPreview[]> => {
    const query = buildQuery({
      view: 'preview',
      includeArchived: options.includeArchived,
      limit: options.limit,
    });
    const response = await fetch(
      `${API_BASE}/tasks/${encodeURIComponent(taskId)}/work-products${query}`,
      {
        credentials: 'include',
      }
    );
    return handleResponse<WorkProductPreview[]>(response);
  },

  listVersions: async (id: string): Promise<WorkProductVersion[]> => {
    const response = await fetch(`${API_BASE}/work-products/${encodeURIComponent(id)}/versions`, {
      credentials: 'include',
    });
    return handleResponse<WorkProductVersion[]>(response);
  },

  update: async (id: string, input: UpdateWorkProductInput): Promise<WorkProduct> => {
    const response = await fetch(`${API_BASE}/work-products/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(input),
    });
    return handleResponse<WorkProduct>(response);
  },

  export: async (id: string, options: WorkProductExportOptions = {}): Promise<string> => {
    const query = buildQuery({
      format: options.format ?? 'markdown',
      redacted: options.redacted ?? true,
    });
    const response = await fetch(
      `${API_BASE}/work-products/${encodeURIComponent(id)}/export${query}`,
      {
        credentials: 'include',
      }
    );

    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new Error(getErrorMessage(body, response.status));
    }

    return response.text();
  },
};
