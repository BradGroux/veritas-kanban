import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AgentPolicy,
  PolicyEvaluationRequest,
  PolicyEvaluationResult,
} from '@veritas-kanban/shared';
import { apiFetch } from '@/lib/api/helpers';

const POLICIES_QUERY_KEY = ['policies'];

export function usePolicies() {
  return useQuery<AgentPolicy[]>({
    queryKey: POLICIES_QUERY_KEY,
    queryFn: () => apiFetch<AgentPolicy[]>('/api/policies'),
  });
}

export function useCreatePolicy() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (policy: AgentPolicy) =>
      apiFetch<AgentPolicy>('/api/policies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(policy),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: POLICIES_QUERY_KEY });
    },
  });
}

export function useUpdatePolicy() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, policy }: { id: string; policy: AgentPolicy }) =>
      apiFetch<AgentPolicy>(`/api/policies/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(policy),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: POLICIES_QUERY_KEY });
    },
  });
}

export function useDeletePolicy() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ deleted: string }>(`/api/policies/${id}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: POLICIES_QUERY_KEY });
    },
  });
}

export function useEvaluatePolicies() {
  return useMutation({
    mutationFn: (input: PolicyEvaluationRequest) =>
      apiFetch<PolicyEvaluationResult>('/api/policies/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      }),
  });
}
