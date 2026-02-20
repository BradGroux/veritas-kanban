import express from 'express';
import request from 'supertest';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../config/security.js', () => ({
  getSecurityConfig: vi.fn(() => ({
    authEnabled: false,
    passwordHash: null,
    jwtSecret: 'test-secret-key',
  })),
  getJwtSecret: vi.fn(() => 'test-secret-key'),
  getValidJwtSecrets: vi.fn(() => ['test-secret-key']),
}));

import { authenticate, authorizeWrite } from '../../middleware/auth.js';

describe('API write authorization integration', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      NODE_ENV: 'test',
      VERITAS_AUTH_ENABLED: 'true',
      VERITAS_AUTH_LOCALHOST_BYPASS: 'false',
      VERITAS_API_KEYS: 'readonly:ro-key:read-only,writer:agent-key:agent',
    };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  function createApp() {
    const app = express();
    app.use(express.json());
    app.use('/api', authenticate, authorizeWrite);

    app.get('/api/probe', (_req, res) => {
      res.status(200).json({ ok: true });
    });

    app.post('/api/probe', (_req, res) => {
      res.status(201).json({ created: true });
    });

    return app;
  }

  it('allows read-only key to perform GET', async () => {
    const app = createApp();

    await request(app).get('/api/probe').set('X-API-Key', 'ro-key').expect(200);
  });

  it('denies read-only key from POST mutation', async () => {
    const app = createApp();

    const response = await request(app)
      .post('/api/probe')
      .set('X-API-Key', 'ro-key')
      .send({ name: 'test' })
      .expect(403);

    expect(response.body).toMatchObject({
      code: 'WRITE_FORBIDDEN',
      message: 'Write access denied',
    });
  });

  it('allows agent key to perform POST mutation', async () => {
    const app = createApp();

    await request(app)
      .post('/api/probe')
      .set('X-API-Key', 'agent-key')
      .send({ name: 'test' })
      .expect(201);
  });
});
