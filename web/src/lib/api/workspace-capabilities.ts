import type {
  WorkspaceCapabilityDiscoveryResult,
  WorkspaceCapabilityExportResult,
  WorkspaceCapabilityFormat,
  WorkspaceCapabilityManifest,
  WorkspaceCapabilityRegistrationResult,
  WorkspaceCapabilityValidationResult,
  WorkspaceDelegatedWorkIntakeInput,
  WorkspaceDelegatedWorkIntakeResult,
  WorkspaceDelegationRecord,
} from '@veritas-kanban/shared';
import { apiFetch } from './helpers';

export const workspaceCapabilitiesApi = {
  getManifest: () =>
    apiFetch<WorkspaceCapabilityManifest | null>('/api/workspace-capabilities/manifest'),

  saveManifest: (manifest: WorkspaceCapabilityManifest) =>
    apiFetch<WorkspaceCapabilityManifest>('/api/workspace-capabilities/manifest', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(manifest),
    }),

  validateManifest: (input: {
    manifest?: unknown;
    content?: string;
    format?: WorkspaceCapabilityFormat;
    source?: string;
  }) =>
    apiFetch<WorkspaceCapabilityValidationResult>('/api/workspace-capabilities/manifest/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }),

  registerTrusted: (input: {
    manifest?: unknown;
    content?: string;
    format?: WorkspaceCapabilityFormat;
    source?: string;
  }) =>
    apiFetch<WorkspaceCapabilityRegistrationResult>('/api/workspace-capabilities/trusted', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }),

  exportManifest: (format: WorkspaceCapabilityFormat = 'yaml') =>
    apiFetch<WorkspaceCapabilityExportResult>(
      `/api/workspace-capabilities/manifest/export?format=${format}`
    ),

  discover: () =>
    apiFetch<WorkspaceCapabilityDiscoveryResult>('/api/workspace-capabilities/discover'),

  intake: (input: WorkspaceDelegatedWorkIntakeInput) =>
    apiFetch<WorkspaceDelegatedWorkIntakeResult>('/api/workspace-capabilities/intake', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }),

  listDelegations: () =>
    apiFetch<WorkspaceDelegationRecord[]>('/api/workspace-capabilities/delegations'),

  refreshDelegation: (id: string) =>
    apiFetch<WorkspaceDelegationRecord>(
      `/api/workspace-capabilities/delegations/${encodeURIComponent(id)}/refresh`,
      { method: 'POST' }
    ),
};
