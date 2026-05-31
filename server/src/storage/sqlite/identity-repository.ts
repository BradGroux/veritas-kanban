import { randomUUID } from 'node:crypto';
import type { SqliteDatabase } from './database.js';

export const WORKSPACE_ROLES = [
  'owner',
  'admin',
  'member',
  'reviewer',
  'read-only',
  'agent',
] as const;

export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

export const ACTIVE_MEMBERSHIP_STATUS = 'active';

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

export interface CreateUserInput {
  id?: string;
  displayName: string;
  email?: string | null;
  handle?: string | null;
  authSubject?: string | null;
  avatarUrl?: string | null;
}

export interface CreateInvitationInput {
  workspaceId: string;
  email?: string | null;
  role: WorkspaceRole;
  tokenHash: string;
  invitedBy: string;
  expiresAt: string;
}

interface UserRow {
  id: string;
  display_name: string;
  email: string | null;
  handle: string | null;
  auth_subject: string | null;
  avatar_url: string | null;
  disabled_at: string | null;
  last_seen_at: string | null;
  created_at: string;
  updated_at: string;
}

interface WorkspaceRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  mode: string;
  created_by: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

interface MembershipRow {
  workspace_id: string;
  user_id: string;
  role: WorkspaceRole;
  status: string;
  invited_by: string | null;
  joined_at: string | null;
  disabled_at: string | null;
  created_at: string;
  updated_at: string;
  user_display_name?: string;
  user_email?: string | null;
  user_handle?: string | null;
  user_auth_subject?: string | null;
  user_avatar_url?: string | null;
  user_disabled_at?: string | null;
  user_last_seen_at?: string | null;
  user_created_at?: string;
  user_updated_at?: string;
}

interface InvitationRow {
  id: string;
  workspace_id: string;
  email: string | null;
  role: WorkspaceRole;
  token_hash: string;
  invited_by: string;
  created_at: string;
  expires_at: string;
  accepted_by: string | null;
  accepted_at: string | null;
  revoked_at: string | null;
}

interface CountRow {
  count: number;
}

export class SqliteIdentityRepository {
  constructor(private readonly database: SqliteDatabase) {}

  ensureLocalOwner(input: { displayName?: string; email?: string | null } = {}): {
    user: IdentityUser;
    workspace: WorkspaceIdentity;
    membership: WorkspaceMembership;
  } {
    const now = new Date().toISOString();
    const db = this.database.getConnection();

    db.prepare(
      `
        INSERT INTO workspaces (id, slug, name, description, mode, created_by, created_at, updated_at)
        VALUES ('local', 'local', 'Local Workspace', ?, 'local', 'local-user', ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          mode = COALESCE(workspaces.mode, excluded.mode),
          updated_at = excluded.updated_at
      `
    ).run('Default local workspace used for v5 migration and single-user mode.', now, now);

    db.prepare(
      `
        INSERT INTO users (id, display_name, email, created_at, updated_at)
        VALUES ('local-user', ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          display_name = CASE
            WHEN ? IS NOT NULL THEN excluded.display_name
            ELSE users.display_name
          END,
          email = COALESCE(excluded.email, users.email),
          updated_at = excluded.updated_at
      `
    ).run(
      input.displayName ?? 'Local User',
      input.email ?? null,
      now,
      now,
      input.displayName ?? null
    );

    db.prepare(
      `
        INSERT INTO workspace_memberships (
          workspace_id, user_id, role, status, joined_at, created_at, updated_at
        )
        VALUES ('local', 'local-user', 'owner', 'active', ?, ?, ?)
        ON CONFLICT(workspace_id, user_id) DO UPDATE SET
          role = CASE
            WHEN workspace_memberships.role = 'owner' THEN workspace_memberships.role
            ELSE excluded.role
          END,
          status = 'active',
          disabled_at = NULL,
          updated_at = excluded.updated_at
      `
    ).run(now, now, now);

    return {
      user: requireValue(this.getUser('local-user'), 'Local user was not created'),
      workspace: requireValue(this.getWorkspace('local'), 'Local workspace was not created'),
      membership: requireValue(
        this.getMembership('local', 'local-user'),
        'Local owner membership was not created'
      ),
    };
  }

