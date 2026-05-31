import type { ClientAuthContext, ClientAuthPermission } from '@veritas-kanban/shared';
import { apiFetch } from './helpers';

export const WORKSPACE_ROLES = [
  'owner',
  'admin',
  'member',
  'reviewer',
  'read-only',
  'agent',
] as const;

export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

export interface IdentityUser {
  id: string;
  displayName: string;
  email: string | null;
  handle: string | null;
  authSubject: string | null;
  avatarUrl: string | null;
  disabledAt: string | null;
  lastSeenAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceIdentity {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  mode: string;
  createdBy: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceMembership {
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
  status: string;
  invitedBy: string | null;
  joinedAt: string | null;
  disabledAt: string | null;
  createdAt: string;
  updatedAt: string;
  user?: IdentityUser;
}

export interface WorkspaceInvitation {
  id: string;
  workspaceId: string;
  email: string | null;
  role: WorkspaceRole;
  tokenHash: string;
  invitedBy: string;
  createdAt: string;
  expiresAt: string;
  acceptedBy: string | null;
  acceptedAt: string | null;
  revokedAt: string | null;
}

export interface IdentityProfile {
  user: IdentityUser;
  workspaces: Array<{
    workspace: WorkspaceIdentity;
    membership: WorkspaceMembership;
  }>;
}

export interface CreateInvitationInput {
  email?: string;
  role: WorkspaceRole;
  expiresAt?: string;
}

export interface CreateInvitationResult {
  invitation: WorkspaceInvitation;
  token: string;
}

export interface ApiTokenSummary {
  name: string;
  authMethod: string;
  tokenName?: string;
  permissions: ClientAuthPermission[];
}

export const identityApi = {
  getAuthContext: () => apiFetch<ClientAuthContext>('/api/auth/context'),

  getProfile: () => apiFetch<IdentityProfile>('/api/identity/profile'),

  listWorkspaces: () => apiFetch<IdentityProfile['workspaces']>('/api/identity/workspaces'),

  switchWorkspace: (workspaceId: string) =>
    apiFetch<{ workspace: WorkspaceIdentity; membership: WorkspaceMembership }>(
      '/api/identity/workspaces/switch',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId }),
      }
    ),

  listMembers: (workspaceId: string) =>
    apiFetch<WorkspaceMembership[]>(
      `/api/identity/workspaces/${encodeURIComponent(workspaceId)}/members`
    ),

  listInvitations: (workspaceId: string) =>
    apiFetch<WorkspaceInvitation[]>(
      `/api/identity/workspaces/${encodeURIComponent(workspaceId)}/invitations`
    ),

  createInvitation: (workspaceId: string, input: CreateInvitationInput) =>
    apiFetch<CreateInvitationResult>(
      `/api/identity/workspaces/${encodeURIComponent(workspaceId)}/invitations`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      }
    ),

  revokeInvitation: (invitationId: string) =>
    apiFetch<WorkspaceInvitation>(
      `/api/identity/invitations/${encodeURIComponent(invitationId)}/revoke`,
      {
        method: 'POST',
      }
    ),

  updateMemberRole: (workspaceId: string, userId: string, role: WorkspaceRole) =>
    apiFetch<WorkspaceMembership>(
      `/api/identity/workspaces/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(
        userId
      )}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role }),
      }
    ),

  removeMember: (workspaceId: string, userId: string) =>
    apiFetch<WorkspaceMembership>(
      `/api/identity/workspaces/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(
        userId
      )}`,
      {
        method: 'DELETE',
      }
    ),
};
