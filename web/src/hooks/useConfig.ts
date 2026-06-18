import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { RepoConfig, AgentConfig, AgentType } from '@veritas-kanban/shared';
import type { AgentProfilePackage, AgentProfilePackageFormat } from '@veritas-kanban/shared';

export function useConfig() {
  return useQuery({
    queryKey: ['config'],
    queryFn: api.config.get,
  });
}

export function useCodexHealth() {
  return useQuery({
    queryKey: ['settings', 'codex-health'],
    queryFn: api.settings.getCodexHealth,
    staleTime: 30 * 1000,
  });
}

export function useProviderHealth() {
  return useQuery({
    queryKey: ['settings', 'provider-health'],
    queryFn: api.settings.getProviderHealth,
    staleTime: 30 * 1000,
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

export function useAgentProfiles() {
  return useQuery({
    queryKey: ['config', 'agent-profiles'],
    queryFn: api.config.agentProfiles.list,
  });
}

export function useValidateAgentProfile() {
  return useMutation({
    mutationFn: (input: { content: string; format?: AgentProfilePackageFormat; source?: string }) =>
      api.config.agentProfiles.validate(input),
  });
}

export function useImportAgentProfile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { content: string; format?: AgentProfilePackageFormat; source?: string }) =>
      api.config.agentProfiles.import(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['config'] });
      queryClient.invalidateQueries({ queryKey: ['config', 'agent-profiles'] });
    },
  });
}

export function useUpdateAgentProfile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      id,
      patch,
    }: {
      id: string;
      patch: Partial<
        Pick<
          AgentProfilePackage,
          'enabled' | 'displayName' | 'role' | 'description' | 'capabilities' | 'defaultTaskTypes'
        >
      >;
    }) => api.config.agentProfiles.update(id, patch),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['config'] });
      queryClient.invalidateQueries({ queryKey: ['config', 'agent-profiles'] });
    },
  });
}

export function useDeleteAgentProfile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => api.config.agentProfiles.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['config'] });
      queryClient.invalidateQueries({ queryKey: ['config', 'agent-profiles'] });
    },
  });
}

export function useExportAgentProfile() {
  return useMutation({
    mutationFn: ({ id, format }: { id: string; format?: AgentProfilePackageFormat }) =>
      api.config.agentProfiles.export(id, format),
  });
}
