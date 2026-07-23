import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { errorHandler } from '../../middleware/error-handler.js';
import type { AuthenticatedRequest } from '../../middleware/auth.js';

const service = vi.hoisted(() => ({
  listDefinitions: vi.fn(),
  getDefinition: vi.fn(),
  createDefinition: vi.fn(),
  updateDefinition: vi.fn(),
  deleteDefinition: vi.fn(),
}));

vi.mock('../../services/credential-broker-service.js', () => ({
  getCredentialBrokerService: () => service,
}));

import credentialBrokerRoutes from '../../routes/credential-broker.js';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as AuthenticatedRequest).auth = {
      role: 'admin',
      isLocalhost: true,
      permissions: ['admin:manage'],
    };
    next();
  });
  app.use('/api/credential-broker', credentialBrokerRoutes);
  app.use(errorHandler);
  return app;
}

const input = {
  id: 'github-token',
  name: 'GitHub token',
  enabled: true,
  source: { kind: 'environment', reference: 'GITHUB_TOKEN' },
  scope: {
    dispatchTypes: ['http'],
    hosts: ['api.github.com'],
    tools: [],
    destinations: ['https://api.github.com'],
    methods: ['GET'],
    actions: ['issues.read'],
    pathPrefixes: ['/repos/'],
  },
  lease: { ttlSeconds: 60, maxUses: 1, renewable: false },
  approval: 'not-required',
};

describe('credential broker definition routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns definition metadata without exposing a source value', async () => {
    service.listDefinitions.mockResolvedValue([
      {
        ...input,
        schemaVersion: 'credential-definition/v1',
        digest: `sha256:${'a'.repeat(64)}`,
        createdAt: '2026-07-23T18:00:00.000Z',
        updatedAt: '2026-07-23T18:00:00.000Z',
      },
    ]);

    const response = await request(createApp()).get('/api/credential-broker');

    expect(response.status).toBe(200);
    expect(response.body[0].source).toEqual({
      kind: 'environment',
      reference: 'GITHUB_TOKEN',
    });
    expect(JSON.stringify(response.body)).not.toContain('credential-sensitive-value');
  });

  it('validates and forwards metadata-only create and update payloads', async () => {
    service.createDefinition.mockResolvedValue({ ...input, digest: `sha256:${'b'.repeat(64)}` });
    const created = await request(createApp()).post('/api/credential-broker').send(input);
    expect(created.status).toBe(201);
    expect(service.createDefinition).toHaveBeenCalledWith(input);

    service.updateDefinition.mockResolvedValue({
      ...input,
      name: 'Updated GitHub token',
      digest: `sha256:${'c'.repeat(64)}`,
    });
    const updatedInput = { ...input, name: 'Updated GitHub token' };
    const updated = await request(createApp())
      .put('/api/credential-broker/github-token')
      .send(updatedInput);
    expect(updated.status).toBe(200);
    expect(service.updateDefinition).toHaveBeenCalledWith('github-token', updatedInput);
  });

  it('rejects raw-looking secret material before it reaches the service', async () => {
    const response = await request(createApp())
      .post('/api/credential-broker')
      .send({
        ...input,
        source: {
          kind: 'external',
          provider: 'vault',
          reference: 'token=credential-sensitive-value',
        },
      });

    expect(response.status).toBe(400);
    expect(service.createDefinition).not.toHaveBeenCalled();
  });
});
