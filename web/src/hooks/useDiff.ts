import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

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
