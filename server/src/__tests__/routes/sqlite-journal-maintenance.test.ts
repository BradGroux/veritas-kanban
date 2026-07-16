import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { AuthenticatedRequest } from '../../middleware/auth.js';
import { errorHandler } from '../../middleware/error-handler.js';

const service = vi.hoisted(() => ({
  preview: vi.fn(),
  schedule: vi.fn(),
  getOperation: vi.fn(),
  getPolicySummary: vi.fn(),
  revoke: vi.fn(),
}));
const auditLog = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('../../services/audit-service.js', () => ({ auditLog }));

vi.mock('../../storage/sqlite/journal-maintenance-service.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../storage/sqlite/journal-maintenance-service.js')>();
  return {
    ...actual,
    getSqliteJournalMaintenanceService: () => service,
  };
});

import { maintenanceRoutes } from '../../routes/maintenance.js';

function createApp(authMethod: 'api-key' | 'disabled' = 'api-key') {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as AuthenticatedRequest).auth = {
      role: 'admin',
      isLocalhost: true,
      authMethod,
      keyName: authMethod === 'api-key' ? 'maintenance-admin' : undefined,
      userId: 'local-user',
    };
    next();
  });
  app.use(maintenanceRoutes);
  app.use(errorHandler);
  return app;
}

describe('SQLite journal maintenance routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auditLog.mockResolvedValue(undefined);
    service.preview.mockResolvedValue({ id: 'preview', targetMode: 'delete' });
    service.schedule.mockResolvedValue({ id: 'operation', state: 'scheduled' });
    service.revoke.mockResolvedValue({ id: 'policy', status: 'revoked' });
  });

  it('previews only the configured database and derives the actor from auth', async () => {
    const response = await request(createApp())
      .post('/sqlite/journal/preview')
      .send({
        targetMode: 'delete',
        singleHost: true,
        overrideReason: 'Approved compatibility posture',
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      });

    expect(response.status).toBe(200);
    expect(service.preview).toHaveBeenCalledWith(
      expect.objectContaining({ targetMode: 'delete', singleHost: true }),
      'api-key:maintenance-admin'
    );

    const arbitraryPath = await request(createApp())
      .post('/sqlite/journal/preview')
      .send({ targetMode: 'wal', sqlitePath: '/tmp/other.db' });
    expect(arbitraryPath.status).toBe(400);
    expect(service.preview).toHaveBeenCalledTimes(1);
  });

  it('schedules apply with explicit confirmation for authenticated admin keys', async () => {
    const previewId = '98af3a58-1b8b-41b3-8162-dfdb1f257740';
    const response = await request(createApp())
      .post('/sqlite/journal/apply')
      .send({
        previewId,
        previewToken: 'a'.repeat(64),
        confirm: previewId,
        acknowledgeRisks: true,
      });

    expect(response.status).toBe(202);
    expect(service.schedule).toHaveBeenCalledWith(
      expect.objectContaining({ previewId, acknowledgeRisks: true }),
      'api-key:maintenance-admin'
    );
  });

  it('rejects auth-disabled apply even when the implicit role is admin', async () => {
    const previewId = '98af3a58-1b8b-41b3-8162-dfdb1f257740';
    const response = await request(createApp('disabled'))
      .post('/sqlite/journal/apply')
      .send({
        previewId,
        previewToken: 'a'.repeat(64),
        confirm: previewId,
        acknowledgeRisks: true,
      });

    expect(response.status).toBe(403);
    expect(service.schedule).not.toHaveBeenCalled();
  });

  it('validates revoke reason and never accepts an actor from the body', async () => {
    const rejected = await request(createApp())
      .post('/sqlite/journal/override/revoke')
      .send({ reason: 'too short', actor: 'spoofed' });
    expect(rejected.status).toBe(400);

    const response = await request(createApp())
      .post('/sqlite/journal/override/revoke')
      .send({ reason: 'Revoked by the maintenance operator' });
    expect(response.status).toBe(200);
    expect(service.revoke).toHaveBeenCalledWith(
      { reason: 'Revoked by the maintenance operator' },
      'api-key:maintenance-admin'
    );
  });
});
