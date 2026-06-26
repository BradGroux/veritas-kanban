import { beforeEach, describe, expect, it, vi } from 'vitest';
import express, { type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';

const { mockExternalTrackerService } = vi.hoisted(() => ({
  mockExternalTrackerService: {
    getConnection: vi.fn(),
    saveConnection: vi.fn(),
    getSchema: vi.fn(),
    introspect: vi.fn(),
    listProfiles: vi.fn(),
    saveProfile: vi.fn(),
    validateProfile: vi.fn(),
    dryRunCreate: vi.fn(),
    createWorkItem: vi.fn(),
    listAudits: vi.fn(),
  },
}));

vi.mock('../../services/external-tracker-service.js', () => ({
  getExternalTrackerService: () => mockExternalTrackerService,
}));

import { externalTrackerRoutes } from '../../routes/external-trackers.js';

interface TestAuthRequest extends Request {
  auth?: { role: string; userId?: string; permissions: string[] };
}

interface TestError extends Error {
  statusCode?: number;
  code?: string;
}

const schema = {
  provider: 'mock',
  providerLabel: 'Mock Tracker',
  schemaVersion: 'mock-2026-06-26',
  introspectedAt: '2026-06-26T12:00:00.000Z',
  workItemTypes: [{ id: 'Task', name: 'Task' }],
  fields: [{ id: 'System.Title', name: 'Title', type: 'string', required: true }],
  projects: [{ id: 'project-default', name: 'Veritas', path: 'Veritas', kind: 'project' }],
  areaPaths: [{ id: 'area-platform', name: 'Platform', path: 'Veritas\\Platform', kind: 'area' }],
  iterationPaths: [
    { id: 'iteration-next', name: 'Next', path: 'Veritas\\Next', kind: 'iteration' },
  ],
  teams: [{ id: 'team-core', name: 'Core', path: 'Veritas\\Core', kind: 'team' }],
  priorities: [1, 2, 3, 4],
  states: ['New', 'Active', 'Closed'],
  tags: ['veritas'],
  assignees: [],
  capabilities: {
    canCreate: true,
    canUpdate: true,
    requiresApproval: true,
    supportsDryRun: true,
  },
  connectionPosture: { status: 'connected', hasCredential: false, credentialRedacted: true },
};

const profile = {
  id: 'default-mock-profile',
  name: 'Default Mock Tracker Mapping',
  provider: 'mock',
  enabled: true,
  defaultWorkItemType: 'Task',
  defaultProjectPath: 'Veritas',
  defaultAreaPath: 'Veritas\\Platform',
  fieldMappings: [{ trackerFieldId: 'System.Title', source: 'title', required: true }],
  backlinkFieldId: 'Custom.VeritasBacklink',
  createdAt: '2026-06-26T12:00:00.000Z',
  updatedAt: '2026-06-26T12:00:00.000Z',
};

function createApp() {
  const app = express();
  app.use(express.json());
  app.use((req: TestAuthRequest, _res: Response, next: NextFunction) => {
    req.auth = { role: 'admin', userId: 'brad', permissions: ['settings:write'] };
    next();
  });
  app.use('/api/integrations/trackers', externalTrackerRoutes);
  app.use((err: TestError, _req: Request, res: Response, _next: NextFunction) => {
    res.status(err.statusCode || 500).json({ code: err.code || 'ERROR', message: err.message });
  });
  return app;
}

describe('external tracker routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExternalTrackerService.getConnection.mockResolvedValue({
      provider: 'mock',
      displayName: 'Mock Tracker',
      status: 'connected',
      hasCredential: false,
      credentialRedacted: true,
      updatedAt: '2026-06-26T12:00:00.000Z',
    });
    mockExternalTrackerService.saveConnection.mockResolvedValue({
      provider: 'mock',
      displayName: 'Mock Tracker',
      status: 'connected',
      hasCredential: true,
      credentialRedacted: true,
      updatedAt: '2026-06-26T12:00:00.000Z',
      updatedBy: 'brad',
    });
    mockExternalTrackerService.getSchema.mockResolvedValue(schema);
    mockExternalTrackerService.introspect.mockResolvedValue(schema);
    mockExternalTrackerService.listProfiles.mockResolvedValue([profile]);
    mockExternalTrackerService.saveProfile.mockResolvedValue(profile);
    mockExternalTrackerService.validateProfile.mockResolvedValue({
      valid: true,
      errors: [],
      warnings: [],
    });
    mockExternalTrackerService.dryRunCreate.mockResolvedValue({
      externalWrite: false,
      profile,
      schema,
      payload: {
        provider: 'mock',
        workItemType: 'Task',
        fields: { 'System.Title': 'Preview' },
        backlinkUrl: 'veritas-kanban://tasks/task_1',
      },
      validation: { valid: true, errors: [], warnings: [] },
    });
    mockExternalTrackerService.createWorkItem.mockResolvedValue({
      externalWrite: true,
      link: {
        id: 'external_work_1',
        provider: 'mock',
        profileId: profile.id,
        externalId: 'MOCK-1',
        externalUrl: 'https://tracker.example.test/work-items/MOCK-1',
        workItemType: 'Task',
        status: 'created',
        title: 'Preview',
        backlinkUrl: 'veritas-kanban://tasks/task_1',
        createdAt: '2026-06-26T12:00:00.000Z',
        createdBy: 'brad',
      },
      profile,
      schema,
      payload: {
        provider: 'mock',
        workItemType: 'Task',
        fields: { 'System.Title': 'Preview' },
        backlinkUrl: 'veritas-kanban://tasks/task_1',
      },
      validation: { valid: true, errors: [], warnings: [] },
    });
    mockExternalTrackerService.listAudits.mockResolvedValue([]);
  });

  it('returns schema and profile configuration', async () => {
    const app = createApp();
    const schemaRes = await request(app).get('/api/integrations/trackers/schema');
    const profileRes = await request(app).get('/api/integrations/trackers/profiles');

    expect(schemaRes.status).toBe(200);
    expect(schemaRes.body.providerLabel).toBe('Mock Tracker');
    expect(profileRes.status).toBe(200);
    expect(profileRes.body[0].id).toBe('default-mock-profile');
  });

  it('saves connection and profile changes with the authenticated actor', async () => {
    const app = createApp();
    await request(app)
      .put('/api/integrations/trackers/connection')
      .send({ provider: 'mock', token: 'secret' })
      .expect(200);

    await request(app)
      .put('/api/integrations/trackers/profiles/default-mock-profile')
      .send(profile)
      .expect(200);

    expect(mockExternalTrackerService.saveConnection).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'mock', token: 'secret' }),
      'brad'
    );
    expect(mockExternalTrackerService.saveProfile).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'default-mock-profile' }),
      'brad'
    );
  });

  it('runs dry-run creates without external writes', async () => {
    const res = await request(createApp())
      .post('/api/integrations/trackers/profiles/default-mock-profile/dry-run-create')
      .send({ taskId: 'task_20260626_tracker' });

    expect(res.status).toBe(200);
    expect(res.body.externalWrite).toBe(false);
    expect(mockExternalTrackerService.dryRunCreate).toHaveBeenCalledWith(
      { profileId: 'default-mock-profile', taskId: 'task_20260626_tracker' },
      'brad'
    );
  });

  it('requires explicit approval before creating external work items', async () => {
    const app = createApp();
    const blocked = await request(app)
      .post('/api/integrations/trackers/profiles/default-mock-profile/create')
      .send({ taskId: 'task_20260626_tracker' });

    const created = await request(app)
      .post('/api/integrations/trackers/profiles/default-mock-profile/create')
      .send({ taskId: 'task_20260626_tracker', approvedBy: 'brad' });

    expect(blocked.status).toBe(400);
    expect(created.status).toBe(201);
    expect(mockExternalTrackerService.createWorkItem).toHaveBeenCalledTimes(1);
    expect(mockExternalTrackerService.createWorkItem).toHaveBeenCalledWith({
      profileId: 'default-mock-profile',
      taskId: 'task_20260626_tracker',
      approvedBy: 'brad',
    });
  });
});
