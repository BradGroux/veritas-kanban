import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import {
  AgentRunTimelinePanel,
  buildAgentRunTimelineEvents,
  getTimelineEventType,
  redactTimelineText,
} from '@/components/task/AgentRunTimelinePanel';
import { createMockTask, renderWithProviders } from './test-utils';
import type {
  AgentRunTrace,
  AnyTelemetryEvent,
  Task,
  WorkProductPreview,
} from '@veritas-kanban/shared';

const mocks = vi.hoisted(() => ({
  onOpenTab: vi.fn(),
  onOpenWorkflow: vi.fn(),
  useAgentRunTraces: vi.fn(),
  useActiveRuns: vi.fn(),
  usePendingAgentApprovals: vi.fn(),
  useRecentRuns: vi.fn(),
  useTaskTelemetryEvents: vi.fn(),
  useTaskNotifications: vi.fn(),
  useTaskWorkProducts: vi.fn(),
}));

vi.mock('@/hooks/useAgentRunTimeline', () => ({
  useAgentRunTraces: mocks.useAgentRunTraces,
  useTaskTelemetryEvents: mocks.useTaskTelemetryEvents,
}));

vi.mock('@/hooks/useAgent', () => ({
  usePendingAgentApprovals: mocks.usePendingAgentApprovals,
}));

vi.mock('@/hooks/useNotifications', () => ({
  useTaskNotifications: mocks.useTaskNotifications,
}));

vi.mock('@/hooks/useWorkProducts', () => ({
  useTaskWorkProducts: mocks.useTaskWorkProducts,
}));

vi.mock('@/hooks/useWorkflowStats', () => ({
  useActiveRuns: mocks.useActiveRuns,
  useRecentRuns: mocks.useRecentRuns,
}));

const task: Task = createMockTask({
  id: 'task-timeline',
  title: 'Implement run timeline',
  description: 'Render stored agent run events with replay metadata and safe redaction.',
  type: 'code',
  status: 'in-progress',
  priority: 'high',
  agent: 'veritas',
  git: {
    repo: 'BradGroux/veritas-kanban',
    branch: 'v5-agent-run-timeline-replay',
    baseBranch: 'main',
    worktreePath: '/tmp/veritas-worktree',
  },
  attempt: {
    id: 'attempt-1',
    agent: 'veritas',
    status: 'complete',
    model: 'gpt-5',
    provider: 'openai',
    started: '2026-06-01T10:00:00.000Z',
    ended: '2026-06-01T10:05:00.000Z',
  },
  review: {
    decision: 'approved',
    decidedAt: '2026-06-01T10:07:00.000Z',
    summary: 'Ready to merge',
  },
  reviewComments: [
    {
      id: 'comment-1',
      file: 'web/src/App.tsx',
      line: 42,
      content: 'Check the timeline entry point',
      created: '2026-06-01T10:08:00.000Z',
    },
  ],
  qaGate: {
    required: true,
    passed: false,
  },
  deliverables: [
    {
      id: 'deliverable-1',
      title: 'Replay evidence log',
      type: 'document',
      path: 'reports/replay.md',
      status: 'attached',
      agent: 'veritas',
      sourceRunId: 'attempt-1',
      version: 1,
      created: '2026-06-01T10:06:20.000Z',
      description: 'Timeline replay evidence',
    },
  ],
  verificationSteps: [{ id: 'verify-1', description: 'Run tests', checked: true }],
});