  createUser(input: CreateUserInput): IdentityUser {
    const now = new Date().toISOString();
    const id = input.id ?? `user_${randomUUID()}`;

    this.database
      .getConnection()
      .prepare(
        `
          INSERT INTO users (
            id, display_name, email, handle, auth_subject, avatar_url, created_at, updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            display_name = excluded.display_name,
            email = COALESCE(excluded.email, users.email),
            handle = COALESCE(excluded.handle, users.handle),
            auth_subject = COALESCE(excluded.auth_subject, users.auth_subject),
            avatar_url = COALESCE(excluded.avatar_url, users.avatar_url),
            updated_at = excluded.updated_at
        `
      )
      .run(
        id,
        input.displayName,
        input.email ?? null,
        input.handle ?? null,
        input.authSubject ?? null,
        input.avatarUrl ?? null,
        now,
        now
      );

    return requireValue(this.getUser(id), 'User was not created');
  }

  getUser(id: string): IdentityUser | null {
    const row = this.database
      .getConnection()
      .prepare('SELECT * FROM users WHERE id = ?')
      .get(id) as UserRow | undefined;

    return row ? mapUser(row) : null;
  }

  getUserByEmail(email: string): IdentityUser | null {
    const row = this.database
      .getConnection()
      .prepare('SELECT * FROM users WHERE lower(email) = lower(?)')
      .get(email) as UserRow | undefined;

    return row ? mapUser(row) : null;
  }

  getWorkspace(id: string): WorkspaceIdentity | null {
    const row = this.database
      .getConnection()
      .prepare('SELECT * FROM workspaces WHERE id = ?')
      .get(id) as WorkspaceRow | undefined;

    return row ? mapWorkspace(row) : null;
  }

  listWorkspacesForUser(userId: string): Array<{
    workspace: WorkspaceIdentity;
    membership: WorkspaceMembership;
  }> {
    const rows = this.database
      .getConnection()
      .prepare(
        `
          SELECT
            w.*,
            m.workspace_id,
            m.user_id,
            m.role,
            m.status,
            m.invited_by,
            m.joined_at,
            m.disabled_at,
            m.created_at AS membership_created_at,
            m.updated_at AS membership_updated_at
          FROM workspace_memberships m
          JOIN workspaces w ON w.id = m.workspace_id
          WHERE m.user_id = ? AND m.status = 'active' AND w.archived_at IS NULL
          ORDER BY w.name ASC
        `
      )
      .all(userId) as unknown as Array<
      WorkspaceRow & {
        workspace_id: string;
        user_id: string;
        role: WorkspaceRole;
        status: string;
        invited_by: string | null;
        joined_at: string | null;
        disabled_at: string | null;
        membership_created_at: string;
        membership_updated_at: string;
      }
    >;

    return rows.map((row) => ({
      workspace: mapWorkspace(row),
      membership: {
        workspaceId: row.workspace_id,
        userId: row.user_id,
        role: row.role,
        status: row.status,
        invitedBy: row.invited_by,
        joinedAt: row.joined_at,
        disabledAt: row.disabled_at,
        createdAt: row.membership_created_at,
        updatedAt: row.membership_updated_at,
      },
    }));
  }

  listMembers(workspaceId: string): WorkspaceMembership[] {
    const rows = this.database
      .getConnection()
      .prepare(
        `
          SELECT
            m.*,
            u.display_name AS user_display_name,
            u.email AS user_email,
            u.handle AS user_handle,
            u.auth_subject AS user_auth_subject,
            u.avatar_url AS user_avatar_url,
            u.disabled_at AS user_disabled_at,
            u.last_seen_at AS user_last_seen_at,
            u.created_at AS user_created_at,
            u.updated_at AS user_updated_at
          FROM workspace_memberships m
          JOIN users u ON u.id = m.user_id
          WHERE m.workspace_id = ? AND m.status = 'active'
          ORDER BY
            CASE m.role
              WHEN 'owner' THEN 0
              WHEN 'admin' THEN 1
              WHEN 'member' THEN 2
              WHEN 'reviewer' THEN 3
              WHEN 'read-only' THEN 4
              ELSE 5
            END,
            lower(u.display_name) ASC
        `
      )
      .all(workspaceId) as unknown as MembershipRow[];

    return rows.map(mapMembership);
  }

