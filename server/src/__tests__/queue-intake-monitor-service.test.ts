import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { QueueIntakeMonitorService } from '../services/queue-intake-monitor-service.js';

describe('QueueIntakeMonitorService', () => {
  let testRoot: string;
  let githubExec: ReturnType<typeof vi.fn>;
  let watcherPolicyService: { evaluateContinuation: ReturnType<typeof vi.fn> };
  let sandboxPolicyService: { dryRun: ReturnType<typeof vi.fn> };
  let budgetService: { resolve: ReturnType<typeof vi.fn>; evaluate: ReturnType<typeof vi.fn> };
  let governanceTraceService: { record: ReturnType<typeof vi.fn> };
  let workflowService: { loadWorkflow: ReturnType<typeof vi.fn> };
  let workflowRunService: { startRun: ReturnType<typeof vi.fn> };
  let workflowAuthoringService: { dryRun: ReturnType<typeof vi.fn> };
  let telemetryService: { emit: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'veritas-queue-monitor-'));
    githubExec = vi.fn(async (args: string[]) => {
      if (args[0] === 'issue') return JSON.stringify(defaultIssues());
      if (args[0] === 'pr') return JSON.stringify(defaultPullRequests());
      return '';
    });
    watcherPolicyService = {
      evaluateContinuation: vi.fn(async () => ({
        decision: 'allow',
        mode: 'auto',
        riskLevel: 'low',
        riskClasses: [],
        reasons: ['Allowed in test policy.'],
        evidence: [],
        caps: { maxContinuations: 5, spendCapUsd: 0 },
        auditLogged: true,
        evaluatedAt: '2026-06-26T12:00:00.000Z',
      })),
    };
    sandboxPolicyService = {
      dryRun: vi.fn(async () => ({
        decision: 'allow',
        preset: { id: 'legacy-permissive', name: 'Legacy permissive' },
        provider: 'codex-cli',
        effective: {
          sandboxMode: 'workspace-write',
          networkAccessEnabled: true,
          envPassthrough: [],
          credentialRefs: [],
        },
        evaluations: [],
        unsupportedRules: [],
        warnings: [],
      })),
    };
    budgetService = {
      resolve: vi.fn(() => undefined),
      evaluate: vi.fn(() => ({
        decision: 'allow',
        usage: {},
        thresholdEvents: [],
      })),
    };
    governanceTraceService = { record: vi.fn(async (trace) => ({ id: 'trace_1', ...trace })) };
    workflowService = { loadWorkflow: vi.fn(async () => workflowDefinition()) };
    workflowRunService = {
      startRun: vi.fn(async () => ({ id: 'run_queue_1' })),
    };
    workflowAuthoringService = {
      dryRun: vi.fn(async () => ({ messages: [], status: 'ready', canRun: true, checks: [] })),
    };
    telemetryService = { emit: vi.fn(async (event) => event) };
  });

  afterEach(async () => {
    await fs.rm(testRoot, { recursive: true, force: true });
  });

  it('builds a bounded dry-run candidate packet and records skipped reasons', async () => {
    const service = queueService();

    const result = await service.runOnce(
      'veritas-backlog-high-priority',
      'manual-run',
      new Date('2026-06-26T12:00:00.000Z')
    );

    expect(result.packet.candidates).toHaveLength(4);
    expect(result.packet.selected?.id).toBe('BradGroux/veritas-kanban#736');
    expect(result.packet.skipped).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          candidateId: 'BradGroux/veritas-kanban#900',
          reasons: ['Blocked by label: blocked'],
        }),
        expect.objectContaining({
          candidateId: 'BradGroux/veritas-kanban#902',
          reasons: ['Draft pull request.'],
        }),
      ])
    );
    expect(result.action).toMatchObject({
      action: 'dry-run',
      status: 'success',
      selectedCandidateId: 'BradGroux/veritas-kanban#736',
    });
    expect(telemetryService.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'run.completed',
        taskId: 'queue-monitor:veritas-backlog-high-priority',
        agent: 'queue-intake-monitor',
        project: 'operations',
      })
    );

    const reloaded = queueService();
    const monitor = await reloaded.getMonitor('veritas-backlog-high-priority');
    expect(monitor.lastPacket?.selected?.number).toBe(736);
  });

  it('blocks execute mode until workflow launch gates pass and opens a visible action item', async () => {
    const service = queueService();
    await service.updateMonitor('veritas-backlog-high-priority', { mode: 'execute' });

    await service.runOnce('veritas-backlog-high-priority');
    await service.runOnce('veritas-backlog-high-priority');
    const result = await service.runOnce('veritas-backlog-high-priority');

    expect(result.action).toMatchObject({
      action: 'blocked',
      status: 'blocked',
      summary: 'Execute mode requires a workflowId before launching work.',
    });
    const health = await service.health('veritas-backlog-high-priority');
    expect(health.monitor.health).toBe('blocked');
    expect(health.actionItem?.summary).toBe(
      'Execute mode requires a workflowId before launching work.'
    );
    expect(workflowRunService.startRun).not.toHaveBeenCalled();
  });

  it('starts a workflow when execute gates pass', async () => {
    const service = queueService();
    await service.updateMonitor('veritas-backlog-high-priority', {
      mode: 'execute',
      workflowId: 'queue-intake-workflow',
    });

    const result = await service.runOnce(
      'veritas-backlog-high-priority',
      'manual-run',
      new Date('2026-06-26T12:00:00.000Z')
    );

    expect(result.action).toMatchObject({
      action: 'start-workflow',
      status: 'started',
      sourceRunId: 'run_queue_1',
    });
    expect(workflowRunService.startRun).toHaveBeenCalledWith(
      'queue-intake-workflow',
      undefined,
      expect.objectContaining({
        queueMonitor: expect.objectContaining({
          monitorId: 'veritas-backlog-high-priority',
          candidate: expect.objectContaining({
            number: 736,
            url: 'https://github.com/BradGroux/veritas-kanban/issues/736',
          }),
        }),
      }),
      undefined
    );
  });

  function queueService(): QueueIntakeMonitorService {
    return new QueueIntakeMonitorService({
      storeFile: path.join(testRoot, 'queue-monitors.json'),
      githubExec,
      watcherPolicyService: watcherPolicyService as never,
      sandboxPolicyService: sandboxPolicyService as never,
      budgetService: budgetService as never,
      governanceTraceService: governanceTraceService as never,
      workflowService: workflowService as never,
      workflowRunService: workflowRunService as never,
      workflowAuthoringService: workflowAuthoringService as never,
      telemetryService: telemetryService as never,
    });
  }
});

