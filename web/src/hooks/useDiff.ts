import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type CodexReviewInput, type CodexReviewResult } from '@/lib/api';

export function useDiffSummary(taskId: string | undefined, hasWorktree: boolean) {
  return useQuery({
    queryKey: ['diff', 'summary', taskId],
    queryFn: () => api.diff.getSummary(taskId!),
    enabled: !!taskId && hasWorktree,
  });
}

export function useFileDiff(taskId: string | undefined, filePath: string | undefined) {
  return useQuery({
    queryKey: ['diff', 'file', taskId, filePath],
    queryFn: () => api.diff.getFileDiff(taskId!, filePath!),
    enabled: !!taskId && !!filePath,
  });
}

export function useFullDiff(taskId: string | undefined, hasWorktree: boolean) {
  return useQuery({
    queryKey: ['diff', 'full', taskId],
    queryFn: () => api.diff.getFullDiff(taskId!),
    enabled: !!taskId && hasWorktree,
  });
}

export function useCodexReview(taskId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation<CodexReviewResult, Error, CodexReviewInput | undefined>({
    mutationFn: (input) => api.diff.runCodexReview(taskId!, input || {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      if (taskId) queryClient.invalidateQueries({ queryKey: ['task', taskId] });
    },
  });
}
