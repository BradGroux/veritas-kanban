import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type {
  SkillCapabilityListFilters,
  SkillCapabilityRemediationTaskInput,
} from '@veritas-kanban/shared';

export function useSkillCapabilityProfiles(filters: SkillCapabilityListFilters = {}) {
  return useQuery({
    queryKey: ['skill-capabilities', filters],
    queryFn: () => api.skillCapabilities.list(filters),
  });
}

export function useSkillCapabilityTaxonomy() {
  return useQuery({
    queryKey: ['skill-capabilities', 'taxonomy'],
    queryFn: api.skillCapabilities.taxonomy,
  });
}

export function useCreateSkillCapabilityRemediationTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      skillId,
      input,
    }: {
      skillId: string;
      input?: SkillCapabilityRemediationTaskInput;
    }) => api.skillCapabilities.createRemediationTask(skillId, input ?? {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['skill-capabilities'] });
    },
  });
}
