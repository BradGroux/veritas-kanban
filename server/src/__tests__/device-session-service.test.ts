import { describe, expect, it, vi } from 'vitest';
import { AppError, ForbiddenError, ValidationError } from '../middleware/error-handler.js';
import {
  DeviceSessionService,
  hashDeviceSessionSecret,
  type CreateDevicePairingResult,
} from '../services/device-session-service.js';
import { createTestSqliteDatabase } from '../storage/sqlite/test-helpers.js';
import { SqliteDeviceSessionRepository } from '../storage/sqlite/device-session-repository.js';
import { SqliteIdentityRepository } from '../storage/sqlite/identity-repository.js';
import type { IdentityActor } from '../services/identity-service.js';

function createService() {
  const fixture = createTestSqliteDatabase();
  fixture.database.open();
  const identityRepository = new SqliteIdentityRepository(fixture.database);
  const sessionRepository = new SqliteDeviceSessionRepository(fixture.database);
  const audit = vi.fn().mockResolvedValue(undefined);
  const activity = { logActivity: vi.fn().mockResolvedValue(undefined) };
  const service = new DeviceSessionService({
    identityRepository,
    sessionRepository,
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
    sessionRepository,
    service,
    audit,
    activity,
    ownerActor,
  };
}

async function createMobilePairing(
  service: DeviceSessionService,
  ownerActor: IdentityActor
): Promise<CreateDevicePairingResult> {
  return service.createPairingCode(
    {
      workspaceId: 'local',
      deviceName: 'Brad phone',
      deviceType: 'pwa',
      clientId: 'mobile-client-1',
      clientMode: 'mobile-pwa',
      capabilities: ['workspace:read', 'task:read', 'task:write'],
      scopes: ['workspace:read', 'task:read', 'task:write'],
      role: 'member',
    },
    ownerActor
  );
}

describe('DeviceSessionService', () => {
  it('creates one-use pairing codes, redeems them into hashed device sessions, and validates secrets', async () => {
    const { fixture, service, sessionRepository, audit, activity, ownerActor } = createService();

    try {
      const pairing = await createMobilePairing(service, ownerActor);
      const redeemed = await service.exchangePairingCode({
        code: pairing.code,
        clientId: pairing.payload.clientId,
        clientMode: pairing.payload.clientMode,
        capabilities: pairing.payload.capabilities,
        nonce: pairing.payload.nonce,
        signedAt: pairing.payload.signedAt,
        signature: pairing.payload.signature,
      });
      const authRecord = sessionRepository.getSessionForAuthByHash(
        hashDeviceSessionSecret(redeemed.secret)
      );
      const validation = service.validateSecret(redeemed.secret, '192.168.1.10');

      expect(pairing.code).toMatch(/^vk_pair_/);
      expect(pairing.link).toContain('veritas://pair?');
      expect(redeemed.secret).toMatch(/^vk_dev_/);
      expect(authRecord?.tokenHash).not.toBe(redeemed.secret);
      expect(validation.valid).toBe(true);
      expect(validation.auth).toMatchObject({
        actorType: 'device',
        authMethod: 'device-session',
        workspaceId: 'local',
        userId: 'local-user',
        deviceSessionId: redeemed.session.id,
        deviceId: redeemed.session.deviceId,
        clientId: 'mobile-client-1',
        clientMode: 'mobile-pwa',
        permissions: ['workspace:read', 'task:read', 'task:write'],
      });
      expect(audit).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'identity.device_pairing.create', resource: 'local' })
      );
      expect(audit).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'identity.device_pairing.exchange', resource: 'local' })
      );
      expect(activity.logActivity).toHaveBeenCalledWith(
        'membership_updated',
        'workspace:local',
        'Workspace local',
        expect.objectContaining({ action: 'identity.device_pairing.exchange' })
      );
    } finally {
      fixture.cleanup();
    }
  });

  it('rejects expired pairing codes and one-use replay attempts', async () => {
    const { fixture, service, ownerActor } = createService();

    try {
      const expired = await createMobilePairing(service, ownerActor);
      fixture.database
        .getConnection()
        .prepare('UPDATE device_pairing_codes SET expires_at = ? WHERE id = ?')
        .run('2000-01-01T00:00:00.000Z', expired.pairing.id);

      await expect(
        service.exchangePairingCode({
          code: expired.code,
          clientId: expired.payload.clientId,
          clientMode: expired.payload.clientMode,
          capabilities: expired.payload.capabilities,
          nonce: expired.payload.nonce,
          signedAt: expired.payload.signedAt,
          signature: expired.payload.signature,
        })
      ).rejects.toBeInstanceOf(ValidationError);

      const oneUse = await createMobilePairing(service, ownerActor);
      await service.exchangePairingCode({
        code: oneUse.code,
        clientId: oneUse.payload.clientId,
        clientMode: oneUse.payload.clientMode,
        capabilities: oneUse.payload.capabilities,
        nonce: oneUse.payload.nonce,
        signedAt: oneUse.payload.signedAt,
        signature: oneUse.payload.signature,
      });

      await expect(
        service.exchangePairingCode({
          code: oneUse.code,
          clientId: oneUse.payload.clientId,
          clientMode: oneUse.payload.clientMode,
          capabilities: oneUse.payload.capabilities,
          nonce: oneUse.payload.nonce,
          signedAt: oneUse.payload.signedAt,
          signature: oneUse.payload.signature,
        })
      ).rejects.toBeInstanceOf(ValidationError);
    } finally {
      fixture.cleanup();
    }
  });

  it('rejects stale nonce, client-mode downgrade, brute-force attempts, and scope escalation', async () => {
    const { fixture, service, ownerActor } = createService();

    try {
      const pairing = await service.createPairingCode(
        {
          workspaceId: 'local',
          deviceName: 'Desktop peer',
          deviceType: 'desktop',
          clientId: 'desktop-client-1',
          clientMode: 'desktop-remote',
          capabilities: ['desktop:remote', 'agent:run:scoped'],
          scopes: ['workspace:read', 'task:read', 'task:write'],
          role: 'member',
        },
        ownerActor
      );

      await expect(
        service.exchangePairingCode({
          code: pairing.code,
          clientId: pairing.payload.clientId,
          clientMode: pairing.payload.clientMode,
          capabilities: pairing.payload.capabilities,
          nonce: pairing.payload.nonce,
          signedAt: '2000-01-01T00:00:00.000Z',
          signature: pairing.payload.signature,
        })
      ).rejects.toBeInstanceOf(ValidationError);

      await expect(
        service.exchangePairingCode({
          code: pairing.code,
          clientId: pairing.payload.clientId,
          clientMode: pairing.payload.clientMode,
          capabilities: pairing.payload.capabilities,
          nonce: 'stale-nonce-stale-nonce',
          signedAt: pairing.payload.signedAt,
          signature: pairing.payload.signature,
        })
      ).rejects.toBeInstanceOf(ValidationError);

      await expect(
        service.exchangePairingCode({
          code: pairing.code,
          clientId: pairing.payload.clientId,
          clientMode: 'mobile-pwa',
          capabilities: pairing.payload.capabilities,
          nonce: pairing.payload.nonce,
          signedAt: pairing.payload.signedAt,
          signature: pairing.payload.signature,
        })
      ).rejects.toBeInstanceOf(ForbiddenError);

      for (let attempt = 0; attempt < 2; attempt += 1) {
        await expect(
          service.exchangePairingCode({
            code: pairing.code,
            clientId: pairing.payload.clientId,
            clientMode: pairing.payload.clientMode,
            capabilities: pairing.payload.capabilities,
            nonce: `bad-nonce-${attempt}-bad-nonce`,
            signedAt: pairing.payload.signedAt,
            signature: pairing.payload.signature,
          })
        ).rejects.toBeInstanceOf(ValidationError);
      }

      await expect(
        service.exchangePairingCode({
          code: pairing.code,
          clientId: pairing.payload.clientId,
          clientMode: pairing.payload.clientMode,
          capabilities: pairing.payload.capabilities,
          nonce: 'bad-nonce-limit-bad-nonce',
          signedAt: pairing.payload.signedAt,
          signature: pairing.payload.signature,
        })
      ).rejects.toBeInstanceOf(AppError);

      const escalation = await service.createPairingCode(
        {
          workspaceId: 'local',
          deviceName: 'Scoped desktop',
          deviceType: 'desktop',
          clientId: 'desktop-client-2',
          clientMode: 'desktop-remote',
          scopes: ['workspace:read', 'task:read'],
          role: 'member',
        },
        ownerActor
      );

      await expect(
        service.exchangePairingCode({
          code: escalation.code,
          clientId: escalation.payload.clientId,
          clientMode: escalation.payload.clientMode,
          capabilities: escalation.payload.capabilities,
          scopes: ['workspace:read', 'task:read', 'task:write'],
          nonce: escalation.payload.nonce,
          signedAt: escalation.payload.signedAt,
          signature: escalation.payload.signature,
        })
      ).rejects.toBeInstanceOf(ForbiddenError);

      await expect(
        service.createPairingCode(
          {
            workspaceId: 'local',
            deviceName: 'Escalation phone',
            deviceType: 'pwa',
            clientId: 'mobile-client-2',
            clientMode: 'mobile-pwa',
            scopes: ['settings:write'],
            role: 'member',
          },
          ownerActor
        )
      ).rejects.toBeInstanceOf(ForbiddenError);
    } finally {
      fixture.cleanup();
    }
  });

  it('rejects revoked device secrets and clamps permissions after workspace role downgrade', async () => {
    const { fixture, service, ownerActor } = createService();

    try {
      const pairing = await createMobilePairing(service, ownerActor);
      const redeemed = await service.exchangePairingCode({
        code: pairing.code,
        clientId: pairing.payload.clientId,
        clientMode: pairing.payload.clientMode,
        capabilities: pairing.payload.capabilities,
        nonce: pairing.payload.nonce,
        signedAt: pairing.payload.signedAt,
        signature: pairing.payload.signature,
      });

      expect(service.validateSecret(redeemed.secret).auth?.permissions).toContain('task:write');
      fixture.database
        .getConnection()
        .prepare('UPDATE workspace_memberships SET role = ? WHERE workspace_id = ? AND user_id = ?')
        .run('read-only', 'local', ownerActor.userId);

      const downgraded = service.validateSecret(redeemed.secret);
      expect(downgraded.valid).toBe(true);
      expect(downgraded.auth?.role).toBe('read-only');
      expect(downgraded.auth?.degradedReason).toBe('role_downgraded');
      expect(downgraded.auth?.permissions).toEqual(['workspace:read', 'task:read']);

      fixture.database
        .getConnection()
        .prepare('UPDATE workspace_memberships SET role = ? WHERE workspace_id = ? AND user_id = ?')
        .run('owner', 'local', ownerActor.userId);
      await service.revokeSession(redeemed.session.id, ownerActor);

      expect(service.validateSecret(redeemed.secret).valid).toBe(false);
      const testResult = service.testSession(redeemed.session.id, ownerActor);
      expect(testResult.allowed).toBe(false);
      expect(testResult.reason).toBe('revoked');
    } finally {
      fixture.cleanup();
    }
  });
});
