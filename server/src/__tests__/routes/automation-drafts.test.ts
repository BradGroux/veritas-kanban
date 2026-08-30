import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthenticatedRequest } from '../../middleware/auth.js';
import { errorHandler } from '../../middleware/error-handler.js';

const automationDraftService = vi.hoisted(() => ({
  preview: vi.fn(),
  save: vi.fn(),
  list: vi.fn(),
  get: vi.fn(),
  revise: vi.fn(),
  clone: vi.fn(),
  delete: vi.fn(),
}));

vi.mock('../../services/automation-draft-service.js', () => ({
  getAutomationDraftService: () => automationDraftService,
}));

import { schedulerRoutes } from '../../routes/scheduler.js';

function createApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as AuthenticatedRequest).auth = {
      userId: 'operator-1',
      role: 'admin',
      workspaceId: 'workspace-a',
      authMethod: 'api-token',
    };
    next();
  });
  app.use('/api/scheduler', schedulerRoutes);
  app.use(errorHandler);
  return app;
}

describe('automation draft routes', () => {
  const draftId = 'automation_1234567890abcdef12345678';
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  it('binds preview attribution and workspace to authenticated context', async () => {
    automationDraftService.preview.mockResolvedValue({ id: draftId, status: 'inactive' });

    const response = await request(app)
      .post('/api/scheduler/drafts/preview')
      .send({
        intent: 'Every weekday at 9 AM create a report.',
        requestId: 'preview-1',
        hints: { timezone: 'UTC' },
      });

    expect(response.status).toBe(200);
    expect(automationDraftService.preview).toHaveBeenCalledWith({
      intent: 'Every weekday at 9 AM create a report.',
      requestId: 'preview-1',
      requestedBy: 'operator-1',
      hints: { timezone: 'UTC', workspaceId: 'workspace-a' },
    });
  });

  it('rejects workspace spoofing and requires exact deletion confirmation', async () => {
    const spoofed = await request(app)
      .post('/api/scheduler/drafts/preview')
      .send({
        intent: 'Every weekday at 9 AM create a report.',
        requestId: 'preview-2',
        hints: { workspaceId: 'workspace-b' },
      });
    const mismatchedDelete = await request(app).delete(
      `/api/scheduler/drafts/${draftId}?confirm=automation_abcdefabcdefabcdefabcdef`
    );

    expect(spoofed.status).toBe(403);
    expect(mismatchedDelete.status).toBe(403);
    expect(automationDraftService.preview).not.toHaveBeenCalled();
    expect(automationDraftService.delete).not.toHaveBeenCalled();
  });

  it('deletes only the exactly confirmed inactive draft', async () => {
    automationDraftService.delete.mockResolvedValue({ deleted: true, revisionsDeleted: 2 });

    const response = await request(app).delete(
      `/api/scheduler/drafts/${draftId}?confirm=${draftId}`
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ deleted: true, revisionsDeleted: 2 });
    expect(automationDraftService.delete).toHaveBeenCalledWith(draftId);
  });
});
