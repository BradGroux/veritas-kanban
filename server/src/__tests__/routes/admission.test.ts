import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { errorHandler } from '../../middleware/error-handler.js';

const admission = vi.hoisted(() => ({
  list: vi.fn(),
  get: vi.fn(),
}));

vi.mock('../../services/admission-control-service.js', () => ({
  getAdmissionControlService: () => admission,
}));

import { admissionRoutes } from '../../routes/admission.js';

function createApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use('/api/admission', admissionRoutes);
  app.use(errorHandler);
  return app;
}

describe('admission routes', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lists filtered reservations with stable machine-readable fields', async () => {
    admission.list.mockResolvedValue([{ id: 'admission_1', state: 'active' }]);

    const response = await request(createApp()).get(
      '/api/admission?workspaceId=workspace-a&workflowRunId=run_1234567890_abcdef&workflowStepId=execute&rootReservationId=admission_root&state=active&state=released&limit=25'
    );

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      generatedAt: expect.any(String),
      reservations: [{ id: 'admission_1', state: 'active' }],
    });
    expect(admission.list).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'workspace-a',
        workflowRunId: 'run_1234567890_abcdef',
        workflowStepId: 'execute',
        rootReservationId: 'admission_root',
        states: ['active', 'released'],
        limit: 25,
      })
    );
  });

  it('inspects one reservation and rejects invalid list filters', async () => {
    admission.get.mockResolvedValue({ id: 'admission_1', state: 'released' });

    const found = await request(createApp()).get('/api/admission/admission_1');
    const invalid = await request(createApp()).get('/api/admission?state=unknown');

    expect(found.status).toBe(200);
    expect(found.body).toEqual({ id: 'admission_1', state: 'released' });
    expect(invalid.status).toBe(400);
    expect(admission.list).not.toHaveBeenCalled();
  });

  it('returns a validation error for an invalid reservation identifier', async () => {
    const invalid = await request(createApp()).get(`/api/admission/${'a'.repeat(241)}`);

    expect(invalid.status).toBe(400);
    expect(invalid.body).toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(admission.get).not.toHaveBeenCalled();
  });
});
