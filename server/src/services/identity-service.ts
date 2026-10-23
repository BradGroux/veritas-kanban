import { createHash, randomBytes } from 'node:crypto';
import { ForbiddenError, NotFoundError, ValidationError } from '../middleware/error-handler.js';
import type { AuthPermission } from '../middleware/auth.js';
import { auditLog, type AuditEvent } from './audit-service.js';
import { ActivityService } from './activity-service.js';
import { SqliteDatabase, type SqliteConnectionOptions } from '../storage/sqlite/database.js';
import {
  WORKSPACE_ROLES,
  SqliteIdentityRepository,
  type IdentityUser,
  type WorkspaceIdentity,
  type WorkspaceInvitation,
  type WorkspaceMembership,
  type WorkspaceRole,
} from '../storage/sqlite/identity-repository.js';

const DEFAULT_INVITATION_TTL_DAYS = 7;
const MANAGER_ROLES = new Set<WorkspaceRole>(['owner', 'admin']);

export interface IdentityActor {
  userId: string;
  role: WorkspaceRole;
  displayName?: string;
  permissions?: AuthPermission[];
  /** Set only from a verified installation-password context. */
  installationOwner?: boolean;
}

export interface CreateInvitationResult {
  invitation: WorkspaceInvitation;
  token: string;
}

export interface IdentityServiceOptions {
  repository?: SqliteIdentityRepository;
  sqliteDatabase?: SqliteDatabase;
  sqliteConnectionOptions?: SqliteConnectionOptions;
  audit?: (event: AuditEvent) => Promise<void>;
  activity?: Pick<ActivityService, 'logActivity'>;
}

export interface ExternalIdentitySession {
  user: IdentityUser;
  workspace: WorkspaceIdentity;
  membership: WorkspaceMembership;
}

export class IdentityService {
  private readonly repository: SqliteIdentityRepository;
  private readonly sqliteDatabase: SqliteDatabase | null = null;
  private readonly ownsSqliteDatabase: boolean = false;
  private readonly audit: (event: AuditEvent) => Promise<void>;
  private readonly activity: Pick<ActivityService, 'logActivity'>;

  constructor(options: IdentityServiceOptions = {}) {
    if (options.repository) {
      this.repository = options.repository;
    } else {
      this.sqliteDatabase =
        options.sqliteDatabase ?? new SqliteDatabase(options.sqliteConnectionOptions);
      this.ownsSqliteDatabase = !options.sqliteDatabase;
      this.sqliteDatabase.open();
      this.repository = new SqliteIdentityRepository(this.sqliteDatabase);
    }

    this.audit = options.audit ?? auditLog;
    this.activity =
      options.activity ??
      new ActivityService({
        storageType: process.env.VERITAS_STORAGE === 'sqlite' ? 'sqlite' : 'file',
        sqliteDatabase: options.sqliteDatabase,
      });
  }

  ensureOwnerSetup(
    input: { displayName?: string; email?: string | null; restoreOwner?: boolean } = {}
  ): {
    user: IdentityUser;
    workspace: WorkspaceIdentity;
    membership: WorkspaceMembership;
  } {
    return this.repository.ensureLocalOwner(input);
  }

  resolveFederatedSession(userId: string, workspaceId: string): ExternalIdentitySession | null {
    const user = this.repository.getUser(userId);
    const workspace = this.repository.getWorkspace(workspaceId);
    const membership = this.repository.getMembership(workspaceId, userId);
    if (
      !user ||
      user.disabledAt ||
      !user.authSubject ||
      !workspace ||
      workspace.archivedAt ||
      !membership ||
      membership.status !== 'active' ||
      membership.disabledAt
    )
      return null;
    return { user, workspace, membership };
  }

  resolveExternalIdentity(
    input: {
      issuer: string;
      clientId: string;
      subject: string;
      email: string | null;
      emailVerified: boolean;
      displayName: string;
      avatarUrl: string | null;
    },
    link?: { userId: string; workspaceId: string }
  ): ExternalIdentitySession {
    const authSubject = JSON.stringify([input.issuer, input.clientId, input.subject]);
    let user = this.repository.getUserByAuthSubject(authSubject);

    if (user && link && user.id !== link.userId) {
      throw new ForbiddenError('This ChatGPT identity is already linked to another Veritas user');
    }

    if (!user && !link) {
      throw new ForbiddenError(
        'This ChatGPT identity is not linked. Sign in with an existing Veritas method to link it.'
      );
    }

    if (!user && link) {
      const linkUser = this.repository.getUser(link.userId);
      const membership = this.repository.getMembership(link.workspaceId, link.userId);
      if (
        !linkUser ||
        linkUser.disabledAt ||
        !membership ||
        membership.status !== 'active' ||
        membership.disabledAt
      ) {
        throw new ForbiddenError('The authenticated Veritas account cannot be linked');
      }
      if (linkUser.authSubject && linkUser.authSubject !== authSubject) {
        throw new ForbiddenError('This Veritas user is already linked to another identity');
      }
      user = this.repository.bindExternalIdentity({
        userId: linkUser.id,
        authSubject,
      });
    } else if (user) {
      user = this.repository.bindExternalIdentity({
        userId: user.id,
        authSubject,
      });
    }

    if (!user || user.disabledAt) throw new ForbiddenError('Veritas user is disabled');
    const memberships = this.repository.listWorkspacesForUser(user.id);
    const selected =
      memberships.find(({ workspace }) => workspace.id === link?.workspaceId) ??
      memberships.find(({ workspace }) => workspace.id === 'local') ??
      memberships[0];
    if (!selected || selected.membership.status !== 'active' || selected.membership.disabledAt) {
      throw new ForbiddenError('No active Veritas workspace membership');
    }
    return { user, workspace: selected.workspace, membership: selected.membership };
  }

