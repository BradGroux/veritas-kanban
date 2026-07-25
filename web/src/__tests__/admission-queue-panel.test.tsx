import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  ADMISSION_QUEUE_INSPECTION_SCHEMA_VERSION,
  ADMISSION_QUEUE_LIST_SCHEMA_VERSION,
  EXECUTION_TREE_IDENTITY_SCHEMA_VERSION,
  type AdmissionQueueInspectionEntry,
  type AdmissionQueueListResponse,
} from '@veritas-kanban/shared';
import { AdmissionQueuePanel } from '@/components/digest/AdmissionQueuePanel';
import { renderWithProviders } from './test-utils';

const mocks = vi.hoisted(() => ({
  useAdmissionQueue: vi.fn(),
  refetch: vi.fn(),
}));

vi.mock('@/hooks/useAdmissionQueue', () => ({
  useAdmissionQueue: mocks.useAdmissionQueue,
}));

const entries: AdmissionQueueInspectionEntry[] = [
  {
    schemaVersion: ADMISSION_QUEUE_INSPECTION_SCHEMA_VERSION,
    id: 'queue-secret-id-root',
    state: 'queued',
    position: 1,
    rawPriority: 4,
    effectivePriority: 6,
    agePromotion: 2,
    ageMs: 7_500_000,
    readiness: 'conditional',
    lease: { posture: 'none' },
    limitingPolicies: [
      {
        scope: 'workspace',
        scopeKey: 'redacted-workspace-key',
        limits: { concurrentRuns: 2 },
      },
    ],
    conditionalStartFactors: ['capacity-available', 'policy-recheck'],
    launch: {
      source: 'direct',
      target: 'direct',
      workspaceId: 'workspace-a',
      taskKey: 'redacted-task-key',
      rootTaskKey: 'redacted-root-key',
      workspaceKey: 'redacted-workspace-key',
      provider: 'codex-cli',
      hostKey: 'redacted-host-key',
      rootObjectiveKey: 'redacted-objective-key',
      nodeKey: 'redacted-node-key',
    },
    navigation: {
      taskId: 'task-a',
      attemptId: 'attempt-a',
      executionTree: {
        schemaVersion: EXECUTION_TREE_IDENTITY_SCHEMA_VERSION,
        rootObjectiveId: 'objective-a',
        nodeId: 'node-root',
        edge: 'root',
        depth: 0,
      },
    },
    retry: {
      count: 0,
      maximum: 3,
      availableAt: '2026-07-25T20:00:00.000Z',
    },
    createdAt: '2026-07-25T19:00:00.000Z',
    updatedAt: '2026-07-25T20:00:00.000Z',
  },
  {
    schemaVersion: ADMISSION_QUEUE_INSPECTION_SCHEMA_VERSION,
    id: 'queue-secret-id-child',
    state: 'leased',
    position: 2,
    rawPriority: 8,
    effectivePriority: 8,
    agePromotion: 0,
    ageMs: 600_000,
    readiness: 'reserved',
    lease: {
      posture: 'active',
      expiresAt: '2026-07-25T20:10:00.000Z',
    },
    limitingPolicies: [
      {
        scope: 'global',
        scopeKey: 'redacted-global-key',
        limits: { concurrentRuns: 4 },
      },
    ],
    conditionalStartFactors: ['active-reservation-release'],
    launch: {
      source: 'workflow',
      target: 'workflow-step',
      workspaceId: 'workspace-b',
      taskKey: 'redacted-task-key',
      rootTaskKey: 'redacted-root-key',
      workspaceKey: 'redacted-workspace-key',
      provider: 'workflow-control',
      hostKey: 'redacted-host-key',
      workflowRunKey: 'redacted-run-key',
      workflowStepKey: 'redacted-step-key',
      rootObjectiveKey: 'redacted-objective-key',
      nodeKey: 'redacted-node-key',
    },
    navigation: {
      taskId: 'task-b',
      attemptId: 'attempt-b',
      workflowId: 'workflow-a',
      workflowRunId: 'run-a',
      workflowStepId: 'step-a',
      executionTree: {
        schemaVersion: EXECUTION_TREE_IDENTITY_SCHEMA_VERSION,
        rootObjectiveId: 'objective-a',
        nodeId: 'node-child',
        parentNodeId: 'node-root',
        edge: 'workflow-step',
        depth: 1,
      },
    },
    retry: {
      count: 1,
      maximum: 3,
      availableAt: '2026-07-25T20:00:00.000Z',
    },
    createdAt: '2026-07-25T19:50:00.000Z',
    updatedAt: '2026-07-25T20:00:00.000Z',
  },
];

