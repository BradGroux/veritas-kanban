import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { RunSessionEvent, RunSessionShare } from '@veritas-kanban/shared';

import {
  RunSessionShareView,
  RunSessionSharesSection,
} from '@/components/task/RunSessionSharesSection';
import { createMockTask, renderWithProviders } from './test-utils';

const mocks = vi.hoisted(() => ({
  useRunSessions: vi.fn(),
  useRunSession: vi.fn(),
  useRunSessionEvents: vi.fn(),
  useRunSessionEventStream: vi.fn(),
  createShareMutateAsync: vi.fn(),
  updateShareMutate: vi.fn(),
  revokeShareMutate: vi.fn(),
  sendMessageMutateAsync: vi.fn(),
  approvalMutateAsync: vi.fn(),
  forkMutateAsync: vi.fn(),
  useAgentStream: vi.fn(),
  toast: vi.fn(),
  identity: {
    authContext: { clientMode: 'desktop' },
  },
}));

vi.mock('@/hooks/useRunSessions', () => ({
  useRunSessions: mocks.useRunSessions,
  useRunSession: mocks.useRunSession,
  useRunSessionEvents: mocks.useRunSessionEvents,
  useRunSessionEventStream: mocks.useRunSessionEventStream,
  useCreateRunSessionShare: () => ({
    mutateAsync: mocks.createShareMutateAsync,
    isPending: false,
  }),
  useUpdateRunSessionShare: () => ({
    mutate: mocks.updateShareMutate,
    isPending: false,
  }),
  useRevokeRunSessionShare: () => ({
    mutate: mocks.revokeShareMutate,
    isPending: false,
  }),
  useSendRunSessionMessage: () => ({
    mutateAsync: mocks.sendMessageMutateAsync,
    isPending: false,
  }),
  useRunSessionApprovalResponse: () => ({
    mutateAsync: mocks.approvalMutateAsync,
    isPending: false,
  }),
  useForkRunSession: () => ({
    mutateAsync: mocks.forkMutateAsync,
    isPending: false,
  }),
}));

vi.mock('@/hooks/useAgent', () => ({
  useAgentStream: mocks.useAgentStream,
}));

