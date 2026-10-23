import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type PreviewServer } from '../lib/api';

export type { PreviewServer };

/**
 * Get preview status for a task
 */
export function usePreviewStatus(taskId: string | undefined) {
  return useQuery<PreviewServer | { status: 'stopped' }>({
    queryKey: ['preview', taskId],
    queryFn: async () => {
      if (!taskId) return { status: 'stopped' as const };
      return api.preview.getStatus(taskId);
    },
    enabled: !!taskId,
    refetchInterval: (query) => {
      const data = query.state.data;
      // Poll more frequently when starting
      if (data && 'status' in data && data.status === 'starting') {
        return 1000;
      }
      // Poll every 5s when running
      if (data && 'status' in data && data.status === 'running') {
        return 5000;
      }
      return false;
    },
  });
}

/**
 * Get preview output
 */
export function usePreviewOutput(taskId: string | undefined, lines: number = 50) {
  return useQuery<{ output: string[] }>({
    queryKey: ['preview', taskId, 'output', lines],
    queryFn: async () => {
      if (!taskId) return { output: [] };
      return api.preview.getOutput(taskId, lines);
    },
    enabled: !!taskId,
    refetchInterval: 2000, // Poll every 2s for output
  });
}

/**
 * Start preview server
 */
export function useStartPreview() {
  const queryClient = useQueryClient();

  return useMutation<PreviewServer, Error, string>({
    mutationFn: (taskId) => api.preview.start(taskId),
    onSuccess: (_data, taskId) => {
      queryClient.invalidateQueries({ queryKey: ['preview', taskId] });
    },
  });
}

/**
 * Stop preview server
 */
export function useStopPreview() {
  const queryClient = useQueryClient();

  return useMutation<void, Error, string>({
    mutationFn: (taskId) => api.preview.stop(taskId),
    onSuccess: (_data, taskId) => {
      queryClient.invalidateQueries({ queryKey: ['preview', taskId] });
    },
  });
}
