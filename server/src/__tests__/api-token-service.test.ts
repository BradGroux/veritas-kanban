import { describe, expect, it, vi } from 'vitest';
import { ForbiddenError, NotFoundError } from '../middleware/error-handler.js';
import {
  ApiTokenService,
  hashApiTokenSecret,
  type CreateApiTokenResult,
} from '../services/api-token-service.js';
import { createTestSqliteDatabase } from '../storage/sqlite/test-helpers.js';
import { SqliteApiTokenRepository } from '../storage/sqlite/api-token-repository.js';
import { SqliteIdentityRepository } from '../storage/sqlite/identity-repository.js';
import type { IdentityActor } from '../services/identity-service.js';

function createService() {
  const fixture = createTestSqliteDatabase();
  fixture.database.open();
  const identityRepository = new SqliteIdentityRepository(fixture.database);
  const tokenRepository = new SqliteApiTokenRepository(fixture.database);
  const audit = vi.fn().mockResolvedValue(undefined);
  const activity = { logActivity: vi.fn().mockResolvedValue(undefined) };
  const service = new ApiTokenService({
    identityRepository,
    tokenRepository,
    audit,
    activity,
  });
  const owner = identityRepository.ensureLocalOwner({ displayName: 'Owner' });
  const ownerActor = {
    userId: owner.user.id,
    role: 'owner',
    displayName: owner.user.displayName,
    permissions: ['*'],
  } satisfies IdentityActor;

  return {
    fixture,
    identityRepository,
    tokenRepository,
    service,
    audit,
    activity,
    ownerActor,
  };
}

describe('ApiTokenService', () => {
  it('creates scoped tokens, stores only a hash, and validates the secret', async () => {
    const { fixture, service, tokenRepository, audit, activity, ownerActor } = createService();

    try {
      const result = await service.createToken(
        {
          workspaceId: 'local',
          name: 'CLI worker',
          scopes: ['workspace:read', 'task:read'],
        },
        ownerActor
      );

      const authRecord = tokenRepository.getForAuthByHash(hashApiTokenSecret(result.secret));
      const validation = service.validateSecret(result.secret);

      expect(result.secret).toMatch(/^vk_pat_/);
      expect(authRecord?.tokenHash).not.toBe(result.secret);
      expect(authRecord?.scopes).toEqual(['workspace:read', 'task:read']);
      expect(validation.valid).toBe(true);
      expect(validation.auth).toMatchObject({
        role: 'read-only',
        userId: 'local-user',
        workspaceId: 'local',
        tokenName: 'CLI worker',
        permissions: ['workspace:read', 'task:read'],
      });
      expect(audit).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'identity.api_token.create', resource: 'local' })
      );
      expect(activity.logActivity).toHaveBeenCalledWith(
        'membership_updated',
        'workspace:local',
        'Workspace local',
        expect.objectContaining({ action: 'identity.api_token.create' })
      );
    } finally {
      fixture.cleanup();
    }
  });

  it('rejects token scopes that exceed the current actor permission boundary', async () => {
    const { fixture, service, ownerActor } = createService();

    try {
      const scopedActor = {
        ...ownerActor,
        role: 'admin',
        permissions: ['admin:manage', 'task:read'],
      } satisfies IdentityActor;

      await expect(
        service.createToken(
          {
            workspaceId: 'local',
            name: 'Escalation attempt',
            scopes: ['task:write'],
          },
          scopedActor
        )
      ).rejects.toBeInstanceOf(ForbiddenError);
    } finally {
      fixture.cleanup();
    }
  });

  it('rejects revoked, expired, and disabled-actor tokens during validation', async () => {
    const { fixture, service, ownerActor } = createService();

    try {
      const active = await service.createToken(
        {
          workspaceId: 'local',
          name: 'Revoked worker',
          scopes: ['workspace:read'],
        },
        ownerActor
      );
      const expired = await service.createToken(
        {
          workspaceId: 'local',
          name: 'Expired worker',
          scopes: ['workspace:read'],
          expiresAt: '2000-01-01T00:00:00.000Z',
        },
        ownerActor
      );

      await service.revokeToken(active.token.id, ownerActor);

      expect(service.validateSecret(active.secret).valid).toBe(false);
      expect(service.validateSecret(expired.secret).valid).toBe(false);

      const stillActive = await service.createToken(
        {
          workspaceId: 'local',
          name: 'Disabled owner worker',
          scopes: ['workspace:read'],
        },
        ownerActor
      );
      fixture.database
        .getConnection()
        .prepare('UPDATE users SET disabled_at = ? WHERE id = ?')
        .run(new Date().toISOString(), ownerActor.userId);

      expect(service.validateSecret(stillActive.secret).valid).toBe(false);
    } finally {
      fixture.cleanup();
    }
  });

  it('does not revoke tokens through the wrong workspace path', async () => {
    const { fixture, service, ownerActor } = createService();

    try {
      const result: CreateApiTokenResult = await service.createToken(
        {
          workspaceId: 'local',
          name: 'Workspace bound worker',
          scopes: ['workspace:read'],
        },
        ownerActor
      );

      await expect(
        service.revokeToken(result.token.id, ownerActor, 'other-workspace')
      ).rejects.toBeInstanceOf(NotFoundError);
      expect(service.validateSecret(result.secret).valid).toBe(true);
    } finally {
      fixture.cleanup();
    }
  });
});
