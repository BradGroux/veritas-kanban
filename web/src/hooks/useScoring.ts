import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type {
  CreateScoringProfileInput,
  EvaluationRequest,
  ScoringProfile,
  UpdateScoringProfileInput,
} from '@veritas-kanban/shared';

export type { ScoringProfile, CreateScoringProfileInput, UpdateScoringProfileInput };

export function useScoringProfiles() {
  return useQuery({
    queryKey: ['scoring', 'profiles'],
    queryFn: api.scoring.listProfiles,
  });
}

export function useScoringHistory(filters?: {
  profileId?: string;
  agent?: string;
  taskId?: string;
  limit?: number;
}) {
  return useQuery({
    queryKey: ['scoring', 'history', filters],
    queryFn: () => api.scoring.getHistory(filters),
  });
}

export function useCreateScoringProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateScoringProfileInput) => api.scoring.createProfile(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scoring'] });
    },
  });
}

export function useUpdateScoringProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateScoringProfileInput }) =>
      api.scoring.updateProfile(id, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scoring'] });
    },
  });
}

export function useDeleteScoringProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.scoring.deleteProfile(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scoring'] });
    },
  });
}

export function useRunEvaluation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: EvaluationRequest) => api.scoring.evaluate(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scoring', 'history'] });
    },
  });
}
