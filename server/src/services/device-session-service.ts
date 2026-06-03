import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import type { AuthContext, AuthPermission, AuthRole } from '../middleware/auth.js';
import {
  AppError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../middleware/error-handler.js';
import { ActivityService } from './activity-service.js';
import { auditLog, type AuditEvent } from './audit-service.js';
import type { IdentityActor } from './identity-service.js';
import { SCOPED_API_TOKEN_PERMISSIONS } from './api-token-service.js';
import {
  SqliteDatabase,
  resolveSqliteDatabasePath,
  type SqliteConnectionOptions,
} from '../storage/sqlite/database.js';
import {
  SqliteDeviceSessionRepository,
  type DeviceConnectionState,
  type DevicePairingCodeRecord,
  type DeviceSessionRecord,
} from '../storage/sqlite/device-session-repository.js';
import {
  SqliteIdentityRepository,
  type WorkspaceMembership,
  type WorkspaceRole,
} from '../storage/sqlite/identity-repository.js';

const DEVICE_SESSION_SECRET_PREFIX = 'vk_dev_';
const PAIRING_CODE_PREFIX = 'vk_pair_';
const TOKEN_PREFIX_LENGTH = 16;
const PAIRING_CODE_TTL_MS = 10 * 60 * 1000;
const PAIRING_PAYLOAD_MAX_AGE_MS = 10 * 60 * 1000;
const CLOCK_SKEW_MS = 60 * 1000;
const DEVICE_SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const MAX_PAIRING_ATTEMPTS = 5;

const MANAGER_ROLES = new Set<WorkspaceRole>(['owner', 'admin']);
const CLIENT_MODES = ['desktop-remote', 'desktop-local', 'mobile-pwa', 'browser', 'cli'] as const;
const CLIENT_MODE_SET = new Set<string>(CLIENT_MODES);
const SCOPED_PERMISSION_SET = new Set<AuthPermission>(SCOPED_API_TOKEN_PERMISSIONS);
const WRITE_PERMISSIONS = new Set<AuthPermission>([
  'task:write',
  'comment:write',
  'workflow:write',
  'workflow:execute',
  'work_product:write',
  'telemetry:write',
  'agent:write',
  'settings:write',
  'policy:write',
  'backup:write',
  'admin:manage',
]);

const WORKSPACE_ROLE_PERMISSIONS: Record<WorkspaceRole, readonly AuthPermission[]> = {
  owner: SCOPED_API_TOKEN_PERMISSIONS,
  admin: SCOPED_API_TOKEN_PERMISSIONS,
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

const CLIENT_MODE_SCOPE_DENY: Record<ClientMode, readonly AuthPermission[]> = {
  'desktop-remote': [],
  'desktop-local': [],
  cli: [],
  browser: ['agent:write', 'backup:write', 'admin:manage'],
  'mobile-pwa': ['agent:write', 'backup:write', 'policy:write', 'admin:manage'],
};

const CLIENT_MODE_CAPABILITIES: Record<ClientMode, readonly string[]> = {
  'desktop-remote': [
    'board:read',
    'workspace:read',
    'task:read',
    'task:write',
    'comment:write',
    'workflow:execute',
    'notification:read',
    'notification:receive',
    'remote:sync',
    'agent:run:scoped',
    'desktop:remote',
  ],
  'desktop-local': [
    'board:read',
    'workspace:read',
    'task:read',
    'task:write',
    'comment:write',
    'workflow:execute',
    'notification:read',
    'notification:receive',
    'remote:sync',
    'agent:run:scoped',
    'desktop:local',
  ],
  cli: ['workspace:read', 'task:read', 'task:write', 'workflow:execute', 'agent:run:scoped'],
  browser: ['board:read', 'workspace:read', 'task:read', 'comment:write', 'workflow:read'],
  'mobile-pwa': [
    'board:read',
    'workspace:read',
    'task:read',
    'task:write',
    'comment:write',
    'workflow:read',
    'notification:read',
    'notification:receive',
    'remote:sync',
  ],
};

export type ClientMode = (typeof CLIENT_MODES)[number];

export interface DevicePairingPayload {
  code: string;
  workspaceId: string;
  deviceId: string;
  clientId: string;
  clientMode: ClientMode;
  capabilities: string[];
  scopes: AuthPermission[];
  role: WorkspaceRole;
  nonce: string;
  signedAt: string;
  signature: string;
  expiresAt: string;
}

export interface CreateDevicePairingResult {
  pairing: DevicePairingCodeRecord;
  code: string;
  payload: DevicePairingPayload;
  link: string;
  pairingCode: DevicePairingCodeRecord;
  pairingUrl: string;
}

export interface ExchangeDevicePairingInput {
  code: string;
  nonce: string;
  signedAt: string;
  signature: string;
  clientId?: string;
  clientMode?: string;
  capabilities?: string[];
  scopes?: AuthPermission[];
}

export interface ExchangeDevicePairingResult {
  session: DeviceSessionRecord;
  secret: string;
  connectionState: DeviceConnectionState;
}

export interface DeviceSessionValidationResult {
  valid: boolean;
  auth?: AuthContext;
}

export interface DeviceSessionTestResult {
  session: DeviceSessionRecord;
  allowed: boolean;
  reason: string;
}

export interface DeviceSessionServiceOptions {
  sessionRepository?: SqliteDeviceSessionRepository;
  identityRepository?: SqliteIdentityRepository;
  sqliteDatabase?: SqliteDatabase;
  sqliteConnectionOptions?: SqliteConnectionOptions;
  audit?: (event: AuditEvent) => Promise<void>;
  activity?: Pick<ActivityService, 'logActivity'>;
}

export class DeviceSessionService {
  private readonly sessionRepository: SqliteDeviceSessionRepository;
  private readonly identityRepository: SqliteIdentityRepository;
  private readonly sqliteDatabase: SqliteDatabase | null = null;
  private readonly ownsSqliteDatabase: boolean = false;
  private readonly audit: (event: AuditEvent) => Promise<void>;
  private readonly activity: Pick<ActivityService, 'logActivity'>;

  constructor(options: DeviceSessionServiceOptions = {}) {
    if (options.sessionRepository && options.identityRepository) {
      this.sessionRepository = options.sessionRepository;
      this.identityRepository = options.identityRepository;
    } else {
      this.sqliteDatabase =
        options.sqliteDatabase ?? new SqliteDatabase(options.sqliteConnectionOptions);
      this.ownsSqliteDatabase = !options.sqliteDatabase;
      this.sqliteDatabase.open();
      this.sessionRepository =
        options.sessionRepository ?? new SqliteDeviceSessionRepository(this.sqliteDatabase);
      this.identityRepository =
        options.identityRepository ?? new SqliteIdentityRepository(this.sqliteDatabase);
    }

    this.audit = options.audit ?? auditLog;
    this.activity =
      options.activity ??
      new ActivityService({
        storageType: process.env.VERITAS_STORAGE === 'sqlite' ? 'sqlite' : 'file',
        sqliteDatabase: options.sqliteDatabase,
      });
  }

  listSessions(workspaceId: string, actor: IdentityActor): DeviceSessionRecord[] {
    this.assertCanManageSessions(workspaceId, actor);
    return this.sessionRepository.listSessionsByWorkspace(workspaceId);
  }

  async createPairingCode(
    input: {
      workspaceId: string;
      deviceName: string;
      deviceType?: string;
      deviceId?: string;
      clientId?: string;
      clientMode?: string;
      capabilities?: string[];
      scopes?: AuthPermission[];
      role?: WorkspaceRole;
      expiresAt?: string | null;
      sessionExpiresAt?: string | null;
    },
    actor: IdentityActor
  ): Promise<CreateDevicePairingResult> {
    const membership = this.assertCanManageSessions(input.workspaceId, actor);
    const clientMode = normalizeClientMode(input.clientMode ?? 'desktop-remote');
    const role = this.normalizeRole(input.role ?? membership.role, membership);
    const capabilities = normalizeCapabilities(clientMode, input.capabilities);
    const scopes = this.normalizeScopes(
      input.scopes ?? defaultScopesForMode(clientMode),
      actor,
      role,
      clientMode
    );
    const code = generatePairingCode();
    const codeHash = hashPairingCode(code);
    const now = new Date();
    const signedAt = now.toISOString();
    const expiresAt =
      input.expiresAt ?? new Date(now.getTime() + PAIRING_CODE_TTL_MS).toISOString();
    const sessionExpiresAt =
      input.sessionExpiresAt ?? new Date(now.getTime() + DEVICE_SESSION_TTL_MS).toISOString();
    const deviceId = input.deviceId?.trim() || `device_${randomUUID()}`;
    const clientId = input.clientId?.trim() || `client_${randomUUID()}`;
    const nonce = randomBytes(16).toString('base64url');
    const signature = signPairingPayload(codeHash, {
      workspaceId: input.workspaceId,
      deviceId,
      clientId,
      clientMode,
      nonce,
      signedAt,
    });

    if (Date.parse(expiresAt) <= Date.now()) {
      throw new ValidationError('Pairing code expiration must be in the future');
    }
    if (Date.parse(sessionExpiresAt) <= Date.now()) {
      throw new ValidationError('Device session expiration must be in the future');
    }

    const pairing = this.sessionRepository.createPairingCode({
      workspaceId: input.workspaceId,
      createdBy: actor.userId,
      codePrefix: code.slice(0, TOKEN_PREFIX_LENGTH),
      codeHash,
      deviceName: input.deviceName,
      deviceType: input.deviceType?.trim() || clientMode,
      deviceId,
      clientId,
      clientMode,
      capabilities,
      scopes,
      role,
      nonce,
      signedAt,
      signature,
      expiresAt,
      sessionExpiresAt,
    });
    const payload: DevicePairingPayload = {
      code,
      workspaceId: pairing.workspaceId,
      deviceId,
      clientId,
      clientMode,
      capabilities,
      scopes,
      role,
      nonce,
      signedAt,
      signature,
      expiresAt,
    };

    await this.recordDeviceChange('identity.device_pairing.create', actor, pairing.workspaceId, {
      pairingId: pairing.id,
      deviceId,
      deviceName: pairing.deviceName,
      clientId,
      clientMode,
      capabilities,
      scopes,
      role,
      expiresAt,
      sessionExpiresAt,
    });

    const link = `veritas://pair?payload=${base64UrlEncode(JSON.stringify(payload))}`;
    return {
      pairing,
      code,
      payload,
      link,
      pairingCode: pairing,
      pairingUrl: link,
    };
  }

  async exchangePairingCode(
    input: ExchangeDevicePairingInput
  ): Promise<ExchangeDevicePairingResult> {
    const codeHash = hashPairingCode(input.code);
    const pairing = this.sessionRepository.getPairingCodeByHash(codeHash);
    if (!pairing) {
      throw new ValidationError('Pairing code is invalid');
    }

    if (pairing.attemptCount >= MAX_PAIRING_ATTEMPTS) {
      await this.recordPairingFailure(pairing, 'pairing_attempt_limit_reached');
      throw new AppError(429, 'Pairing code is locked', 'RATE_LIMITED');
    }

    await this.assertPairingIsRedeemable(pairing);
    await this.assertPairingPayload(pairing, input);

    const requestedMode = input.clientMode
      ? normalizeClientMode(input.clientMode)
      : pairing.clientMode;
    if (requestedMode !== pairing.clientMode) {
      await this.recordPairingFailure(pairing, 'client_mode_mismatch');
      throw new ForbiddenError('Pairing client mode does not match approved mode');
    }

    this.assertNoEscalation(
      'Device pairing scopes exceed the approved scopes',
      input.scopes,
      pairing.scopes
    );
    this.assertNoEscalation(
      'Device pairing capabilities exceed the approved capabilities',
      input.capabilities,
      pairing.capabilities
    );

    const secret = generateDeviceSessionSecret();
    const session = this.sessionRepository.redeemPairingCode(pairing.id, {
      workspaceId: pairing.workspaceId,
      userId: pairing.createdBy,
      deviceName: pairing.deviceName,
      deviceType: pairing.deviceType,
      deviceId: pairing.deviceId,
      clientId: pairing.clientId,
      clientMode: pairing.clientMode,
      capabilities: pairing.capabilities,
      scopes: pairing.scopes,
      role: pairing.role,
      tokenPrefix: secret.slice(0, TOKEN_PREFIX_LENGTH),
      tokenHash: hashDeviceSessionSecret(secret),
      nonce: pairing.nonce,
      signedAt: pairing.signedAt,
      signature: pairing.signature,
      expiresAt: pairing.sessionExpiresAt,
    });

    if (!session) {
      await this.recordPairingFailure(pairing, 'pairing_replay_detected');
      throw new ValidationError('Pairing code has already been used');
    }

    await this.recordDeviceChange(
      'identity.device_pairing.exchange',
      {
        userId: pairing.createdBy,
        role: pairing.role,
        displayName: pairing.deviceName,
        permissions: pairing.scopes,
      },
      pairing.workspaceId,
      {
        pairingId: pairing.id,
        sessionId: session.id,
        deviceId: session.deviceId,
        deviceName: session.deviceName,
        clientId: session.clientId,
        clientMode: session.clientMode,
        scopes: session.scopes,
      }
    );

    return { session, secret, connectionState: session.connectionState };
  }

  async revokeSession(
    sessionId: string,
    actor: IdentityActor,
    expectedWorkspaceId?: string
  ): Promise<DeviceSessionRecord> {
    const existing = this.sessionRepository.getSession(sessionId);
    if (!existing) throw new NotFoundError('Device session not found');
    if (expectedWorkspaceId && existing.workspaceId !== expectedWorkspaceId) {
      throw new NotFoundError('Device session not found');
    }
    this.assertCanManageSessions(existing.workspaceId, actor);

    const session = this.sessionRepository.revokeSession(sessionId, actor.userId);
    if (!session) throw new ValidationError('Device session cannot be revoked');

    await this.recordDeviceChange('identity.device_session.revoke', actor, session.workspaceId, {
      sessionId,
      deviceId: session.deviceId,
      deviceName: session.deviceName,
      clientId: session.clientId,
      clientMode: session.clientMode,
    });

    return session;
  }

  testSession(
    sessionId: string,
    actor: IdentityActor,
    expectedWorkspaceId?: string
  ): DeviceSessionTestResult {
    const session = this.sessionRepository.getSession(sessionId);
    if (!session) throw new NotFoundError('Device session not found');
    if (expectedWorkspaceId && session.workspaceId !== expectedWorkspaceId) {
      throw new NotFoundError('Device session not found');
    }
    this.assertCanManageSessions(session.workspaceId, actor);

    if (session.revokedAt) {
      return { session, allowed: false, reason: 'revoked' };
    }
    if (Date.parse(session.expiresAt) <= Date.now()) {
      this.sessionRepository.updateSessionState(session.id, 'expired', 'expired');
      return {
        session: this.sessionRepository.getSession(session.id) ?? session,
        allowed: false,
        reason: 'expired',
      };
    }

    this.sessionRepository.updateSessionState(session.id, 'reconnecting', 'manual_test');
    const updated = this.sessionRepository.getSession(session.id) ?? session;
    return { session: updated, allowed: true, reason: 'session_ready_for_reconnect' };
  }

  validateSecret(secret: string, ipAddress?: string | null): DeviceSessionValidationResult {
    if (!isDeviceSessionSecret(secret)) return { valid: false };

    const session = this.sessionRepository.getSessionForAuthByHash(hashDeviceSessionSecret(secret));
    if (!session) return { valid: false };

    if (session.revokedAt) {
      this.sessionRepository.recordAuthFailure(session.id, 'revoked', 'revoked');
      return { valid: false };
    }
    if (Date.parse(session.expiresAt) <= Date.now()) {
      this.sessionRepository.recordAuthFailure(session.id, 'expired', 'expired');
      return { valid: false };
    }
    if (session.userDisabledAt) {
      this.sessionRepository.recordAuthFailure(session.id, 'auth_failed', 'user_disabled');
      return { valid: false };
    }
    if (session.workspaceArchivedAt) {
      this.sessionRepository.recordAuthFailure(session.id, 'auth_failed', 'workspace_archived');
      return { valid: false };
    }
    if (session.membershipStatus !== 'active' || session.membershipDisabledAt) {
      this.sessionRepository.recordAuthFailure(session.id, 'auth_failed', 'membership_inactive');
      return { valid: false };
    }

    const currentRole = session.membershipRole ?? session.role;
    const roleAllowed = new Set(WORKSPACE_ROLE_PERMISSIONS[currentRole] ?? []);
    const effectiveScopes = session.scopes.filter((scope) => roleAllowed.has(scope));
    if (effectiveScopes.length === 0) {
      this.sessionRepository.recordAuthFailure(
        session.id,
        'auth_failed',
        'role_downgraded_no_scopes'
      );
      return { valid: false };
    }

    const degraded =
      currentRole !== session.role || effectiveScopes.length !== session.scopes.length
        ? 'role_downgraded'
        : null;
    this.sessionRepository.recordSessionUse(session.id, ipAddress);
    this.sessionRepository.recordDegradedSession(session.id, degraded);

    return {
      valid: true,
      auth: {
        role: roleForScopes(effectiveScopes),
        keyName: session.deviceName,
        isLocalhost: false,
        userId: session.userId,
        workspaceId: session.workspaceId,
        actorType: 'device',
        authMethod: 'device-session',
        tokenName: session.deviceName,
        permissions: effectiveScopes,
        deviceSessionId: session.id,
        deviceId: session.deviceId,
        clientId: session.clientId,
        clientMode: session.clientMode,
        capabilities: session.capabilities,
        degradedReason: degraded,
      },
    };
  }

  close(): void {
    if (this.ownsSqliteDatabase) {
      this.sqliteDatabase?.close();
    }
  }

  private assertCanManageSessions(workspaceId: string, actor: IdentityActor): WorkspaceMembership {
    this.identityRepository.ensureLocalOwner();
    const membership = this.identityRepository.getMembership(workspaceId, actor.userId);
    if (!membership || membership.status !== 'active' || membership.disabledAt) {
      throw new ForbiddenError('No active membership for workspace');
    }
    if (!MANAGER_ROLES.has(membership.role)) {
      throw new ForbiddenError('Only workspace owners and admins can manage device sessions');
    }
    return membership;
  }

  private normalizeRole(role: WorkspaceRole, actorMembership: WorkspaceMembership): WorkspaceRole {
    if (role === 'owner' && actorMembership.role !== 'owner') {
      throw new ForbiddenError('Only workspace owners can approve owner device sessions');
    }
    return role;
  }

  private normalizeScopes(
    scopes: AuthPermission[],
    actor: IdentityActor,
    role: WorkspaceRole,
    clientMode: ClientMode
  ): AuthPermission[] {
    const uniqueScopes = [...new Set(scopes)];
    if (uniqueScopes.length === 0) {
      throw new ValidationError('At least one device session scope is required');
    }

    const invalid = uniqueScopes.filter((scope) => !SCOPED_PERMISSION_SET.has(scope));
    if (invalid.length > 0) {
      throw new ValidationError('Invalid device session scope', { invalid });
    }

    const rolePermissions = new Set(WORKSPACE_ROLE_PERMISSIONS[role] ?? []);
    const roleDenied = uniqueScopes.filter((scope) => !rolePermissions.has(scope));
    if (roleDenied.length > 0) {
      throw new ForbiddenError('Device session scopes exceed the approved role', {
        denied: roleDenied,
      });
    }

    const modeDeniedSet = new Set(CLIENT_MODE_SCOPE_DENY[clientMode]);
    const modeDenied = uniqueScopes.filter((scope) => modeDeniedSet.has(scope));
    if (modeDenied.length > 0) {
      throw new ForbiddenError('Device session scopes exceed the client-mode policy', {
        denied: modeDenied,
      });
    }

    const actorPermissions = actor.permissions ?? [];
    const actorHasAll = actorPermissions.includes('*') || actor.role === 'owner';
    if (!actorHasAll) {
      const denied = uniqueScopes.filter((scope) => !actorPermissions.includes(scope));
      if (denied.length > 0) {
        throw new ForbiddenError('Device session scopes exceed the current actor permissions', {
          denied,
        });
      }
    }

    return uniqueScopes;
  }

  private async assertPairingIsRedeemable(pairing: DevicePairingCodeRecord): Promise<void> {
    if (pairing.revokedAt) {
      await this.recordPairingFailure(pairing, 'pairing_revoked');
      throw new ValidationError('Pairing code has been revoked');
    }
    if (pairing.usedAt) {
      await this.recordPairingFailure(pairing, 'pairing_replay_detected');
      throw new ValidationError('Pairing code has already been used');
    }
    if (Date.parse(pairing.expiresAt) <= Date.now()) {
      await this.recordPairingFailure(pairing, 'pairing_expired');
      throw new ValidationError('Pairing code has expired');
    }
  }

  private async assertPairingPayload(
    pairing: DevicePairingCodeRecord,
    input: ExchangeDevicePairingInput
  ): Promise<void> {
    const signedAtMs = Date.parse(input.signedAt);
    const now = Date.now();
    if (!Number.isFinite(signedAtMs)) {
      throw new ValidationError('Pairing payload signed timestamp is invalid');
    }
    if (signedAtMs < now - PAIRING_PAYLOAD_MAX_AGE_MS || signedAtMs > now + CLOCK_SKEW_MS) {
      await this.recordPairingFailure(pairing, 'stale_pairing_payload');
      throw new ValidationError('Pairing payload is stale');
    }
    if (input.nonce !== pairing.nonce) {
      await this.recordPairingFailure(pairing, 'nonce_mismatch');
      throw new ValidationError('Pairing nonce does not match');
    }
    if (input.signedAt !== pairing.signedAt) {
      await this.recordPairingFailure(pairing, 'signed_timestamp_mismatch');
      throw new ValidationError('Pairing signed timestamp does not match');
    }
    const expectedSignature = signPairingPayload(hashPairingCode(input.code), {
      workspaceId: pairing.workspaceId,
      deviceId: pairing.deviceId,
      clientId: pairing.clientId,
      clientMode: pairing.clientMode,
      nonce: pairing.nonce,
      signedAt: pairing.signedAt,
    });
    if (input.signature !== expectedSignature || input.signature !== pairing.signature) {
      await this.recordPairingFailure(pairing, 'signature_mismatch');
      throw new ValidationError('Pairing signature does not match');
    }
    if (input.clientId && input.clientId !== pairing.clientId) {
      await this.recordPairingFailure(pairing, 'client_id_mismatch');
      throw new ForbiddenError('Pairing client id does not match approved client');
    }
  }

  private assertNoEscalation<T extends string>(
    message: string,
    requested: T[] | undefined,
    approved: readonly T[]
  ): void {
    if (!requested) return;
    const approvedSet = new Set(approved);
    const denied = [...new Set(requested)].filter((item) => !approvedSet.has(item));
    if (denied.length > 0) {
      throw new ForbiddenError(message, { denied });
    }
  }

  private async recordPairingFailure(
    pairing: DevicePairingCodeRecord,
    reason: string
  ): Promise<void> {
    const updated = this.sessionRepository.recordPairingAttempt(pairing.id) ?? pairing;
    await this.audit({
      action: 'identity.device_pairing.failed',
      actor: pairing.deviceName,
      resource: pairing.workspaceId,
      details: {
        pairingId: pairing.id,
        deviceId: pairing.deviceId,
        clientId: pairing.clientId,
        clientMode: pairing.clientMode,
        reason,
        attemptCount: updated.attemptCount,
      },
    });
  }

  private async recordDeviceChange(
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

let deviceSessionService: DeviceSessionService | null = null;
let deviceSessionServicePath: string | null = null;

export function getDeviceSessionService(): DeviceSessionService {
  const databasePath = resolveSqliteDatabasePath();
  if (!deviceSessionService || deviceSessionServicePath !== databasePath) {
    deviceSessionService?.close();
    deviceSessionService = new DeviceSessionService({ sqliteConnectionOptions: { databasePath } });
    deviceSessionServicePath = databasePath;
  }
  return deviceSessionService;
}

export function resetDeviceSessionServiceForTests(): void {
  deviceSessionService?.close();
  deviceSessionService = null;
  deviceSessionServicePath = null;
}

export function validateDeviceSessionSecret(
  secret: string,
  ipAddress?: string | null
): DeviceSessionValidationResult {
  if (!isDeviceSessionSecret(secret)) return { valid: false };
  return getDeviceSessionService().validateSecret(secret, ipAddress);
}

export function generateDeviceSessionSecret(): string {
  return `${DEVICE_SESSION_SECRET_PREFIX}${randomBytes(32).toString('base64url')}`;
}

export function hashDeviceSessionSecret(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex');
}

export function isDeviceSessionSecret(secret: string): boolean {
  return secret.startsWith(DEVICE_SESSION_SECRET_PREFIX);
}

export function hashPairingCode(code: string): string {
  return createHash('sha256').update(normalizePairingCode(code), 'utf8').digest('hex');
}

function generatePairingCode(): string {
  return `${PAIRING_CODE_PREFIX}${randomBytes(18).toString('base64url')}`;
}

function normalizePairingCode(code: string): string {
  return code.trim();
}

function normalizeClientMode(value: string): ClientMode {
  if (!CLIENT_MODE_SET.has(value)) {
    throw new ValidationError('Invalid device client mode', { clientMode: value });
  }
  return value as ClientMode;
}

function normalizeCapabilities(clientMode: ClientMode, capabilities?: string[]): string[] {
  const requested = capabilities?.length
    ? [...new Set(capabilities)]
    : defaultCapabilities(clientMode);
  const allowed = new Set(CLIENT_MODE_CAPABILITIES[clientMode]);
  const denied = requested.filter((capability) => !allowed.has(capability));
  if (denied.length > 0) {
    throw new ForbiddenError('Device capabilities exceed the client-mode policy', { denied });
  }
  return requested;
}

function defaultCapabilities(clientMode: ClientMode): string[] {
  return [...CLIENT_MODE_CAPABILITIES[clientMode]].slice(0, 4);
}

function defaultScopesForMode(clientMode: ClientMode): AuthPermission[] {
  if (clientMode === 'mobile-pwa' || clientMode === 'browser') {
    return ['workspace:read', 'task:read', 'comment:write'];
  }
  return ['workspace:read', 'task:read', 'task:write', 'workflow:execute'];
}

function signPairingPayload(
  codeHash: string,
  input: {
    workspaceId: string;
    deviceId: string;
    clientId: string;
    clientMode: string;
    nonce: string;
    signedAt: string;
  }
): string {
  return createHmac('sha256', codeHash)
    .update(
      [
        input.workspaceId,
        input.deviceId,
        input.clientId,
        input.clientMode,
        input.nonce,
        input.signedAt,
      ].join(':')
    )
    .digest('base64url');
}

function roleForScopes(scopes: readonly AuthPermission[]): AuthRole {
  return scopes.some((scope) => WRITE_PERMISSIONS.has(scope)) ? 'agent' : 'read-only';
}

function base64UrlEncode(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}
