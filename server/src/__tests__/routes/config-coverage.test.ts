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
    saveConfig: vi.fn(),
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
    // Simulate authenticated admin user for route tests
    app.use((req: any, _res: any, next: any) => {
      req.auth = { role: 'admin', keyName: 'test-admin', isLocalhost: true };
      next();
    });
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

  describe('agent profile packages', () => {
    const profileYaml = `id: qa-reviewer
schemaVersion: agent-profile-package/v1
version: 1.0.0
displayName: QA Reviewer
role: Reviews QA evidence
enabled: true
capabilities:
  - qa
defaultTaskTypes:
  - review
runtime:
  agent: codex
`;

    it('validates package content with field paths', async () => {
      const res = await request(app)
        .post('/api/config/agent-profiles/validate')
        .send({ content: 'displayName: Broken', format: 'yaml' });

      expect(res.status).toBe(200);
      expect(res.body.valid).toBe(false);
      expect(res.body.issues.map((issue: { path: string }) => issue.path)).toContain('$.id');
    });

    it('imports and lists profile packages', async () => {
      mockConfigService.getConfig.mockResolvedValue({
        repos: [],
        agents: [],
        agentProfiles: [],
      });
      mockConfigService.saveConfig.mockResolvedValue(undefined);

      const imported = await request(app)
        .post('/api/config/agent-profiles/import')
        .send({ content: profileYaml, format: 'yaml', source: 'test' });

      expect(imported.status).toBe(201);
      expect(imported.body.profile.id).toBe('qa-reviewer');
      expect(mockConfigService.saveConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          agentProfiles: [expect.objectContaining({ id: 'qa-reviewer' })],
        })
      );

      mockConfigService.getConfig.mockResolvedValue({
        repos: [],
        agents: [],
        agentProfiles: [imported.body.profile],
      });
      const listed = await request(app).get('/api/config/agent-profiles');
      expect(listed.status).toBe(200);
      expect(listed.body).toHaveLength(1);
      expect(listed.body[0]).toMatchObject({ id: 'qa-reviewer', displayName: 'QA Reviewer' });
    });

    it('updates and exports profile packages', async () => {
      const profile = {
        id: 'qa-reviewer',
        schemaVersion: 'agent-profile-package/v1',
        version: '1.0.0',
        displayName: 'QA Reviewer',
        role: 'Reviews QA evidence',
        enabled: true,
        capabilities: ['qa'],
        defaultTaskTypes: ['review'],
        runtime: { agent: 'codex' },
      };
      mockConfigService.getConfig.mockResolvedValue({
        repos: [],
        agents: [],
        agentProfiles: [profile],
      });
      mockConfigService.saveConfig.mockResolvedValue(undefined);

      const updated = await request(app)
        .patch('/api/config/agent-profiles/qa-reviewer')
        .send({ enabled: false, displayName: 'QA Gate Reviewer' });

      expect(updated.status).toBe(200);
      expect(updated.body).toMatchObject({ enabled: false, displayName: 'QA Gate Reviewer' });

      mockConfigService.getConfig.mockResolvedValue({
        repos: [],
        agents: [],
        agentProfiles: [updated.body],
      });
      const exported = await request(app).get('/api/config/agent-profiles/qa-reviewer/export');

      expect(exported.status).toBe(200);
      expect(exported.body.format).toBe('yaml');
      expect(exported.body.content).toContain('QA Gate Reviewer');
    });
  });

  describe('team roster manifests', () => {
    const teamRoster = {
      id: 'core-team',
      schemaVersion: 'team-roster/v1',
      workspaceId: 'local',
      name: 'Core Team',
      enabled: true,
      coordinatorMemberId: 'ops-lead',
      members: [
        {
          id: 'ops-lead',
          displayName: 'Ops Lead',
          role: 'Coordinates queue work',
          agent: 'codex',
          status: 'enabled',
          capabilities: ['ops', 'triage'],
          defaultTaskTypes: ['feature'],
        },
        {
          id: 'docs-reviewer',
          displayName: 'Docs Reviewer',
          role: 'Reviews docs',
          agent: 'amp',
          status: 'enabled',
          capabilities: ['docs', 'review'],
          defaultTaskTypes: ['docs'],
        },
      ],
      routingRules: [
        {
          id: 'docs',
          name: 'Docs work',
          enabled: true,
          match: { type: 'docs' },
          memberId: 'docs-reviewer',
          reviewerMemberIds: ['ops-lead'],
        },
      ],
    };

    it('validates and imports roster manifests', async () => {
      const invalid = await request(app)
        .post('/api/config/team-roster/validate')
        .send({
          roster: {
            ...teamRoster,
            routingRules: [{ ...teamRoster.routingRules[0], memberId: 'missing' }],
          },
        });

      expect(invalid.status).toBe(200);
      expect(invalid.body.valid).toBe(false);
      expect(invalid.body.issues.map((issue: { message: string }) => issue.message)).toContain(
        'Unknown member ID: missing'
      );

      mockConfigService.getConfig.mockResolvedValue({
        repos: [],
        agents: [],
        teamRoster: undefined,
      });
      mockConfigService.saveConfig.mockResolvedValue(undefined);

      const imported = await request(app)
        .post('/api/config/team-roster/import')
        .send({ content: JSON.stringify(teamRoster), format: 'json', source: 'test' });

      expect(imported.status).toBe(201);
      expect(imported.body.id).toBe('core-team');
      expect(mockConfigService.saveConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          teamRoster: expect.objectContaining({ id: 'core-team' }),
        })
      );
    });

    it('exports and previews roster routes', async () => {
      mockConfigService.getConfig.mockResolvedValue({
        repos: [],
        agents: [],
        teamRoster,
      });

      const exported = await request(app).get('/api/config/team-roster/export?format=json');
      expect(exported.status).toBe(200);
      expect(exported.body.content).toContain('"core-team"');

      const preview = await request(app)
        .post('/api/config/team-roster/preview-route')
        .send({ type: 'docs' });
      expect(preview.status).toBe(200);
      expect(preview.body.member.id).toBe('docs-reviewer');
      expect(preview.body.reviewerMembers.map((member: { id: string }) => member.id)).toEqual([
        'ops-lead',
      ]);
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

    it('should accept Codex provider metadata', async () => {
      const agents = [
        {
          type: 'codex',
          name: 'OpenAI Codex',
          command: 'codex',
          args: ['exec', '--sandbox', 'workspace-write', '--json'],
          enabled: true,
          provider: 'codex-cli',
          model: 'gpt-5.5',
        },
        {
          type: 'codex-sdk',
          name: 'OpenAI Codex SDK',
          command: 'codex',
          args: [],
          enabled: true,
          provider: 'codex-sdk',
          model: 'gpt-5.5',
        },
        {
          type: 'codex-cloud',
          name: 'OpenAI Codex Cloud',
          command: 'gh',
          args: [],
          enabled: true,
          provider: 'codex-cloud',
          model: 'gpt-5.5',
        },
        {
          type: 'hermes',
          name: 'Hermes Agent',
          command: 'hermes',
          args: [],
          enabled: false,
          provider: 'hermes-cli',
        },
        {
          type: 'ollama-local',
          name: 'Ollama Local',
          command: 'ollama',
          args: ['run', 'llama3.2'],
          enabled: true,
          provider: 'ollama-local',
          model: 'llama3.2',
        },
        {
          type: 'ollama-cloud',
          name: 'Ollama Cloud',
          command: 'ollama',
          args: ['run', 'gpt-oss:120b-cloud'],
          enabled: true,
          provider: 'ollama-cloud',
          model: 'gpt-oss:120b-cloud',
        },
        {
          type: 'lm-studio-local',
          name: 'LM Studio Local',
          command: 'lms',
          args: ['server', 'status'],
          enabled: true,
          provider: 'lm-studio-local',
        },
      ];
      mockConfigService.updateAgents.mockResolvedValue({ agents });
      const res = await request(app).put('/api/config/agents').send(agents);
      expect(res.status).toBe(200);
      expect(mockConfigService.updateAgents).toHaveBeenCalledWith(agents);
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
