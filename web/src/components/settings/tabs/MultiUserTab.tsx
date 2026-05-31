import { useMemo, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  Clipboard,
  KeyRound,
  MailPlus,
  Shield,
  Trash2,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/useToast';
import {
  WORKSPACE_ROLES,
  useCreateWorkspaceInvitation,
  useIdentity,
  useRemoveWorkspaceMember,
  useRevokeWorkspaceInvitation,
  useUpdateWorkspaceMemberRole,
  useWorkspaceInvitations,
  useWorkspaceMembers,
  type WorkspaceRole,
} from '@/hooks/useIdentity';
import type { WorkspaceInvitation, WorkspaceMembership } from '@/lib/api/identity';

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
  if (invitation.acceptedAt) return { label: 'Accepted', variant: 'secondary' as const };
  if (invitation.revokedAt) return { label: 'Revoked', variant: 'destructive' as const };
  if (Date.parse(invitation.expiresAt) <= Date.now()) {
    return { label: 'Expired', variant: 'outline' as const };
  }
  return { label: 'Pending', variant: 'secondary' as const };
}

function memberName(member: WorkspaceMembership) {
  return member.user?.displayName ?? member.userId;
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

  const workspaceId = activeWorkspace?.id ?? null;
  const membersQuery = useWorkspaceMembers(workspaceId);
  const invitationsQuery = useWorkspaceInvitations(workspaceId, canManageMembers);
  const createInvitation = useCreateWorkspaceInvitation(workspaceId);
  const updateMemberRole = useUpdateWorkspaceMemberRole(workspaceId);
  const removeMember = useRemoveWorkspaceMember(workspaceId);
  const revokeInvitation = useRevokeWorkspaceInvitation(workspaceId);

  const roleOptions = useMemo(
    () =>
      activeMembership?.role === 'owner'
        ? WORKSPACE_ROLES
        : WORKSPACE_ROLES.filter((role) => role !== 'owner'),
    [activeMembership?.role]
  );

  const canWriteSettings = hasPermission('settings:write');
  const canManageApiTokens = hasPermission('admin:manage');
  const members = membersQuery.data ?? [];
  const invitations = invitationsQuery.data ?? [];

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
              <Badge variant="secondary" className="capitalize">
                {activeMembership.role}
              </Badge>
              <Badge variant="outline" className="capitalize">
                {activeWorkspace.mode}
              </Badge>
            </div>
            <div className="text-sm text-muted-foreground">
              {activeWorkspace.description ?? 'Workspace access is active.'}
            </div>
          </div>
          <Select value={activeWorkspace.id} onValueChange={(value) => void switchWorkspace(value)}>
            <SelectTrigger className="w-full sm:w-56" aria-label="Active workspace">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {workspaces.map(({ workspace, membership }) => (
                <SelectItem key={workspace.id} value={workspace.id}>
                  {workspace.name} ({membership.role})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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
                          value={member.role}
                          onValueChange={(role) =>
                            void handleRoleChange(member, role as WorkspaceRole)
                          }
                          disabled={!canEditMember}
                        >
                          <SelectTrigger
                            className="h-8 w-36"
                            aria-label={`Role for ${memberName(member)}`}
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {roleOptions.map((role) => (
                              <SelectItem key={role} value={role}>
                                {ROLE_LABELS[role]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {formatDate(member.joinedAt)}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => void handleRemoveMember(member)}
                          disabled={!canEditMember || isSelf}
                          title={
                            isSelf
                              ? 'Cannot remove your own active session'
                              : canEditMember
                                ? 'Remove member'
                                : 'Owner or admin permission required'
                          }
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                        </Button>
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
              <div className="grid gap-1.5 sm:col-span-2">
                <Label htmlFor="invite-email">Email</Label>
                <Input
                  id="invite-email"
                  type="email"
                  value={inviteEmail}
                  onChange={(event) => setInviteEmail(event.target.value)}
                  placeholder="person@example.com"
                />
              </div>
              <div className="grid gap-1.5">
                <Label>Role</Label>
                <Select
                  value={inviteRole}
                  onValueChange={(role) => setInviteRole(role as WorkspaceRole)}
                >
                  <SelectTrigger aria-label="Invitation role">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {roleOptions.map((role) => (
                      <SelectItem key={role} value={role}>
                        {ROLE_LABELS[role]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="invite-expires">Expires</Label>
                <Input
                  id="invite-expires"
                  type="datetime-local"
                  value={inviteExpiresAt}
                  onChange={(event) => setInviteExpiresAt(event.target.value)}
                />
              </div>
              <div className="flex items-end sm:col-span-2 sm:justify-end">
                <Button
                  type="submit"
                  disabled={createInvitation.isPending}
                  className="w-full sm:w-auto"
                >
                  <MailPlus className="mr-2 h-4 w-4" aria-hidden="true" />
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
                  <Input value={createdToken} readOnly className="font-mono text-xs" />
                  <Button type="button" variant="outline" onClick={() => void handleCopyToken()}>
                    <Clipboard className="h-4 w-4" aria-hidden="true" />
                  </Button>
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
                          <Badge variant={status.variant}>{status.label}</Badge>
                          <Badge variant="outline">{ROLE_LABELS[invitation.role]}</Badge>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Expires {formatDate(invitation.expiresAt)}
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
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
              <Badge key={permission} variant="outline" className="font-mono text-[11px]">
                {permission}
              </Badge>
            ))}
            {(authContext?.permissions?.length ?? 0) > 10 && (
              <Badge variant="secondary">+{(authContext?.permissions?.length ?? 0) - 10}</Badge>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              disabled
              title={
                canManageApiTokens
                  ? 'Scoped token API is not available yet'
                  : 'Admin manage permission required'
              }
            >
              <KeyRound className="mr-2 h-4 w-4" aria-hidden="true" />
              Create Token
            </Button>
            <span className="text-xs text-muted-foreground">
              Scoped token issuance is held until the SQLite token repository/API lands.
            </span>
          </div>
          {!canWriteSettings && (
            <PermissionEmptyState message="Settings write permission is required before token policy changes can be made." />
          )}
        </div>
      </Section>
    </div>
  );
}