const trace: AgentRunTrace = {
  traceId: 'attempt-1',
  taskId: 'task-timeline',
  agent: 'veritas',
  project: 'veritas',
  startedAt: '2026-06-01T10:00:00.000Z',
  endedAt: '2026-06-01T10:05:00.000Z',
  totalDurationMs: 300000,
  status: 'completed',
  metadata: {
    clientSource: 'agent-service',
    mode: 'eng-review',
    capabilitySet: ['start', 'status', 'logs', 'complete'],
    workspaceId: 'local',
    runKey: 'attempt-1',
    policyProfile: 'codex-cli:workspace-write',
    provider: 'codex-cli',
    model: 'gpt-5',
    repo: 'BradGroux/veritas-kanban',
    branch: 'v5-agent-run-timeline-replay',
  },
  steps: [
    {
      type: 'init',
      sequence: 1,
      startedAt: '2026-06-01T10:00:01.000Z',
      endedAt: '2026-06-01T10:00:02.000Z',
      durationMs: 1000,
      metadata: { provider: 'codex-cli' },
    },
    {
      type: 'execute',
      sequence: 2,
      startedAt: '2026-06-01T10:01:00.000Z',
      endedAt: '2026-06-01T10:01:05.000Z',
      durationMs: 5000,
      metadata: {
        eventType: 'command.completed',
        summary: 'pnpm test TOKEN=super-secret-token',
      },
    },
    {
      type: 'execute',
      sequence: 3,
      startedAt: '2026-06-01T10:02:00.000Z',
      endedAt: '2026-06-01T10:02:02.000Z',
      durationMs: 2000,
      metadata: {
        eventType: 'item.completed',
        tool: 'file_change',
        files: ['web/src/components/task/AgentRunTimelinePanel.tsx'],
      },
    },
    {
      type: 'stream',
      sequence: 4,
      startedAt: '2026-06-01T10:02:10.000Z',
      endedAt: '2026-06-01T10:02:11.000Z',
      durationMs: 1000,
      metadata: {
        eventType: 'stream.stdout',
        stream: 'stdout',
        summary: 'Running pnpm test with redacted output',
        chunkBytes: 42,
      },
    },
    {
      type: 'retry',
      sequence: 5,
      startedAt: '2026-06-01T10:02:20.000Z',
      endedAt: '2026-06-01T10:02:20.000Z',
      durationMs: 0,
      metadata: {
        eventType: 'turn.retrying',
        summary: 'Retrying after transient provider failure',
        retryAttempt: 2,
        retryDelayMs: 1250,
      },
    },
    {
      type: 'finalize',
      sequence: 6,
      startedAt: '2026-06-01T10:04:59.000Z',
      endedAt: '2026-06-01T10:05:00.000Z',
      durationMs: 1000,
      metadata: {
        eventType: 'run.finalizing',
        exitCode: 0,
        success: true,
      },
    },
    {
      type: 'complete',
      sequence: 7,
      startedAt: '2026-06-01T10:05:00.000Z',
      endedAt: '2026-06-01T10:05:00.000Z',
      durationMs: 0,
      metadata: {
        eventType: 'turn.completed',
        summary: 'Timeline replay captured with final result evidence.',
        finalResult: 'Timeline replay captured with final result evidence.',
      },
    },
  ],
};

const telemetryEvents: AnyTelemetryEvent[] = [
  {
    id: 'evt-start',
    type: 'run.started',
    timestamp: '2026-06-01T10:00:00.000Z',
    taskId: 'task-timeline',
    agent: 'veritas',
    model: 'gpt-5',
    attemptId: 'attempt-1',
  },
  {
    id: 'evt-tokens',
    type: 'run.tokens',
    timestamp: '2026-06-01T10:04:00.000Z',
    taskId: 'task-timeline',
    agent: 'veritas',
    model: 'gpt-5',
    inputTokens: 1200,
    outputTokens: 800,
    totalTokens: 2000,
    cost: 0.14,
    attemptId: 'attempt-1',
  },
  {
    id: 'evt-completed',
    type: 'run.completed',
    timestamp: '2026-06-01T10:05:00.000Z',
    taskId: 'task-timeline',
    agent: 'veritas',
    durationMs: 300000,
    success: true,
    attemptId: 'attempt-1',
  },
];

const product: WorkProductPreview = {
  id: 'wp-timeline',
  workspaceId: 'local',
  kind: 'report',
  title: 'Run replay report',
  status: 'active',
  version: 2,
  taskId: 'task-timeline',
  sourceRunId: 'attempt-1',
  agent: 'veritas',
  model: 'gpt-5',
  sourceLinks: [{ label: 'Source run', href: '/runs/attempt-1', type: 'run' }],
  redacted: true,
  snippet: 'Replay summary',
  createdAt: '2026-06-01T10:06:00.000Z',
  updatedAt: '2026-06-01T10:06:30.000Z',
};

const approval = {
  id: 'approval-1',
  agentId: 'veritas',
  action: 'write_file',
  taskId: 'task-timeline',
  details: 'Needs permission to update replay docs',
  status: 'pending' as const,
  createdAt: '2026-06-01T10:02:00.000Z',
};

const notification = {
  id: 'notification-1',
  taskId: 'task-timeline',
  targetAgent: 'veritas',
  fromAgent: 'system',
  content: 'Run replay needs review',
  type: 'review_needed',
  title: 'Timeline notification',
  delivered: false,
  createdAt: '2026-06-01T10:06:45.000Z',
  targetUrl: 'veritas://task/task-timeline?tab=timeline&attempt=attempt-1',
  source: { attemptId: 'attempt-1' },
};

