import { afterEach, describe, expect, it, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import type { IncomingMessage } from 'node:http';
import type { Response } from 'express';
vi.mock('../config/security.js', () => ({
  getSecurityConfig: () => ({
    authEnabled: true,
    passwordHash: 'synthetic-hash',
    sessionVersion: 0,
  }),
  getSessionVersion: () => 0,
  getValidJwtSecrets: () => ['synthetic-authority-validation-key'],
}));
import { createTestSqliteDatabase } from '../storage/sqlite/test-helpers.js';
import { SqliteIdentityRepository } from '../storage/sqlite/identity-repository.js';
import { IdentityService, resetIdentityServiceForTests } from '../services/identity-service.js';
import {
  authenticate,
  authenticateWebSocket,
  authorizeWrite,
  type AuthenticatedRequest,
  type AuthenticatedWebSocket,
} from '../middleware/auth.js';
import { canReceiveWebSocketEvent, sendWebSocketEvent } from '../services/websocket-permissions.js';

const identity = {
  issuer: 'https://auth.openai.com',
  clientId: 'synthetic-client',
  subject: 'synthetic-owner',
  email: null,
  emailVerified: false,
  displayName: 'Synthetic',
  avatarUrl: null,
};
const owner = { userId: 'local-user', role: 'owner' as const };
const originalEnv = { ...process.env };
afterEach(() => {
  resetIdentityServiceForTests();
  process.env = { ...originalEnv };
});

function setup() {
  const fixture = createTestSqliteDatabase();
  fixture.database.open();
  const repository = new SqliteIdentityRepository(fixture.database);
  const service = new IdentityService({
    repository,
    audit: vi.fn().mockResolvedValue(undefined),
    activity: { logActivity: vi.fn().mockResolvedValue(undefined) },
  });
  service.ensureOwnerSetup();
  process.env.VERITAS_SQLITE_PATH = fixture.databasePath;
  process.env.VERITAS_AUTH_ENABLED = 'true';
  process.env.VERITAS_AUTH_LOCALHOST_BYPASS = 'false';
  delete process.env.VERITAS_ADMIN_KEY;
  delete process.env.VERITAS_API_KEYS;
  return { fixture, repository, service };
}
function token(userId: string, expiresIn: number = 86400) {
  return jwt.sign(
    {
      type: 'session',
      sessionKind: 'openai-oidc',
      userId,
      workspaceId: 'local',
      role: 'admin',
      sessionVersion: 0,
    },
    'synthetic-authority-validation-key',
    { expiresIn }
  );
}
function httpRequest(session: string, loopback = false) {
  return {
    headers: { host: loopback ? 'localhost:3001' : 'kanban.example.test' },
    cookies: { veritas_session: session },
    socket: { remoteAddress: loopback ? '127.0.0.1' : '203.0.113.8' },
    method: 'POST',
  } as unknown as AuthenticatedRequest;
}
function socketRequest(session: string, loopback = false) {
  const req = httpRequest(session, loopback);
  return {
    headers: { ...req.headers, cookie: 'veritas_session=' + session },
    socket: req.socket,
    url: '/',
  } as IncomingMessage;
}
function response() {
  return { status: vi.fn().mockReturnThis(), json: vi.fn() } as unknown as Response;
}
async function addMember(service: IdentityService, role: 'owner' | 'admin') {
  const invitation = await service.createInvitation({ workspaceId: 'local', role }, owner);
  const member = await service.acceptInvitation({ token: invitation.token });
  service.resolveExternalIdentity(
    { ...identity, subject: member.user.id },
    { userId: member.user.id, workspaceId: 'local' }
  );
  return member.user.id;
}

describe('current federated authority', () => {
  it.each(['removed', 'demoted'] as const)(
    'preserves local-owner %s across external sign-in and profile reads',
    async (change) => {
      const { fixture, repository, service } = setup();
      try {
        service.resolveExternalIdentity(identity, { userId: 'local-user', workspaceId: 'local' });
        const replacement = await addMember(service, 'owner');
        const actor = { userId: replacement, role: 'owner' as const };
        if (change === 'removed') await service.removeMember('local', 'local-user', actor);
        else await service.updateMemberRole('local', 'local-user', 'read-only', actor);
        service.getProfile(actor);
        service.listWorkspaces(actor);
        service.listMembers('local', actor);
        if (change === 'removed')
          expect(() => service.resolveExternalIdentity(identity)).toThrow('No active');
        else expect(service.resolveExternalIdentity(identity).membership.role).toBe('read-only');
        expect(repository.getMembership('local', 'local-user')).toMatchObject(
          change === 'removed' ? { status: 'removed' } : { role: 'read-only' }
        );
        // Explicit trusted installation-password recovery remains available.
        service.getProfile({ ...owner, installationOwner: true });
        expect(repository.getMembership('local', 'local-user')).toMatchObject({
          status: 'active',
          role: 'owner',
          disabledAt: null,
        });
      } finally {
        resetIdentityServiceForTests();
        fixture.cleanup();
      }
    }
  );

  it.each([false, true])(
    'rejects removed sessions without password fallback (loopback=%s)',
    async (loopback) => {
      const { fixture, service } = setup();
      try {
        const member = await addMember(service, 'admin');
        const session = token(member);
        await service.removeMember('local', member, owner);
        const req = httpRequest(session, loopback),
          res = response(),
          next = vi.fn();
        authenticate(req, res, next);
        expect(next).not.toHaveBeenCalled();
        expect(req.auth).toBeUndefined();
        expect(authenticateWebSocket(socketRequest(session, loopback)).authenticated).toBe(false);
      } finally {
        resetIdentityServiceForTests();
        fixture.cleanup();
      }
    }
  );

  it('applies demotion to HTTP writes and an already established WebSocket before delivery', async () => {
    const { fixture, service } = setup();
    try {
      const member = await addMember(service, 'admin');
      const session = token(member);
      const initial = authenticateWebSocket(socketRequest(session));
      expect(initial.authenticated).toBe(true);
      expect(initial.role).toBe('admin');
      expect(initial.workspaceRole).toBe('admin');
      const send = vi.fn(),
        close = vi.fn();
      const socket = {
        readyState: 1,
        auth: initial,
        revalidateAuth: initial.revalidateAuth,
        send,
        close,
      } as unknown as AuthenticatedWebSocket;
      expect(canReceiveWebSocketEvent(socket, { permissions: ['task:write'] })).toBe(true);
      await service.updateMemberRole('local', member, 'read-only', owner);
      const req = httpRequest(session),
        res = response(),
        next = vi.fn();
      authenticate(req, res, next);
      expect(next).toHaveBeenCalledOnce();
      expect(req.auth?.role).toBe('read-only');
      expect(req.auth?.workspaceRole).toBe('read-only');
      expect(req.auth?.installationOwner).not.toBe(true);
      const write = vi.fn();
      authorizeWrite(req, res, write);
      expect(write).not.toHaveBeenCalled();
      expect(canReceiveWebSocketEvent(socket, { permissions: ['task:write'] })).toBe(false);
      expect(canReceiveWebSocketEvent(socket, { permissions: ['task:read'] })).toBe(true);
      await service.removeMember('local', member, owner);
      expect(sendWebSocketEvent(socket, 'protected', { permissions: ['task:read'] })).toBe(false);
      expect(send).not.toHaveBeenCalled();
      expect(close).toHaveBeenCalledWith(4001, 'Session authority revoked');
    } finally {
      resetIdentityServiceForTests();
      fixture.cleanup();
    }
  });

  it.each([
    'disabled-user',
    'disabled-membership',
    'archived-workspace',
    'expired-session',
  ] as const)('fails closed for %s', async (change) => {
    const { fixture, service } = setup();
    try {
      const member = await addMember(service, 'admin');
      const session = token(member, change === 'expired-session' ? -1 : 86400);
      const db = fixture.database.getConnection();
      if (change === 'disabled-user')
        db.prepare('UPDATE users SET disabled_at = ? WHERE id = ?').run(
          new Date().toISOString(),
          member
        );
      if (change === 'disabled-membership')
        db.prepare('UPDATE workspace_memberships SET disabled_at = ? WHERE user_id = ?').run(
          new Date().toISOString(),
          member
        );
      if (change === 'archived-workspace')
        db.prepare('UPDATE workspaces SET archived_at = ? WHERE id = ?').run(
          new Date().toISOString(),
          'local'
        );
      const req = httpRequest(session),
        next = vi.fn();
      authenticate(req, response(), next);
      expect(next).not.toHaveBeenCalled();
      expect(authenticateWebSocket(socketRequest(session)).authenticated).toBe(false);
    } finally {
      resetIdentityServiceForTests();
      fixture.cleanup();
    }
  });
});
