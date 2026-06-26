import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ActivityFeed } from '@/components/activity/ActivityFeed';
import { ChatPanel } from '@/components/chat/ChatPanel';
import { FloatingChat } from '@/components/chat/FloatingChat';
import { SquadChatPanel } from '@/components/chat/SquadChatPanel';
import { ActivitySidebar } from '@/components/layout/ActivitySidebar';
import { renderWithProviders } from './test-utils';

const mocks = vi.hoisted(() => ({
  clearActivities: vi.fn(),
  deleteChatSession: vi.fn(),
  refetchActivities: vi.fn(),
  sendChatMessage: vi.fn(),
  sendSquadMessage: vi.fn(),
  addSquadReaction: vi.fn(),
  markSquadRead: vi.fn(),
  updateSquadMessageState: vi.fn(),
  useActivities: vi.fn(),
  useActivityFeed: vi.fn(),
  useChatSession: vi.fn(),
  useChatSessions: vi.fn(),
  useChatStream: vi.fn(),
  useConfig: vi.fn(),
  useDailySummary: vi.fn(),
  useDeleteChatSession: vi.fn(),
  useFeatureSetting: vi.fn(),
  useSendChatMessage: vi.fn(),
  useSendSquadMessage: vi.fn(),
  useSquadSearch: vi.fn(),
  useSquadMessages: vi.fn(),
  useSquadStream: vi.fn(),
  useSquadUnread: vi.fn(),
  useStatusHistory: vi.fn(),
  useTask: vi.fn(),
}));

vi.mock('@/hooks/useActivity', () => ({
  useActivities: mocks.useActivities,
  useActivityFeed: mocks.useActivityFeed,
  useClearActivities: () => ({ mutate: mocks.clearActivities, isPending: false }),
}));

vi.mock('@/hooks/useChat', () => ({
  useChatSession: mocks.useChatSession,
  useChatSessions: mocks.useChatSessions,
  useChatStream: mocks.useChatStream,
  useDeleteChatSession: mocks.useDeleteChatSession,
  useSendChatMessage: mocks.useSendChatMessage,
  useSendSquadMessage: mocks.useSendSquadMessage,
  useAddSquadReaction: () => ({ mutate: mocks.addSquadReaction, isPending: false }),
  useMarkSquadRead: () => ({ mutate: mocks.markSquadRead, isPending: false }),
  useSquadMessages: mocks.useSquadMessages,
  useSquadSearch: mocks.useSquadSearch,
  useSquadStream: mocks.useSquadStream,
  useSquadUnread: mocks.useSquadUnread,
  useUpdateSquadMessageState: () => ({ mutate: mocks.updateSquadMessageState, isPending: false }),
}));

vi.mock('@/hooks/useConfig', () => ({
  useConfig: mocks.useConfig,
}));

vi.mock('@/hooks/useFeatureSettings', () => ({
  useFeatureSetting: mocks.useFeatureSetting,
}));

vi.mock('@/hooks/useStatusHistory', () => ({
  formatDurationMs: (ms: number) => `${Math.round(ms / 60000)}m`,
  getStatusColor: (status: string) => {
    if (status === 'working') return 'bg-green-500';
    if (status === 'idle') return 'bg-gray-500';
    return 'bg-blue-500';
  },
  useDailySummary: mocks.useDailySummary,
  useStatusHistory: mocks.useStatusHistory,
}));

vi.mock('@/hooks/useTasks', () => ({
  useTask: mocks.useTask,
}));

