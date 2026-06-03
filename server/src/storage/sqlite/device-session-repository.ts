import { randomUUID } from 'node:crypto';
import type { AuthPermission } from '../../middleware/auth.js';
import type { SqliteDatabase } from './database.js';
import type { WorkspaceRole } from './identity-repository.js';

export type DeviceConnectionState =
  | 'pairing'
  | 'connected'
  | 'reconnecting'
  | 'auth_failed'
  | 'unreachable'
  | 'revoked'
  | 'expired';

export interface DevicePairingCodeRecord {
  id: string;
  workspaceId: string;
  createdBy: string;
  codePrefix: string;
  deviceName: string;
  deviceType: string;
  deviceId: string;
  clientId: string;
  clientMode: string;
  capabilities: string[];
  scopes: AuthPermission[];
  role: WorkspaceRole;
  nonce: string;
  signedAt: string;
  signature: string;
  createdAt: string;
  expiresAt: string;
  sessionExpiresAt: string;
  usedAt: string | null;
  usedBy: string | null;
  revokedAt: string | null;
  attemptCount: number;
  lastAttemptAt: string | null;
}

export interface DeviceSessionRecord {
  id: string;
  workspaceId: string;
  userId: string;
  deviceName: string;
  deviceType: string;
  deviceId: string;
  clientId: string;
  clientMode: string;
  capabilities: string[];
  scopes: AuthPermission[];
  role: WorkspaceRole;
  tokenPrefix: string;
  nonce: string;
  signedAt: string;
  signature: string;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  revokedBy: string | null;
  lastSeenAt: string | null;
  lastSeenIp: string | null;
  connectionState: DeviceConnectionState;
  stateReason: string | null;
  lastAuthFailure: string | null;
  degradedReason: string | null;
}

export interface DeviceSessionAuthRecord extends DeviceSessionRecord {
  tokenHash: string;
  userDisabledAt: string | null;
  membershipRole: WorkspaceRole | null;
  membershipStatus: string | null;
  membershipDisabledAt: string | null;
  workspaceArchivedAt: string | null;
}

export interface CreateDevicePairingCodeInput {
  workspaceId: string;
  createdBy: string;
  codePrefix: string;
  codeHash: string;
  deviceName: string;
  deviceType: string;
  deviceId: string;
  clientId: string;
  clientMode: string;
  capabilities: string[];
  scopes: AuthPermission[];
  role: WorkspaceRole;
  nonce: string;
  signedAt: string;
  signature: string;
  expiresAt: string;
  sessionExpiresAt: string;
}

export interface CreateDeviceSessionInput {
  workspaceId: string;
  userId: string;
  deviceName: string;
  deviceType: string;
  deviceId: string;
  clientId: string;
  clientMode: string;
  capabilities: string[];
  scopes: AuthPermission[];
  role: WorkspaceRole;
  tokenPrefix: string;
  tokenHash: string;
  nonce: string;
  signedAt: string;
  signature: string;
  expiresAt: string;
}

interface DevicePairingCodeRow {
  id: string;
  workspace_id: string;
  created_by: string;
  code_prefix: string;
  code_hash: string;
  device_name: string;
  device_type: string;
  device_id: string;
  client_id: string;
  client_mode: string;
  capabilities_json: string;
  scopes_json: string;
  role: WorkspaceRole;
  nonce: string;
  signed_at: string;
  signature: string;
  created_at: string;
  expires_at: string;
  session_expires_at: string;
  used_at: string | null;
  used_by: string | null;
  revoked_at: string | null;
  attempt_count: number;
  last_attempt_at: string | null;
}

interface DeviceSessionRow {
  id: string;
  workspace_id: string;
  user_id: string;
  device_name: string;
  device_type: string;
  device_id: string;
  client_id: string;
  client_mode: string;
  capabilities_json: string;
  scopes_json: string;
  role: WorkspaceRole;
  token_prefix: string;
  token_hash: string;
  nonce: string;
  signed_at: string;
  signature: string;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
  revoked_by: string | null;
  last_seen_at: string | null;
  last_seen_ip: string | null;
  connection_state: DeviceConnectionState;
  state_reason: string | null;
  last_auth_failure: string | null;
  degraded_reason: string | null;
  user_disabled_at?: string | null;
  membership_role?: WorkspaceRole | null;
  membership_status?: string | null;
  membership_disabled_at?: string | null;
  workspace_archived_at?: string | null;
}

export class SqliteDeviceSessionRepository {
  constructor(private readonly database: SqliteDatabase) {}

