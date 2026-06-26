import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from './test-utils';
import { SquadChatPanel } from '@/components/chat/SquadChatPanel';

const mocks = vi.hoisted(() => ({
  addReaction: vi.fn(),
  markRead: vi.fn(),
  sendSquadMessage: vi.fn(),
  updateMessageState: vi.fn(),
  useSquadMessages: vi.fn(),
  useSquadSearch: vi.fn(),
  useSquadUnread: vi.fn(),
}));

vi.mock('@/hooks/useChat', () => ({
  useAddSquadReaction: () => ({ mutate: mocks.addReaction, isPending: false }),
  useMarkSquadRead: () => ({ mutate: mocks.markRead, isPending: false }),
  useSquadMessages: mocks.useSquadMessages,
  useSendSquadMessage: () => ({ mutate: mocks.sendSquadMessage, isPending: false }),
  useSquadSearch: mocks.useSquadSearch,
  useSquadStream: () => ({ newMessage: null }),
  useSquadUnread: mocks.useSquadUnread,
  useUpdateSquadMessageState: () => ({ mutate: mocks.updateMessageState, isPending: false }),
}));

vi.mock('@/hooks/useFeatureSettings', () => ({
  useFeatureSetting: () => 'Coby',
}));

vi.mock('@/hooks/useConfig', () => ({
  useConfig: () => ({
    data: {
      agents: [
        { type: 'codex', name: 'OpenAI Codex', enabled: true },
        { type: 'claude-code', name: 'Claude Code Opus 4.7 Reviewer', enabled: true },
        { type: 'amp', name: 'Amp', enabled: false },
      ],
    },
  }),
}));

describe('SquadChatPanel', () => {
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
    mocks.addReaction.mockReset();
    mocks.markRead.mockReset();
    mocks.sendSquadMessage.mockReset();
    mocks.updateMessageState.mockReset();
    mocks.useSquadMessages.mockReturnValue({ data: [], isLoading: false });
    mocks.useSquadSearch.mockReturnValue({ data: { query: '', results: [] } });
    mocks.useSquadUnread.mockReturnValue({
      data: { actor: 'Human', unreadCount: 0, mentionCount: 0 },
    });
  });

  afterEach(() => cleanup());

  it('uses configured enabled agents for the sender selector instead of the demo roster', async () => {
    const user = userEvent.setup();

    renderWithProviders(<SquadChatPanel open={true} onOpenChange={vi.fn()} />);

    const [filterSelector, senderSelector] = screen.getAllByRole('combobox');
    expect(filterSelector).toBeDefined();

    await user.click(senderSelector);

    expect(await screen.findByText('OpenAI Codex')).toBeDefined();
    expect(screen.getByText('Claude Code Opus 4.7 Reviewer')).toBeDefined();
    expect(screen.queryByText('Amp')).toBeNull();
    expect(screen.queryByText('TARS')).toBeNull();
  });

  it('renders unread state, compact replies, search jump, and collaboration actions', async () => {
    const user = userEvent.setup();
    const now = '2026-06-26T12:00:00.000Z';
    mocks.useSquadMessages.mockReturnValue({
      data: [
        {
          id: 'msg_root',
          agent: 'VERITAS',
          message: 'Need @case review',
          timestamp: now,
          mentions: [{ target: 'case' }],
        },
        {
          id: 'msg_reply',
          agent: 'CASE',
          message: 'On it.',
          timestamp: now,
          replyToId: 'msg_root',
          threadId: 'msg_root',
        },
      ],
      isLoading: false,
    });
    mocks.useSquadSearch.mockReturnValue({
      data: {
        query: 'review',
        results: [
          {
            messageId: 'msg_root',
            timestamp: now,
            agent: 'VERITAS',
            snippet: 'Need @case review',
          },
        ],
      },
    });
    mocks.useSquadUnread.mockReturnValue({
      data: { actor: 'Human', unreadCount: 2, mentionCount: 1 },
    });

    renderWithProviders(<SquadChatPanel open={true} onOpenChange={vi.fn()} />);

    expect(screen.getByText('2/1')).toBeDefined();
    expect(screen.getByText('1 reply')).toBeDefined();

    await user.type(screen.getByLabelText('Search squad chat'), 'review');
    await user.click(screen.getByText('Need @case review'));
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: /Mark read/ }));
    expect(mocks.markRead).toHaveBeenCalledWith({ actor: 'Human', messageId: 'msg_reply' });

    await user.click(screen.getAllByLabelText('Reply to message')[0]);
    await user.type(screen.getByPlaceholderText('Send a message to the squad...'), 'Checking now');
    await user.click(screen.getByLabelText('Send squad message'));
    expect(mocks.sendSquadMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: 'Human',
        message: 'Checking now',
        replyToId: 'msg_root',
      }),
      expect.any(Object)
    );

    await user.click(screen.getAllByLabelText('Pin message')[0]);
    expect(mocks.updateMessageState).toHaveBeenCalledWith({
      messageId: 'msg_root',
      pinned: true,
    });

    await user.click(screen.getAllByLabelText('Mark decision')[0]);
    expect(mocks.updateMessageState).toHaveBeenCalledWith({
      messageId: 'msg_root',
      decision: true,
    });

    await user.click(screen.getAllByLabelText('Acknowledge message')[0]);
    expect(mocks.addReaction).toHaveBeenCalledWith({
      messageId: 'msg_root',
      actor: 'Human',
      reaction: 'ack',
    });
  });
});
