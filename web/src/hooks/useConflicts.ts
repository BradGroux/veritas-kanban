import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  api,
  type ConflictStatus,
  type ConflictFile,
  type ResolveResult,
  type ConflictMarker,
} from '../lib/api';

export type { ConflictStatus, ConflictFile, ResolveResult, ConflictMarker };

/**
 * Get conflict status for a task
 */
export function useConflictStatus(taskId: string | undefined) {
  return useQuery<ConflictStatus>({
    queryKey: ['conflicts', taskId],
    queryFn: async () => {
      if (!taskId)
        return {
          hasConflicts: false,
          conflictingFiles: [],
          rebaseInProgress: false,
          mergeInProgress: false,
        };
      return api.conflicts.getStatus(taskId);
    },
    enabled: !!taskId,
    refetchInterval: (query) => {
      // Poll when there are conflicts
      if (query.state.data?.hasConflicts) {
        return 5000;
      }
      return false;
    },
  });
}

/**
 * Get conflict details for a specific file
 */
export function useFileConflict(taskId: string | undefined, filePath: string | undefined) {
  return useQuery<ConflictFile>({
    queryKey: ['conflicts', taskId, 'file', filePath],
    queryFn: async () => {
      if (!taskId || !filePath) throw new Error('Task ID and file path required');
      return api.conflicts.getFile(taskId, filePath);
    },
    enabled: !!taskId && !!filePath,
  });
}

/**
 * Resolve a file conflict
 */
export function useResolveConflict() {
  const queryClient = useQueryClient();

  return useMutation<
    ResolveResult,
    Error,
    {
      taskId: string;
      filePath: string;
      resolution: 'ours' | 'theirs' | 'manual';
      manualContent?: string;
    }
  >({
    mutationFn: async ({ taskId, filePath, resolution, manualContent }) => {
      return api.conflicts.resolve(taskId, filePath, resolution, manualContent);
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['conflicts', variables.taskId] });
      queryClient.invalidateQueries({ queryKey: ['conflicts', variables.taskId, 'file'] });
    },
  });
}

/**
 * Abort rebase or merge
 */
export function useAbortConflict() {
  const queryClient = useQueryClient();

  return useMutation<{ aborted: boolean }, Error, string>({
    mutationFn: (taskId) => api.conflicts.abort(taskId),
    onSuccess: (_data, taskId) => {
      queryClient.invalidateQueries({ queryKey: ['conflicts', taskId] });
      queryClient.invalidateQueries({ queryKey: ['worktree', taskId] });
    },
  });
}

/**
 * Continue rebase or merge after resolving conflicts
 */
export function useContinueConflict() {
  const queryClient = useQueryClient();

  return useMutation<
    { success: boolean; error?: string },
    Error,
    { taskId: string; message?: string }
  >({
    mutationFn: ({ taskId, message }) => api.conflicts.continue(taskId, message),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['conflicts', variables.taskId] });
      queryClient.invalidateQueries({ queryKey: ['worktree', variables.taskId] });
    },
  });
}
