import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type {
  SkillSecurityExceptionInput,
  SkillRiskRemediationTaskInput,
} from '@veritas-kanban/shared';

export function useSkillRiskInventory() {
  return useQuery({
    queryKey: ['skill-security', 'inventory'],
    queryFn: api.skillSecurity.inventory,
  });
}

export function useCreateSkillRiskRemediationTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ skillId, input }: { skillId: string; input?: SkillRiskRemediationTaskInput }) =>
      api.skillSecurity.createRemediationTask(skillId, input ?? {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['skill-security', 'inventory'] });
    },
  });
}

export function useCreateSkillSecurityException() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ skillId, input }: { skillId: string; input: SkillSecurityExceptionInput }) =>
      api.skillSecurity.createException(skillId, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['skill-security', 'inventory'] });
    },
  });
}
