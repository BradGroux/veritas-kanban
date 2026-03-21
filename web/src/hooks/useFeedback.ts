import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { feedbackApi } from '@/lib/api/feedback';
import type {
  CreateFeedbackInput,
  Feedback,
  FeedbackAnalyticsFilters,
  FeedbackListFilters,
  UpdateFeedbackInput,
} from '@veritas-kanban/shared';

export type { Feedback, CreateFeedbackInput, UpdateFeedbackInput };

// ─── Queries ──────────────────────────────────────────────────────────────────

export function useFeedbackList(filters?: FeedbackListFilters) {
  return useQuery({
    queryKey: ['feedback', 'list', filters],
    queryFn: () => feedbackApi.list(filters),
  });
}

export function useFeedback(id: string) {
  return useQuery({
    queryKey: ['feedback', id],
    queryFn: () => feedbackApi.get(id),
    enabled: Boolean(id),
  });
}

export function useFeedbackAnalytics(filters?: FeedbackAnalyticsFilters) {
  return useQuery({
    queryKey: ['feedback', 'analytics', filters],
    queryFn: () => feedbackApi.getAnalytics(filters),
  });
}

export function useUnresolvedFeedback(limit?: number) {
  return useQuery({
    queryKey: ['feedback', 'unresolved', limit],
    queryFn: () => feedbackApi.listUnresolved(limit),
  });
}

// ─── Mutations ────────────────────────────────────────────────────────────────

export function useCreateFeedback() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateFeedbackInput) => feedbackApi.create(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['feedback'] });
    },
  });
}

export function useUpdateFeedback() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateFeedbackInput }) =>
      feedbackApi.update(id, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['feedback'] });
    },
  });
}

export function useDeleteFeedback() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => feedbackApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['feedback'] });
    },
  });
}

export function useResolveFeedback() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => feedbackApi.update(id, { resolved: true }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['feedback'] });
    },
  });
}
