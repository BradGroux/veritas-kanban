import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { AuthenticatedRequest } from '../../middleware/auth.js';
import { errorHandler } from '../../middleware/error-handler.js';

const mockApprovalBroker = vi.hoisted(() => ({
  list: vi.fn(),
  get: vi.fn(),
  decide: vi.fn(),
}));

vi.mock('../../services/run-approval-broker-service.js', () => ({
  getRunApprovalBrokerService: () => mockApprovalBroker,
}));

import { runApprovalRoutes } from '../../routes/run-approvals.js';

const APPROVAL_ID = 'runapproval_route_test12';
const ACTION_HASH = 'a'.repeat(64);

function createApp(role: 'admin' | 'read-only' = 'admin'): express.Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as AuthenticatedRequest).auth = {
      role,
      isLocalhost: false,
      userId: 'user-brad',
      tokenName: 'Brad',
      workspaceId: 'workspace-a',
      actorType: 'user',
      authMethod: 'api-key',
      clientMode: req.header('x-client-mode') || undefined,
    };
    next();
  });
  app.use('/api/run-approvals', runApprovalRoutes);
  app.use(errorHandler);
  return app;
}

describe('Run Approval Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('scopes list and detail reads to the authenticated workspace', async () => {
    mockApprovalBroker.list.mockResolvedValue([{ id: APPROVAL_ID }]);
    mockApprovalBroker.get.mockResolvedValue({ id: APPROVAL_ID });
    const app = createApp();

    const list = await request(app).get(
      '/api/run-approvals?status=pending&taskId=task-1&attemptId=attempt-1'
    );
    const detail = await request(app).get(`/api/run-approvals/${APPROVAL_ID}`);

    expect(list.status).toBe(200);
    expect(detail.status).toBe(200);
    expect(mockApprovalBroker.list).toHaveBeenCalledWith({
      workspaceId: 'workspace-a',
      status: 'pending',
      taskId: 'task-1',
      attemptId: 'attempt-1',
    });
    expect(mockApprovalBroker.get).toHaveBeenCalledWith(APPROVAL_ID, 'workspace-a');
  });

  it('derives the reviewer from auth context and preserves CAS inputs', async () => {
    mockApprovalBroker.decide.mockResolvedValue({
      id: APPROVAL_ID,
      status: 'approved',
      revision: 2,
    });
    const app = createApp();

    const response = await request(app)
      .post(`/api/run-approvals/${APPROVAL_ID}/decision`)
      .set('x-client-mode', 'desktop')
      .send({
        decision: 'approved',
        expectedRevision: 1,
        expectedActionHash: ACTION_HASH,
        note: 'Reviewed exact command.',
      });

    expect(response.status).toBe(200);
    expect(mockApprovalBroker.decide).toHaveBeenCalledWith(
      APPROVAL_ID,
      {
        decision: 'approved',
        expectedRevision: 1,
        expectedActionHash: ACTION_HASH,
        note: 'Reviewed exact command.',
      },
      {
        id: 'user-brad',
        label: 'Brad',
        type: 'user',
        authMethod: 'api-key',
        clientMode: 'desktop',
        workspaceId: 'workspace-a',
      }
    );
  });

  it('rejects caller-supplied reviewer identity and non-admin decisions', async () => {
    const spoofed = await request(createApp())
      .post(`/api/run-approvals/${APPROVAL_ID}/decision`)
      .send({
        decision: 'approved',
        expectedRevision: 1,
        expectedActionHash: ACTION_HASH,
        actor: { id: 'spoofed-admin' },
      });
    const readOnly = await request(createApp('read-only'))
      .post(`/api/run-approvals/${APPROVAL_ID}/decision`)
      .send({
        decision: 'approved',
        expectedRevision: 1,
        expectedActionHash: ACTION_HASH,
      });

    expect(spoofed.status).toBe(400);
    expect(readOnly.status).toBe(403);
    expect(mockApprovalBroker.decide).not.toHaveBeenCalled();
  });
});
