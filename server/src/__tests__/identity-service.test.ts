import { describe, expect, it, vi } from 'vitest';
import { createTestSqliteDatabase } from '../storage/sqlite/test-helpers.js';
import { SqliteIdentityRepository } from '../storage/sqlite/identity-repository.js';
import { IdentityService, type IdentityActor } from '../services/identity-service.js';
import { ForbiddenError, ValidationError } from '../middleware/error-handler.js';

function createService() {
  const fixture = createTestSqliteDatabase();
  fixture.database.open();
  const repository = new SqliteIdentityRepository(fixture.database);
  const audit = vi.fn().mockResolvedValue(undefined);
  const activity = { logActivity: vi.fn().mockResolvedValue(undefined) };
  const service = new IdentityService({ repository, audit, activity });
  const owner = service.ensureOwnerSetup({ displayName: 'Owner' });

  return {
    fixture,
    repository,
    service,
    audit,
    activity,
    ownerActor: {
      userId: owner.user.id,
      role: 'owner',
      displayName: owner.user.displayName,
    } satisfies IdentityActor,
  };
}

describe('IdentityService', () => {
  it('lets owner/admin create invitations and records audit and activity entries', async () => {
    const { fixture, service, audit, activity, ownerActor } = createService();

    try {
      const result = await service.createInvitation(
        {
          workspaceId: 'local',
          email: 'member@example.com',
          role: 'member',
        },
        ownerActor
      );

      expect(result.token).toHaveLength(64);
      expect(result.invitation.email).toBe('member@example.com');
      expect(result.invitation.tokenHash).not.toBe(result.token);
      expect(audit).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'identity.invitation.create',
          resource: 'local',
        })
      );
      expect(activity.logActivity).toHaveBeenCalledWith(
        'membership_updated',
        'workspace:local',
        'Workspace local',
        expect.objectContaining({ action: 'identity.invitation.create' })
      );
    } finally {
      fixture.cleanup();
    }
  });

  it('rejects member and read-only membership management', async () => {
    const { fixture, service, ownerActor } = createService();

    try {
      const invitation = await service.createInvitation(
        {
          workspaceId: 'local',
          email: 'member@example.com',
          role: 'member',
        },
        ownerActor
      );
      const accepted = await service.acceptInvitation({
        token: invitation.token,
        displayName: 'Member',
      });

      await expect(
        service.createInvitation(
          {
            workspaceId: 'local',
            email: 'blocked@example.com',
            role: 'member',
          },
          {
            userId: accepted.user.id,
            role: 'member',
            displayName: 'Member',
          }
        )
      ).rejects.toBeInstanceOf(ForbiddenError);
      await expect(
        service.createInvitation(
          {
            workspaceId: 'local',
            email: 'blocked@example.com',
            role: 'read-only',
          },
          {
            userId: accepted.user.id,
            role: 'read-only',
            displayName: 'Member',
          }
        )
      ).rejects.toBeInstanceOf(ForbiddenError);
    } finally {
      fixture.cleanup();
    }
  });

  it('accepts invitations into active memberships and blocks expired tokens', async () => {
    const { fixture, service, ownerActor } = createService();

    try {
      const active = await service.createInvitation(
        {
          workspaceId: 'local',
          email: 'reviewer@example.com',
          role: 'reviewer',
        },
        ownerActor
      );
      const accepted = await service.acceptInvitation({
        token: active.token,
        displayName: 'Reviewer',
      });
      const expired = await service.createInvitation(
        {
          workspaceId: 'local',
          email: 'old@example.com',
          role: 'member',
          expiresAt: '2000-01-01T00:00:00.000Z',
        },
        ownerActor
      );

      expect(accepted.membership.role).toBe('reviewer');
      expect(accepted.invitation.acceptedAt).toBeTruthy();
      await expect(
        service.acceptInvitation({
          token: expired.token,
          displayName: 'Old Invite',
        })
      ).rejects.toBeInstanceOf(ValidationError);
    } finally {
      fixture.cleanup();
    }
  });

  it('protects the last owner from demotion or removal', async () => {
    const { fixture, service, ownerActor } = createService();

    try {
      await expect(
        service.updateMemberRole('local', ownerActor.userId, 'admin', ownerActor)
      ).rejects.toBeInstanceOf(ValidationError);
      await expect(
        service.removeMember('local', ownerActor.userId, ownerActor)
      ).rejects.toBeInstanceOf(ValidationError);
    } finally {
      fixture.cleanup();
    }
  });
});
