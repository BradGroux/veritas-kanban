/**
 * Config Route Coverage Tests
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';

const { mockConfigService } = vi.hoisted(() => ({
  mockConfigService: {
    getConfig: vi.fn(),
    addRepo: vi.fn(),
    updateRepo: vi.fn(),
    removeRepo: vi.fn(),
    validateRepoPath: vi.fn(),
    getRepoBranches: vi.fn(),
    updateAgents: vi.fn(),
    setDefaultAgent: vi.fn(),
  },
}));

vi.mock('../../services/config-service.js', () => ({
  ConfigService: function () {
    return mockConfigService;
  },
}));

import { configRoutes } from '../../routes/config.js';

describe('Config Routes (actual module)', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = express();
    app.use(express.json());
    app.use('/api/config', configRoutes);
  });

  describe('GET /api/config', () => {
    it('should return config', async () => {
      mockConfigService.getConfig.mockResolvedValue({ repos: [], agents: [] });
      const res = await request(app).get('/api/config');
      expect(res.status).toBe(200);
    });

    it('should handle error', async () => {
      mockConfigService.getConfig.mockRejectedValue(new Error('fail'));
      const res = await request(app).get('/api/config');
      expect(res.status).toBe(500);
    });
  });

  describe('GET /api/config/repos', () => {
    it('should list repos', async () => {
      mockConfigService.getConfig.mockResolvedValue({ repos: [{ name: 'test', path: '/test' }] });
      const res = await request(app).get('/api/config/repos');
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
    });

    it('should handle error', async () => {
      mockConfigService.getConfig.mockRejectedValue(new Error('fail'));
      const res = await request(app).get('/api/config/repos');
      expect(res.status).toBe(500);
    });
  });

  describe('POST /api/config/repos', () => {
    it('should add a repo', async () => {
      mockConfigService.addRepo.mockResolvedValue({
        repos: [{ name: 'new', path: '/new', defaultBranch: 'main' }],
      });
      const res = await request(app)
        .post('/api/config/repos')
        .send({ name: 'new', path: '/new', defaultBranch: 'main' });
      expect(res.status).toBe(201);
    });

    it('should reject invalid repo data', async () => {
      const res = await request(app).post('/api/config/repos').send({ name: '' });
      expect(res.status).toBe(400);
    });

    it('should handle service error', async () => {
      mockConfigService.addRepo.mockRejectedValue(new Error('duplicate'));
      const res = await request(app).post('/api/config/repos').send({ name: 'dup', path: '/dup' });
      expect(res.status).toBe(400);
    });
  });

  describe('PATCH /api/config/repos/:name', () => {
    it('should update a repo', async () => {
      mockConfigService.updateRepo.mockResolvedValue({ repos: [] });
      const res = await request(app).patch('/api/config/repos/test').send({ path: '/updated' });
      expect(res.status).toBe(200);
    });

    it('should handle service error', async () => {
      mockConfigService.updateRepo.mockRejectedValue(new Error('not found'));
      const res = await request(app).patch('/api/config/repos/test').send({ path: '/x' });
      expect(res.status).toBe(400);
    });
  });

  describe('DELETE /api/config/repos/:name', () => {
    it('should remove a repo', async () => {
      mockConfigService.removeRepo.mockResolvedValue({ repos: [] });
      const res = await request(app).delete('/api/config/repos/test');
      expect(res.status).toBe(200);
    });

    it('should handle error', async () => {
      mockConfigService.removeRepo.mockRejectedValue(new Error('fail'));
      const res = await request(app).delete('/api/config/repos/test');
      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/config/repos/validate', () => {
    it('should validate repo path', async () => {
      mockConfigService.validateRepoPath.mockResolvedValue({ valid: true });
      const res = await request(app)
        .post('/api/config/repos/validate')
        .send({ path: '/valid/repo' });
      expect(res.status).toBe(200);
    });

    it('should reject missing path', async () => {
      const res = await request(app).post('/api/config/repos/validate').send({});
      expect(res.status).toBe(400);
    });

    it('should handle validation error', async () => {
      mockConfigService.validateRepoPath.mockRejectedValue(new Error('invalid'));
      const res = await request(app).post('/api/config/repos/validate').send({ path: '/bad' });
      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/config/repos/:name/branches', () => {
    it('should get branches', async () => {
      mockConfigService.getRepoBranches.mockResolvedValue(['main', 'dev']);
      const res = await request(app).get('/api/config/repos/test/branches');
      expect(res.status).toBe(200);
    });

    it('should handle error', async () => {
      mockConfigService.getRepoBranches.mockRejectedValue(new Error('fail'));
      const res = await request(app).get('/api/config/repos/test/branches');
      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/config/agents', () => {
    it('should list agents', async () => {
      mockConfigService.getConfig.mockResolvedValue({
        agents: [{ type: 'claude-code', name: 'Claude' }],
      });
      const res = await request(app).get('/api/config/agents');
      expect(res.status).toBe(200);
    });

    it('should handle error', async () => {
      mockConfigService.getConfig.mockRejectedValue(new Error('fail'));
      const res = await request(app).get('/api/config/agents');
      expect(res.status).toBe(500);
    });
  });

  describe('PUT /api/config/agents', () => {
    it('should update agents', async () => {
      const agents = [
        { type: 'claude-code', name: 'Claude', command: 'cc', args: [], enabled: true },
      ];
      mockConfigService.updateAgents.mockResolvedValue({ agents });
      const res = await request(app).put('/api/config/agents').send(agents);
      expect(res.status).toBe(200);
    });

    it('should reject invalid agent data', async () => {
      const res = await request(app)
        .put('/api/config/agents')
        .send([{ type: 'invalid' }]);
      expect(res.status).toBe(400);
    });

    it('should handle service error', async () => {
      mockConfigService.updateAgents.mockRejectedValue(new Error('fail'));
      const agents = [
        { type: 'claude-code', name: 'Claude', command: 'cc', args: [], enabled: true },
      ];
      const res = await request(app).put('/api/config/agents').send(agents);
      expect(res.status).toBe(500);
    });
  });

  describe('PUT /api/config/default-agent', () => {
    it('should set default agent', async () => {
      mockConfigService.setDefaultAgent.mockResolvedValue({ defaultAgent: 'claude-code' });
      const res = await request(app)
        .put('/api/config/default-agent')
        .send({ agent: 'claude-code' });
      expect(res.status).toBe(200);
    });

    it('should reject missing agent', async () => {
      const res = await request(app).put('/api/config/default-agent').send({});
      expect(res.status).toBe(400);
    });

    it('should handle error', async () => {
      mockConfigService.setDefaultAgent.mockRejectedValue(new Error('fail'));
      const res = await request(app)
        .put('/api/config/default-agent')
        .send({ agent: 'claude-code' });
      expect(res.status).toBe(500);
    });
  });
});
