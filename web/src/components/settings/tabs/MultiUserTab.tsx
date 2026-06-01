import { useMemo, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { ActionIcon, Badge, Button, Checkbox, Select, TextInput } from '@mantine/core';
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  Clipboard,
  KeyRound,
  MailPlus,
  RefreshCw,
  Shield,
  Trash2,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { useToast } from '@/hooks/useToast';
import {
  SCOPED_API_TOKEN_PERMISSIONS,
  WORKSPACE_ROLES,
  useCreateWorkspaceApiToken,
  useCreateWorkspaceInvitation,
  useIdentity,
  useRemoveWorkspaceMember,
  useRevokeWorkspaceApiToken,
  useRevokeWorkspaceInvitation,
  useRotateWorkspaceApiToken,
  useUpdateWorkspaceMemberRole,
  useWorkspaceApiTokens,
  useWorkspaceInvitations,
  useWorkspaceMembers,
  type WorkspaceRole,
} from '@/hooks/useIdentity';
import type { ClientAuthPermission } from '@veritas-kanban/shared';
import type { ApiTokenSummary, WorkspaceInvitation, WorkspaceMembership } from '@/lib/api/identity';

const ROLE_LABELS: Record<WorkspaceRole, string> = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'Member',
  reviewer: 'Reviewer',
  'read-only': 'Read-only',
  agent: 'Agent',
};

function formatDate(value: string | null | undefined) {
  if (!value) return 'Never';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
}

function invitationStatus(invitation: WorkspaceInvitation) {
  if (invitation.acceptedAt)
    return { label: 'Accepted', color: 'green', variant: 'light' as const };
  if (invitation.revokedAt) return { label: 'Revoked', color: 'red', variant: 'light' as const };
  if (Date.parse(invitation.expiresAt) <= Date.now()) {
    return { label: 'Expired', color: 'gray', variant: 'outline' as const };
  }
  return { label: 'Pending', color: 'yellow', variant: 'light' as const };
}

function tokenStatus(token: ApiTokenSummary) {
  if (token.revokedAt) return { label: 'Revoked', color: 'red', variant: 'light' as const };
  if (token.expiresAt && Date.parse(token.expiresAt) <= Date.now()) {
    return { label: 'Expired', color: 'gray', variant: 'outline' as const };
  }
  return { label: 'Active', color: 'green', variant: 'light' as const };
}

function memberName(member: WorkspaceMembership) {
  return member.user?.displayName ?? member.userId;
}

function permissionLabel(permission: ClientAuthPermission) {
  return permission.replace(':', ' ');
}

function Section({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: LucideIcon;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <h3 className="text-sm font-semibold">{title}</h3>
      </div>
      {children}
    </section>
  );
}

function PermissionEmptyState({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-dashed p-3 text-sm text-muted-foreground">
      <Shield className="mt-0.5 h-4 w-4" aria-hidden="true" />
      <span>{message}</span>
    </div>
  );
}

