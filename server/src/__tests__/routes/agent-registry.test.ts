/**
 * Agent Registry Route Integration Tests
 *
 * @see https://github.com/BradGroux/veritas-kanban/issues/52
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import { errorHandler } from '../../middleware/error-handler.js';
import { providerRuntimeManifestFixture } from '../fixtures/provider-runtime-manifest.js';
import { calculateProviderRuntimeManifestDigest } from '../../utils/provider-runtime-manifest-digest.js';
import type { AuthContext, AuthenticatedRequest } from '../../middleware/auth.js';

const routeMocks = vi.hoisted(() => ({
  getAgentStatus: vi.fn(() => ({
    status: 'idle',
    activeAgents: [],
    lastUpdated: '2026-06-04T12:00:00Z',
  })),
  getEvents: vi.fn(async () => []),
  listTasks: vi.fn(async () => []),
}));

// Mock fs-helpers before importing routes
vi.mock('../../storage/fs-helpers.js', () => ({
  existsSync: vi.fn().mockReturnValue(false),
  readFileSync: vi.fn().mockReturnValue('{}'),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
  rename: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../services/task-service.js', () => ({
  getTaskService: () => ({ listTasks: routeMocks.listTasks }),
}));

vi.mock('../../services/telemetry-service.js', () => ({
  getTelemetryService: () => ({ getEvents: routeMocks.getEvents }),
}));

vi.mock('../../routes/agent-status.js', () => ({
  getAgentStatus: routeMocks.getAgentStatus,
}));

const { disposeAgentRegistryService } = await import('../../services/agent-registry-service.js');
const { agentRegistryRoutes } = await import('../../routes/agent-registry.js');

describe('Agent Registry Routes', () => {
  let app: express.Express;
  let authContext: AuthContext;

  beforeEach(() => {
    disposeAgentRegistryService();
    routeMocks.getAgentStatus.mockReturnValue({
      status: 'idle',
      activeAgents: [],
      lastUpdated: '2026-06-04T12:00:00Z',
    });
    routeMocks.getEvents.mockResolvedValue([]);
    routeMocks.listTasks.mockResolvedValue([]);
    authContext = {
      role: 'admin',
      isLocalhost: true,
      authMethod: 'disabled',
    };

    app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as AuthenticatedRequest).auth = authContext;
      next();
    });
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

    it('registers a validated custom provider runtime manifest', async () => {
      const providerRuntimeManifest = providerRuntimeManifestFixture({
        provider: 'custom-runtime',
        adapter: 'custom-adapter',
        models: ['custom-model'],
      });

      const res = await request(app).post('/api/agents/register').send({
        id: 'custom-agent',
        name: 'Custom Agent',
        providerRuntimeManifest,
      });

      expect(res.status).toBe(201);
      expect(res.body.providerRuntimeManifest).toMatchObject({
        provider: 'custom-runtime',
        adapter: 'custom-adapter',
        digest: providerRuntimeManifest.digest,
      });
    });

    it('rejects forged or incomplete provider runtime manifests', async () => {
      const valid = providerRuntimeManifestFixture();
      const forged = { ...valid, providerVersion: 'tampered' };
      const incompletePayload = {
        ...valid,
        capabilities: valid.capabilities.slice(0, 1),
      };
      const incomplete = {
        ...incompletePayload,
        digest: calculateProviderRuntimeManifestDigest(incompletePayload),
      };

      const forgedResponse = await request(app).post('/api/agents/register').send({
        id: 'forged-agent',
        name: 'Forged Agent',
        providerRuntimeManifest: forged,
      });
      const incompleteResponse = await request(app).post('/api/agents/register').send({
        id: 'incomplete-agent',
        name: 'Incomplete Agent',
        providerRuntimeManifest: incomplete,
      });

      expect(forgedResponse.status).toBe(400);
      expect(incompleteResponse.status).toBe(400);
    });

    it('rejects unredacted secrets in external runtime evidence', async () => {
      const valid = providerRuntimeManifestFixture();
      const unsafePayload = {
        ...valid,
        capabilities: valid.capabilities.map((capability, index) =>
          index === 0 ? { ...capability, reason: 'token=secret-value' } : capability
        ),
      };
      const unsafe = {
        ...unsafePayload,
        digest: calculateProviderRuntimeManifestDigest(unsafePayload),
      };

      const response = await request(app).post('/api/agents/register').send({
        id: 'unsafe-agent',
        name: 'Unsafe Agent',
        providerRuntimeManifest: unsafe,
      });

      expect(response.status).toBe(400);
      expect(JSON.stringify(response.body)).not.toContain('secret-value');
    });

    it('rejects misspelled manifest fields instead of silently dropping evidence', async () => {
      const response = await request(app).post('/api/agents/register').send({
        id: 'typo-agent',
        name: 'Typo Agent',
        providerRuntimeManfiest: providerRuntimeManifestFixture(),
      });

      expect(response.status).toBe(400);
    });

    it('binds manifest writes to the authenticated agent identity', async () => {
      authContext = {
        role: 'agent',
        keyName: 'other-agent',
        isLocalhost: false,
        authMethod: 'api-key',
      };
      const denied = await request(app).post('/api/agents/register').send({
        id: 'custom-agent',
        name: 'Custom Agent',
        providerRuntimeManifest: providerRuntimeManifestFixture(),
      });
      expect(denied.status).toBe(403);

      authContext.keyName = 'custom-agent';
      const allowed = await request(app).post('/api/agents/register').send({
        id: 'custom-agent',
        name: 'Custom Agent',
        providerRuntimeManifest: providerRuntimeManifestFixture(),
      });
      expect(allowed.status).toBe(201);
    });

    it('prevents another telemetry agent from replacing or clearing authoritative evidence', async () => {
      const manifest = providerRuntimeManifestFixture();
      await request(app).post('/api/agents/register').send({
        id: 'protected-agent',
        name: 'Protected Agent',
        provider: 'codex-cli',
        providerRuntimeManifest: manifest,
      });
      authContext = {
        role: 'agent',
        keyName: 'other-agent',
        isLocalhost: false,
        authMethod: 'api-key',
      };

      await request(app)
        .post('/api/agents/register')
        .send({
          id: 'protected-agent',
          name: 'Protected Agent',
          provider: 'openclaw',
        })
        .expect(403);
      await request(app)
        .post('/api/agents/register/protected-agent/heartbeat')
        .send({ status: 'online' })
        .expect(403);
      await request(app).delete('/api/agents/register/protected-agent').expect(403);

      const record = await request(app).get('/api/agents/register/protected-agent').expect(200);
      expect(record.body.provider).toBe('codex-cli');
      expect(record.body.providerRuntimeManifest.digest).toBe(manifest.digest);
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

    it('replaces the validated runtime manifest via heartbeat', async () => {
      const first = providerRuntimeManifestFixture({ providerVersion: 'fixture 1.0.0' });
      const upgraded = providerRuntimeManifestFixture({ providerVersion: 'fixture 2.0.0' });
      await request(app).post('/api/agents/register').send({
        id: 'manifest-agent',
        name: 'Manifest Agent',
        providerRuntimeManifest: first,
      });

      const res = await request(app)
        .post('/api/agents/register/manifest-agent/heartbeat')
        .send({ providerRuntimeManifest: upgraded });

      expect(res.status).toBe(200);
      expect(res.body.providerRuntimeManifest).toMatchObject({
        providerVersion: 'fixture 2.0.0',
        digest: upgraded.digest,
      });
    });

    it('rejects a misspelled heartbeat manifest field', async () => {
      await request(app).post('/api/agents/register').send({
        id: 'manifest-agent',
        name: 'Manifest Agent',
      });

      const response = await request(app)
        .post('/api/agents/register/manifest-agent/heartbeat')
        .send({ providerRuntimeManfiest: providerRuntimeManifestFixture() });

      expect(response.status).toBe(400);
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
        .send({ id: 'a1', name: 'Agent 1', capabilities: [{ name: 'code' }] });

      await request(app)
        .post('/api/agents/register')
        .send({ id: 'a2', name: 'Agent 2', capabilities: [{ name: 'deploy' }] });

      const res = await request(app).get('/api/agents/register');

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
    });

    it('should filter by status', async () => {
      await request(app)
        .post('/api/agents/register')
        .send({ id: 'a1', name: 'Agent 1', capabilities: [] });

      await request(app)
        .post('/api/agents/register')
        .send({ id: 'a2', name: 'Agent 2', capabilities: [] });

      await request(app).post('/api/agents/register/a1/heartbeat').send({ status: 'busy' });

      const res = await request(app).get('/api/agents/register').query({ status: 'busy' });

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].id).toBe('a1');
    });

    it('should filter by capability', async () => {
      await request(app)
        .post('/api/agents/register')
        .send({ id: 'a1', name: 'Agent 1', capabilities: [{ name: 'code' }, { name: 'test' }] });

      await request(app)
        .post('/api/agents/register')
        .send({ id: 'a2', name: 'Agent 2', capabilities: [{ name: 'code' }] });

      const res = await request(app).get('/api/agents/register').query({ capability: 'test' });

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].id).toBe('a1');
    });
  });

  // ── Health Classifier ────────────────────────────────────────

  describe('GET /api/agents/register/health', () => {
    it('should return deterministic agent health classifications before ID lookup', async () => {
      routeMocks.listTasks.mockResolvedValue([
        {
          id: 'task_20260604_health',
          title: 'Health classified task',
          description: 'Route fixture',
          type: 'feature',
          status: 'blocked',
          priority: 'high',
          created: '2026-06-04T10:00:00Z',
          updated: '2026-06-04T11:00:00Z',
          blockedReason: { category: 'waiting-on-feedback', note: 'Needs owner approval' },
        },
      ]);

      await request(app)
        .post('/api/agents/register')
        .send({ id: 'codex', name: 'Codex', capabilities: [] });

      await request(app).post('/api/agents/register/codex/heartbeat').send({
        status: 'busy',
        currentTaskId: 'task_20260604_health',
        currentTaskTitle: 'Health classified task',
      });

      const res = await request(app).get('/api/agents/register/health');

      expect(res.status).toBe(200);
      expect(res.body.generatedAt).toBeDefined();
      expect(res.body.classifications).toHaveLength(1);
      expect(res.body.classifications[0]).toMatchObject({
        subjectId: 'agent:codex',
        state: 'blocked',
        reasonCode: 'hitl_pending',
        confidence: 0.88,
      });
      expect(routeMocks.getEvents).toHaveBeenCalledWith(
        expect.objectContaining({
          type: ['run.completed', 'run.error'],
          limit: 5000,
        })
      );
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
        .send({ id: 'a1', name: 'Agent 1', capabilities: [{ name: 'code' }] });

      await request(app)
        .post('/api/agents/register')
        .send({ id: 'a2', name: 'Agent 2', capabilities: [{ name: 'deploy' }] });

      await request(app).post('/api/agents/register/a1/heartbeat').send({ status: 'busy' });

      const res = await request(app).get('/api/agents/register/stats');

      expect(res.status).toBe(200);
      expect(res.body.total).toBe(2);
      expect(res.body.busy).toBe(1);
      expect(res.body.online).toBe(1);
      expect(res.body.capabilities).toContain('code');
      expect(res.body.capabilities).toContain('deploy');
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
