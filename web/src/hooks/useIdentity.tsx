import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  hasClientPermission,
  type ClientAuthContext,
  type ClientAuthPermission,
} from '@veritas-kanban/shared';
import {
  identityApi,
  type CreateApiTokenInput,
  type CreatePairingCodeInput,
  type CreateInvitationInput,
  type IdentityProfile,
  type WorkspaceIdentity,
  type WorkspaceMembership,
  type WorkspaceRole,
} from '@/lib/api/identity';

const ACTIVE_WORKSPACE_STORAGE_KEY = 'veritas-kanban.active-workspace-id';

export const ALL_PERMISSIONS: readonly ClientAuthPermission[] = [
  '*',
  'workspace:read',
  'task:read',
  'task:write',
  'comment:write',
  'workflow:read',
  'workflow:write',
  'workflow:execute',
  'work_product:read',
  'work_product:write',
  'report:read',
  'telemetry:read',
  'telemetry:write',
  'agent:read',
  'agent:write',
  'settings:read',
  'settings:write',
  'policy:read',
  'policy:write',
  'backup:read',
  'backup:write',
  'admin:manage',
];

export const SCOPED_API_TOKEN_PERMISSIONS = ALL_PERMISSIONS.filter(
  (permission) => permission !== '*'
);

const WORKSPACE_ROLE_PERMISSIONS: Record<WorkspaceRole, readonly ClientAuthPermission[]> = {
  owner: ALL_PERMISSIONS,
  admin: ALL_PERMISSIONS.filter((permission) => permission !== '*'),
  member: [
    'workspace:read',
    'task:read',
    'task:write',
    'comment:write',
    'workflow:read',
    'workflow:execute',
    'work_product:read',
    'work_product:write',
    'report:read',
    'telemetry:read',
    'agent:read',
    'settings:read',
  ],
  reviewer: [
    'workspace:read',
    'task:read',
    'comment:write',
    'workflow:read',
    'work_product:read',
    'report:read',
    'telemetry:read',
    'agent:read',
    'settings:read',
    'policy:read',
  ],
  'read-only': [
    'workspace:read',
    'task:read',
    'workflow:read',
    'work_product:read',
    'report:read',
    'telemetry:read',
    'agent:read',
    'settings:read',
    'policy:read',
    'backup:read',
  ],
  agent: [
    'workspace:read',
    'task:read',
    'task:write',
    'comment:write',
    'workflow:read',
    'workflow:execute',
    'work_product:read',
    'work_product:write',
    'report:read',
    'telemetry:write',
    'agent:read',
  ],
};

interface IdentityContextValue {
  authContext: ClientAuthContext | null;
  profile: IdentityProfile | null;
  workspaces: IdentityProfile['workspaces'];
  activeWorkspace: WorkspaceIdentity | null;
  activeMembership: WorkspaceMembership | null;
  activeWorkspaceId: string | null;
  isLoading: boolean;
  error: Error | null;
  canManageMembers: boolean;
  hasPermission: (permission: ClientAuthPermission) => boolean;
  switchWorkspace: (workspaceId: string) => Promise<void>;
}

const permissiveFallback: IdentityContextValue = {
  authContext: null,
  profile: null,
  workspaces: [],
  activeWorkspace: null,
  activeMembership: null,
  activeWorkspaceId: null,
  isLoading: false,
  error: null,
  canManageMembers: true,
  hasPermission: () => true,
  switchWorkspace: async () => {},
};

const IdentityContext = createContext<IdentityContextValue | null>(null);

function readStoredWorkspaceId(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(ACTIVE_WORKSPACE_STORAGE_KEY);
}

function storeWorkspaceId(workspaceId: string): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(ACTIVE_WORKSPACE_STORAGE_KEY, workspaceId);
}

function workspaceRoleAllows(role: WorkspaceRole | undefined, permission: ClientAuthPermission) {
  if (!role) return true;
  const permissions = WORKSPACE_ROLE_PERMISSIONS[role] ?? [];
  return permissions.includes('*') || permissions.includes(permission);
}