  getProfile(actor: IdentityActor): {
    user: IdentityUser;
    workspaces: Array<{ workspace: WorkspaceIdentity; membership: WorkspaceMembership }>;
  } {
    this.ensureOwnerSetup({ restoreOwner: actor.installationOwner === true });
    const user = this.repository.getUser(actor.userId) ?? this.repository.getUser('local-user');
    if (!user) throw new NotFoundError('User not found');

    return {
      user,
      workspaces: this.repository.listWorkspacesForUser(user.id),
    };
  }

  listWorkspaces(actor: IdentityActor): Array<{
    workspace: WorkspaceIdentity;
    membership: WorkspaceMembership;
  }> {
    this.ensureOwnerSetup({ restoreOwner: actor.installationOwner === true });
    return this.repository.listWorkspacesForUser(actor.userId);
  }

  switchWorkspace(
    workspaceId: string,
    actor: IdentityActor
  ): { workspace: WorkspaceIdentity; membership: WorkspaceMembership } {
    this.ensureOwnerSetup({ restoreOwner: actor.installationOwner === true });
    const membership = this.repository.getMembership(workspaceId, actor.userId);
    if (!membership || membership.status !== 'active') {
      throw new ForbiddenError('No active membership for workspace');
    }

    const workspace = this.repository.getWorkspace(workspaceId);
    if (!workspace) throw new NotFoundError('Workspace not found');

    return { workspace, membership };
  }

  listMembers(workspaceId: string, actor: IdentityActor): WorkspaceMembership[] {
    this.assertWorkspaceAccess(workspaceId, actor);
    return this.repository.listMembers(workspaceId);
  }

  listInvitations(workspaceId: string, actor: IdentityActor): WorkspaceInvitation[] {
    this.assertCanManageMembers(workspaceId, actor);
    return this.repository.listInvitations(workspaceId, { includeInactive: true });
  }

  async createInvitation(
    input: {
      workspaceId: string;
      email?: string | null;
      role: WorkspaceRole;
      expiresAt?: string | null;
    },
    actor: IdentityActor
  ): Promise<CreateInvitationResult> {
    this.assertCanManageMembers(input.workspaceId, actor);
    this.assertAssignableRole(input.role, actor);

    const token = randomBytes(32).toString('hex');
    const invitation = this.repository.createInvitation({
      workspaceId: input.workspaceId,
      email: input.email,
      role: input.role,
      tokenHash: hashInvitationToken(token),
      invitedBy: actor.userId,
      expiresAt: input.expiresAt ?? defaultInvitationExpiry(),
    });

    await this.recordIdentityChange('identity.invitation.create', actor, input.workspaceId, {
      invitationId: invitation.id,
      email: invitation.email,
      role: invitation.role,
    });

    return { invitation, token };
  }

  async acceptInvitation(input: {
    token: string;
    displayName?: string | null;
    email?: string | null;
  }): Promise<{
    invitation: WorkspaceInvitation;
    user: IdentityUser;
    membership: WorkspaceMembership;
  }> {
    const tokenHash = hashInvitationToken(input.token);
    const invitation = this.repository.getInvitationByTokenHash(tokenHash);
    if (!invitation) throw new NotFoundError('Invitation not found');
    if (invitation.revokedAt) throw new ValidationError('Invitation has been revoked');
    if (invitation.acceptedAt) throw new ValidationError('Invitation has already been accepted');
    if (Date.parse(invitation.expiresAt) <= Date.now()) {
      throw new ValidationError('Invitation has expired');
    }

    const result = this.repository.acceptInvitation({
      tokenHash,
      displayName: input.displayName,
      email: input.email,
    });

    await this.recordIdentityChange(
      'identity.invitation.accept',
      {
        userId: result.user.id,
        role: result.membership.role,
        displayName: result.user.displayName,
      },
      result.invitation.workspaceId,
      {
        invitationId: result.invitation.id,
        role: result.membership.role,
      }
    );

    return result;
  }

