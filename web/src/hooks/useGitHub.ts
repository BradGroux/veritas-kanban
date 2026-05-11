import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  api,
  type GitHubStatus,
  type PRInfo,
  type CreatePRInput,
  type CodexCloudDelegationInput,
  type CodexCloudDelegationResult,
} from '../lib/api';

export type {
  GitHubStatus,
  PRInfo,
  CreatePRInput,
  CodexCloudDelegationInput,
  CodexCloudDelegationResult,
};

/**
 * Check GitHub CLI status
 */
export function useGitHubStatus() {
  return useQuery<GitHubStatus>({
    queryKey: ['github', 'status'],
    queryFn: () => api.github.getStatus(),
    staleTime: 60 * 1000, // 1 minute
  });
}

/**
 * Create a PR for a task
 */
export function useCreatePR() {
  const queryClient = useQueryClient();

  return useMutation<PRInfo, Error, CreatePRInput>({
    mutationFn: (input) => api.github.createPR(input),
    onSuccess: (_data, variables) => {
      // Invalidate the task to refresh its PR info
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      queryClient.invalidateQueries({ queryKey: ['task', variables.taskId] });
    },
  });
}

/**
 * Open PR in browser
 */
export function useOpenPR() {
  return useMutation<void, Error, string>({
    mutationFn: (taskId) => api.github.openPR(taskId),
  });
}

/**
 * Delegate a task to Codex Cloud via GitHub issue/PR workflows.
 */
export function useDelegateCodexCloud() {
  const queryClient = useQueryClient();

  return useMutation<CodexCloudDelegationResult, Error, CodexCloudDelegationInput>({
    mutationFn: (input) => api.github.delegateCodexCloud(input),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      queryClient.invalidateQueries({ queryKey: ['task', variables.taskId] });
    },
  });
}