  createPairingCode(input: CreateDevicePairingCodeInput): DevicePairingCodeRecord {
    const id = `pair_${randomUUID()}`;
    const now = new Date().toISOString();

    this.database
      .getConnection()
      .prepare(
        `
          INSERT INTO device_pairing_codes (
            id,
            workspace_id,
            created_by,
            code_prefix,
            code_hash,
            device_name,
            device_type,
            device_id,
            client_id,
            client_mode,
            capabilities_json,
            scopes_json,
            role,
            nonce,
            signed_at,
            signature,
            created_at,
            expires_at,
            session_expires_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        id,
        input.workspaceId,
        input.createdBy,
        input.codePrefix,
        input.codeHash,
        input.deviceName.trim(),
        input.deviceType,
        input.deviceId,
        input.clientId.trim(),
        input.clientMode,
        JSON.stringify(input.capabilities),
        JSON.stringify(input.scopes),
        input.role,
        input.nonce,
        input.signedAt,
        input.signature,
        now,
        input.expiresAt,
        input.sessionExpiresAt
      );

    return requireValue(this.getPairingCode(id), 'Pairing code was not created');
  }

  getPairingCode(id: string): DevicePairingCodeRecord | null {
    const row = this.database
      .getConnection()
      .prepare('SELECT * FROM device_pairing_codes WHERE id = ?')
      .get(id) as DevicePairingCodeRow | undefined;

    return row ? mapPairingCode(row) : null;
  }

  getPairingCodeByHash(codeHash: string): DevicePairingCodeRecord | null {
    const row = this.database
      .getConnection()
      .prepare('SELECT * FROM device_pairing_codes WHERE code_hash = ?')
      .get(codeHash) as DevicePairingCodeRow | undefined;

    return row ? mapPairingCode(row) : null;
  }

  recordPairingAttempt(id: string): DevicePairingCodeRecord | null {
    const now = new Date().toISOString();
    this.database
      .getConnection()
      .prepare(
        `
          UPDATE device_pairing_codes
          SET attempt_count = attempt_count + 1,
              last_attempt_at = ?
          WHERE id = ?
        `
      )
      .run(now, id);

    return this.getPairingCode(id);
  }

  redeemPairingCode(
    pairingCodeId: string,
    input: CreateDeviceSessionInput
  ): DeviceSessionRecord | null {
    const db = this.database.getConnection();
    const id = `devsess_${randomUUID()}`;
    const now = new Date().toISOString();

    try {
      db.exec('BEGIN IMMEDIATE;');
      const markUsed = db
        .prepare(
          `
            UPDATE device_pairing_codes
            SET used_at = ?, used_by = ?
            WHERE id = ?
              AND used_at IS NULL
              AND revoked_at IS NULL
          `
        )
        .run(now, input.userId, pairingCodeId);

      if (markUsed.changes === 0) {
        db.exec('ROLLBACK;');
        return null;
      }

      db.prepare(
        `
          INSERT INTO device_sessions (
            id,
            workspace_id,
            user_id,
            device_name,
            device_type,
            device_id,
            client_id,
            client_mode,
            capabilities_json,
            scopes_json,
            role,
            token_prefix,
            token_hash,
            nonce,
            signed_at,
            signature,
            created_at,
            expires_at,
            connection_state,
            state_reason
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'connected', 'paired')
        `
      ).run(
        id,
        input.workspaceId,
        input.userId,
        input.deviceName.trim(),
        input.deviceType,
        input.deviceId,
        input.clientId.trim(),
        input.clientMode,
        JSON.stringify(input.capabilities),
        JSON.stringify(input.scopes),
        input.role,
        input.tokenPrefix,
        input.tokenHash,
        input.nonce,
        input.signedAt,
        input.signature,
        now,
        input.expiresAt
      );

      db.exec('COMMIT;');
    } catch (error) {
      try {
        db.exec('ROLLBACK;');
      } catch {
        // Preserve the original write error.
      }
      throw error;
    }

    return this.getSession(id);
  }

  listSessionsByWorkspace(workspaceId: string): DeviceSessionRecord[] {
    const rows = this.database
      .getConnection()
      .prepare(
        `
          SELECT *
          FROM device_sessions
          WHERE workspace_id = ?
          ORDER BY created_at DESC
        `
      )
      .all(workspaceId) as unknown as DeviceSessionRow[];

    return rows.map(mapDeviceSession);
  }

  getSession(id: string): DeviceSessionRecord | null {
    const row = this.database
      .getConnection()
      .prepare('SELECT * FROM device_sessions WHERE id = ?')
      .get(id) as DeviceSessionRow | undefined;

    return row ? mapDeviceSession(row) : null;
  }

  getSessionForAuthByHash(tokenHash: string): DeviceSessionAuthRecord | null {
    const row = this.database
      .getConnection()
      .prepare(
        `
          SELECT
            s.*,
            u.disabled_at AS user_disabled_at,
            m.role AS membership_role,
            m.status AS membership_status,
            m.disabled_at AS membership_disabled_at,
            w.archived_at AS workspace_archived_at
          FROM device_sessions s
          JOIN users u ON u.id = s.user_id
          JOIN workspaces w ON w.id = s.workspace_id
          LEFT JOIN workspace_memberships m
            ON m.workspace_id = s.workspace_id
           AND m.user_id = s.user_id
          WHERE s.token_hash = ?
        `
      )
      .get(tokenHash) as DeviceSessionRow | undefined;

    return row
      ? {
          ...mapDeviceSession(row),
          tokenHash: row.token_hash,
          userDisabledAt: row.user_disabled_at ?? null,
          membershipRole: row.membership_role ?? null,
          membershipStatus: row.membership_status ?? null,
          membershipDisabledAt: row.membership_disabled_at ?? null,
          workspaceArchivedAt: row.workspace_archived_at ?? null,
        }
      : null;
  }

  revokeSession(id: string, revokedBy: string): DeviceSessionRecord | null {
    const now = new Date().toISOString();
    const result = this.database
      .getConnection()
      .prepare(
        `
          UPDATE device_sessions
          SET revoked_at = ?,
              revoked_by = ?,
              connection_state = 'revoked',
              state_reason = 'revoked_by_user'
          WHERE id = ?
            AND revoked_at IS NULL
        `
      )
      .run(now, revokedBy, id);

    return result.changes > 0 ? this.getSession(id) : null;
  }

  recordSessionUse(id: string, ipAddress?: string | null): void {
    this.database
      .getConnection()
      .prepare(
        `
          UPDATE device_sessions
          SET last_seen_at = ?,
              last_seen_ip = ?,
              connection_state = 'connected',
              state_reason = 'validated',
              last_auth_failure = NULL
          WHERE id = ?
        `
      )
      .run(new Date().toISOString(), ipAddress ?? null, id);
  }

  updateSessionState(id: string, state: DeviceConnectionState, reason?: string | null): void {
    this.database
      .getConnection()
      .prepare(
        `
          UPDATE device_sessions
          SET connection_state = ?,
              state_reason = ?
          WHERE id = ?
        `
      )
      .run(state, reason ?? null, id);
  }

  recordAuthFailure(id: string, state: DeviceConnectionState, reason: string): void {
    this.database
      .getConnection()
      .prepare(
        `
          UPDATE device_sessions
          SET connection_state = ?,
              state_reason = ?,
              last_auth_failure = ?
          WHERE id = ?
        `
      )
      .run(state, reason, reason, id);
  }

  recordDegradedSession(id: string, reason: string | null): void {
    this.database
      .getConnection()
      .prepare(
        `
          UPDATE device_sessions
          SET degraded_reason = ?,
              state_reason = COALESCE(?, state_reason)
          WHERE id = ?
        `
      )
      .run(reason, reason, id);
  }
}

function mapPairingCode(row: DevicePairingCodeRow): DevicePairingCodeRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    createdBy: row.created_by,
    codePrefix: row.code_prefix,
    deviceName: row.device_name,
    deviceType: row.device_type,
    deviceId: row.device_id,
    clientId: row.client_id,
    clientMode: row.client_mode,
    capabilities: parseStringArray(row.capabilities_json),
    scopes: parseScopes(row.scopes_json),
    role: row.role,
    nonce: row.nonce,
    signedAt: row.signed_at,
    signature: row.signature,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    sessionExpiresAt: row.session_expires_at,
    usedAt: row.used_at,
    usedBy: row.used_by,
    revokedAt: row.revoked_at,
    attemptCount: row.attempt_count,
    lastAttemptAt: row.last_attempt_at,
  };
}

function mapDeviceSession(row: DeviceSessionRow): DeviceSessionRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    userId: row.user_id,
    deviceName: row.device_name,
    deviceType: row.device_type,
    deviceId: row.device_id,
    clientId: row.client_id,
    clientMode: row.client_mode,
    capabilities: parseStringArray(row.capabilities_json),
    scopes: parseScopes(row.scopes_json),
    role: row.role,
    tokenPrefix: row.token_prefix,
    nonce: row.nonce,
    signedAt: row.signed_at,
    signature: row.signature,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    revokedBy: row.revoked_by,
    lastSeenAt: row.last_seen_at,
    lastSeenIp: row.last_seen_ip,
    connectionState: deriveConnectionState(row),
    stateReason: row.state_reason,
    lastAuthFailure: row.last_auth_failure,
    degradedReason: row.degraded_reason,
  };
}

function deriveConnectionState(row: DeviceSessionRow): DeviceConnectionState {
  if (row.revoked_at) return 'revoked';
  if (Date.parse(row.expires_at) <= Date.now()) return 'expired';
  return row.connection_state;
}

function parseStringArray(value: string): string[] {
  const parsed = JSON.parse(value) as unknown;
  return Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string') : [];
}

function parseScopes(value: string): AuthPermission[] {
  return parseStringArray(value) as AuthPermission[];
}

function requireValue<T>(value: T | null | undefined, message: string): T {
  if (value === null || value === undefined) {
    throw new Error(message);
  }
  return value;
}