const response: AdmissionQueueListResponse = {
  schemaVersion: ADMISSION_QUEUE_LIST_SCHEMA_VERSION,
  generatedAt: '2026-07-25T20:00:00.000Z',
  conditional: true,
  depth: {
    global: { current: 2, limit: 2 },
    workspaces: [
      {
        workspaceId: 'workspace-a',
        workspaceKey: 'redacted-workspace-a',
        current: 2,
        limit: 2,
      },
      {
        workspaceId: 'workspace-b',
        workspaceKey: 'redacted-workspace-b',
        current: 1,
        limit: 3,
      },
    ],
  },
  pagination: {
    page: 1,
    limit: 100,
    total: 103,
    hasMore: true,
    snapshotTruncated: true,
  },
  entries,
};

function queueResult(overrides: Record<string, unknown> = {}) {
  return {
    data: response,
    error: null,
    isLoading: false,
    isFetching: false,
    isStale: false,
    refetch: mocks.refetch,
    ...overrides,
  };
}

describe('AdmissionQueuePanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.refetch.mockResolvedValue({});
    mocks.useAdmissionQueue.mockReturnValue(queueResult());
  });

  afterEach(() => cleanup());

  it('shows bounded saturation, queue context, and safe drilldowns', async () => {
    const user = userEvent.setup();
    const onTaskClick = vi.fn();
    const onWorkflowClick = vi.fn();
    const { container } = renderWithProviders(
      <AdmissionQueuePanel onTaskClick={onTaskClick} onWorkflowClick={onWorkflowClick} />
    );

    expect(screen.getByRole('heading', { name: 'Admission Runway' })).toBeDefined();
    expect(screen.getByText('Saturated')).toBeDefined();
    expect(screen.getByText('Partial view')).toBeDefined();
    expect(screen.getByText('Conditional, no start-time promise')).toBeDefined();
    expect(screen.getByText('Root')).toBeDefined();
    expect(screen.getByText('Descendant · depth 1')).toBeDefined();
    expect(screen.getAllByText('workspace-a').length).toBeGreaterThan(0);
    expect(
      screen
        .getByRole('progressbar', { name: 'Global admission queue capacity' })
        .getAttribute('aria-valuenow')
    ).toBe('2');

    await user.click(screen.getByRole('button', { name: 'Open attempt at queue position 1' }));
    expect(onTaskClick).toHaveBeenCalledWith('task-a', {
      tab: 'timeline',
      timelineAttemptId: 'attempt-a',
    });

    await user.click(screen.getByRole('button', { name: 'Open workflow for queue position 2' }));
    expect(onWorkflowClick).toHaveBeenCalledWith('workflow-a');

    expect(container.textContent).not.toContain('queue-secret-id-root');
    expect(container.textContent).not.toContain('redacted-workspace-key');
  });

  it('renders an explicit loading state', () => {
    mocks.useAdmissionQueue.mockReturnValue(
      queueResult({ data: undefined, isLoading: true, isFetching: true })
    );
    renderWithProviders(<AdmissionQueuePanel />);
    expect(screen.getByText('Loading bounded admission queue…')).toBeDefined();
  });

  it('renders an explicit empty state', () => {
    mocks.useAdmissionQueue.mockReturnValue(
      queueResult({
        data: {
          ...response,
          depth: { global: { current: 0, limit: 50 }, workspaces: [] },
          pagination: {
            ...response.pagination,
            total: 0,
            hasMore: false,
            snapshotTruncated: false,
          },
          entries: [],
        },
      })
    );
    renderWithProviders(<AdmissionQueuePanel />);
    expect(screen.getByText('Admission runway is clear')).toBeDefined();
  });

  it('keeps cached data visible when refresh fails', () => {
    mocks.useAdmissionQueue.mockReturnValue(
      queueResult({ error: new Error('Temporary connection failure'), isStale: true })
    );
    renderWithProviders(<AdmissionQueuePanel />);
    expect(screen.getByText('Stale snapshot')).toBeDefined();
    expect(screen.getByText(/Showing the last available bounded snapshot/)).toBeDefined();
    expect(screen.getByText('Root')).toBeDefined();
  });

  it('renders a recoverable error when no snapshot is available', async () => {
    const user = userEvent.setup();
    mocks.useAdmissionQueue.mockReturnValue(
      queueResult({
        data: undefined,
        error: new Error('Admission service unavailable'),
      })
    );
    renderWithProviders(<AdmissionQueuePanel />);
    expect(screen.getByText('Admission queue unavailable')).toBeDefined();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(mocks.refetch).toHaveBeenCalledOnce();
  });
});
