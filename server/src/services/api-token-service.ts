import { createHash, randomBytes } from 'node:crypto';
import type { AuthContext, AuthPermission, AuthRole } from '../middleware/auth.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../middleware/error-handler.js';
import { auditLog, type AuditEvent } from './audit-service.js';
import { ActivityService } from './activity-service.js';
import {
  SqliteDatabase,
  resolveSqliteDatabasePath,
  type SqliteConnectionOptions,
} from '../storage/sqlite/database.js';
import {
  SqliteApiTokenRepository,
  type ApiTokenRecord,
} from '../storage/sqlite/api-token-repository.js';
import {
  SqliteIdentityRepository,
  type WorkspaceMembership,
  type WorkspaceRole,
} from '../storage/sqlite/identity-repository.js';
import type { IdentityActor } from './identity-service.js';

const TOKEN_SECRET_PREFIX = 'vk_pat_';
const TOKEN_PREFIX_LENGTH = 16;
const MANAGER_ROLES = new Set<WorkspaceRole>(['owner', 'admin']);
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

export const SCOPED_API_TOKEN_PERMISSIONS = [
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
] as const satisfies readonly AuthPermission[];

const SCOPED_API_TOKEN_PERMISSION_SET = new Set<AuthPermission>(SCOPED_API_TOKEN_PERMISSIONS);

export interface CreateApiTokenResult {
  token: ApiTokenRecord;
  secret: string;
}

export interface ApiTokenServiceOptions {
  tokenRepository?: SqliteApiTokenRepository;
  identityRepository?: SqliteIdentityRepository;
  sqliteDatabase?: SqliteDatabase;
  sqliteConnectionOptions?: SqliteConnectionOptions;
  audit?: (event: AuditEvent) => Promise<void>;
  activity?: Pick<ActivityService, 'logActivity'>;
}

export interface ScopedApiTokenValidationResult {
  valid: boolean;
  auth?: AuthContext;
}

export class ApiTokenService {
  private readonly tokenRepository: SqliteApiTokenRepository;
  private readonly identityRepository: SqliteIdentityRepository;
  private readonly sqliteDatabase: SqliteDatabase | null = null;
  private readonly ownsSqliteDatabase: boolean = false;
  private readonly audit: (event: AuditEvent) => Promise<void>;
  private readonly activity: Pick<ActivityService, 'logActivity'>;

