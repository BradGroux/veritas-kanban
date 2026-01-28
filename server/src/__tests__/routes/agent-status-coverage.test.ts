/**
 * Agent Status Route Coverage Tests
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';

vi.mock('../../services/status-history-service.js', () => ({
  statusHistoryService: {
    logStatusChange: vi.fn().mockResolvedValue(undefined),
  },
}));

import { agentStatusRoutes, updateAgentStatus, getAgentStatus, initAgentStatus } from '../../routes/agent-status.js';
import { errorHandler } from '../../middleware/error-handler.js';

describe('Agent Status Routes (actual module)', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    updateAgentStatus({ status: 'idle', subAgentCount: 0 });
    app = express();
    app.use(express.json());
    app.use('/api/agent/status', agentStatusRoutes);
    app.use(errorHandler);
  });

  it('GET / should return current status', async () => {
    const res = await request(app).get('/api/agent/status');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('idle');
  });

  it('GET / should return flattened activeTask', async () => {
    updateAgentStatus({ status: 'working', activeTask: { id: 't1', title: 'Test' } });
    const res = await request(app).get('/api/agent/status');
    expect(res.body.activeTask).toBe('t1');
    expect(res.body.activeTaskTitle).toBe('Test');
  });

  it('POST / should update to working', async () => {
    const res = await request(app).post('/api/agent/status').send({ status: 'working', activeTask: { id: 't1' } });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('working');
  });

  it('POST / should update sub-agent count', async () => {
    const res = await request(app).post('/api/agent/status').send({ status: 'sub-agent', subAgentCount: 3 });
    expect(res.body.subAgentCount).toBe(3);
  });

  it('POST / should clear state on idle', async () => {
    updateAgentStatus({ status: 'error', errorMessage: 'Broke', activeTask: { id: 't1' } });
    const res = await request(app).post('/api/agent/status').send({ status: 'idle' });
    expect(res.body.activeTask).toBeUndefined();
    expect(res.body.errorMessage).toBeUndefined();
  });

  it('POST / should set error message', async () => {
    const res = await request(app).post('/api/agent/status').send({ status: 'error', errorMessage: 'Failed' });
    expect(res.body.errorMessage).toBe('Failed');
  });

  it('POST / should reject invalid status', async () => {
    const res = await request(app).post('/api/agent/status').send({ status: 'invalid' });
    expect(res.status).toBe(400);
  });

  it('POST / should handle null activeTask', async () => {
    const res = await request(app).post('/api/agent/status').send({ activeTask: null });
    expect(res.status).toBe(200);
  });

  it('POST / should handle null errorMessage', async () => {
    const res = await request(app).post('/api/agent/status').send({ errorMessage: null });
    expect(res.status).toBe(200);
  });

  it('getAgentStatus() should return copy', () => {
    const status = getAgentStatus();
    expect(status.status).toBe('idle');
  });

  it('initAgentStatus() should not throw', () => {
    expect(() => initAgentStatus({} as any)).not.toThrow();
  });
});
