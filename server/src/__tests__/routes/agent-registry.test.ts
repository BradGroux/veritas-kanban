/**
 * Agent Registry Route Integration Tests
 *
 * @see https://github.com/BradGroux/veritas-kanban/issues/52
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import { errorHandler } from '../../middleware/error-handler.js';

// Mock fs-helpers before importing routes
vi.mock('../../storage/fs-helpers.js', () => ({
  existsSync: vi.fn().mockReturnValue(false),
  readFileSync: vi.fn().mockReturnValue('{}'),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

const { disposeAgentRegistryService } = await import('../../services/agent-registry-service.js');
const { agentRegistryRoutes } = await import('../../routes/agent-registry.js');

describe('Agent Registry Routes', () => {
  let app: express.Express;

  beforeEach(() => {
    disposeAgentRegistryService();

    app = express();
    app.use(express.json());
    app.use('/api/agents/register', agentRegistryRoutes);
    app.use(errorHandler);
  });

  afterEach(() => {
    disposeAgentRegistryService();
  });

  // ── Registration ─────────────────────────────────────────────

  describe('POST /api/agents/register', () => {
    it('should register a new agent (201)', async () => {
      const res = await request(app)
        .post('/api/agents/register')
        .send({
          id: 'claude-main',
          name: 'Claude Main',
          model: 'claude-sonnet-4',
          provider: 'anthropic',
          capabilities: [{ name: 'code' }, { name: 'test' }],
        });

      expect(res.status).toBe(201);
      expect(res.body.id).toBe('claude-main');
      expect(res.body.name).toBe('Claude Main');
      expect(res.body.model).toBe('claude-sonnet-4');
      expect(res.body.capabilities).toHaveLength(2);
      expect(res.body.status).toBe('online');
    });

    it('should update an existing agent (201)', async () => {
      await request(app)
        .post('/api/agents/register')
        .send({
          id: 'claude-main',
          name: 'Claude Main',
          capabilities: [{ name: 'code' }],
        });

      const res = await request(app)
        .post('/api/agents/register')
        .send({
          id: 'claude-main',
          name: 'Claude Main Updated',
          capabilities: [{ name: 'code' }, { name: 'test' }, { name: 'review' }],
        });

      expect(res.status).toBe(201);
      expect(res.body.name).toBe('Claude Main Updated');
      expect(res.body.capabilities).toHaveLength(3);
    });

    it('should reject missing required fields', async () => {
      const res = await request(app).post('/api/agents/register').send({ name: 'test' });

      expect(res.status).toBe(400);
    });

    it('should accept minimal valid registration', async () => {
      const res = await request(app).post('/api/agents/register').send({
        id: 'minimal-agent',
        name: 'Minimal Agent',
      });

      expect(res.status).toBe(201);
      expect(res.body.id).toBe('minimal-agent');
      expect(res.body.capabilities).toEqual([]);
    });
  });

  // ── Heartbeat ────────────────────────────────────────────────

  describe('POST /api/agents/register/:id/heartbeat', () => {
    it('should update agent status (200)', async () => {
      await request(app)
        .post('/api/agents/register')
        .send({ id: 'test-agent', name: 'Test Agent', capabilities: [{ name: 'code' }] });

      const res = await request(app)
        .post('/api/agents/register/test-agent/heartbeat')
        .send({ status: 'busy', currentTaskId: 'TASK-1', currentTaskTitle: 'Working on task' });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('busy');
      expect(res.body.currentTaskId).toBe('TASK-1');
      expect(res.body.currentTaskTitle).toBe('Working on task');
    });

    it('should return 404 for unregistered agent', async () => {
      const res = await request(app)
        .post('/api/agents/register/unknown/heartbeat')
        .send({ status: 'online' });

      expect(res.status).toBe(404);
    });

    it('should update metadata via heartbeat', async () => {
      await request(app)
        .post('/api/agents/register')
        .send({ id: 'test-agent', name: 'Test', capabilities: [] });

      const res = await request(app)
        .post('/api/agents/register/test-agent/heartbeat')
        .send({ metadata: { ping: 12345 } });

      expect(res.status).toBe(200);
      expect(res.body.metadata).toEqual({ ping: 12345 });
    });

    it('should clear task when status is idle', async () => {
      await request(app)
        .post('/api/agents/register')
        .send({ id: 'test-agent', name: 'Test', capabilities: [] });

      await request(app)
        .post('/api/agents/register/test-agent/heartbeat')
        .send({ status: 'busy', currentTaskId: 'TASK-1' });

      const res = await request(app)
        .post('/api/agents/register/test-agent/heartbeat')
        .send({ status: 'idle', currentTaskId: '', currentTaskTitle: '' });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('idle');
      // Empty string clears it, leaving the field present but set to undefined in response
      expect(res.body.currentTaskId).toBeUndefined();
    });
  });

  // ── List Agents ──────────────────────────────────────────────

  describe('GET /api/agents/register', () => {
    it('should list all registered agents', async () => {
      await request(app)
        .post('/api/agents/register')
        .send({ id: 'ops', name: 'Ops', capabilities: [{ name: 'legacy' }] });

      await request(app)
        .post('/api/agents/register')
        .send({ id: 'hawk', name: 'Hawk', capabilities: [{ name: 'ops' }] });

      const res = await request(app).get('/api/agents/register');

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(10);
      expect(res.body.map((agent: { id: string }) => agent.id)).toEqual([
        'default',
        'hawk',
        'blitz',
        'aura',
        'forge',
        'midas',
        'orbit',
        'signal',
        'helm',
        'scops',
      ]);
      expect(res.body.find((agent: { id: string }) => agent.id === 'ops')).toBeUndefined();
    });

    it('should filter by status', async () => {
      await request(app)
        .post('/api/agents/register')
        .send({ id: 'hawk', name: 'Hawk', capabilities: [] });

      await request(app)
        .post('/api/agents/register')
        .send({ id: 'a2', name: 'Agent 2', capabilities: [] });

      await request(app).post('/api/agents/register/hawk/heartbeat').send({ status: 'busy' });

      const res = await request(app).get('/api/agents/register').query({ status: 'busy' });

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].id).toBe('hawk');
    });

    it('should filter by capability', async () => {
      await request(app)
        .post('/api/agents/register')
        .send({ id: 'hawk', name: 'Hawk', capabilities: [{ name: 'ops' }, { name: 'test' }] });

      await request(app)
        .post('/api/agents/register')
        .send({ id: 'a2', name: 'Agent 2', capabilities: [{ name: 'code' }] });

      const res = await request(app).get('/api/agents/register').query({ capability: 'test' });

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].id).toBe('hawk');
    });
  });

  // ── Get Agent ────────────────────────────────────────────────

  describe('GET /api/agents/register/:id', () => {
    it('should get agent by ID', async () => {
      await request(app)
        .post('/api/agents/register')
        .send({ id: 'test-agent', name: 'Test Agent', capabilities: [] });

      const res = await request(app).get('/api/agents/register/test-agent');

      expect(res.status).toBe(200);
      expect(res.body.id).toBe('test-agent');
      expect(res.body.name).toBe('Test Agent');
    });

    it('should return 404 for unknown agent', async () => {
      const res = await request(app).get('/api/agents/register/nonexistent');
      expect(res.status).toBe(404);
    });
  });

  // ── Get Stats ────────────────────────────────────────────────

  describe('GET /api/agents/register/stats', () => {
    it('should return registry statistics', async () => {
      await request(app)
        .post('/api/agents/register')
        .send({ id: 'ops', name: 'Ops', capabilities: [{ name: 'legacy' }] });

      await request(app)
        .post('/api/agents/register')
        .send({ id: 'hawk', name: 'Hawk', capabilities: [{ name: 'ops' }] });

      await request(app).post('/api/agents/register/hawk/heartbeat').send({ status: 'busy' });

      const res = await request(app).get('/api/agents/register/stats');

      expect(res.status).toBe(200);
      expect(res.body.total).toBe(10);
      expect(res.body.busy).toBe(1);
      expect(res.body.online).toBe(2);
      expect(res.body.offline).toBe(7);
      expect(res.body.capabilities).toContain('ops');
      expect(res.body.capabilities).not.toContain('legacy');
    });
  });

  // ── Find by Capability ───────────────────────────────────────

  describe('GET /api/agents/register/capabilities/:capability', () => {
    it('should find agents by capability', async () => {
      await request(app)
        .post('/api/agents/register')
        .send({ id: 'a1', name: 'Agent 1', capabilities: [{ name: 'deploy' }] });

      await request(app)
        .post('/api/agents/register')
        .send({ id: 'a2', name: 'Agent 2', capabilities: [{ name: 'code' }] });

      const res = await request(app).get('/api/agents/register/capabilities/deploy');

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].id).toBe('a1');
    });

    it('should return empty array when no agents have capability', async () => {
      const res = await request(app).get('/api/agents/register/capabilities/nonexistent');

      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });
  });

  // ── Deregister ───────────────────────────────────────────────

  describe('DELETE /api/agents/register/:id', () => {
    it('should deregister an agent', async () => {
      await request(app)
        .post('/api/agents/register')
        .send({ id: 'test-agent', name: 'Test', capabilities: [] });

      const res = await request(app).delete('/api/agents/register/test-agent');

      expect(res.status).toBe(200);
      expect(res.body.removed).toBe(true);

      const get = await request(app).get('/api/agents/register/test-agent');
      expect(get.status).toBe(404);
    });

    it('should return 404 for unknown agent', async () => {
      const res = await request(app).delete('/api/agents/register/nonexistent');
      expect(res.status).toBe(404);
    });
  });
});