  constructor(options: ApiTokenServiceOptions = {}) {
    if (options.tokenRepository && options.identityRepository) {
      this.tokenRepository = options.tokenRepository;
      this.identityRepository = options.identityRepository;
    } else {
      this.sqliteDatabase =
        options.sqliteDatabase ?? new SqliteDatabase(options.sqliteConnectionOptions);
      this.ownsSqliteDatabase = !options.sqliteDatabase;
      this.sqliteDatabase.open();
      this.tokenRepository =
        options.tokenRepository ?? new SqliteApiTokenRepository(this.sqliteDatabase);
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

  listTokens(workspaceId: string, actor: IdentityActor): ApiTokenRecord[] {
    this.assertCanManageTokens(workspaceId, actor);
    return this.tokenRepository.listByWorkspace(workspaceId);
  }

  async createToken(
    input: {
      workspaceId: string;
      name: string;
      scopes: AuthPermission[];
      expiresAt?: string | null;
    },
    actor: IdentityActor
  ): Promise<CreateApiTokenResult> {
    this.assertCanManageTokens(input.workspaceId, actor);
    const scopes = this.normalizeScopes(input.scopes, actor);
    const secret = generateApiTokenSecret();
    const token = this.tokenRepository.create({
      workspaceId: input.workspaceId,
      name: input.name,
      tokenPrefix: secret.slice(0, TOKEN_PREFIX_LENGTH),
      tokenHash: hashApiTokenSecret(secret),
      scopes,
      createdBy: actor.userId,
      expiresAt: input.expiresAt ?? null,
    });

    await this.recordTokenChange('identity.api_token.create', actor, input.workspaceId, {
      tokenId: token.id,
      tokenName: token.name,
      scopes,
      expiresAt: token.expiresAt,
    });

    return { token, secret };
  }

  async revokeToken(
    tokenId: string,
    actor: IdentityActor,
    expectedWorkspaceId?: string
  ): Promise<ApiTokenRecord> {
    const existing = this.tokenRepository.get(tokenId);
    if (!existing) throw new NotFoundError('API token not found');
    if (expectedWorkspaceId && existing.workspaceId !== expectedWorkspaceId) {
      throw new NotFoundError('API token not found');
    }
    this.assertCanManageTokens(existing.workspaceId, actor);

    const token = this.tokenRepository.revoke(tokenId, actor.userId);
    if (!token) throw new ValidationError('API token cannot be revoked');

    await this.recordTokenChange('identity.api_token.revoke', actor, token.workspaceId, {
      tokenId,
      tokenName: token.name,
    });

    return token;
  }

  async rotateToken(
    tokenId: string,
    actor: IdentityActor,
    expectedWorkspaceId?: string
  ): Promise<CreateApiTokenResult> {
    const existing = this.tokenRepository.get(tokenId);
    if (!existing) throw new NotFoundError('API token not found');
    if (expectedWorkspaceId && existing.workspaceId !== expectedWorkspaceId) {
      throw new NotFoundError('API token not found');
    }
    this.assertCanManageTokens(existing.workspaceId, actor);
    this.normalizeScopes(existing.scopes, actor);

    if (!existing.revokedAt) {
      this.tokenRepository.revoke(tokenId, actor.userId);
    }

    const result = await this.createToken(
      {
        workspaceId: existing.workspaceId,
        name: existing.name,
        scopes: existing.scopes,
        expiresAt: existing.expiresAt,
      },
      actor
    );

    await this.recordTokenChange('identity.api_token.rotate', actor, existing.workspaceId, {
      previousTokenId: tokenId,
      tokenId: result.token.id,
      tokenName: result.token.name,
    });

    return result;
  }

  validateSecret(secret: string, ipAddress?: string | null): ScopedApiTokenValidationResult {
    if (!isScopedApiTokenSecret(secret)) return { valid: false };

    const token = this.tokenRepository.getForAuthByHash(hashApiTokenSecret(secret));
    if (!token) return { valid: false };
    if (token.revokedAt) return { valid: false };
    if (token.expiresAt && Date.parse(token.expiresAt) <= Date.now()) return { valid: false };
    if (token.creatorDisabledAt) return { valid: false };
    if (token.workspaceArchivedAt) return { valid: false };
    if (token.membershipStatus !== 'active' || token.membershipDisabledAt) return { valid: false };

    this.tokenRepository.recordUse(token.id, ipAddress);

    return {
      valid: true,
      auth: {
        role: roleForScopes(token.scopes),
        keyName: token.name,
        isLocalhost: false,
        userId: token.createdBy,
        workspaceId: token.workspaceId,
        actorType: 'service',
        authMethod: 'api-key',
        tokenName: token.name,
        permissions: token.scopes,
      },
    };
  }

  close(): void {
    if (this.ownsSqliteDatabase) {
      this.sqliteDatabase?.close();
    }
  }

  private assertCanManageTokens(workspaceId: string, actor: IdentityActor): WorkspaceMembership {
    this.identityRepository.ensureLocalOwner();
    const membership = this.identityRepository.getMembership(workspaceId, actor.userId);
    if (!membership || membership.status !== 'active' || membership.disabledAt) {
      throw new ForbiddenError('No active membership for workspace');
    }

    if (!MANAGER_ROLES.has(membership.role)) {
      throw new ForbiddenError('Only workspace owners and admins can manage API tokens');
    }

    return membership;
  }

  private normalizeScopes(scopes: AuthPermission[], actor: IdentityActor): AuthPermission[] {
    const uniqueScopes = [...new Set(scopes)];
    if (uniqueScopes.length === 0) {
      throw new ValidationError('At least one API token scope is required');
    }

    const invalid = uniqueScopes.filter((scope) => !SCOPED_API_TOKEN_PERMISSION_SET.has(scope));
    if (invalid.length > 0) {
      throw new ValidationError('Invalid API token scope', { invalid });
    }

    const actorPermissions = actor.permissions ?? [];
    const actorHasAll = actorPermissions.includes('*') || actor.role === 'owner';
    if (!actorHasAll) {
      const denied = uniqueScopes.filter((scope) => !actorPermissions.includes(scope));
      if (denied.length > 0) {
        throw new ForbiddenError('API token scopes exceed the current actor permissions', {
          denied,
        });
      }
    }

    return uniqueScopes;
  }

  private async recordTokenChange(
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

let apiTokenService: ApiTokenService | null = null;
let apiTokenServicePath: string | null = null;

export function getApiTokenService(): ApiTokenService {
  const databasePath = resolveSqliteDatabasePath();
  if (!apiTokenService || apiTokenServicePath !== databasePath) {
    apiTokenService?.close();
    apiTokenService = new ApiTokenService({ sqliteConnectionOptions: { databasePath } });
    apiTokenServicePath = databasePath;
  }
  return apiTokenService;
}

export function resetApiTokenServiceForTests(): void {
  apiTokenService?.close();
  apiTokenService = null;
  apiTokenServicePath = null;
}

export function validateScopedApiToken(
  secret: string,
  ipAddress?: string | null
): ScopedApiTokenValidationResult {
  if (!isScopedApiTokenSecret(secret)) return { valid: false };
  return getApiTokenService().validateSecret(secret, ipAddress);
}

export function generateApiTokenSecret(): string {
  return `${TOKEN_SECRET_PREFIX}${randomBytes(32).toString('base64url')}`;
}

export function hashApiTokenSecret(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex');
}

export function isScopedApiTokenSecret(secret: string): boolean {
  return secret.startsWith(TOKEN_SECRET_PREFIX);
}

function roleForScopes(scopes: readonly AuthPermission[]): AuthRole {
  return scopes.some((scope) => WRITE_PERMISSIONS.has(scope)) ? 'agent' : 'read-only';
}
