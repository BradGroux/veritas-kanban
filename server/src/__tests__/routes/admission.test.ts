import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { errorHandler } from '../../middleware/error-handler.js';

const admission = vi.hoisted(() => ({
  list: vi.fn(),
  get: vi.fn(),
  inspectQueue: vi.fn(),
  inspectQueueEntry: vi.fn(),
  cancelQueuedLaunch: vi.fn(),
}));

const cancelExecutionTree = vi.hoisted(() => vi.fn());

vi.mock('../../services/admission-control-service.js', () => ({
  getAdmissionControlService: () => admission,
}));

vi.mock('../../services/clawdbot-agent-service.js', () => ({
  clawdbotAgentService: { cancelExecutionTree },
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

  it('lists the versioned queue view with bounded operator filters', async () => {
    admission.inspectQueue.mockResolvedValue({
      schemaVersion: 'admission-queue-list/v1',
      generatedAt: '2026-07-25T12:00:00.000Z',
      conditional: true,
      depth: {
        global: { current: 2, limit: 1_000 },
        workspaces: [{ workspaceKey: `sha256:${'a'.repeat(64)}`, current: 2, limit: 100 }],
      },
      pagination: { page: 1, limit: 25, total: 1, hasMore: false },
      entries: [{ id: 'admission_queue_1', state: 'queued', position: 1 }],
    });

    const response = await request(createApp()).get(
      '/api/admission/queue?workspaceId=workspace-a&rootObjectiveId=objective-a&nodeId=node-a&source=workflow&state=queued&state=requeued&priority=3&limitingScope=provider&minAgeMs=60000&maxAgeMs=3600000&page=1&limit=25'
    );

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      schemaVersion: 'admission-queue-list/v1',
      conditional: true,
      pagination: { page: 1, limit: 25, total: 1, hasMore: false },
      entries: [{ id: 'admission_queue_1', position: 1 }],
    });
    expect(admission.inspectQueue).toHaveBeenCalledWith({
      workspaceId: 'workspace-a',
      rootObjectiveId: 'objective-a',
      nodeId: 'node-a',
      sources: ['workflow'],
      states: ['queued', 'requeued'],
      priority: 3,
      limitingScopes: ['provider'],
      minAgeMs: 60_000,
      maxAgeMs: 3_600_000,
      page: 1,
      limit: 25,
    });
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

  it('inspects one queue entry and rejects invalid queue filters', async () => {
    admission.inspectQueueEntry.mockResolvedValue({
      schemaVersion: 'admission-queue-inspection/v1',
      entry: { id: 'admission_queue_1', state: 'leased' },
    });

    const found = await request(createApp()).get('/api/admission/queue/admission_queue_1');
    const invalid = await request(createApp()).get(
      '/api/admission/queue?minAgeMs=5000&maxAgeMs=1000'
    );

    expect(found.status).toBe(200);
    expect(found.body).toMatchObject({
      schemaVersion: 'admission-queue-inspection/v1',
      entry: { id: 'admission_queue_1', state: 'leased' },
    });
    expect(admission.inspectQueueEntry).toHaveBeenCalledWith('admission_queue_1');
    expect(invalid.status).toBe(400);
    expect(admission.inspectQueue).not.toHaveBeenCalled();
  });

  it('cancels queued launches and execution trees with stable operator identity', async () => {
    admission.cancelQueuedLaunch.mockResolvedValue({
      schemaVersion: 'execution-tree-cancellation/v1',
      scope: 'queued-launch',
      queueEntry: { id: 'admission_queue_1', state: 'terminal' },
    });
    cancelExecutionTree.mockResolvedValue({
      schemaVersion: 'execution-tree-cancellation/v1',
      scope: 'execution-tree',
      rootObjectiveId: 'objective-a',
      queueEntriesCancelled: 2,
      interruptedAttempts: 1,
      runningAttempts: [],
    });
    const app = createApp();
    const queued = await request(app).post('/api/admission/queue/admission_queue_1/cancel').send({
      idempotencyKey: 'cancel-queue-entry-123',
      reason: 'Operator cancelled the queued launch.',
    });
    const tree = await request(app).post('/api/admission/tree/objective-a/cancel').send({
      idempotencyKey: 'cancel-execution-tree-123',
      reason: 'Operator cancelled runaway expansion.',
    });

    expect(queued.status).toBe(200);
    expect(admission.cancelQueuedLaunch).toHaveBeenCalledWith('admission_queue_1', {
      idempotencyKey: 'cancel-queue-entry-123',
      reason: 'Operator cancelled the queued launch.',
    });
    expect(tree.status).toBe(200);
    expect(cancelExecutionTree).toHaveBeenCalledWith('objective-a', {
      idempotencyKey: 'cancel-execution-tree-123',
      reason: 'Operator cancelled runaway expansion.',
    });

    const invalid = await request(app)
      .post('/api/admission/tree/objective-a/cancel')
      .send({ idempotencyKey: 'short', reason: 'too short' });
    expect(invalid.status).toBe(400);
    expect(cancelExecutionTree).toHaveBeenCalledTimes(1);
  });

  it('returns a validation error for an invalid reservation identifier', async () => {
    const invalid = await request(createApp()).get(`/api/admission/${'a'.repeat(241)}`);

    expect(invalid.status).toBe(400);
    expect(invalid.body).toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(admission.get).not.toHaveBeenCalled();
  });
});
