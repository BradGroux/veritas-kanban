import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import type { AppConfig, Task, WorkspaceCapabilityManifest } from '@veritas-kanban/shared';
import { workspaceCapabilityRoutes } from '../../routes/workspace-capabilities';
import { errorHandler } from '../../middleware/error-handler';

const { mockConfigService, mockTaskService } = vi.hoisted(() => ({
  mockConfigService: {
    getConfig: vi.fn(),
    saveConfig: vi.fn(),
  },
  mockTaskService: {
    createTask: vi.fn(),
    getTask: vi.fn(),
    updateTask: vi.fn(),
  },
}));

vi.mock('../../services/config-service.js', () => ({
  ConfigService: function () {
    return mockConfigService;
  },
  getConfigService: () => mockConfigService,
}));

vi.mock('../../services/task-service.js', () => ({
  getTaskService: () => mockTaskService,
}));

const localManifest: WorkspaceCapabilityManifest = {
  id: 'local-board',
  schemaVersion: 'workspace-capability/v1',
  workspaceId: 'local',
  name: 'Local Board',
  enabled: true,
  capabilities: [
    {
      id: 'docs',
      name: 'Documentation',
      acceptedTaskTypes: ['docs'],
      requiredContextFields: ['acceptance'],
      intakeTargets: ['task'],
    },
  ],
};

const trustedManifest: WorkspaceCapabilityManifest = {
  id: 'source-board',
  schemaVersion: 'workspace-capability/v1',
  workspaceId: 'source',
  name: 'Source Board',
  enabled: true,
  capabilities: [
    {
      id: 'ops',
      name: 'Ops',
      acceptedTaskTypes: ['feature'],
      intakeTargets: ['task'],
    },
  ],
};

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/workspace-capabilities', workspaceCapabilityRoutes);
  app.use(errorHandler);
  return app;
}

describe('workspace capability routes', () => {
  let app: express.Express;
  let config: AppConfig;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
    config = {
      repos: [],
      agents: [],
      defaultAgent: 'codex',
      workspaceCapability: localManifest,
      trustedWorkspaceCapabilities: [trustedManifest],
    };
    mockConfigService.getConfig.mockImplementation(async () => config);
    mockConfigService.saveConfig.mockImplementation(async (next: AppConfig) => {
      Object.assign(config, next);
    });
    mockTaskService.getTask.mockResolvedValue(null);
    mockTaskService.updateTask.mockResolvedValue(null);
    mockTaskService.createTask.mockImplementation(
      async (input) =>
        ({
          id: 'task_20260626_target',
          title: input.title,
          description: input.description,
          type: input.type,
          status: 'todo',
          priority: input.priority,
          created: '2026-06-26T00:00:00.000Z',
          updated: '2026-06-26T00:00:00.000Z',
        }) satisfies Task
    );
  });

  it('validates manifests and reports field paths', async () => {
    const res = await request(app)
      .post('/api/workspace-capabilities/manifest/validate')
      .send({
        manifest: {
          ...localManifest,
          capabilities: [
            { ...localManifest.capabilities[0] },
            { ...localManifest.capabilities[0] },
          ],
        },
      });

    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(false);
    expect(res.body.issues.map((issue: { message: string }) => issue.message)).toContain(
      'Duplicate capability ID: docs'
    );
  });

  it('registers trusted manifests and exposes redacted discovery', async () => {
    config.trustedWorkspaceCapabilities = [];

    const register = await request(app)
      .post('/api/workspace-capabilities/trusted')
      .send({
        manifest: {
          ...trustedManifest,
          metadata: { source: '/tmp/source.yaml' },
        },
      });

    expect(register.status).toBe(201);
    expect(register.body.manifest.metadata.source).toBeUndefined();

    const discover = await request(app).get('/api/workspace-capabilities/discover');
    expect(discover.status).toBe(200);
    expect(discover.body.trusted[0].workspaceId).toBe('source');
    expect(discover.body.trusted[0].metadata.source).toBeUndefined();
  });

  it('creates delegated task intake for trusted sources', async () => {
    const res = await request(app)
      .post('/api/workspace-capabilities/intake')
      .send({
        source: { workspaceId: 'source', workspaceName: 'Source Board' },
        capabilityId: 'docs',
        title: 'Write docs',
        context: 'Document the handoff.',
        contextFields: { acceptance: 'Includes handoff and rollback steps' },
        type: 'docs',
      });

    expect(res.status).toBe(201);
    expect(res.body.taskId).toBe('task_20260626_target');
    expect(mockTaskService.createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Write docs',
        type: 'docs',
      })
    );
    expect(config.workspaceDelegations?.[0]).toMatchObject({
      source: { workspaceId: 'source' },
      target: { taskId: 'task_20260626_target' },
    });
  });

  it('rejects untrusted delegated intake', async () => {
    const res = await request(app)
      .post('/api/workspace-capabilities/intake')
      .send({
        source: { workspaceId: 'unknown' },
        capabilityId: 'docs',
        title: 'Write docs',
        context: 'Document the handoff.',
        contextFields: { acceptance: 'Includes handoff and rollback steps' },
        type: 'docs',
      });

    expect(res.status).toBe(403);
    expect(res.body.message).toContain('Workspace is not trusted');
  });
});
