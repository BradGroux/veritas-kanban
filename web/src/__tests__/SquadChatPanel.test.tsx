import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from './test-utils';
import { SquadChatPanel } from '@/components/chat/SquadChatPanel';

vi.mock('@/hooks/useChat', () => ({
  useSquadMessages: () => ({ data: [], isLoading: false }),
  useSendSquadMessage: () => ({ mutate: vi.fn(), isPending: false }),
  useSquadStream: () => ({ newMessage: null }),
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
});