export function MultiUserTab() {
  const {
    activeMembership,
    activeWorkspace,
    authContext,
    canManageMembers,
    error,
    hasPermission,
    isLoading,
    profile,
    switchWorkspace,
    workspaces,
  } = useIdentity();
  const { toast } = useToast();
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<WorkspaceRole>('member');
  const [inviteExpiresAt, setInviteExpiresAt] = useState('');
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [apiTokenName, setApiTokenName] = useState('');
  const [apiTokenExpiresAt, setApiTokenExpiresAt] = useState('');
  const [apiTokenScopes, setApiTokenScopes] = useState<ClientAuthPermission[]>([
    'workspace:read',
    'task:read',
  ]);
  const [createdApiTokenSecret, setCreatedApiTokenSecret] = useState<string | null>(null);

  const workspaceId = activeWorkspace?.id ?? null;
  const canManageApiTokens = hasPermission('admin:manage');
  const membersQuery = useWorkspaceMembers(workspaceId);
  const invitationsQuery = useWorkspaceInvitations(workspaceId, canManageMembers);
  const apiTokensQuery = useWorkspaceApiTokens(workspaceId, canManageApiTokens);
  const createInvitation = useCreateWorkspaceInvitation(workspaceId);
  const createApiToken = useCreateWorkspaceApiToken(workspaceId);
  const updateMemberRole = useUpdateWorkspaceMemberRole(workspaceId);
  const removeMember = useRemoveWorkspaceMember(workspaceId);
  const revokeInvitation = useRevokeWorkspaceInvitation(workspaceId);
  const revokeApiToken = useRevokeWorkspaceApiToken(workspaceId);
  const rotateApiToken = useRotateWorkspaceApiToken(workspaceId);

  const roleOptions = useMemo(
    () =>
      activeMembership?.role === 'owner'
        ? WORKSPACE_ROLES
        : WORKSPACE_ROLES.filter((role) => role !== 'owner'),
    [activeMembership?.role]
  );
  const roleSelectData = useMemo(
    () => roleOptions.map((role) => ({ value: role, label: ROLE_LABELS[role] })),
    [roleOptions]
  );
  const workspaceSelectData = useMemo(
    () =>
      workspaces.map(({ workspace, membership }) => ({
        value: workspace.id,
        label: `${workspace.name} (${membership.role})`,
      })),
    [workspaces]
  );

  const members = membersQuery.data ?? [];
  const invitations = invitationsQuery.data ?? [];
  const apiTokens = apiTokensQuery.data ?? [];
  const selectableTokenScopes = useMemo(
    () => SCOPED_API_TOKEN_PERMISSIONS.filter((permission) => hasPermission(permission)),
    [hasPermission]
  );

  const handleCreateInvitation = async (event: FormEvent) => {
    event.preventDefault();
    if (!workspaceId) return;
    setCreatedToken(null);

    try {
      const result = await createInvitation.mutateAsync({
        email: inviteEmail.trim() || undefined,
        role: inviteRole,
        expiresAt: inviteExpiresAt ? new Date(inviteExpiresAt).toISOString() : undefined,
      });
      setCreatedToken(result.token);
      setInviteEmail('');
      setInviteExpiresAt('');
      toast({
        title: 'Invitation created',
        description: result.invitation.email ?? 'One-time invitation token is ready.',
      });
    } catch (err) {
      toast({
        title: 'Invitation failed',
        description: err instanceof Error ? err.message : 'Unable to create invitation.',
        duration: Infinity,
      });
    }
  };

  const handleCopyToken = async () => {
    if (!createdToken || !navigator.clipboard) return;
    await navigator.clipboard.writeText(createdToken);
    toast({ title: 'Invitation token copied', duration: 2500 });
  };

  const handleCreateApiToken = async (event: FormEvent) => {
    event.preventDefault();
    if (!workspaceId) return;
    setCreatedApiTokenSecret(null);

    try {
      const result = await createApiToken.mutateAsync({
        name: apiTokenName.trim(),
        scopes: apiTokenScopes,
        expiresAt: apiTokenExpiresAt ? new Date(apiTokenExpiresAt).toISOString() : null,
      });
      setCreatedApiTokenSecret(result.secret);
      setApiTokenName('');
      setApiTokenExpiresAt('');
      toast({ title: 'API token created', description: result.token.name });
    } catch (err) {
      toast({
        title: 'API token failed',
        description: err instanceof Error ? err.message : 'Unable to create API token.',
        duration: Infinity,
      });
    }
  };

  const handleToggleApiScope = (permission: ClientAuthPermission, checked: boolean) => {
    setApiTokenScopes((current) =>
      checked
        ? [...new Set([...current, permission])]
        : current.filter((scope) => scope !== permission)
    );
  };

  const handleCopyApiToken = async () => {
    if (!createdApiTokenSecret || !navigator.clipboard) return;
    await navigator.clipboard.writeText(createdApiTokenSecret);
    toast({ title: 'API token copied', duration: 2500 });
  };

  const handleRoleChange = async (member: WorkspaceMembership, role: WorkspaceRole) => {
    try {
      await updateMemberRole.mutateAsync({ userId: member.userId, role });
      toast({ title: 'Role updated', description: `${memberName(member)} is now ${role}.` });
    } catch (err) {
      toast({
        title: 'Role update failed',
        description: err instanceof Error ? err.message : 'Unable to update member role.',
        duration: Infinity,
      });
    }
  };

  const handleRemoveMember = async (member: WorkspaceMembership) => {
    try {
      await removeMember.mutateAsync(member.userId);
      toast({ title: 'Member removed', description: memberName(member) });
    } catch (err) {
      toast({
        title: 'Remove failed',
        description: err instanceof Error ? err.message : 'Unable to remove member.',
        duration: Infinity,
      });
    }
  };

  const handleRevokeInvitation = async (invitation: WorkspaceInvitation) => {
    try {
      await revokeInvitation.mutateAsync(invitation.id);
      toast({ title: 'Invitation revoked', description: invitation.email ?? invitation.id });
    } catch (err) {
      toast({
        title: 'Revoke failed',
        description: err instanceof Error ? err.message : 'Unable to revoke invitation.',
        duration: Infinity,
      });
    }
  };

  const handleRevokeApiToken = async (token: ApiTokenSummary) => {
    try {
      await revokeApiToken.mutateAsync(token.id);
      toast({ title: 'API token revoked', description: token.name });
    } catch (err) {
      toast({
        title: 'Revoke failed',
        description: err instanceof Error ? err.message : 'Unable to revoke API token.',
        duration: Infinity,
      });
    }
  };

  const handleRotateApiToken = async (token: ApiTokenSummary) => {
    try {
      const result = await rotateApiToken.mutateAsync(token.id);
      setCreatedApiTokenSecret(result.secret);
      toast({ title: 'API token rotated', description: token.name });
    } catch (err) {
      toast({
        title: 'Rotate failed',
        description: err instanceof Error ? err.message : 'Unable to rotate API token.',
        duration: Infinity,
      });
    }
  };

  if (isLoading) {
    return <div className="text-sm text-muted-foreground">Loading workspace access...</div>;
  }

  if (error) {
    return (
      <div className="flex items-start gap-2 rounded-md border border-destructive/40 p-3 text-sm">
        <AlertTriangle className="mt-0.5 h-4 w-4 text-destructive" aria-hidden="true" />
        <div>
          <div className="font-medium text-destructive">Unable to load identity data</div>
          <div className="text-muted-foreground">{error.message}</div>
        </div>
      </div>
    );
  }

  if (!activeWorkspace || !activeMembership) {
    return <PermissionEmptyState message="No active workspace membership is available." />;
  }

  return (
    <div className="space-y-6">
      <Section title="Workspace" icon={Building2}>
        <div className="grid gap-3 rounded-md border p-3 sm:grid-cols-[1fr_auto]">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <div className="truncate font-medium">{activeWorkspace.name}</div>
              <Badge variant="light" color="gray" className="capitalize">
                {activeMembership.role}
              </Badge>
              <Badge variant="outline" color="gray" className="capitalize">
                {activeWorkspace.mode}
              </Badge>
            </div>
            <div className="text-sm text-muted-foreground">
              {activeWorkspace.description ?? 'Workspace access is active.'}
            </div>
          </div>
          <Select
            data={workspaceSelectData}
            value={activeWorkspace.id}
            onChange={(value) => {
              if (value) {
                void switchWorkspace(value);
              }
            }}
            aria-label="Active workspace"
            className="w-full sm:w-56"
            size="sm"
            radius="md"
          />
        </div>
      </Section>

      <Section title="Members" icon={Users}>
        {membersQuery.isLoading ? (
          <div className="text-sm text-muted-foreground">Loading members...</div>
        ) : members.length === 0 ? (
          <PermissionEmptyState message="No active members were returned for this workspace." />
        ) : (
          <div className="overflow-hidden rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Member</th>
                  <th className="px-3 py-2 text-left font-medium">Role</th>
                  <th className="px-3 py-2 text-left font-medium">Joined</th>
                  <th className="px-3 py-2 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {members.map((member) => {
                  const isSelf = member.userId === profile?.user.id;
                  const canEditMember =
                    canManageMembers &&
                    (activeMembership.role === 'owner' || member.role !== 'owner');
                  return (
                    <tr key={member.userId} className="border-t">
                      <td className="px-3 py-2">
                        <div className="font-medium">{memberName(member)}</div>
                        <div className="text-xs text-muted-foreground">
                          {member.user?.email ?? member.userId}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <Select
                          data={roleSelectData}
                          value={member.role}
                          onChange={(role) => {
                            if (role) {
                              void handleRoleChange(member, role as WorkspaceRole);
                            }
                          }}
                          disabled={!canEditMember}
                          aria-label={`Role for ${memberName(member)}`}
                          w={144}
                          size="xs"
                          radius="md"
                        />
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {formatDate(member.joinedAt)}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <ActionIcon
                          type="button"
                          variant="subtle"
                          color="red"
                          size="sm"
                          radius="md"
                          onClick={() => void handleRemoveMember(member)}
                          disabled={!canEditMember || isSelf}
                          aria-label={`Remove ${memberName(member)}`}
                          title={
                            isSelf
                              ? 'Cannot remove your own active session'
                              : canEditMember
                                ? 'Remove member'
                                : 'Owner or admin permission required'
                          }
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                        </ActionIcon>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="Invitations" icon={MailPlus}>
        {!canManageMembers ? (
          <PermissionEmptyState message="Owner or admin permission is required to view and send invitations." />
        ) : (
          <div className="space-y-3">
            <form
              className="grid gap-3 rounded-md border p-3 sm:grid-cols-2"
              onSubmit={handleCreateInvitation}
            >
              <TextInput
                className="sm:col-span-2"
                id="invite-email"
                type="email"
                label="Email"
                value={inviteEmail}
                onChange={(event) => setInviteEmail(event.target.value)}
                placeholder="person@example.com"
                size="sm"
                radius="md"
              />
              <Select
                data={roleSelectData}
                label="Role"
                value={inviteRole}
                onChange={(role) => {
                  if (role) {
                    setInviteRole(role as WorkspaceRole);
                  }
                }}
                aria-label="Invitation role"
                size="sm"
                radius="md"
              />
              <TextInput
                id="invite-expires"
                type="datetime-local"
                label="Expires"
                value={inviteExpiresAt}
                onChange={(event) => setInviteExpiresAt(event.target.value)}
                size="sm"
                radius="md"
              />
              <div className="flex items-end sm:col-span-2 sm:justify-end">
                <Button
                  type="submit"
                  disabled={createInvitation.isPending}
                  className="w-full sm:w-auto"
                  radius="md"
                  leftSection={<MailPlus className="h-4 w-4" aria-hidden="true" />}
                >
                  Send
                </Button>
              </div>
            </form>

            {createdToken && (
              <div className="grid gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/5 p-3">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <CheckCircle2 className="h-4 w-4 text-emerald-500" aria-hidden="true" />
                  One-time invitation token
                </div>
                <div className="flex gap-2">
                  <TextInput
                    value={createdToken}
                    readOnly
                    className="flex-1"
                    classNames={{ input: 'font-mono text-xs' }}
                    size="sm"
                    radius="md"
                  />
                  <ActionIcon
                    type="button"
                    variant="outline"
                    onClick={() => void handleCopyToken()}
                    aria-label="Copy invitation token"
                    size="lg"
                    radius="md"
                  >
                    <Clipboard className="h-4 w-4" aria-hidden="true" />
                  </ActionIcon>
                </div>
              </div>
            )}

            {invitationsQuery.isLoading ? (
              <div className="text-sm text-muted-foreground">Loading invitations...</div>
            ) : invitations.length === 0 ? (
              <PermissionEmptyState message="No invitations have been created for this workspace." />
            ) : (
              <div className="space-y-2">
                {invitations.map((invitation) => {
                  const status = invitationStatus(invitation);
                  const canRevoke = status.label === 'Pending';
                  return (
                    <div
                      key={invitation.id}
                      className="flex items-center justify-between gap-3 rounded-md border p-3"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="truncate font-medium">
                            {invitation.email ?? invitation.id}
                          </span>
                          <Badge variant={status.variant} color={status.color}>
                            {status.label}
                          </Badge>
                          <Badge variant="outline" color="gray">
                            {ROLE_LABELS[invitation.role]}
                          </Badge>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Expires {formatDate(invitation.expiresAt)}
                        </div>
                      </div>
                      <Button
                        type="button"
                        variant="subtle"
                        color="gray"
                        size="sm"
                        radius="md"
                        onClick={() => void handleRevokeInvitation(invitation)}
                        disabled={!canRevoke || revokeInvitation.isPending}
                      >
                        Revoke
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </Section>

      <Section title="API Access" icon={KeyRound}>
        <div className="space-y-3 rounded-md border p-3">
          <div className="grid gap-2 text-sm sm:grid-cols-3">
            <div>
              <div className="text-xs uppercase text-muted-foreground">Auth method</div>
              <div className="font-medium">{authContext?.authMethod ?? 'unknown'}</div>
            </div>
            <div>
              <div className="text-xs uppercase text-muted-foreground">Actor</div>
              <div className="font-medium">{authContext?.actorType ?? 'unknown'}</div>
            </div>
            <div>
              <div className="text-xs uppercase text-muted-foreground">Token</div>
              <div className="font-medium">{authContext?.tokenName ?? 'session'}</div>
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {(authContext?.permissions ?? []).slice(0, 10).map((permission) => (
              <Badge
                key={permission}
                variant="outline"
                color="gray"
                className="font-mono text-[11px]"
              >
                {permission}
              </Badge>
            ))}
            {(authContext?.permissions?.length ?? 0) > 10 && (
              <Badge variant="light" color="gray">
                +{(authContext?.permissions?.length ?? 0) - 10}
              </Badge>
            )}
          </div>
          {!canManageApiTokens ? (
            <PermissionEmptyState message="Owner or admin permission is required to create and manage scoped API tokens." />
          ) : (
            <div className="space-y-3">
              <form className="grid gap-3 rounded-md border p-3" onSubmit={handleCreateApiToken}>
                <div className="grid gap-3 sm:grid-cols-2">
                  <TextInput
                    id="api-token-name"
                    label="Name"
                    value={apiTokenName}
                    onChange={(event) => setApiTokenName(event.target.value)}
                    placeholder="Automation worker"
                    size="sm"
                    radius="md"
                  />
                  <TextInput
                    id="api-token-expires"
                    type="datetime-local"
                    label="Expires"
                    value={apiTokenExpiresAt}
                    onChange={(event) => setApiTokenExpiresAt(event.target.value)}
                    size="sm"
                    radius="md"
                  />
                </div>
                <div className="grid gap-2">
                  <div className="text-sm font-medium">Scopes</div>
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {selectableTokenScopes.map((permission) => {
                      return (
                        <div
                          key={permission}
                          className="flex items-center gap-2 rounded-md border px-2.5 py-2 text-xs"
                        >
                          <Checkbox
                            checked={apiTokenScopes.includes(permission)}
                            onChange={(event) =>
                              handleToggleApiScope(permission, event.currentTarget.checked)
                            }
                            label={<span className="font-mono">{permissionLabel(permission)}</span>}
                            radius="sm"
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
                <div className="flex justify-end">
                  <Button
                    type="submit"
                    disabled={
                      createApiToken.isPending ||
                      apiTokenName.trim().length === 0 ||
                      apiTokenScopes.length === 0
                    }
                    className="w-full sm:w-auto"
                    radius="md"
                    leftSection={<KeyRound className="h-4 w-4" aria-hidden="true" />}
                  >
                    Create
                  </Button>
                </div>
              </form>

              {createdApiTokenSecret && (
                <div className="grid gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/5 p-3">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <CheckCircle2 className="h-4 w-4 text-emerald-500" aria-hidden="true" />
                    One-time API token
                  </div>
                  <div className="flex gap-2">
                    <TextInput
                      value={createdApiTokenSecret}
                      readOnly
                      className="flex-1"
                      classNames={{ input: 'font-mono text-xs' }}
                      size="sm"
                      radius="md"
                    />
                    <ActionIcon
                      type="button"
                      variant="outline"
                      onClick={() => void handleCopyApiToken()}
                      aria-label="Copy API token"
                      size="lg"
                      radius="md"
                    >
                      <Clipboard className="h-4 w-4" aria-hidden="true" />
                    </ActionIcon>
                  </div>
                </div>
              )}

              {apiTokensQuery.isLoading ? (
                <div className="text-sm text-muted-foreground">Loading API tokens...</div>
              ) : apiTokens.length === 0 ? (
                <PermissionEmptyState message="No scoped API tokens have been created for this workspace." />
              ) : (
                <div className="space-y-2">
                  {apiTokens.map((token) => {
                    const status = tokenStatus(token);
                    const isActive = status.label === 'Active';
                    return (
                      <div key={token.id} className="rounded-md border p-3">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0 space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="truncate font-medium">{token.name}</span>
                              <Badge variant={status.variant} color={status.color}>
                                {status.label}
                              </Badge>
                              <Badge variant="outline" color="gray" className="font-mono">
                                {token.tokenPrefix}...
                              </Badge>
                            </div>
                            <div className="text-xs text-muted-foreground">
                              Created {formatDate(token.createdAt)} · Last used{' '}
                              {formatDate(token.lastUsedAt)} · Expires {formatDate(token.expiresAt)}
                            </div>
                          </div>
                          <div className="flex items-center gap-1">
                            <ActionIcon
                              type="button"
                              variant="subtle"
                              color="gray"
                              size="sm"
                              radius="md"
                              onClick={() => void handleRotateApiToken(token)}
                              disabled={rotateApiToken.isPending}
                              aria-label={`Rotate ${token.name}`}
                              title="Rotate token"
                            >
                              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                            </ActionIcon>
                            <ActionIcon
                              type="button"
                              variant="subtle"
                              color="red"
                              size="sm"
                              radius="md"
                              onClick={() => void handleRevokeApiToken(token)}
                              disabled={!isActive || revokeApiToken.isPending}
                              aria-label={`Revoke ${token.name}`}
                              title="Revoke token"
                            >
                              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                            </ActionIcon>
                          </div>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {token.scopes.map((scope) => (
                            <Badge
                              key={scope}
                              variant="outline"
                              color="gray"
                              className="font-mono text-[11px]"
                            >
                              {scope}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </Section>
    </div>
  );
}