  getMembership(workspaceId: string, userId: string): WorkspaceMembership | null {
    const row = this.database
      .getConnection()
      .prepare('SELECT * FROM workspace_memberships WHERE workspace_id = ? AND user_id = ?')
      .get(workspaceId, userId) as MembershipRow | undefined;

    return row ? mapMembership(row) : null;
  }

  createInvitation(input: CreateInvitationInput): WorkspaceInvitation {
    const now = new Date().toISOString();
    const id = `inv_${randomUUID()}`;

    this.database
      .getConnection()
      .prepare(
        `
          INSERT INTO workspace_invitations (
            id, workspace_id, email, role, token_hash, invited_by, created_at, expires_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        id,
        input.workspaceId,
        input.email?.trim().toLowerCase() || null,
        input.role,
        input.tokenHash,
        input.invitedBy,
        now,
        input.expiresAt
      );

    return requireValue(this.getInvitation(id), 'Invitation was not created');
  }

  listInvitations(
    workspaceId: string,
    options: { includeInactive?: boolean } = {}
  ): WorkspaceInvitation[] {
    const rows = this.database
      .getConnection()
      .prepare(
        `
          SELECT *
          FROM workspace_invitations
          WHERE workspace_id = ?
            AND (? = 1 OR (accepted_at IS NULL AND revoked_at IS NULL))
          ORDER BY created_at DESC
        `
      )
      .all(workspaceId, options.includeInactive ? 1 : 0) as unknown as InvitationRow[];

    return rows.map(mapInvitation);
  }

  getInvitation(id: string): WorkspaceInvitation | null {
    const row = this.database
      .getConnection()
      .prepare('SELECT * FROM workspace_invitations WHERE id = ?')
      .get(id) as InvitationRow | undefined;

    return row ? mapInvitation(row) : null;
  }

  getInvitationByTokenHash(tokenHash: string): WorkspaceInvitation | null {
    const row = this.database
      .getConnection()
      .prepare('SELECT * FROM workspace_invitations WHERE token_hash = ?')
      .get(tokenHash) as InvitationRow | undefined;

    return row ? mapInvitation(row) : null;
  }

  acceptInvitation(input: {
    tokenHash: string;
    displayName?: string | null;
    email?: string | null;
  }): { invitation: WorkspaceInvitation; user: IdentityUser; membership: WorkspaceMembership } {
    const invitation = this.getInvitationByTokenHash(input.tokenHash);
    if (!invitation) {
      throw new Error('Invitation not found');
    }

    const now = new Date().toISOString();
    const email = input.email ?? invitation.email;
    const existing = email ? this.getUserByEmail(email) : null;
    const user =
      existing ??
      this.createUser({
        displayName: input.displayName || email || 'Invited User',
        email,
      });

    const db = this.database.getConnection();
    try {
      db.exec('BEGIN IMMEDIATE;');
      db.prepare(
        `
          INSERT INTO workspace_memberships (
            workspace_id,
            user_id,
            role,
            status,
            invited_by,
            joined_at,
            created_at,
            updated_at
          )
          VALUES (?, ?, ?, 'active', ?, ?, ?, ?)
          ON CONFLICT(workspace_id, user_id) DO UPDATE SET
            role = excluded.role,
            status = 'active',
            invited_by = excluded.invited_by,
            joined_at = COALESCE(workspace_memberships.joined_at, excluded.joined_at),
            disabled_at = NULL,
            updated_at = excluded.updated_at
        `
      ).run(invitation.workspaceId, user.id, invitation.role, invitation.invitedBy, now, now, now);

      db.prepare(
        `
          UPDATE workspace_invitations
          SET accepted_by = ?, accepted_at = ?
          WHERE id = ?
        `
      ).run(user.id, now, invitation.id);
      db.exec('COMMIT;');
    } catch (error) {
      try {
        db.exec('ROLLBACK;');
      } catch {
        // Preserve the original write error.
      }
      throw error;
    }

    return {
      invitation: requireValue(
        this.getInvitation(invitation.id),
        'Accepted invitation was not updated'
      ),
      user: requireValue(this.getUser(user.id), 'Invitation user was not created'),
      membership: requireValue(
        this.getMembership(invitation.workspaceId, user.id),
        'Invitation membership was not created'
      ),
    };
  }

  revokeInvitation(id: string): WorkspaceInvitation | null {
    const now = new Date().toISOString();
    const result = this.database
      .getConnection()
      .prepare(
        `
          UPDATE workspace_invitations
          SET revoked_at = ?
          WHERE id = ? AND accepted_at IS NULL AND revoked_at IS NULL
        `
      )
      .run(now, id);

    return result.changes > 0 ? this.getInvitation(id) : null;
  }

  updateMembershipRole(
    workspaceId: string,
    userId: string,
    role: WorkspaceRole
  ): WorkspaceMembership | null {
    const now = new Date().toISOString();
    const result = this.database
      .getConnection()
      .prepare(
        `
          UPDATE workspace_memberships
          SET role = ?, updated_at = ?
          WHERE workspace_id = ? AND user_id = ? AND status = 'active'
        `
      )
      .run(role, now, workspaceId, userId);

    return result.changes > 0 ? this.getMembership(workspaceId, userId) : null;
  }

  removeMembership(workspaceId: string, userId: string): WorkspaceMembership | null {
    const now = new Date().toISOString();
    const result = this.database
      .getConnection()
      .prepare(
        `
          UPDATE workspace_memberships
          SET status = 'removed', disabled_at = ?, updated_at = ?
          WHERE workspace_id = ? AND user_id = ? AND status = 'active'
        `
      )
      .run(now, now, workspaceId, userId);

    return result.changes > 0 ? this.getMembership(workspaceId, userId) : null;
  }

  countActiveOwners(workspaceId: string): number {
    const row = this.database
      .getConnection()
      .prepare(
        `
          SELECT COUNT(*) AS count
          FROM workspace_memberships
          WHERE workspace_id = ? AND role = 'owner' AND status = 'active'
        `
      )
      .get(workspaceId) as unknown as CountRow;

    return row.count;
  }
}

function mapUser(row: UserRow): IdentityUser {
  return {
    id: row.id,
    displayName: row.display_name,
    email: row.email,
    handle: row.handle,
    authSubject: row.auth_subject,
    avatarUrl: row.avatar_url,
    disabledAt: row.disabled_at,
    lastSeenAt: row.last_seen_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapWorkspace(row: WorkspaceRow): WorkspaceIdentity {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    mode: row.mode,
    createdBy: row.created_by,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapMembership(row: MembershipRow): WorkspaceMembership {
  const membership: WorkspaceMembership = {
    workspaceId: row.workspace_id,
    userId: row.user_id,
    role: row.role,
    status: row.status,
    invitedBy: row.invited_by,
    joinedAt: row.joined_at,
    disabledAt: row.disabled_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };

  if (row.user_display_name && row.user_created_at && row.user_updated_at) {
    membership.user = {
      id: row.user_id,
      displayName: row.user_display_name,
      email: row.user_email ?? null,
      handle: row.user_handle ?? null,
      authSubject: row.user_auth_subject ?? null,
      avatarUrl: row.user_avatar_url ?? null,
      disabledAt: row.user_disabled_at ?? null,
      lastSeenAt: row.user_last_seen_at ?? null,
      createdAt: row.user_created_at,
      updatedAt: row.user_updated_at,
    };
  }

  return membership;
}

function mapInvitation(row: InvitationRow): WorkspaceInvitation {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    email: row.email,
    role: row.role,
    tokenHash: row.token_hash,
    invitedBy: row.invited_by,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    acceptedBy: row.accepted_by,
    acceptedAt: row.accepted_at,
    revokedAt: row.revoked_at,
  };
}

function requireValue<T>(value: T | null | undefined, message: string): T {
  if (value === null || value === undefined) {
    throw new Error(message);
  }
  return value;
}