function requireWorkspaceId(workspaceId: string | null | undefined): string {
  if (!workspaceId) {
    throw new Error('Workspace is required');
  }
  return workspaceId;
}

export function IdentityProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(readStoredWorkspaceId);

  const authQuery = useQuery({
    queryKey: ['auth', 'context'],
    queryFn: identityApi.getAuthContext,
    retry: false,
  });

  const profileQuery = useQuery({
    queryKey: ['identity', 'profile'],
    queryFn: identityApi.getProfile,
    retry: false,
  });

  const workspaces = useMemo(() => profileQuery.data?.workspaces ?? [], [profileQuery.data]);

  useEffect(() => {
    if (workspaces.length === 0) return;
    const selected = activeWorkspaceId
      ? workspaces.some((entry) => entry.workspace.id === activeWorkspaceId)
      : false;
    if (!selected) {
      const nextWorkspaceId = workspaces[0].workspace.id;
      setActiveWorkspaceId(nextWorkspaceId);
      storeWorkspaceId(nextWorkspaceId);
    }
  }, [activeWorkspaceId, workspaces]);

  const switchMutation = useMutation({
    mutationFn: identityApi.switchWorkspace,
    onSuccess: async (result) => {
      setActiveWorkspaceId(result.workspace.id);
      storeWorkspaceId(result.workspace.id);
      await queryClient.invalidateQueries({ queryKey: ['identity'] });
    },
  });

  const activeEntry = useMemo(() => {
    if (workspaces.length === 0) return null;
    return workspaces.find((entry) => entry.workspace.id === activeWorkspaceId) ?? workspaces[0];
  }, [activeWorkspaceId, workspaces]);

  const authContext = authQuery.data ?? null;
  const activeMembership = activeEntry?.membership ?? null;

  const hasPermission = useCallback(
    (permission: ClientAuthPermission) => {
      const authAllows = authContext ? hasClientPermission(authContext, permission) : true;
      return authAllows && workspaceRoleAllows(activeMembership?.role, permission);
    },
    [activeMembership?.role, authContext]
  );

  const value = useMemo<IdentityContextValue>(
    () => ({
      authContext,
      profile: profileQuery.data ?? null,
      workspaces,
      activeWorkspace: activeEntry?.workspace ?? null,
      activeMembership,
      activeWorkspaceId: activeEntry?.workspace.id ?? activeWorkspaceId,
      isLoading: authQuery.isLoading || profileQuery.isLoading,
      error: (authQuery.error as Error | null) ?? (profileQuery.error as Error | null) ?? null,
      canManageMembers: hasPermission('admin:manage'),
      hasPermission,
      switchWorkspace: async (workspaceId: string) => {
        await switchMutation.mutateAsync(workspaceId);
      },
    }),
    [
      activeEntry,
      activeMembership,
      activeWorkspaceId,
      authContext,
      authQuery.error,
      authQuery.isLoading,
      hasPermission,
      profileQuery.data,
      profileQuery.error,
      profileQuery.isLoading,
      switchMutation,
      workspaces,
    ]
  );

  return <IdentityContext.Provider value={value}>{children}</IdentityContext.Provider>;
}

export function useIdentity(): IdentityContextValue {
  return useContext(IdentityContext) ?? permissiveFallback;
}

export function useWorkspaceMembers(workspaceId: string | null | undefined) {
  return useQuery({
    queryKey: ['identity', 'workspaces', workspaceId, 'members'],
    queryFn: () => identityApi.listMembers(requireWorkspaceId(workspaceId)),
    enabled: !!workspaceId,
  });
}

export function useWorkspaceInvitations(
  workspaceId: string | null | undefined,
  canManageMembers: boolean
) {
  return useQuery({
    queryKey: ['identity', 'workspaces', workspaceId, 'invitations'],
    queryFn: () => identityApi.listInvitations(requireWorkspaceId(workspaceId)),
    enabled: !!workspaceId && canManageMembers,
  });
}