function defaultIssues() {
  return [
    {
      number: 736,
      title: 'Add policy-gated queue intake monitor',
      state: 'OPEN',
      labels: [{ name: 'priority: high' }, { name: 'workflow-engine' }],
      assignees: [],
      author: { login: 'BradGroux' },
      createdAt: '2026-06-20T12:00:00.000Z',
      updatedAt: '2026-06-21T12:00:00.000Z',
      url: 'https://github.com/BradGroux/veritas-kanban/issues/736',
      comments: 2,
    },
    {
      number: 900,
      title: 'Blocked backlog item',
      state: 'OPEN',
      labels: [{ name: 'priority: high' }, { name: 'blocked' }],
      assignees: [],
      author: { login: 'BradGroux' },
      createdAt: '2026-06-20T12:00:00.000Z',
      updatedAt: '2026-06-22T12:00:00.000Z',
      url: 'https://github.com/BradGroux/veritas-kanban/issues/900',
      comments: 1,
    },
  ];
}

function defaultPullRequests() {
  return [
    {
      number: 901,
      title: 'Ready pull request',
      state: 'OPEN',
      labels: [{ name: 'priority: high' }],
      assignees: [{ login: 'BradGroux' }],
      author: { login: 'BradGroux' },
      createdAt: '2026-06-20T12:00:00.000Z',
      updatedAt: '2026-06-25T12:00:00.000Z',
      url: 'https://github.com/BradGroux/veritas-kanban/pull/901',
      isDraft: false,
      reviewDecision: 'APPROVED',
      statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'SUCCESS' }],
    },
    {
      number: 902,
      title: 'Draft pull request',
      state: 'OPEN',
      labels: [{ name: 'priority: high' }],
      assignees: [],
      author: { login: 'BradGroux' },
      createdAt: '2026-06-20T12:00:00.000Z',
      updatedAt: '2026-06-26T12:00:00.000Z',
      url: 'https://github.com/BradGroux/veritas-kanban/pull/902',
      isDraft: true,
      reviewDecision: '',
      statusCheckRollup: [],
    },
  ];
}

function workflowDefinition() {
  return {
    id: 'queue-intake-workflow',
    name: 'Queue Intake Workflow',
    version: 1,
    description: 'Handle selected queue item.',
    agents: [
      {
        id: 'coordinator',
        name: 'Coordinator',
        role: 'general',
        description: 'Coordinates queue work.',
      },
    ],
    steps: [
      {
        id: 'plan',
        name: 'Plan',
        type: 'agent',
        agent: 'coordinator',
        input: 'Plan selected work.',
      },
    ],
  };
}