vi.mock('@/hooks/useToast', () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

vi.mock('@/hooks/useIdentity', () => ({
  useIdentity: () => mocks.identity,
}));

const baseShare: RunSessionShare = {
  id: 'run_share_721',
  workspaceId: 'local',
  taskId: 'task-721',
  sourceType: 'task-agent',
  sourceId: 'attempt-721',
  permission: 'view',
  status: 'active',
  createdAt: '2026-06-18T10:00:00.000Z',
  updatedAt: '2026-06-18T10:00:00.000Z',
  createdBy: { id: 'user-1', label: 'Brad', workspaceId: 'local' },
  actorLabel: 'Reviewer',
  stablePath: '/runs/shared/run_share_721',
  mobileSafeApprovalClasses: ['human-review'],
  snapshot: {
    running: true,
    taskTitle: 'Shared live sessions',
    attemptId: 'attempt-721',
    attemptStatus: 'running',
    agent: 'codex',
    model: 'gpt-5',
    startedAt: '2026-06-18T10:00:00.000Z',
  },
  forkedTaskIds: [],
};

const event: RunSessionEvent = {
  id: 'run_event_msg',
  shareId: baseShare.id,
  taskId: baseShare.taskId,
  attemptId: baseShare.snapshot.attemptId,
  type: 'message.sent',
  actor: { id: 'editor-1', label: 'Pair Editor', workspaceId: 'local' },
  createdAt: '2026-06-18T10:02:00.000Z',
  message: 'Continue the run',
};

describe('run session share Mantine surfaces', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useRunSessions.mockReturnValue({ data: [baseShare], isLoading: false });
    mocks.useRunSession.mockReturnValue({ data: baseShare, isLoading: false, error: null });
    mocks.useRunSessionEvents.mockReturnValue({ data: [event], isLoading: false });
    mocks.useAgentStream.mockReturnValue({
      outputs: [
        {
          type: 'stdout',
          content: 'agent streamed output',
          timestamp: '2026-06-18T10:01:00.000Z',
        },
      ],
      isConnected: true,
      isRunning: true,
      clearOutputs: vi.fn(),
    });
    mocks.createShareMutateAsync.mockResolvedValue(baseShare);
    mocks.sendMessageMutateAsync.mockResolvedValue(event);
    mocks.approvalMutateAsync.mockResolvedValue({
      ...event,
      type: 'approval.responded',
      actionClass: 'human-review',
      approvalResponse: 'approved',
    });
    mocks.forkMutateAsync.mockResolvedValue({
      fork: { id: 'run_fork_721' },
      task: { id: 'task-721-fork', title: 'Forked task' },
    });
    mocks.identity.authContext = { clientMode: 'desktop' };
  });

  afterEach(() => {
    cleanup();
  });

  it('creates links, upgrades view-only shares, and revokes active shares from task detail', async () => {
    const user = userEvent.setup();
    const task = createMockTask({ id: 'task-721', title: 'Shared live sessions' });

    renderWithProviders(<RunSessionSharesSection task={task} isAgentRunning />);

    expect(screen.getByText('Shared Live Sessions')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Create Link' }));
    expect(mocks.createShareMutateAsync).toHaveBeenCalledWith({
      taskId: 'task-721',
      permission: 'view',
      mobileSafeApprovalClasses: ['human-review', 'task-comment', 'low-risk'],
    });

    await user.click(screen.getByRole('button', { name: 'Co-drive' }));
    expect(mocks.updateShareMutate).toHaveBeenCalledWith({
      shareId: 'run_share_721',
      input: { permission: 'edit' },
    });

    await user.click(screen.getByRole('button', { name: 'Revoke' }));
    expect(mocks.revokeShareMutate).toHaveBeenCalledWith({ shareId: 'run_share_721' });
  });

  it('renders a view-only shared session without edit or fork controls', () => {
    renderWithProviders(<RunSessionShareView shareId="run_share_721" />);

    expect(screen.getByText('Shared live sessions')).toBeTruthy();
    expect(screen.getByText('agent streamed output')).toBeTruthy();
    expect(screen.getByText('message.sent')).toBeTruthy();
    expect(screen.queryByText('Co-drive Message')).toBeNull();
    expect(screen.queryByText('Fork Session')).toBeNull();
  });

  it('sends attributed co-drive messages and mobile-safe approval responses', async () => {
    const user = userEvent.setup();
    mocks.identity.authContext = { clientMode: 'mobile-pwa' };
    mocks.useRunSession.mockReturnValue({
      data: { ...baseShare, permission: 'edit' },
      isLoading: false,
      error: null,
    });

    renderWithProviders(<RunSessionShareView shareId="run_share_721" />);

    await user.type(
      screen.getByPlaceholderText('Send an attributed message into the run...'),
      'Run the narrow verification gate'
    );
    await user.click(screen.getByRole('button', { name: 'Send Message' }));
    expect(mocks.sendMessageMutateAsync).toHaveBeenCalledWith({
      shareId: 'run_share_721',
      input: { message: 'Run the narrow verification gate' },
    });

    expect(
      screen.getByText(
        'Mobile clients can respond only to classes marked mobile-safe for this share.'
      )
    ).toBeTruthy();
    await user.type(screen.getByLabelText('Note'), 'Looks safe from mobile');
    await user.click(screen.getByRole('button', { name: 'Approve' }));

    await waitFor(() =>
      expect(mocks.approvalMutateAsync).toHaveBeenCalledWith({
        shareId: 'run_share_721',
        input: {
          actionClass: 'human-review',
          response: 'approved',
          note: 'Looks safe from mobile',
        },
      })
    );
  });

  it('forks a fork-permission share without enabling co-drive controls', async () => {
    const user = userEvent.setup();
    mocks.useRunSession.mockReturnValue({
      data: { ...baseShare, permission: 'fork' },
      isLoading: false,
      error: null,
    });

    renderWithProviders(<RunSessionShareView shareId="run_share_721" />);

    expect(screen.queryByText('Co-drive Message')).toBeNull();
    await user.type(screen.getByLabelText('Fork task title'), 'Continue in a clean fork');
    await user.click(screen.getByRole('button', { name: 'Create Fork' }));

    expect(mocks.forkMutateAsync).toHaveBeenCalledWith({
      shareId: 'run_share_721',
      input: {
        title: 'Continue in a clean fork',
        reason: 'Forked from shared live run session.',
      },
    });
  });
});
