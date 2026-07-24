import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { CreateWorktreeRequest, DeleteWorktreeRequest } from '@veritas-kanban/shared';

export function useWorktreeStatus(taskId: string | undefined, hasWorktree: boolean) {
  return useQuery({
    queryKey: ['worktree', taskId],
    queryFn: () => {
      if (!taskId) throw new Error('Task ID is required');
      return api.worktree.status(taskId);
    },
    enabled: !!taskId && hasWorktree,
    refetchInterval: 10000, // Refresh every 10 seconds
  });
}

export function useCreateWorktree() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: string | { taskId: string; request?: CreateWorktreeRequest }) =>
      typeof input === 'string'
        ? api.worktree.create(input)
        : api.worktree.create(input.taskId, input.request),
    onSuccess: (_, input) => {
      const taskId = typeof input === 'string' ? input : input.taskId;
      queryClient.invalidateQueries({ queryKey: ['worktree', taskId] });
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
  });
}

export function useAdoptWorktree() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (taskId: string) => api.worktree.adopt(taskId),
    onSuccess: (_, taskId) => {
      queryClient.invalidateQueries({ queryKey: ['worktree', taskId] });
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
  });
}

export function useDeleteWorktree() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ taskId, ...request }: { taskId: string } & DeleteWorktreeRequest) =>
      api.worktree.delete(taskId, request),
    onSuccess: (_, { taskId }) => {
      queryClient.invalidateQueries({ queryKey: ['worktree', taskId] });
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
  });
}

export function useRebaseWorktree() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (taskId: string) => api.worktree.rebase(taskId),
    onSuccess: (_, taskId) => {
      queryClient.invalidateQueries({ queryKey: ['worktree', taskId] });
    },
  });
}

export function useMergeWorktree() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (taskId: string) => api.worktree.merge(taskId),
    onSuccess: (_, taskId) => {
      queryClient.invalidateQueries({ queryKey: ['worktree', taskId] });
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
  });
}
