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
  useAgentRunTraces: vi.fn(),
  useTaskTelemetryEvents: vi.fn(),
  useTaskWorkProducts: vi.fn(),
}));

vi.mock('@/hooks/useAgentRunTimeline', () => ({
  useAgentRunTraces: mocks.useAgentRunTraces,
  useTaskTelemetryEvents: mocks.useTaskTelemetryEvents,
}));

vi.mock('@/hooks/useWorkProducts', () => ({
  useTaskWorkProducts: mocks.useTaskWorkProducts,
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

describe('agent run timeline Mantine surface', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useAgentRunTraces.mockReturnValue({ data: [trace], isLoading: false });
    mocks.useTaskTelemetryEvents.mockReturnValue({ data: telemetryEvents, isLoading: false });
    mocks.useTaskWorkProducts.mockReturnValue({ data: [product], isLoading: false });
  });

  afterEach(() => {
    cleanup();
  });

  it('builds chronological timeline events with trace, telemetry, and work product context', () => {
    const events = buildAgentRunTimelineEvents({
      task,
      traces: [trace],
      telemetryEvents,
      workProducts: [product],
      selectedAttemptId: 'attempt-1',
    });

    expect(events.map((event) => event.sequence)).toEqual(events.map((_, index) => index + 1));
    expect(events.some((event) => event.type === 'prompt')).toBe(true);
    expect(events.some((event) => event.type === 'command')).toBe(true);
    expect(events.some((event) => event.type === 'usage')).toBe(true);
    expect(events.some((event) => event.title.includes('Work product saved'))).toBe(true);
    expect(getTimelineEventType('execute', { eventType: 'tool.progress' })).toBe('tool');
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

  it('renders run replay controls, filters by event type, and links back to task surfaces', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AgentRunTimelinePanel task={task} onOpenTab={mocks.onOpenTab} />);

    expect(screen.getByText('Run Timeline')).toBeDefined();
    expect(screen.getByText('Stored replay')).toBeDefined();
    expect(screen.getByText('command.completed')).toBeDefined();
    expect(screen.getByText('Run replay report')).toBeDefined();
    expect(screen.queryByText('super-secret-token')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Usage' }));

    expect(screen.getByText('Token usage recorded')).toBeDefined();
    expect(screen.queryByText('command.completed')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Work Products' }));

    expect(mocks.onOpenTab).toHaveBeenCalledWith('work-products');
  });
});
