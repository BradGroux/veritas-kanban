import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type {
  CreateDecisionInput,
  DecisionListFilters,
  DecisionWithChain,
  UpdateDecisionAssumptionInput,
} from '@veritas-kanban/shared';

export function useDecisions(filters: DecisionListFilters) {
  return useQuery({
    queryKey: ['decisions', filters],
    queryFn: () => api.decisions.list(filters),
  });
}

export function useDecision(id: string | null) {
  return useQuery({
    queryKey: ['decisions', id],
    queryFn: () => {
      if (!id) {
        throw new Error('Decision id is required');
      }
      return api.decisions.get(id);
    },
    enabled: !!id,
  });
}

export function useCreateDecision() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateDecisionInput) => api.decisions.create(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['decisions'] });
    },
  });
}

export function useUpdateDecisionAssumption() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      index,
      input,
    }: {
      id: string;
      index: number;
      input: UpdateDecisionAssumptionInput;
    }) => api.decisions.updateAssumption(id, index, input),
    onSuccess: (decision) => {
      queryClient.invalidateQueries({ queryKey: ['decisions'] });
      queryClient.setQueryData<DecisionWithChain | undefined>(['decisions', decision.id], (old) =>
        old
          ? {
              ...old,
              decision,
              chain: old.chain.map((item) => (item.id === decision.id ? decision : item)),
            }
          : old
      );
    },
  });
}
