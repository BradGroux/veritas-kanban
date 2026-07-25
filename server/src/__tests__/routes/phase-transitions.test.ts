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

const { mockGetCurrent, mockList, mockTransition } = vi.hoisted(() => ({
  mockGetCurrent: vi.fn(),
  mockList: vi.fn(),
  mockTransition: vi.fn(),
}));

vi.mock('../../services/phase-transition-service.js', () => ({
  getPhaseTransitionService: () => ({
    getCurrent: mockGetCurrent,
    list: mockList,
    transition: mockTransition,
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
    mockGetCurrent.mockResolvedValue(null);
    mockList.mockResolvedValue([]);
  });

  it('reads current state and bounded history for one exact run', async () => {
    const response = await request(app())
      .get('/api/agents/task-1/phase')
      .query({ attemptId: 'attempt-1', limit: 25 });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ current: null, history: [] });
    expect(mockGetCurrent).toHaveBeenCalledWith('local', 'task-1', 'attempt-1');
    expect(mockList).toHaveBeenCalledWith('local', 'task-1', 'attempt-1', 25);
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
