import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type {
  CreateDecisionReviewSessionInput,
  DecisionReviewListFilters,
  DecisionReviewSession,
  FinalizeDecisionReviewSessionInput,
  RecordDecisionReviewCritiqueInput,
  RecordDecisionReviewTurnInput,
} from '@veritas-kanban/shared';

export function useDecisionReviews(filters: DecisionReviewListFilters) {
  return useQuery({
    queryKey: ['decision-reviews', filters],
    queryFn: () => api.decisions.reviews.list(filters),
  });
}

export function useDecisionReview(id: string | null) {
  return useQuery({
    queryKey: ['decision-reviews', id],
    queryFn: () => {
      if (!id) throw new Error('Decision review id is required');
      return api.decisions.reviews.get(id);
    },
    enabled: Boolean(id),
  });
}

function updateReviewCaches(
  queryClient: ReturnType<typeof useQueryClient>,
  session: DecisionReviewSession
) {
  queryClient.invalidateQueries({ queryKey: ['decision-reviews'] });
  queryClient.invalidateQueries({ queryKey: ['decisions'] });
  queryClient.invalidateQueries({ queryKey: ['tasks', session.taskId, 'work-products'] });
  queryClient.setQueryData(['decision-reviews', session.id], session);
}

export function useCreateDecisionReview() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateDecisionReviewSessionInput) => api.decisions.reviews.create(input),
    onSuccess: (session) => updateReviewCaches(queryClient, session),
  });
}

export function useRecordDecisionReviewResponse() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: RecordDecisionReviewTurnInput }) =>
      api.decisions.reviews.recordResponse(id, input),
    onSuccess: (session) => updateReviewCaches(queryClient, session),
  });
}

export function useRecordDecisionReviewCritique() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: RecordDecisionReviewCritiqueInput }) =>
      api.decisions.reviews.recordCritique(id, input),
    onSuccess: (session) => updateReviewCaches(queryClient, session),
  });
}

export function useFinalizeDecisionReview() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: FinalizeDecisionReviewSessionInput }) =>
      api.decisions.reviews.finalize(id, input),
    onSuccess: (session) => updateReviewCaches(queryClient, session),
  });
}

export function useCancelDecisionReview() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.decisions.reviews.cancel(id),
    onSuccess: (session) => updateReviewCaches(queryClient, session),
  });
}

export function useExportDecisionReview() {
  return useMutation({
    mutationFn: (id: string) => api.decisions.reviews.export(id),
  });
}
