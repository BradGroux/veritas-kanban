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
import { API_BASE, handleResponse } from './helpers.js';

export const promptRegistryApi = {
  /**
   * List all prompt templates
   */
  listTemplates: async (): Promise<PromptTemplate[]> => {
    const response = await fetch(`${API_BASE}/prompt-registry`);
    return handleResponse<PromptTemplate[]>(response);
  },

  /**
   * Get single template by ID
   */
  getTemplate: async (id: string): Promise<PromptTemplate> => {
    const response = await fetch(`${API_BASE}/prompt-registry/${id}`);
    return handleResponse<PromptTemplate>(response);
  },

  /**
   * Create new template
   */
  createTemplate: async (input: CreatePromptTemplateInput): Promise<PromptTemplate> => {
    const response = await fetch(`${API_BASE}/prompt-registry`, {
      credentials: 'include',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    return handleResponse<PromptTemplate>(response);
  },

  /**
   * Update existing template
   */
  updateTemplate: async (id: string, input: UpdatePromptTemplateInput): Promise<PromptTemplate> => {
    const response = await fetch(`${API_BASE}/prompt-registry/${id}`, {
      credentials: 'include',
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    return handleResponse<PromptTemplate>(response);
  },

  /**
   * Delete template
   */
  deleteTemplate: async (id: string): Promise<void> => {
    const response = await fetch(`${API_BASE}/prompt-registry/${id}`, {
      credentials: 'include',
      method: 'DELETE',
    });
    return handleResponse<void>(response);
  },

  /**
   * Get version history for a template
   */
  getVersionHistory: async (templateId: string): Promise<PromptVersion[]> => {
    const response = await fetch(`${API_BASE}/prompt-registry/${templateId}/versions`);
    return handleResponse<PromptVersion[]>(response);
  },

  /**
   * Get usage records for a template
   */
  getUsageRecords: async (templateId: string): Promise<PromptUsage[]> => {
    const response = await fetch(`${API_BASE}/prompt-registry/${templateId}/usage`);
    return handleResponse<PromptUsage[]>(response);
  },

  /**
   * Get statistics for a template
   */
  getStats: async (templateId: string): Promise<PromptStats> => {
    const response = await fetch(`${API_BASE}/prompt-registry/${templateId}/stats`);
    return handleResponse<PromptStats>(response);
  },

  /**
   * Get statistics for all templates
   */
  getAllStats: async (): Promise<PromptStats[]> => {
    const response = await fetch(`${API_BASE}/prompt-registry/stats/all`);
    return handleResponse<PromptStats[]>(response);
  },

  /**
   * Render template preview with sample variables
   */
  renderPreview: async (templateId: string, sampleVariables: Record<string, string>): Promise<RenderPreviewResponse> => {
    const response = await fetch(`${API_BASE}/prompt-registry/${templateId}/render-preview`, {
      credentials: 'include',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sampleVariables }),
    });
    return handleResponse<RenderPreviewResponse>(response);
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
    const response = await fetch(`${API_BASE}/prompt-registry/${templateId}/record-usage`, {
      credentials: 'include',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usedBy, renderedPrompt, model, inputTokens, outputTokens }),
    });
    return handleResponse<PromptUsage>(response);
  },
};
