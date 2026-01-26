import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { RepoConfig, AgentConfig, AgentType } from '@veritas-kanban/shared';

export function useConfig() {
  return useQuery({
    queryKey: ['config'],
    queryFn: api.config.get,
  });
}

export function useRepos() {
  return useQuery({
    queryKey: ['config', 'repos'],
    queryFn: api.config.repos.list,
  });
}

export function useAddRepo() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (repo: RepoConfig) => api.config.repos.add(repo),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['config'] });
    },
  });
}

export function useUpdateRepo() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ name, updates }: { name: string; updates: Partial<RepoConfig> }) =>
      api.config.repos.update(name, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['config'] });
    },
  });
}

export function useRemoveRepo() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (name: string) => api.config.repos.remove(name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['config'] });
    },
  });
}

export function useValidateRepoPath() {
  return useMutation({
    mutationFn: (path: string) => api.config.repos.validate(path),
  });
}

export function useRepoBranches(repoName: string | undefined) {
  return useQuery({
    queryKey: ['config', 'repos', repoName, 'branches'],
    queryFn: () => api.config.repos.branches(repoName!),
    enabled: !!repoName,
  });
}

export function useUpdateAgents() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (agents: AgentConfig[]) => api.config.agents.update(agents),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['config'] });
    },
  });
}

export function useSetDefaultAgent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (agent: AgentType) => api.config.agents.setDefault(agent),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['config'] });
    },
  });
}
