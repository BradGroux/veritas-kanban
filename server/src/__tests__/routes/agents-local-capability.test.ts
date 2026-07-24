import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthContext, AuthenticatedRequest } from '../../middleware/auth.js';
import { errorHandler } from '../../middleware/error-handler.js';

const {
  mockStartAgent,
  mockPreviewAgentLaunch,
  mockStopAgent,
  mockInterruptConversation,
  mockSendMessage,
  mockResumeConversation,
  mockFollowUpConversation,
  mockForkConversation,
  mockCompactConversation,
  mockArchiveConversation,
  mockCloseConversation,
  mockCompleteAgent,
  mockGetAgentStatus,
  mockAssertActiveRunControl,
  mockRecordBudgetUsage,
  mockGetRunEvents,
  mockGetTask,
  mockTelemetryEmit,
} = vi.hoisted(() => ({
  mockStartAgent: vi.fn(),
  mockPreviewAgentLaunch: vi.fn(),
  mockStopAgent: vi.fn(),
  mockInterruptConversation: vi.fn(),
  mockSendMessage: vi.fn(),
  mockResumeConversation: vi.fn(),
  mockFollowUpConversation: vi.fn(),
  mockForkConversation: vi.fn(),
  mockCompactConversation: vi.fn(),
  mockArchiveConversation: vi.fn(),
  mockCloseConversation: vi.fn(),
  mockCompleteAgent: vi.fn(),
  mockGetAgentStatus: vi.fn(),
  mockAssertActiveRunControl: vi.fn(),
  mockRecordBudgetUsage: vi.fn(),
  mockGetRunEvents: vi.fn(),
  mockGetTask: vi.fn(),
  mockTelemetryEmit: vi.fn(),
}));

vi.mock('../../services/clawdbot-agent-service.js', () => ({
  AgentReadinessError: class AgentReadinessError extends Error {
    constructor(
      public readiness: unknown,
      message = 'Task readiness override required'
    ) {
      super(message);
    }
  },
  clawdbotAgentService: {
    startAgent: mockStartAgent,
    previewAgentLaunch: mockPreviewAgentLaunch,
    stopAgent: mockStopAgent,
    interruptConversation: mockInterruptConversation,
    sendMessage: mockSendMessage,
    resumeConversation: mockResumeConversation,
    followUpConversation: mockFollowUpConversation,
    forkConversation: mockForkConversation,
    compactConversation: mockCompactConversation,
    archiveConversation: mockArchiveConversation,
    closeConversation: mockCloseConversation,
    completeAgent: mockCompleteAgent,
    getAgentStatus: mockGetAgentStatus,
    assertRunControl: vi.fn(),
    assertActiveRunControl: mockAssertActiveRunControl,
    recordBudgetUsage: mockRecordBudgetUsage,
    listPendingRequests: vi.fn(),
    listAttempts: vi.fn(),
    getAttemptLog: vi.fn(),
    getRunEvents: mockGetRunEvents,
  },
}));

vi.mock('../../services/task-service.js', () => ({
  getTaskService: () => ({ getTask: mockGetTask }),
}));

vi.mock('../../services/telemetry-service.js', () => ({
  getTelemetryService: () => ({ emit: mockTelemetryEmit }),
}));

import { agentRoutes } from '../../routes/agents.js';

function auth(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    role: 'agent',
    isLocalhost: false,
    authMethod: 'device-session',
    permissions: ['agent:write'],
    clientMode: 'desktop-remote',
    capabilities: ['desktop:remote', 'agent:run:scoped'],
    ...overrides,
  };
}

function createApp(authContext: AuthContext | undefined) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as AuthenticatedRequest).auth = authContext;
    next();
  });
  app.use('/api/agents', agentRoutes);
  app.use(errorHandler);
  return app;
}

