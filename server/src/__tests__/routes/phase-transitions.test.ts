import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PHASE_AUTHORITY_DIMENSIONS,
  type PhaseAuthorityDimension,
  type PhaseAuthoritySource,
} from '@veritas-kanban/shared';
import type { AuthenticatedRequest } from '../../middleware/auth.js';
import { errorHandler } from '../../middleware/error-handler.js';
import {
  compilePhaseCapabilityAuthority,
  getBuiltInPhaseCapabilityProfile,
} from '../../services/phase-capability-service.js';

const {
  mockApplyAccessChange,
  mockGetPhase,
  mockGetRunAccess,
  mockPreviewAccessChange,
  mockTransition,
} = vi.hoisted(() => ({
  mockApplyAccessChange: vi.fn(),
  mockGetPhase: vi.fn(),
  mockGetRunAccess: vi.fn(),
  mockPreviewAccessChange: vi.fn(),
  mockTransition: vi.fn(),
}));

vi.mock('../../services/run-access-change-service.js', () => ({
  getRunAccessChangeService: () => ({
    apply: mockApplyAccessChange,
    preview: mockPreviewAccessChange,
  }),
}));

vi.mock('../../services/run-access-summary-service.js', () => ({
  getRunAccessSummaryService: () => ({ get: mockGetRunAccess }),
}));

vi.mock('../../services/phase-transition-service.js', () => ({
  getPhaseTransitionService: () => ({
    transition: mockTransition,
  }),
}));

vi.mock('../../services/run-phase-authority-service.js', () => ({
  getRunPhaseAuthorityService: () => ({
    get: mockGetPhase,
  }),
}));

vi.mock('../../services/clawdbot-agent-service.js', () => ({
  AgentReadinessError: class AgentReadinessError extends Error {},
  clawdbotAgentService: {},
}));

vi.mock('../../services/task-service.js', () => ({
  getTaskService: () => ({ getTask: vi.fn() }),
}));

vi.mock('../../services/telemetry-service.js', () => ({
  getTelemetryService: () => ({ emit: vi.fn() }),
}));

vi.mock('../../services/workspace-execution-trust-service.js', () => ({
  getWorkspaceExecutionTrustService: () => ({}),
}));

import { agentRoutes } from '../../routes/agents.js';

describe('phase transition routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetPhase.mockResolvedValue(null);
    mockGetRunAccess.mockResolvedValue({
      current: { schemaVersion: 'run-access-summary/v1' },
      history: [],
    });
  });

  it('reads current state and bounded history for one exact run', async () => {
    const response = await request(app())
      .get('/api/agents/task-1/phase')
      .query({ attemptId: 'attempt-1', limit: 25 });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ phase: null, current: null, history: [] });
    expect(mockGetPhase).toHaveBeenCalledWith('local', 'task-1', 'attempt-1', 25);
  });

  it('reads one exact run access projection through agent read authority', async () => {
    const response = await request(app())
      .get('/api/agents/task-1/access')
      .query({ attemptId: 'attempt-1' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      current: { schemaVersion: 'run-access-summary/v1' },
      history: [],
    });
    expect(mockGetRunAccess).toHaveBeenCalledWith('local', 'task-1', 'attempt-1');
  });

  it('forwards a validated compare-and-set transition and actor authority', async () => {
    const fromEvidence = evidence('plan');
    const targetEvidence = evidence('implement');
    mockTransition.mockResolvedValue({
      status: 'approval-required',
      current: null,
      targetEvidenceDigest: targetEvidence.digest,
      approval: { id: 'runapproval_000000000001' },
    });
    const body = {
      attemptId: 'attempt-1',
      operationId: 'transition-1',
      expectedSequence: 0,
      expectedPhaseEvidenceDigest: fromEvidence.digest,
      expectedManifestDigest: `sha256:${'1'.repeat(64)}`,
      reason: 'Move from planning into implementation.',
      fromEvidence,
      targetEvidence,
    };

    const response = await request(app()).post('/api/agents/task-1/phase/transitions').send(body);

    expect(response.status).toBe(202);
    expect(mockTransition).toHaveBeenCalledWith(
      'local',
      'task-1',
      body,
      expect.objectContaining({
        administrator: true,
        actor: expect.objectContaining({
          id: 'owner',
          workspaceId: 'local',
          type: 'user',
        }),
      })
    );
  });

  it('previews and applies a server-owned Run Access change', async () => {
    const body = {
      attemptId: 'attempt-1',
      requestId: 'access-change-1',
      operation: 'transition-phase',
      targetPhase: 'publish',
      reason: 'Move the active run into reviewed publication authority.',
      expectedAccessSummaryDigest: `sha256:${'4'.repeat(64)}`,
      expectedSequence: 0,
      expectedPhaseEvidenceDigest: `sha256:${'2'.repeat(64)}`,
      expectedManifestDigest: `sha256:${'1'.repeat(64)}`,
    };
    mockPreviewAccessChange.mockResolvedValue({
      schemaVersion: 'run-access-change-preview/v1',
      requestRevision: `sha256:${'3'.repeat(64)}`,
    });

    const preview = await request(app())
      .post('/api/agents/task-1/access/changes/preview')
      .send(body);

    expect(preview.status).toBe(200);
    expect(mockPreviewAccessChange).toHaveBeenCalledWith('local', 'task-1', body);

    const appliedBody = { ...body, requestRevision: preview.body.requestRevision };
    mockApplyAccessChange.mockResolvedValue({
      preview: preview.body,
      transition: { status: 'approval-required' },
    });
    const applied = await request(app())
      .post('/api/agents/task-1/access/changes')
      .send(appliedBody);

    expect(applied.status).toBe(202);
    expect(mockApplyAccessChange).toHaveBeenCalledWith(
      'local',
      'task-1',
      appliedBody,
      expect.objectContaining({ administrator: true })
    );
  });
});

function app() {
  const application = express();
  application.use(express.json());
  application.use((req, _res, next) => {
    (req as AuthenticatedRequest).auth = {
      role: 'admin',
      isLocalhost: true,
      userId: 'owner',
      workspaceId: 'local',
      actorType: 'user',
      authMethod: 'session',
      authenticatedAt: '2026-07-25T01:00:00.000Z',
      permissions: ['*'],
    };
    next();
  });
  application.use('/api/agents', agentRoutes);
  application.use(errorHandler);
  return application;
}

function evidence(phase: 'plan' | 'implement') {
  return compilePhaseCapabilityAuthority({
    profile: getBuiltInPhaseCapabilityProfile(phase),
    sources: {
      parent: source('parent', 'parent'),
      agentProfile: source('agent-profile', 'agent-profile'),
      sandbox: source('sandbox', 'sandbox'),
      toolCatalog: source('tool-catalog', 'tool-catalog'),
      launchPolicy: source('launch-policy', 'launch-policy'),
    },
  });
}

function source<K extends PhaseAuthoritySource['kind']>(
  id: string,
  kind: K
): PhaseAuthoritySource & { kind: K } {
  return {
    id,
    kind,
    authority: dimensions(() => ['*']),
    enforcement: dimensions(() => 'enforced' as const),
  };
}

function dimensions<T>(
  value: (dimension: PhaseAuthorityDimension) => T
): Record<PhaseAuthorityDimension, T> {
  return Object.fromEntries(
    PHASE_AUTHORITY_DIMENSIONS.map((dimension) => [dimension, value(dimension)])
  ) as Record<PhaseAuthorityDimension, T>;
}
