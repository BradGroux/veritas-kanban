import { describe, expect, it } from 'vitest';
import { createTestSqliteDatabase } from '../../storage/sqlite/test-helpers.js';
import { SqliteIdentityRepository } from '../../storage/sqlite/identity-repository.js';
import { hashInvitationToken } from '../../services/identity-service.js';

describe('SqliteIdentityRepository', () => {
  it('seeds the local owner and lists workspace membership details', () => {
    const fixture = createTestSqliteDatabase();

    try {
      fixture.database.open();
      const repository = new SqliteIdentityRepository(fixture.database);

      const setup = repository.ensureLocalOwner({
        displayName: 'Owner',
        email: 'owner@example.com',
      });
      const workspaces = repository.listWorkspacesForUser('local-user');
      const members = repository.listMembers('local');

      expect(setup.user.displayName).toBe('Owner');
      expect(setup.workspace.id).toBe('local');
      expect(setup.membership.role).toBe('owner');
      expect(workspaces).toHaveLength(1);
      expect(workspaces[0].membership.role).toBe('owner');
      expect(members[0].user?.email).toBe('owner@example.com');
    } finally {
      fixture.cleanup();
    }
  });

  it('creates, accepts, and revokes workspace invitations', () => {
    const fixture = createTestSqliteDatabase();

    try {
      fixture.database.open();
      const repository = new SqliteIdentityRepository(fixture.database);
      repository.ensureLocalOwner();

      const pending = repository.createInvitation({
        workspaceId: 'local',
        email: 'member@example.com',
        role: 'member',
        tokenHash: hashInvitationToken('invite-token'),
        invitedBy: 'local-user',
        expiresAt: '2099-01-01T00:00:00.000Z',
      });
      const accepted = repository.acceptInvitation({
        tokenHash: hashInvitationToken('invite-token'),
        displayName: 'Member',
      });
      const revoked = repository.createInvitation({
        workspaceId: 'local',
        email: 'reviewer@example.com',
        role: 'reviewer',
        tokenHash: hashInvitationToken('revoke-token'),
        invitedBy: 'local-user',
        expiresAt: '2099-01-01T00:00:00.000Z',
      });

      expect(pending.acceptedAt).toBeNull();
      expect(accepted.user.email).toBe('member@example.com');
      expect(accepted.membership.role).toBe('member');
      expect(repository.listMembers('local').map((member) => member.role)).toEqual([
        'owner',
        'member',
      ]);
      expect(repository.revokeInvitation(revoked.id)?.revokedAt).toBeTruthy();
      expect(repository.listInvitations('local')).toHaveLength(0);
      expect(repository.listInvitations('local', { includeInactive: true })).toHaveLength(2);
    } finally {
      fixture.cleanup();
    }
  });

  it('updates and removes active memberships without deleting history', () => {
    const fixture = createTestSqliteDatabase();

    try {
      fixture.database.open();
      const repository = new SqliteIdentityRepository(fixture.database);
      repository.ensureLocalOwner();
      const user = repository.createUser({
        displayName: 'Reviewer',
        email: 'reviewer@example.com',
      });
      repository.createInvitation({
        workspaceId: 'local',
        email: 'reviewer@example.com',
        role: 'reviewer',
        tokenHash: hashInvitationToken('reviewer-token'),
        invitedBy: 'local-user',
        expiresAt: '2099-01-01T00:00:00.000Z',
      });
      repository.acceptInvitation({ tokenHash: hashInvitationToken('reviewer-token') });

      const updated = repository.updateMembershipRole('local', user.id, 'read-only');
      const removed = repository.removeMembership('local', user.id);

      expect(updated?.role).toBe('read-only');
      expect(removed?.status).toBe('removed');
      expect(repository.listMembers('local').map((member) => member.userId)).not.toContain(user.id);
    } finally {
      fixture.cleanup();
    }
  });
});
