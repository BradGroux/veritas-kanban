/**
 * React Query hooks for prompt registry operations
 * Provides typed, cached access to prompt templates, versions, usage, and statistics
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { promptRegistryApi } from '../lib/api/prompt-registry.js';
import type {
  CreatePromptTemplateInput,
  UpdatePromptTemplateInput,
} from '@veritas-kanban/shared';

// Query key factory
const promptRegistryKeys = {
  all: ['prompt-registry'] as const,
  templates: () => [...promptRegistryKeys.all, 'templates'] as const,
  template: (id: string) => [...promptRegistryKeys.templates(), id] as const,
  versions: (id: string) => [...promptRegistryKeys.template(id), 'versions'] as const,
  usage: (id: string) => [...promptRegistryKeys.template(id), 'usage'] as const,
  stats: () => [...promptRegistryKeys.all, 'stats'] as const,
  templateStats: (id: string) => [...promptRegistryKeys.stats(), id] as const,
};

/**
 * Fetch all prompt templates
 */
export function usePromptTemplates() {
  return useQuery({
    queryKey: promptRegistryKeys.templates(),
    queryFn: () => promptRegistryApi.listTemplates(),
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

/**
 * Fetch single template by ID
 */
export function usePromptTemplate(id: string | null) {
  return useQuery({
    queryKey: id ? promptRegistryKeys.template(id) : ['disabled'],
    queryFn: () => (id ? promptRegistryApi.getTemplate(id) : Promise.reject('No ID')),
    enabled: !!id,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Create new prompt template
 */
export function useCreatePromptTemplate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreatePromptTemplateInput) => promptRegistryApi.createTemplate(input),
    onSuccess: (newTemplate) => {
      queryClient.invalidateQueries({ queryKey: promptRegistryKeys.templates() });
      queryClient.setQueryData(promptRegistryKeys.template(newTemplate.id), newTemplate);
    },
  });
}

/**
 * Update existing prompt template
 */
export function useUpdatePromptTemplate(id: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: UpdatePromptTemplateInput) => promptRegistryApi.updateTemplate(id, input),
    onSuccess: (updatedTemplate) => {
      queryClient.invalidateQueries({ queryKey: promptRegistryKeys.templates() });
      queryClient.setQueryData(promptRegistryKeys.template(id), updatedTemplate);
      queryClient.invalidateQueries({ queryKey: promptRegistryKeys.versions(id) });
      queryClient.invalidateQueries({ queryKey: promptRegistryKeys.stats() });
    },
  });
}

/**
 * Delete prompt template
 */
export function useDeletePromptTemplate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => promptRegistryApi.deleteTemplate(id),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: promptRegistryKeys.templates() });
      queryClient.removeQueries({ queryKey: promptRegistryKeys.template(id) });
      queryClient.invalidateQueries({ queryKey: promptRegistryKeys.stats() });
    },
  });
}

/**
 * Fetch version history for a template
 */
export function usePromptVersionHistory(templateId: string | null) {
  return useQuery({
    queryKey: templateId ? promptRegistryKeys.versions(templateId) : ['disabled'],
    queryFn: () => (templateId ? promptRegistryApi.getVersionHistory(templateId) : Promise.reject('No ID')),
    enabled: !!templateId,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Fetch usage records for a template
 */
export function usePromptUsageRecords(templateId: string | null) {
  return useQuery({
    queryKey: templateId ? promptRegistryKeys.usage(templateId) : ['disabled'],
    queryFn: () => (templateId ? promptRegistryApi.getUsageRecords(templateId) : Promise.reject('No ID')),
    enabled: !!templateId,
    staleTime: 2 * 60 * 1000, // 2 minutes (more volatile)
  });
}

/**
 * Fetch statistics for all templates
 */
export function usePromptStatsAll() {
  return useQuery({
    queryKey: promptRegistryKeys.stats(),
    queryFn: () => promptRegistryApi.getAllStats(),
    staleTime: 10 * 60 * 1000, // 10 minutes
  });
}

/**
 * Fetch statistics for a single template
 */
export function usePromptStats(templateId: string | null) {
  return useQuery({
    queryKey: templateId ? promptRegistryKeys.templateStats(templateId) : ['disabled'],
    queryFn: () => (templateId ? promptRegistryApi.getStats(templateId) : Promise.reject('No ID')),
    enabled: !!templateId,
    staleTime: 10 * 60 * 1000,
  });
}

/**
 * Record usage of a template
 */
export function useRecordPromptUsage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      templateId,
      usedBy,
      renderedPrompt,
      model,
      inputTokens,
      outputTokens,
    }: {
      templateId: string;
      usedBy?: string;
      renderedPrompt?: string;
      model?: string;
      inputTokens?: number;
      outputTokens?: number;
    }) =>
      promptRegistryApi.recordUsage(
        templateId,
        usedBy,
        renderedPrompt,
        model,
        inputTokens,
        outputTokens
      ),
    onSuccess: (_, { templateId }) => {
      // Invalidate usage and stats for this template
      queryClient.invalidateQueries({ queryKey: promptRegistryKeys.usage(templateId) });
      queryClient.invalidateQueries({ queryKey: promptRegistryKeys.templateStats(templateId) });
      queryClient.invalidateQueries({ queryKey: promptRegistryKeys.stats() });
    },
  });
}

/**
 * Render template preview with sample variables
 */
export function useRenderPromptPreview(templateId: string | null, sampleVariables?: Record<string, string>) {
  return useQuery({
    queryKey: templateId && sampleVariables ? ['prompt-preview', templateId, sampleVariables] : ['disabled'],
    queryFn: () =>
      templateId && sampleVariables
        ? promptRegistryApi.renderPreview(templateId, sampleVariables)
        : Promise.reject('No template or variables'),
    enabled: !!templateId && !!sampleVariables,
  });
}
