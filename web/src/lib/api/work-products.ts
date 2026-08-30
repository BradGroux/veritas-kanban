import type {
  UpdateWorkProductInput,
  WorkProduct,
  WorkProductArtifactPreview,
  WorkProductMaintenancePreview,
  WorkProductPreview,
  WorkProductVersion,
} from '@veritas-kanban/shared';
import { API_BASE, apiFetch, apiResponse, apiText } from './helpers';

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

export const workProductsApi = {
  maintenancePreview: async (): Promise<WorkProductMaintenancePreview> => {
    return apiFetch<WorkProductMaintenancePreview>(`${API_BASE}/work-products/maintenance-preview`);
  },

  listForTask: async (
    taskId: string,
    options: { includeArchived?: boolean; limit?: number } = {}
  ): Promise<WorkProductPreview[]> => {
    const query = buildQuery({
      view: 'preview',
      includeArchived: options.includeArchived,
      limit: options.limit,
    });
    return apiFetch<WorkProductPreview[]>(
      `${API_BASE}/tasks/${encodeURIComponent(taskId)}/work-products${query}`
    );
  },

  listVersions: async (id: string): Promise<WorkProductVersion[]> => {
    return apiFetch<WorkProductVersion[]>(
      `${API_BASE}/work-products/${encodeURIComponent(id)}/versions`
    );
  },

  downloadArtifact: async (id: string, version?: number): Promise<Blob> => {
    const query = buildQuery({ version });
    return (
      await apiResponse(
        `${API_BASE}/work-products/${encodeURIComponent(id)}/artifact/download${query}`
      )
    ).blob();
  },

  previewArtifact: async (id: string, version?: number): Promise<WorkProductArtifactPreview> => {
    const query = buildQuery({ version });
    return apiFetch<WorkProductArtifactPreview>(
      `${API_BASE}/work-products/${encodeURIComponent(id)}/artifact/preview${query}`
    );
  },

  update: async (id: string, input: UpdateWorkProductInput): Promise<WorkProduct> => {
    return apiFetch<WorkProduct>(`${API_BASE}/work-products/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  },

  export: async (id: string, options: WorkProductExportOptions = {}): Promise<string> => {
    const query = buildQuery({
      format: options.format ?? 'markdown',
      redacted: options.redacted ?? true,
    });
    return apiText(`${API_BASE}/work-products/${encodeURIComponent(id)}/export${query}`);
  },
};
