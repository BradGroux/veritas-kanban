import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type {
  DistillTemplateFromRunInput,
  TaskTemplate,
  CreateTemplateInput,
  UpdateTemplateInput,
} from '@veritas-kanban/shared';

export type { TaskTemplate, CreateTemplateInput, DistillTemplateFromRunInput, UpdateTemplateInput };

export function useTemplates() {
  return useQuery({
    queryKey: ['templates'],
    queryFn: api.templates.list,
  });
}

export function useTemplate(id: string) {
  return useQuery({
    queryKey: ['templates', id],
    queryFn: () => api.templates.get(id),
    enabled: !!id,
  });
}

export function useCreateTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: api.templates.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['templates'] });
    },
  });
}

export function useUpdateTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateTemplateInput }) =>
      api.templates.update(id, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['templates'] });
    },
  });
}

export function useDeleteTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: api.templates.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['templates'] });
    },
  });
}

export function useDistillTemplateFromRun() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: api.templates.distillFromRun,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['templates'] });
    },
  });
}