describe('activity and chat Mantine migration', () => {
  const originalScrollIntoView = Element.prototype.scrollIntoView;
  const originalHasPointerCapture = Element.prototype.hasPointerCapture;
  const originalSetPointerCapture = Element.prototype.setPointerCapture;
  const originalReleasePointerCapture = Element.prototype.releasePointerCapture;

  beforeAll(() => {
    Element.prototype.scrollIntoView = vi.fn();
    Element.prototype.hasPointerCapture = vi.fn(() => false);
    Element.prototype.setPointerCapture = vi.fn();
    Element.prototype.releasePointerCapture = vi.fn();
  });

  afterAll(() => {
    Element.prototype.scrollIntoView = originalScrollIntoView;
    Element.prototype.hasPointerCapture = originalHasPointerCapture;
    Element.prototype.setPointerCapture = originalSetPointerCapture;
    Element.prototype.releasePointerCapture = originalReleasePointerCapture;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    const now = new Date().toISOString();

    mocks.useActivities.mockReturnValue({
      data: [
        {
          id: 'activity-1',
          type: 'task_created',
          taskId: 'task-1',
          taskTitle: 'Draft launch checklist',
          timestamp: now,
          details: {},
        },
        {
          id: 'activity-2',
          type: 'status_changed',
          taskId: 'task-1',
          taskTitle: 'Draft launch checklist',
          timestamp: now,
          details: { status: 'done' },
        },
      ],
      isLoading: false,
      isRefetching: false,
      refetch: mocks.refetchActivities,
    });
    mocks.useActivityFeed.mockReturnValue({
      data: {
        pages: [
          [
            {
              id: 'activity-3',
              type: 'status_changed',
              taskId: 'task-2',
              taskTitle: 'Review release notes',
              timestamp: now,
              details: { from: 'todo', status: 'in-progress' },
            },
          ],
        ],
      },
      isLoading: false,
    });
    mocks.useDailySummary.mockReturnValue({
      data: {
        activeMs: 7_200_000,
        idleMs: 1_800_000,
        errorMs: 0,
      },
      isLoading: false,
    });
    mocks.useStatusHistory.mockReturnValue({
      data: [
        {
          id: 'status-1',
          timestamp: now,
          previousStatus: 'idle',
          newStatus: 'working',
          durationMs: 1_800_000,
        },
      ],
      isLoading: false,
    });
    mocks.useChatSessions.mockReturnValue({ data: [{ id: 'board-chat', taskId: undefined }] });
    mocks.useChatSession.mockImplementation((sessionId?: string) => ({
      data: sessionId
        ? {
            id: sessionId,
            messages: [
              {
                id: 'chat-1',
                role: 'assistant',
                content: 'Ready to help with the board.',
                timestamp: now,
              },
            ],
          }
        : undefined,
    }));
    mocks.useChatStream.mockReturnValue({ streamingMessage: null });
    mocks.useDeleteChatSession.mockReturnValue({
      mutate: mocks.deleteChatSession,
      isPending: false,
    });
    mocks.useSendChatMessage.mockReturnValue({
      mutate: mocks.sendChatMessage,
      isPending: false,
    });
    mocks.useSquadMessages.mockReturnValue({
      data: [
        {
          id: 'squad-1',
          agent: 'Human',
          message: 'Code review ready.',
          timestamp: now,
          system: false,
        },
      ],
      isLoading: false,
    });
    mocks.useSendSquadMessage.mockReturnValue({
      mutate: mocks.sendSquadMessage,
      isPending: false,
    });
    mocks.useSquadSearch.mockReturnValue({
      data: { query: '', results: [] },
    });
    mocks.useSquadStream.mockReturnValue({ newMessage: null });
    mocks.useSquadUnread.mockReturnValue({
      data: { actor: 'Human', unreadCount: 0, mentionCount: 0 },
    });
    mocks.useFeatureSetting.mockReturnValue('Coby');
    mocks.useConfig.mockReturnValue({
      data: {
        agents: [
          { name: 'OpenAI Codex', enabled: true },
          { name: 'Claude Code Opus 4.7 Reviewer', enabled: true },
          { name: 'Amp', enabled: false },
        ],
      },
    });
    mocks.useTask.mockReturnValue({ data: { id: 'task-1', title: 'Draft launch checklist' } });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders activity surfaces with direct Mantine primitives', () => {
    const { baseElement } = renderWithProviders(
      <>
        <ActivitySidebar open={true} onOpenChange={vi.fn()} />
        <ActivityFeed onBack={vi.fn()} onTaskClick={vi.fn()} />
      </>
    );

    expect(screen.getByText('Activity Log')).toBeDefined();
    expect(screen.getByText("Today's Summary")).toBeDefined();
    expect(screen.getByText('Task Activity')).toBeDefined();
    expect(screen.getByText('Status History')).toBeDefined();
    expect(screen.getByText('Activity')).toBeDefined();
    expect(screen.getByText('Review release notes')).toBeDefined();
    expect(baseElement.querySelector('.mantine-Drawer-root')).toBeDefined();
    expect(baseElement.querySelector('.mantine-Tabs-root')).toBeDefined();
    expect(baseElement.querySelector('.mantine-Select-root')).toBeDefined();
    expect(baseElement.querySelector('.mantine-ScrollArea-root')).toBeDefined();
    expect(baseElement.querySelector('.mantine-ActionIcon-root')).toBeDefined();
    expect(baseElement.querySelector('.mantine-Paper-root')).toBeDefined();
    expect(baseElement.querySelector('[data-slot="sheet-content"]')).toBeNull();
    expect(baseElement.querySelector('[data-slot="tabs-list"]')).toBeNull();
    expect(baseElement.querySelector('[data-slot="select-trigger"]')).toBeNull();
  });

  it('renders chat overlays with direct Mantine primitives', async () => {
    const user = userEvent.setup();
    const { baseElement } = renderWithProviders(
      <>
        <ChatPanel open={true} onOpenChange={vi.fn()} />
        <SquadChatPanel open={true} onOpenChange={vi.fn()} />
        <FloatingChat />
      </>
    );

    expect(await screen.findByText('Board Chat')).toBeDefined();
    expect(screen.getByText('Ready to help with the board.')).toBeDefined();
    expect(screen.getByText('Squad Chat')).toBeDefined();
    expect(screen.getByText('Code review ready.')).toBeDefined();
    expect(screen.getByLabelText('Open chat')).toBeDefined();
    expect(baseElement.querySelectorAll('.mantine-Drawer-root').length).toBeGreaterThanOrEqual(2);
    expect(baseElement.querySelector('.mantine-TextInput-root')).toBeDefined();
    expect(baseElement.querySelector('.mantine-Select-root')).toBeDefined();
    expect(baseElement.querySelector('.mantine-ScrollArea-root')).toBeDefined();
    expect(baseElement.querySelector('.mantine-ActionIcon-root')).toBeDefined();

    await user.click(await screen.findByLabelText('Clear chat'));

    expect(await screen.findByText('Clear chat history?')).toBeDefined();
    expect(baseElement.querySelector('.mantine-Modal-root')).toBeDefined();
    expect(baseElement.querySelector('[data-slot="sheet-content"]')).toBeNull();
    expect(baseElement.querySelector('[data-slot="alert-dialog-content"]')).toBeNull();
    expect(baseElement.querySelector('[data-slot="input"]')).toBeNull();
  });

  it('renders chat panels inline for the desktop bottom panel', () => {
    const { baseElement } = renderWithProviders(
      <>
        <ChatPanel open={true} onOpenChange={vi.fn()} variant="inline" />
        <SquadChatPanel open={true} onOpenChange={vi.fn()} variant="inline" />
      </>
    );

    expect(screen.getByLabelText('Board Chat')).toBeDefined();
    expect(screen.getByLabelText('Squad Chat')).toBeDefined();
    expect(screen.getByLabelText('Close chat panel')).toBeDefined();
    expect(screen.getByLabelText('Close squad chat panel')).toBeDefined();
    expect(baseElement.querySelector('.mantine-Drawer-root')).toBeNull();
  });
});