export function useWorkspaceApiTokens(
  workspaceId: string | null | undefined,
  canManageApiTokens: boolean
) {
  return useQuery({
    queryKey: ['identity', 'workspaces', workspaceId, 'api-tokens'],
    queryFn: () => identityApi.listApiTokens(requireWorkspaceId(workspaceId)),
    enabled: !!workspaceId && canManageApiTokens,
  });
}

export function useWorkspaceDeviceSessions(
  workspaceId: string | null | undefined,
  canManageDeviceSessions: boolean
) {
  return useQuery({
    queryKey: ['identity', 'workspaces', workspaceId, 'device-sessions'],
    queryFn: () => identityApi.listDeviceSessions(requireWorkspaceId(workspaceId)),
    enabled: !!workspaceId && canManageDeviceSessions,
  });
}

export function useCreateWorkspaceInvitation(workspaceId: string | null | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateInvitationInput) =>
      identityApi.createInvitation(requireWorkspaceId(workspaceId), input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ['identity', 'workspaces', workspaceId, 'invitations'],
      });
    },
  });
}

export function useCreateWorkspacePairingCode(workspaceId: string | null | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreatePairingCodeInput) =>
      identityApi.createPairingCode(requireWorkspaceId(workspaceId), input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ['identity', 'workspaces', workspaceId, 'device-sessions'],
      });
    },
  });
}

export function useRevokeWorkspaceDeviceSession(workspaceId: string | null | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (sessionId: string) =>
      identityApi.revokeDeviceSession(requireWorkspaceId(workspaceId), sessionId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ['identity', 'workspaces', workspaceId, 'device-sessions'],
      });
    },
  });
}

export function useTestWorkspaceDeviceSession(workspaceId: string | null | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (sessionId: string) =>
      identityApi.testDeviceSession(requireWorkspaceId(workspaceId), sessionId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ['identity', 'workspaces', workspaceId, 'device-sessions'],
      });
    },
  });
}

export function useCreateWorkspaceApiToken(workspaceId: string | null | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateApiTokenInput) =>
      identityApi.createApiToken(requireWorkspaceId(workspaceId), input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ['identity', 'workspaces', workspaceId, 'api-tokens'],
      });
    },
  });
}

export function useRevokeWorkspaceApiToken(workspaceId: string | null | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (tokenId: string) =>
      identityApi.revokeApiToken(requireWorkspaceId(workspaceId), tokenId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ['identity', 'workspaces', workspaceId, 'api-tokens'],
      });
    },
  });
}

export function useRotateWorkspaceApiToken(workspaceId: string | null | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (tokenId: string) =>
      identityApi.rotateApiToken(requireWorkspaceId(workspaceId), tokenId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ['identity', 'workspaces', workspaceId, 'api-tokens'],
      });
    },
  });
}

export function useUpdateWorkspaceMemberRole(workspaceId: string | null | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: WorkspaceRole }) =>
      identityApi.updateMemberRole(requireWorkspaceId(workspaceId), userId, role),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ['identity', 'workspaces', workspaceId, 'members'],
        }),
        queryClient.invalidateQueries({ queryKey: ['identity', 'profile'] }),
      ]);
    },
  });
}

export function useRemoveWorkspaceMember(workspaceId: string | null | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (userId: string) =>
      identityApi.removeMember(requireWorkspaceId(workspaceId), userId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ['identity', 'workspaces', workspaceId, 'members'],
      });
    },
  });
}

export function useRevokeWorkspaceInvitation(workspaceId: string | null | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: identityApi.revokeInvitation,
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ['identity', 'workspaces', workspaceId, 'invitations'],
      });
    },
  });
}

export { WORKSPACE_ROLES, type WorkspaceRole } from '@/lib/api/identity';
