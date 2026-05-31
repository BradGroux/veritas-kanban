import { randomUUID } from 'node:crypto';
import type { AuthPermission } from '../../middleware/auth.js';
import type { SqliteDatabase } from './database.js';

export interface ApiTokenRecord {
  id: string;
  workspaceId: string;
  name: string;
  tokenPrefix: string;
  scopes: AuthPermission[];
  createdBy: string;
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  revokedBy: string | null;
  lastUsedAt: string | null;
  lastUsedIp: string | null;
}

export interface ApiTokenAuthRecord extends ApiTokenRecord {
  tokenHash: string;
  creatorDisabledAt: string | null;
  membershipRole: string | null;
  membershipStatus: string | null;
  membershipDisabledAt: string | null;
  workspaceArchivedAt: string | null;
}

export interface CreateApiTokenInput {
  workspaceId: string;
  name: string;
  tokenPrefix: string;
  tokenHash: string;
  scopes: AuthPermission[];
  createdBy: string;
  expiresAt?: string | null;
}

interface ApiTokenRow {
  id: string;
  workspace_id: string;
  name: string;
  token_prefix: string;
  token_hash: string;
  scopes_json: string;
  created_by: string;
  created_at: string;
  expires_at: string | null;
  revoked_at: string | null;
  revoked_by: string | null;
  last_used_at: string | null;
  last_used_ip: string | null;
  creator_disabled_at?: string | null;
  membership_role?: string | null;
  membership_status?: string | null;
  membership_disabled_at?: string | null;
  workspace_archived_at?: string | null;
}

export class SqliteApiTokenRepository {
  constructor(private readonly database: SqliteDatabase) {}

  create(input: CreateApiTokenInput): ApiTokenRecord {
    const id = `token_${randomUUID()}`;
    const now = new Date().toISOString();

    this.database
      .getConnection()
      .prepare(
        `
          INSERT INTO api_tokens (
            id,
            workspace_id,
            name,
            token_prefix,
            token_hash,
            scopes_json,
            created_by,
            created_at,
            expires_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        id,
        input.workspaceId,
        input.name.trim(),
        input.tokenPrefix,
        input.tokenHash,
        JSON.stringify(input.scopes),
        input.createdBy,
        now,
        input.expiresAt ?? null
      );

    return requireValue(this.get(id), 'API token was not created');
  }

  listByWorkspace(workspaceId: string): ApiTokenRecord[] {
    const rows = this.database
      .getConnection()
      .prepare(
        `
          SELECT *
          FROM api_tokens
          WHERE workspace_id = ?
          ORDER BY created_at DESC
        `
      )
      .all(workspaceId) as unknown as ApiTokenRow[];

    return rows.map(mapApiToken);
  }

  get(id: string): ApiTokenRecord | null {
    const row = this.database
      .getConnection()
      .prepare('SELECT * FROM api_tokens WHERE id = ?')
      .get(id) as ApiTokenRow | undefined;

    return row ? mapApiToken(row) : null;
  }

  getForAuthByHash(tokenHash: string): ApiTokenAuthRecord | null {
    const row = this.database
      .getConnection()
      .prepare(
        `
          SELECT
            t.*,
            u.disabled_at AS creator_disabled_at,
            m.role AS membership_role,
            m.status AS membership_status,
            m.disabled_at AS membership_disabled_at,
            w.archived_at AS workspace_archived_at
          FROM api_tokens t
          JOIN users u ON u.id = t.created_by
          JOIN workspaces w ON w.id = t.workspace_id
          LEFT JOIN workspace_memberships m
            ON m.workspace_id = t.workspace_id
           AND m.user_id = t.created_by
          WHERE t.token_hash = ?
        `
      )
      .get(tokenHash) as ApiTokenRow | undefined;

    return row
      ? {
          ...mapApiToken(row),
          tokenHash: row.token_hash,
          creatorDisabledAt: row.creator_disabled_at ?? null,
          membershipRole: row.membership_role ?? null,
          membershipStatus: row.membership_status ?? null,
          membershipDisabledAt: row.membership_disabled_at ?? null,
          workspaceArchivedAt: row.workspace_archived_at ?? null,
        }
      : null;
  }

  revoke(id: string, revokedBy: string): ApiTokenRecord | null {
    const now = new Date().toISOString();
    const result = this.database
      .getConnection()
      .prepare(
        `
          UPDATE api_tokens
          SET revoked_at = ?, revoked_by = ?
          WHERE id = ? AND revoked_at IS NULL
        `
      )
      .run(now, revokedBy, id);

    return result.changes > 0 ? this.get(id) : null;
  }

  recordUse(id: string, ipAddress?: string | null): void {
    this.database
      .getConnection()
      .prepare(
        `
          UPDATE api_tokens
          SET last_used_at = ?, last_used_ip = ?
          WHERE id = ?
        `
      )
      .run(new Date().toISOString(), ipAddress ?? null, id);
  }
}

function mapApiToken(row: ApiTokenRow): ApiTokenRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    tokenPrefix: row.token_prefix,
    scopes: parseScopes(row.scopes_json),
    createdBy: row.created_by,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    revokedBy: row.revoked_by,
    lastUsedAt: row.last_used_at,
    lastUsedIp: row.last_used_ip,
  };
}

function parseScopes(value: string): AuthPermission[] {
  const parsed = JSON.parse(value) as unknown;
  return Array.isArray(parsed)
    ? (parsed.filter((item) => typeof item === 'string') as AuthPermission[])
    : [];
}

function requireValue<T>(value: T | null | undefined, message: string): T {
  if (value === null || value === undefined) {
    throw new Error(message);
  }
  return value;
}