describe('agent local capability enforcement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStartAgent.mockResolvedValue({ taskId: 'task_1', agent: 'codex', status: 'running' });
    mockPreviewAgentLaunch.mockResolvedValue({
      manifest: {
        digest: `sha256:${'a'.repeat(64)}`,
        enforcement: { enforceable: true, blockers: [] },
      },
    });
    mockStopAgent.mockResolvedValue(undefined);
    mockInterruptConversation.mockResolvedValue({
      action: 'interrupt',
      attemptId: 'attempt_1',
      delivered: true,
    });
    mockSendMessage.mockResolvedValue({ delivered: true, note: 'delivered' });
    mockResumeConversation.mockResolvedValue({
      taskId: 'task_1',
      attemptId: 'attempt_2',
      status: 'running',
    });
    mockFollowUpConversation.mockResolvedValue({
      taskId: 'task_1',
      attemptId: 'attempt_2',
      status: 'running',
    });
    mockForkConversation.mockResolvedValue({
      taskId: 'task_1',
      attemptId: 'attempt_2',
      status: 'running',
    });
    mockCompactConversation.mockResolvedValue({
      action: 'compact',
      attemptId: 'attempt_1',
      delivered: true,
    });
    mockArchiveConversation.mockResolvedValue({
      action: 'archive',
      attemptId: 'attempt_1',
      delivered: true,
    });
    mockCloseConversation.mockResolvedValue({
      action: 'close',
      attemptId: 'attempt_1',
      delivered: true,
    });
    mockCompleteAgent.mockResolvedValue(undefined);
    mockGetAgentStatus.mockReturnValue(null);
    mockAssertActiveRunControl.mockResolvedValue(undefined);
    mockRecordBudgetUsage.mockResolvedValue(undefined);
    mockGetRunEvents.mockResolvedValue({
      schemaVersion: 'run-event/v1',
      taskId: 'task_1',
      attemptId: 'attempt_1',
      events: [],
      nextCursor: 12,
      hasMore: false,
    });
    mockGetTask.mockResolvedValue({
      id: 'task_1',
      project: 'veritas',
      attempt: { id: 'attempt_1', agent: 'codex' },
    });
    mockTelemetryEmit.mockImplementation(async (event) => ({ id: 'event_1', ...event }));
  });

  it('rejects remote sessions without a local-agent capability before starting agents', async () => {
    const response = await request(createApp(auth()))
      .post('/api/agents/task_1/start')
      .send({ agent: 'codex' });

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({
      code: 'FORBIDDEN',
      message: 'Local agent controls are disabled for this session',
    });
    expect(mockStartAgent).not.toHaveBeenCalled();
  });

  it('allows local desktop sessions to start agents', async () => {
    const response = await request(
      createApp(auth({ clientMode: 'desktop-local', capabilities: ['desktop:local'] }))
    )
      .post('/api/agents/task_1/start')
      .send({ agent: 'codex' });

    expect(response.status).toBe(201);
    expect(mockStartAgent).toHaveBeenCalledWith('task_1', 'codex', {
      profileId: undefined,
      overrideReason: undefined,
      sandboxPresetId: undefined,
      budget: undefined,
      requiredRuntimeCapabilities: undefined,
      commitPolicy: undefined,
      parentAttemptId: undefined,
    });
  });

  it('previews launch evidence without dispatching an agent', async () => {
    const app = createApp(auth({ clientMode: 'desktop-local', capabilities: ['desktop:local'] }));
    const response = await request(app)
      .post('/api/agents/task_1/launch-preview')
      .send({ agent: 'codex', parentAttemptId: 'attempt_parent' });

    expect(response.status).toBe(200);
    expect(response.body.manifest.digest).toBe(`sha256:${'a'.repeat(64)}`);
    expect(mockPreviewAgentLaunch).toHaveBeenCalledWith('task_1', 'codex', {
      profileId: undefined,
      overrideReason: undefined,
      sandboxPresetId: undefined,
      budget: undefined,
      requiredRuntimeCapabilities: undefined,
      commitPolicy: undefined,
      parentAttemptId: 'attempt_parent',
    });
    expect(mockStartAgent).not.toHaveBeenCalled();
  });

  it('requires local agent capability for launch preview', async () => {
    const response = await request(createApp(auth()))
      .post('/api/agents/task_1/launch-preview')
      .send({ agent: 'codex' });

    expect(response.status).toBe(403);
    expect(mockPreviewAgentLaunch).not.toHaveBeenCalled();
  });

  it('returns the same readiness validation evidence for preview as start', async () => {
    const { AgentReadinessError } = await import('../../services/clawdbot-agent-service.js');
    const readiness = {
      ready: false,
      missingRequired: [{ id: 'acceptance', label: 'Acceptance criteria' }],
    };
    mockPreviewAgentLaunch.mockRejectedValue(new AgentReadinessError(readiness));

    const response = await request(
      createApp(auth({ clientMode: 'desktop-local', capabilities: ['desktop:local'] }))
    )
      .post('/api/agents/task_1/launch-preview')
      .send({ agent: 'codex' });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      code: 'VALIDATION_ERROR',
      details: { readiness },
    });
  });

  it('validates and forwards an explicit run commit policy', async () => {
    const app = createApp(auth({ clientMode: 'desktop-local', capabilities: ['desktop:local'] }));
    const response = await request(app)
      .post('/api/agents/task_1/start')
      .send({ agent: 'codex', commitPolicy: 'forbidden' });

    expect(response.status).toBe(201);
    expect(mockStartAgent).toHaveBeenCalledWith(
      'task_1',
      'codex',
      expect.objectContaining({ commitPolicy: 'forbidden' })
    );

    const invalid = await request(app)
      .post('/api/agents/task_1/start')
      .send({ agent: 'codex', commitPolicy: 'sometimes' });
    expect(invalid.status).toBe(400);
  });

  it('validates and forwards required runtime capabilities', async () => {
    const app = createApp(auth({ clientMode: 'desktop-local', capabilities: ['desktop:local'] }));
    const response = await request(app)
      .post('/api/agents/task_1/start')
      .send({ agent: 'codex', requiredRuntimeCapabilities: ['tool.mcp'] });

    expect(response.status).toBe(201);
    expect(mockStartAgent).toHaveBeenCalledWith(
      'task_1',
      'codex',
      expect.objectContaining({ requiredRuntimeCapabilities: ['tool.mcp'] })
    );

    const invalid = await request(app)
      .post('/api/agents/task_1/start')
      .send({ agent: 'codex', requiredRuntimeCapabilities: ['INVALID CAPABILITY'] });
    expect(invalid.status).toBe(400);
  });

  it('returns capability-derived controls with agent status', async () => {
    mockGetAgentStatus.mockReturnValue({
      taskId: 'task_1',
      attemptId: 'attempt_1',
      agent: 'codex',
      status: 'running',
      providerRuntimeManifest: { digest: 'sha256:fixture' },
      controls: {
        manifestDigest: 'sha256:fixture',
        controls: [
          {
            action: 'stop',
            capabilityId: 'run.stop',
            state: 'unsupported',
            available: false,
            advisory: false,
            reason: 'Provider cannot stop this run.',
          },
        ],
      },
    });

    const response = await request(createApp(auth())).get('/api/agents/task_1/status');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      running: true,
      controls: {
        controls: [expect.objectContaining({ action: 'stop', available: false })],
      },
    });
  });

  it('allows explicitly authorized remote sessions to stop agents', async () => {
    const response = await request(
      createApp(auth({ capabilities: ['desktop:remote', 'agent:run:local'] }))
    )
      .post('/api/agents/task_1/stop')
      .send({ attemptId: 'attempt_1' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ stopped: true });
    expect(mockStopAgent).toHaveBeenCalledWith('task_1', 'attempt_1');
  });

  it('requires active attempt provenance for stop and message controls', async () => {
    const app = createApp(auth({ clientMode: 'desktop-local', capabilities: ['desktop:local'] }));

    const missingStop = await request(app).post('/api/agents/task_1/stop').send({});
    const missingMessage = await request(app)
      .post('/api/agents/task_1/message')
      .send({ message: 'continue' });
    expect(missingStop.status).toBe(400);
    expect(missingMessage.status).toBe(400);
    expect(mockStopAgent).not.toHaveBeenCalled();
    expect(mockSendMessage).not.toHaveBeenCalled();

    const message = await request(app).post('/api/agents/task_1/message').send({
      attemptId: 'attempt_1',
      message: 'continue',
    });
    expect(message.status).toBe(200);
    expect(mockSendMessage).toHaveBeenCalledWith('task_1', 'continue', {
      actor: 'agent',
      source: 'agent-route',
      expectedAttemptId: 'attempt_1',
    });
  });

  it('exposes attributed provider-neutral conversation lifecycle routes', async () => {
    const app = createApp(
      auth({
        userId: 'operator_1',
        clientMode: 'desktop-local',
        capabilities: ['desktop:local'],
      })
    );

    const resume = await request(app).post('/api/agents/task_1/conversation/resume').send({
      sourceAttemptId: 'attempt_parent',
      message: 'Continue from the durable provider history',
      commitPolicy: 'forbidden',
    });
    expect(resume.status).toBe(201);
    expect(mockResumeConversation).toHaveBeenCalledWith(
      'task_1',
      'attempt_parent',
      'Continue from the durable provider history',
      expect.objectContaining({ commitPolicy: 'forbidden' })
    );

    const fork = await request(app).post('/api/agents/task_1/conversation/fork').send({
      sourceAttemptId: 'attempt_parent',
      message: 'Explore another branch',
      forkTurnId: 'turn_7',
    });
    expect(fork.status).toBe(201);
    expect(mockForkConversation).toHaveBeenCalledWith(
      'task_1',
      'attempt_parent',
      'Explore another branch',
      'turn_7',
      expect.any(Object)
    );

    const spoofedSteer = await request(app).post('/api/agents/task_1/conversation/steer').send({
      attemptId: 'attempt_1',
      message: 'Pretend another actor sent this',
      actor: 'spoofed-operator',
    });
    expect(spoofedSteer.status).toBe(400);

    const steer = await request(app).post('/api/agents/task_1/conversation/steer').send({
      attemptId: 'attempt_1',
      message: 'Use the narrow fix',
    });
    expect(steer.status).toBe(200);
    expect(mockSendMessage).toHaveBeenCalledWith('task_1', 'Use the narrow fix', {
      actor: 'operator_1',
      source: 'conversation-route',
      expectedAttemptId: 'attempt_1',
    });

    const compact = await request(app).post('/api/agents/task_1/conversation/compact').send({
      attemptId: 'attempt_1',
    });
    expect(compact.status).toBe(200);
    expect(mockCompactConversation).toHaveBeenCalledWith('task_1', 'attempt_1', 'operator_1');

    const interrupt = await request(app).post('/api/agents/task_1/conversation/interrupt').send({
      attemptId: 'attempt_1',
    });
    expect(interrupt.status).toBe(200);
    expect(mockInterruptConversation).toHaveBeenCalledWith('task_1', 'attempt_1', 'operator_1');
  });

  it('requires and forwards completion attempt provenance', async () => {
    const app = createApp(auth());
    const digest = `sha256:${'a'.repeat(64)}`;

    const missing = await request(app).post('/api/agents/task_1/complete').send({ success: true });
    expect(missing.status).toBe(400);

    const response = await request(app).post('/api/agents/task_1/complete').send({
      attemptId: 'attempt_1',
      providerRuntimeManifestDigest: digest,
      success: true,
      summary: 'Done',
    });
    expect(response.status).toBe(200);
    expect(mockCompleteAgent).toHaveBeenCalledWith(
      'task_1',
      { success: true, summary: 'Done', error: undefined },
      {
        attemptId: 'attempt_1',
        providerRuntimeManifestDigest: digest,
        terminalSource: 'callback',
      }
    );

    const structured = await request(app)
      .post('/api/agents/task_1/complete')
      .send({
        attemptId: 'attempt_1',
        providerRuntimeManifestDigest: digest,
        status: 'blocked',
        summary: 'Waiting on an operator.',
        blockers: [
          {
            code: 'operator-input',
            summary: 'Operator input required',
            detail: 'Choose the release channel.',
            retryable: true,
          },
        ],
      });
    expect(structured.status).toBe(200);
    expect(mockCompleteAgent).toHaveBeenLastCalledWith(
      'task_1',
      expect.objectContaining({
        status: 'blocked',
        summary: 'Waiting on an operator.',
        blockers: [expect.objectContaining({ code: 'operator-input' })],
      }),
      {
        attemptId: 'attempt_1',
        providerRuntimeManifestDigest: digest,
        terminalSource: 'callback',
      }
    );

    const oversized = await request(app)
      .post('/api/agents/task_1/complete')
      .send({
        attemptId: 'attempt_1',
        providerRuntimeManifestDigest: digest,
        success: false,
        error: 'x'.repeat(20_001),
      });
    expect(oversized.status).toBe(400);
  });

  it('binds token budget mutation to the resolved active attempt', async () => {
    const app = createApp(auth());
    const missing = await request(app).post('/api/agents/task_1/tokens').send({
      inputTokens: 10,
      outputTokens: 5,
    });
    expect(missing.status).toBe(400);
    expect(mockRecordBudgetUsage).not.toHaveBeenCalled();

    const response = await request(app).post('/api/agents/task_1/tokens').send({
      attemptId: 'attempt_1',
      inputTokens: 10,
      outputTokens: 5,
    });

    expect(response.status).toBe(201);
    expect(mockAssertActiveRunControl).toHaveBeenCalledWith('task_1', 'token-usage', 'attempt_1');
    expect(mockRecordBudgetUsage).toHaveBeenCalledWith('task_1', 'attempt_1', {
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
      costUsd: undefined,
    });
  });

  it('validates and forwards durable run-event replay cursors', async () => {
    const app = createApp(auth());
    const response = await request(app)
      .get('/api/agents/task_1/attempts/attempt_1/events')
      .query({ afterSequence: 12, limit: 50 });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      schemaVersion: 'run-event/v1',
      nextCursor: 12,
    });
    expect(mockGetRunEvents).toHaveBeenCalledWith('task_1', 'attempt_1', 12, 50);

    const invalid = await request(app)
      .get('/api/agents/task_1/attempts/attempt_1/events')
      .query({ afterSequence: -1 });
    expect(invalid.status).toBe(400);
  });
});
