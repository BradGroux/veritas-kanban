import type {
  SandboxPolicyDryRunRequest,
  SandboxPolicyDryRunResult,
  SandboxPolicyPreset,
} from '@veritas-kanban/shared';
import { apiFetch } from './helpers';

export const sandboxPoliciesApi = {
  list: () => apiFetch<SandboxPolicyPreset[]>('/api/sandbox-policies'),

  create: (preset: SandboxPolicyPreset) =>
    apiFetch<SandboxPolicyPreset>('/api/sandbox-policies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(preset),
    }),

  update: (id: string, preset: SandboxPolicyPreset) =>
    apiFetch<SandboxPolicyPreset>(`/api/sandbox-policies/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(preset),
    }),

  delete: (id: string) =>
    apiFetch<{ deleted: string }>(`/api/sandbox-policies/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  validate: (request: SandboxPolicyDryRunRequest) =>
    apiFetch<SandboxPolicyDryRunResult & { traceId: string }>('/api/sandbox-policies/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    }),
};
