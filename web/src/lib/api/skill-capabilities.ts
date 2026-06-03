import type {
  SkillCapabilityDefinition,
  SkillCapabilityListFilters,
  SkillCapabilityProfile,
  SkillCapabilityRemediationTaskInput,
  Task,
} from '@veritas-kanban/shared';
import { apiFetch } from './helpers';

function toQuery(filters: SkillCapabilityListFilters = {}): string {
  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  if (filters.severity) params.set('severity', filters.severity);
  if (filters.capability) params.set('capability', filters.capability);
  if (filters.q) params.set('q', filters.q);
  const query = params.toString();
  return query ? `?${query}` : '';
}

export const skillCapabilitiesApi = {
  taxonomy: (): Promise<SkillCapabilityDefinition[]> =>
    apiFetch<SkillCapabilityDefinition[]>('/api/skills/capabilities/taxonomy'),

  list: (filters: SkillCapabilityListFilters = {}): Promise<SkillCapabilityProfile[]> =>
    apiFetch<SkillCapabilityProfile[]>(`/api/skills/capabilities${toQuery(filters)}`),

  get: (skillId: string): Promise<SkillCapabilityProfile> =>
    apiFetch<SkillCapabilityProfile>(`/api/skills/capabilities/${encodeURIComponent(skillId)}`),

  createRemediationTask: (
    skillId: string,
    input: SkillCapabilityRemediationTaskInput = {}
  ): Promise<{ profile: SkillCapabilityProfile; task: Task }> =>
    apiFetch<{ profile: SkillCapabilityProfile; task: Task }>(
      `/api/skills/capabilities/${encodeURIComponent(skillId)}/remediation-task`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      }
    ),
};
