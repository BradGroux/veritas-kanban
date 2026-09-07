import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { DEFAULT_FEATURE_SETTINGS } from '@veritas-kanban/shared';
import { KeyboardProvider } from '@/hooks/useKeyboard';
import { KeyboardShortcutsDialog } from '@/components/layout/KeyboardShortcutsDialog';
import { renderWithProviders } from './test-utils';

const config = vi.hoisted(() => ({
  settings: { board: { columns: [] as Array<{ id: string; title: string }> } },
}));
vi.mock('@/hooks/useFeatureSettings', () => ({ useFeatureSettings: () => config }));

function Surface() {
  return (
    <KeyboardProvider>
      <KeyboardShortcutsDialog />
    </KeyboardProvider>
  );
}
function keyFor(label: string) {
  const description = screen.getByText(`Move to ${label}`);
  const row = description.parentElement;
  if (!row) throw new Error('Shortcut description has no row');
  return within(row).getByText(/^\d$/).textContent;
}
describe('configured shortcut help', () => {
  beforeEach(() => {
    config.settings.board.columns = [...DEFAULT_FEATURE_SETTINGS.board.columns];
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('matches default destinations and updates rename, order, additions and removals while open', async () => {
    const view = renderWithProviders(<Surface />);
    fireEvent.keyDown(window, { key: '?' });
    await screen.findByRole('dialog');
    for (const [i, column] of DEFAULT_FEATURE_SETTINGS.board.columns.entries()) {
      expect(keyFor(column.title)).toBe(String(i + 1));
    }
    expect(screen.queryByText('Move to Planning')).toBeNull();
    config.settings.board.columns = [
      { id: 'done', title: 'Complete' },
      { id: 'ready', title: 'Ready' },
      { id: 'todo', title: 'To Do' },
    ];
    view.rerender(<Surface />);
    expect(keyFor('Complete')).toBe('1');
    expect(keyFor('Ready')).toBe('2');
    expect(keyFor('To Do')).toBe('3');
    expect(screen.queryByText('Move to In Progress')).toBeNull();
    expect(screen.queryByText('Move to Done')).toBeNull();
  });

  it('lists only nine numeric destinations and explains the limit', async () => {
    config.settings.board.columns = Array.from({ length: 11 }, (_, i) => ({
      id: `stage-${i}`,
      title: `Stage ${i + 1}`,
    }));
    renderWithProviders(<Surface />);
    fireEvent.keyDown(window, { key: '?' });
    await screen.findByRole('dialog');
    expect(keyFor('Stage 9')).toBe('9');
    expect(screen.queryByText('Move to Stage 10')).toBeNull();
    expect(screen.getByText(/Number shortcuts cover the first nine columns/)).toBeDefined();
  });

  it.each([
    ['MacIntel', '⌘⇧C'],
    ['Win32', 'Ctrl+Shift+C'],
    ['Linux x86_64', 'Ctrl+Shift+C'],
  ])('labels chat modifiers for %s', async (platform, label) => {
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue(platform);
    renderWithProviders(<Surface />);
    fireEvent.keyDown(window, { key: '?' });
    await screen.findByRole('dialog');
    expect(screen.getByText(label)).toBeDefined();
  });
});
