/**
 * Prompt Registry API client
 * Handles template CRUD, versioning, usage tracking, and preview rendering
 */
import type {
  PromptTemplate,
  PromptVersion,
  PromptUsage,
  PromptStats,
  CreatePromptTemplateInput,
  UpdatePromptTemplateInput,
  RenderPreviewResponse,
} from '@veritas-kanban/shared';
import { API_BASE, apiFetch } from './helpers.js';

export const promptRegistryApi = {
  /**
   * List all prompt templates
   */
  listTemplates: async (): Promise<PromptTemplate[]> => {
    return apiFetch<PromptTemplate[]>(`${API_BASE}/prompt-registry`);
  },

  /**
   * Get single template by ID
   */
  getTemplate: async (id: string): Promise<PromptTemplate> => {
    return apiFetch<PromptTemplate>(`${API_BASE}/prompt-registry/${id}`);
  },

  /**
   * Create new template
   */
  createTemplate: async (input: CreatePromptTemplateInput): Promise<PromptTemplate> => {
    return apiFetch<PromptTemplate>(`${API_BASE}/prompt-registry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  },

  /**
   * Update existing template
   */
  updateTemplate: async (id: string, input: UpdatePromptTemplateInput): Promise<PromptTemplate> => {
    return apiFetch<PromptTemplate>(`${API_BASE}/prompt-registry/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  },

  /**
   * Delete template
   */
  deleteTemplate: async (id: string): Promise<void> => {
    return apiFetch<void>(`${API_BASE}/prompt-registry/${id}`, {
      method: 'DELETE',
    });
  },

  /**
   * Get version history for a template
   */
  getVersionHistory: async (templateId: string): Promise<PromptVersion[]> => {
    return apiFetch<PromptVersion[]>(`${API_BASE}/prompt-registry/${templateId}/versions`);
  },

  /**
   * Get usage records for a template
   */
  getUsageRecords: async (templateId: string): Promise<PromptUsage[]> => {
    return apiFetch<PromptUsage[]>(`${API_BASE}/prompt-registry/${templateId}/usage`);
  },

  /**
   * Get statistics for a template
   */
  getStats: async (templateId: string): Promise<PromptStats> => {
    return apiFetch<PromptStats>(`${API_BASE}/prompt-registry/${templateId}/stats`);
  },

  /**
   * Get statistics for all templates
   */
  getAllStats: async (): Promise<PromptStats[]> => {
    return apiFetch<PromptStats[]>(`${API_BASE}/prompt-registry/stats/all`);
  },

  /**
   * Render template preview with sample variables
   */
  renderPreview: async (
    templateId: string,
    sampleVariables: Record<string, string>
  ): Promise<RenderPreviewResponse> => {
    return apiFetch<RenderPreviewResponse>(
      `${API_BASE}/prompt-registry/${templateId}/render-preview`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sampleVariables }),
      }
    );
  },

  /**
   * Record usage of a template
   */
  recordUsage: async (
    templateId: string,
    usedBy?: string,
    renderedPrompt?: string,
    model?: string,
    inputTokens?: number,
    outputTokens?: number
  ): Promise<PromptUsage> => {
    return apiFetch<PromptUsage>(`${API_BASE}/prompt-registry/${templateId}/record-usage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usedBy, renderedPrompt, model, inputTokens, outputTokens }),
    });
  },
};