  async revokeInvitation(invitationId: string, actor: IdentityActor): Promise<WorkspaceInvitation> {
    const existing = this.repository.getInvitation(invitationId);
    if (!existing) throw new NotFoundError('Invitation not found');

    this.assertCanManageMembers(existing.workspaceId, actor);
    const invitation = this.repository.revokeInvitation(invitationId);
    if (!invitation) throw new ValidationError('Invitation cannot be revoked');

    await this.recordIdentityChange('identity.invitation.revoke', actor, invitation.workspaceId, {
      invitationId,
    });

    return invitation;
  }

  async updateMemberRole(
    workspaceId: string,
    userId: string,
    role: WorkspaceRole,
    actor: IdentityActor
  ): Promise<WorkspaceMembership> {
    this.assertCanManageMembers(workspaceId, actor);
    this.assertAssignableRole(role, actor);

    const existing = this.repository.getMembership(workspaceId, userId);
    if (!existing || existing.status !== 'active') throw new NotFoundError('Member not found');
    if (
      existing.role === 'owner' &&
      role !== 'owner' &&
      this.repository.countActiveOwners(workspaceId) <= 1
    ) {
      throw new ValidationError('Cannot remove the last workspace owner role');
    }

    const membership = this.repository.updateMembershipRole(workspaceId, userId, role);
    if (!membership) throw new NotFoundError('Member not found');

    await this.recordIdentityChange('identity.member.role_update', actor, workspaceId, {
      userId,
      previousRole: existing.role,
      role,
    });

    return membership;
  }

  async removeMember(
    workspaceId: string,
    userId: string,
    actor: IdentityActor
  ): Promise<WorkspaceMembership> {
    this.assertCanManageMembers(workspaceId, actor);

    const existing = this.repository.getMembership(workspaceId, userId);
    if (!existing || existing.status !== 'active') throw new NotFoundError('Member not found');
    if (existing.role === 'owner' && this.repository.countActiveOwners(workspaceId) <= 1) {
      throw new ValidationError('Cannot remove the last workspace owner');
    }

    const membership = this.repository.removeMembership(workspaceId, userId);
    if (!membership) throw new NotFoundError('Member not found');

    await this.recordIdentityChange('identity.member.remove', actor, workspaceId, {
      userId,
      role: existing.role,
    });

    return membership;
  }

  close(): void {
    if (this.ownsSqliteDatabase) {
      this.sqliteDatabase?.close();
    }
  }

  private assertWorkspaceAccess(workspaceId: string, actor: IdentityActor): void {
    this.ensureOwnerSetup({ restoreOwner: actor.installationOwner === true });
    const membership = this.repository.getMembership(workspaceId, actor.userId);
    if (!membership || membership.status !== 'active') {
      throw new ForbiddenError('No active membership for workspace');
    }
  }

  private assertCanManageMembers(workspaceId: string, actor: IdentityActor): void {
    this.assertWorkspaceAccess(workspaceId, actor);
    const membership = this.repository.getMembership(workspaceId, actor.userId);
    const effectiveRole = membership?.role ?? actor.role;
    if (!MANAGER_ROLES.has(effectiveRole)) {
      throw new ForbiddenError('Only workspace owners and admins can manage members');
    }
  }

  private assertAssignableRole(role: WorkspaceRole, actor: IdentityActor): void {
    if (!WORKSPACE_ROLES.includes(role)) {
      throw new ValidationError('Invalid workspace role');
    }
    if (role === 'owner' && actor.role !== 'owner') {
      throw new ForbiddenError('Only owners can assign the owner role');
    }
  }

  private async recordIdentityChange(
    action: string,
    actor: IdentityActor,
    workspaceId: string,
    details: Record<string, unknown>
  ): Promise<void> {
    await this.audit({
      action,
      actor: actor.displayName || actor.userId,
      resource: workspaceId,
      details,
    });

    await this.activity.logActivity(
      'membership_updated',
      `workspace:${workspaceId}`,
      `Workspace ${workspaceId}`,
      {
        action,
        actor: actor.userId,
        ...details,
      }
    );
  }
}

let identityService: IdentityService | null = null;

export function getIdentityService(): IdentityService {
  if (!identityService) {
    identityService = new IdentityService();
  }
  return identityService;
}

export function resetIdentityServiceForTests(): void {
  identityService?.close();
  identityService = null;
}

export function hashInvitationToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function isWorkspaceRole(value: string): value is WorkspaceRole {
  return (WORKSPACE_ROLES as readonly string[]).includes(value);
}

function defaultInvitationExpiry(): string {
  const expiresAt = new Date();
  expiresAt.setUTCDate(expiresAt.getUTCDate() + DEFAULT_INVITATION_TTL_DAYS);
  return expiresAt.toISOString();
}
