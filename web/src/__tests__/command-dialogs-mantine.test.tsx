import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';

import { ViewProvider } from '@/contexts/ViewContext';
import { KeyboardProvider } from '@/hooks/useKeyboard';
import { CommandPalette } from '@/components/layout/CommandPalette';
import { KeyboardShortcutsDialog } from '@/components/layout/KeyboardShortcutsDialog';
import { renderWithProviders } from './test-utils';

function renderCommandSurface(ui: React.ReactElement) {
  return renderWithProviders(
    <KeyboardProvider>
      <ViewProvider>{ui}</ViewProvider>
    </KeyboardProvider>
  );
}

describe('command and shortcut dialogs Mantine migration', () => {
  afterEach(() => {
    cleanup();
  });

  it('opens the command palette through direct Mantine modal primitives', async () => {
    const { baseElement } = renderCommandSurface(<CommandPalette />);

    fireEvent.keyDown(window, { key: 'k', metaKey: true });

    expect(await screen.findByRole('dialog', { name: 'Command palette' })).toBeDefined();
    expect(screen.getByLabelText('Search commands')).toBeDefined();
    expect(screen.getByText('New Task')).toBeDefined();
    expect(baseElement.querySelector('.mantine-Modal-content')).toBeDefined();
    expect(baseElement.querySelector('.mantine-TextInput-root')).toBeDefined();
    expect(baseElement.querySelector('.mantine-ScrollArea-root')).toBeDefined();
    expect(baseElement.querySelector('[data-slot="dialog-content"]')).toBeNull();
    expect(baseElement.querySelector('[data-slot="dialog-title"]')).toBeNull();
  });

  it('opens keyboard shortcuts through direct Mantine modal and key badges', async () => {
    const { baseElement } = renderCommandSurface(<KeyboardShortcutsDialog />);

    fireEvent.keyDown(window, { key: '?' });

    expect(await screen.findByRole('dialog', { name: 'Keyboard Shortcuts' })).toBeDefined();
    expect(screen.getByText('Select next task')).toBeDefined();
    expect(baseElement.querySelector('.mantine-Modal-content')).toBeDefined();
    expect(baseElement.querySelectorAll('.mantine-Kbd-root').length).toBeGreaterThan(0);
    expect(baseElement.querySelector('[data-slot="dialog-content"]')).toBeNull();
    expect(baseElement.querySelector('[data-slot="dialog-title"]')).toBeNull();
  });
});