const workflowRun = {
  id: 'workflow-run-1',
  workflowId: 'wf-release',
  workflowVersion: 1,
  taskId: 'task-timeline',
  status: 'blocked' as const,
  currentStep: 'approval',
  context: { attemptId: 'attempt-1', taskId: 'task-timeline' },
  startedAt: '2026-06-01T10:03:00.000Z',
  lastCheckpoint: '2026-06-01T10:03:30.000Z',
  steps: [
    {
      stepId: 'approval',
      status: 'failed',
      agent: 'veritas',
      retries: 1,
      error: 'Approval required',
    },
  ],
};

describe('agent run timeline Mantine surface', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useAgentRunTraces.mockReturnValue({ data: [trace], isLoading: false });
    mocks.useActiveRuns.mockReturnValue({ data: [workflowRun], isLoading: false });
    mocks.usePendingAgentApprovals.mockReturnValue({ data: [approval], isLoading: false });
    mocks.useRecentRuns.mockReturnValue({ data: [], isLoading: false });
    mocks.useTaskTelemetryEvents.mockReturnValue({ data: telemetryEvents, isLoading: false });
    mocks.useTaskNotifications.mockReturnValue({ data: [notification], isLoading: false });
    mocks.useTaskWorkProducts.mockReturnValue({ data: [product], isLoading: false });
  });

  afterEach(() => {
    cleanup();
  });

  it('builds chronological timeline events with trace, telemetry, and work product context', () => {
    const events = buildAgentRunTimelineEvents({
      task,
      approvals: [approval],
      notifications: [notification],
      traces: [trace],
      telemetryEvents,
      workflowRuns: [workflowRun],
      workProducts: [product],
      selectedAttemptId: 'attempt-1',
    });

    expect(events.map((event) => event.sequence)).toEqual(events.map((_, index) => index + 1));
    expect(events.some((event) => event.type === 'prompt')).toBe(true);
    expect(events.some((event) => event.type === 'command')).toBe(true);
    expect(events.some((event) => event.type === 'file')).toBe(true);
    expect(events.some((event) => event.type === 'usage')).toBe(true);
    expect(events.some((event) => event.title.includes('Work product saved'))).toBe(true);
    expect(events.some((event) => event.title.includes('Permission pending'))).toBe(true);
    expect(events.some((event) => event.title.includes('Workflow blocked'))).toBe(true);
    expect(events.some((event) => event.title.includes('Deliverable attached'))).toBe(true);
    expect(events.some((event) => event.title.includes('Timeline notification'))).toBe(true);
    expect(events.some((event) => event.title.includes('stream.stdout'))).toBe(true);
    expect(events.some((event) => event.title.includes('turn.retrying'))).toBe(true);
    expect(events.some((event) => event.title.includes('run.finalizing'))).toBe(true);
    expect(getTimelineEventType('execute', { eventType: 'tool.progress' })).toBe('tool');
    expect(getTimelineEventType('stream', { eventType: 'stream.stdout' })).toBe('command');
    expect(getTimelineEventType('retry', { eventType: 'turn.retrying' })).toBe('tool');
    expect(getTimelineEventType('abort', { eventType: 'run.aborted' })).toBe('error');
    expect(getTimelineEventType('finalize', { eventType: 'run.finalizing' })).toBe('result');
    expect(getTimelineEventType('error', { summary: 'failed' })).toBe('error');
  });

  it('redacts sensitive values before rendering timeline metadata', () => {
    const redacted = redactTimelineText(
      'Authorization: Bearer abc123supersecret OPENAI_API_KEY=sk-supersecret123456'
    );

    expect(redacted).toContain('[REDACTED]');
    expect(redacted).toContain('OPENAI_API_KEY=[REDACTED]');
    expect(redacted).not.toContain('abc123supersecret');
    expect(redacted).not.toContain('sk-supersecret123456');
  });

  it('falls back to internal links when derived external targets are not http urls', () => {
    const events = buildAgentRunTimelineEvents({
      task,
      notifications: [
        {
          ...notification,
          id: 'notification-unsafe',
          targetUrl: 'javascript:alert(1)',
        },
      ],
      traces: [],
      telemetryEvents: [],
      workProducts: [
        {
          ...product,
          id: 'wp-unsafe',
          sourceLinks: [{ label: 'Unsafe source', href: 'javascript:alert(1)', type: 'url' }],
        },
      ],
      selectedAttemptId: 'attempt-1',
    });

    expect(events.find((event) => event.id === 'work-product-wp-unsafe')?.link).toMatchObject({
      target: 'work-products',
    });
    expect(
      events.find((event) => event.id === 'notification-notification-unsafe')?.link
    ).toMatchObject({
      target: 'agent',
    });

    const deepLinkEvents = buildAgentRunTimelineEvents({
      task,
      notifications: [
        {
          ...notification,
          id: 'notification-deeplink',
        },
      ],
      traces: [],
      telemetryEvents: [],
      workProducts: [],
      selectedAttemptId: 'attempt-1',
    });

    expect(
      deepLinkEvents.find((event) => event.id === 'notification-notification-deeplink')?.link
    ).toMatchObject({
      href: 'veritas://task/task-timeline?tab=timeline&attempt=attempt-1',
      target: 'external',
    });
  });

  it('renders run replay controls, filters by event type, and links back to task surfaces', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <AgentRunTimelinePanel
        task={task}
        onOpenTab={mocks.onOpenTab}
        onOpenWorkflow={mocks.onOpenWorkflow}
      />
    );

    expect(screen.getByText('Run Timeline')).toBeDefined();
    expect(screen.getByText('Stored replay')).toBeDefined();
    expect(screen.getByText('command.completed')).toBeDefined();
    expect(screen.getByText('stream.stdout')).toBeDefined();
    expect(screen.getByText('turn.retrying')).toBeDefined();
    expect(screen.getByText('run.finalizing')).toBeDefined();
    expect(
      screen.getAllByText('Timeline replay captured with final result evidence.').length
    ).toBeGreaterThan(0);
    expect(screen.getByText('2,000 tokens / $0.14')).toBeDefined();
    expect(screen.getByText('5m 0s')).toBeDefined();
    expect(screen.getByText('Run replay report')).toBeDefined();
    expect(screen.getByText('Timeline notification')).toBeDefined();
    expect(screen.getByText('Workflow blocked: wf-release')).toBeDefined();
    expect(screen.getByText('Deliverable attached: Replay evidence log')).toBeDefined();
    expect(screen.queryByText('super-secret-token')).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Agent logs' }).length).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: 'Workflow run' }));

    expect(mocks.onOpenWorkflow).toHaveBeenCalledWith('workflow-run-1');

    await user.click(screen.getByRole('button', { name: 'Usage' }));

    expect(screen.getByText('Token usage recorded')).toBeDefined();
    expect(screen.queryByText('command.completed')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Work Products' }));

    expect(mocks.onOpenTab).toHaveBeenCalledWith('work-products');
  });

  it('pages long timelines so replay rendering stays bounded', async () => {
    const user = userEvent.setup();
    const longTrace: AgentRunTrace = {
      ...trace,
      steps: Array.from({ length: 140 }, (_, index) => ({
        type: 'execute',
        sequence: index + 1,
        startedAt: new Date(Date.UTC(2026, 5, 1, 10, index)).toISOString(),
        metadata: {
          eventType: `tool.progress.${index + 1}`,
          summary: `Progress event ${index + 1}`,
        },
      })),
    };
    mocks.useAgentRunTraces.mockReturnValue({ data: [longTrace], isLoading: false });
    mocks.useActiveRuns.mockReturnValue({ data: [], isLoading: false });
    mocks.usePendingAgentApprovals.mockReturnValue({ data: [], isLoading: false });
    mocks.useRecentRuns.mockReturnValue({ data: [], isLoading: false });
    mocks.useTaskTelemetryEvents.mockReturnValue({ data: [], isLoading: false });
    mocks.useTaskNotifications.mockReturnValue({ data: [], isLoading: false });
    mocks.useTaskWorkProducts.mockReturnValue({ data: [], isLoading: false });

    renderWithProviders(<AgentRunTimelinePanel task={task} onOpenTab={mocks.onOpenTab} />);

    expect(screen.getByText('Showing 80 of 149 filtered events.')).toBeDefined();
    expect(screen.getByText('Progress event 1')).toBeDefined();
    expect(screen.queryByText('Progress event 140')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Load 69 more' }));

    expect(screen.getByText('Showing 149 of 149 filtered events.')).toBeDefined();
    expect(screen.getByText('Progress event 140')).toBeDefined();
  });
});
