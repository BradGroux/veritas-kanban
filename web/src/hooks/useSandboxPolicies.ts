import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SandboxPolicyDryRunRequest, SandboxPolicyPreset } from '@veritas-kanban/shared';
import { sandboxPoliciesApi } from '@/lib/api/sandbox-policies';

export const SANDBOX_POLICIES_QUERY_KEY = ['sandbox-policies'];

export function useSandboxPolicies() {
  return useQuery({
    queryKey: SANDBOX_POLICIES_QUERY_KEY,
    queryFn: sandboxPoliciesApi.list,
  });
}

export function useCreateSandboxPolicy() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (preset: SandboxPolicyPreset) => sandboxPoliciesApi.create(preset),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: SANDBOX_POLICIES_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: ['config'] });
    },
  });
}

export function useUpdateSandboxPolicy() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, preset }: { id: string; preset: SandboxPolicyPreset }) =>
      sandboxPoliciesApi.update(id, preset),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: SANDBOX_POLICIES_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: ['config'] });
    },
  });
}

export function useDeleteSandboxPolicy() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => sandboxPoliciesApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: SANDBOX_POLICIES_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: ['config'] });
    },
  });
}

export function useValidateSandboxPolicy() {
  return useMutation({
    mutationFn: (request: SandboxPolicyDryRunRequest) => sandboxPoliciesApi.validate(request),
  });
}
