import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import type { AuthenticatedRequest } from '../../middleware/auth.js';
import { errorHandler } from '../../middleware/error-handler.js';
import { createIdentityRoutes } from '../../routes/identity.js';
import { IdentityService } from '../../services/identity-service.js';
import { createTestSqliteDatabase } from '../../storage/sqlite/test-helpers.js';
import { SqliteIdentityRepository } from '../../storage/sqlite/identity-repository.js';

function createApp(role: 'admin' | 'agent' | 'read-only' = 'admin') {
  const fixture = createTestSqliteDatabase();
  fixture.database.open();
  const repository = new SqliteIdentityRepository(fixture.database);
  const service = new IdentityService({
    repository,
    audit: vi.fn().mockResolvedValue(undefined),
    activity: { logActivity: vi.fn().mockResolvedValue(undefined) },
  });
  service.ensureOwnerSetup({ displayName: 'Owner' });

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as AuthenticatedRequest).auth = {
      role,
      keyName: role,
      isLocalhost: false,
    };
    next();
  });
  app.use('/identity', createIdentityRoutes(service));
  app.use(errorHandler);

  return { app, fixture };
}

describe('identity routes', () => {
  it('returns profile and workspace memberships for the current user', async () => {
    const { app, fixture } = createApp();

    try {
      const response = await request(app).get('/identity/profile').expect(200);

      expect(response.body.user.id).toBe('local-user');
      expect(response.body.workspaces[0].workspace.id).toBe('local');
      expect(response.body.workspaces[0].membership.role).toBe('owner');
    } finally {
      fixture.cleanup();
    }
  });

  it('creates and accepts workspace invitations', async () => {
    const { app, fixture } = createApp();

    try {
      const invitation = await request(app)
        .post('/identity/workspaces/local/invitations')
        .send({ email: 'member@example.com', role: 'member' })
        .expect(201);
      const accepted = await request(app)
        .post('/identity/invitations/accept')
        .send({ token: invitation.body.token, displayName: 'Member' })
        .expect(201);

      expect(invitation.body.invitation.tokenHash).not.toBe(invitation.body.token);
      expect(accepted.body.membership.role).toBe('member');
    } finally {
      fixture.cleanup();
    }
  });

  it('keeps read-only callers out of membership mutations', async () => {
    const { app, fixture } = createApp('read-only');

    try {
      await request(app)
        .post('/identity/workspaces/local/invitations')
        .send({ email: 'member@example.com', role: 'member' })
        .expect(403);
    } finally {
      fixture.cleanup();
    }
  });
});
