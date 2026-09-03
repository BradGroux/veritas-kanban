import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';

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
    expect(screen.getByText('Command center')).toBeDefined();
    expect(screen.getByText('Run a command')).toBeDefined();
    expect(screen.queryByRole('button', { name: /Restart Local Server/ })).toBeNull();
    expect(screen.getByText(/ready · \d+ unavailable/)).toBeDefined();
    const selectedCommand = screen.getByRole('button', { name: /New Task/ });
    expect(selectedCommand.className).toContain('bg-primary');
    expect(selectedCommand.className).toContain('text-white');
    expect(baseElement.querySelector('.mantine-Modal-content')).toBeDefined();
    expect(baseElement.querySelector('.mantine-TextInput-root')).toBeDefined();
    expect(baseElement.querySelector('.mantine-ScrollArea-root')).toBeDefined();
    expect(baseElement.querySelector('[data-slot="dialog-content"]')).toBeNull();
    expect(baseElement.querySelector('[data-slot="dialog-title"]')).toBeNull();
  });

  it('filters commands and exposes disabled reasons without a pointer tooltip', async () => {
    renderCommandSurface(<CommandPalette />);
    fireEvent.keyDown(window, { key: 'k', metaKey: true });

    const input = await screen.findByRole('textbox', { name: 'Search commands' });
    fireEvent.change(input, { target: { value: 'restart local' } });

    const disabledCommand = screen.getByRole('button', { name: /Restart Local Server/ });
    expect(disabledCommand.getAttribute('aria-disabled')).toBe('true');
    expect(disabledCommand.getAttribute('title')).toBeNull();
    expect(disabledCommand.getAttribute('aria-describedby')).toBe(
      'command-disabled-restart-local-server'
    );
    expect(
      screen.getByText('The desktop bridge does not expose server restart from the web app yet.')
    ).toBeDefined();

    disabledCommand.focus();
    expect(document.activeElement).toBe(disabledCommand);
  });

  it('skips unavailable commands and Enter runs the visibly selected command', async () => {
    const onDiagnostics = vi.fn();
    window.addEventListener('veritas:open-diagnostics', onDiagnostics, { once: true });
    renderCommandSurface(<CommandPalette />);
    fireEvent.keyDown(window, { key: 'k', metaKey: true });

    const input = await screen.findByRole('textbox', { name: 'Search commands' });
    fireEvent.change(input, { target: { value: 'diagnostics' } });

    const selected = screen.getByRole('button', { name: 'Open Logs and Diagnostics' });
    expect(selected.getAttribute('data-selected')).toBe('true');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(selected.getAttribute('data-selected')).toBe('true');

    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(onDiagnostics).toHaveBeenCalledOnce());
  });

  it('focuses search, restores trigger focus, and provides viewport scroll cues', async () => {
    renderCommandSurface(
      <>
        <button type="button">Palette trigger</button>
        <CommandPalette />
      </>
    );
    const trigger = screen.getByRole('button', { name: 'Palette trigger' });
    trigger.focus();
    fireEvent.keyDown(window, { key: 'k', metaKey: true });

    const input = await screen.findByRole('textbox', { name: 'Search commands' });
    await waitFor(() => expect(document.activeElement).toBe(input));
    expect(screen.getByTestId('command-palette-surface').className).toContain('100dvh');

    const viewport = screen.getByLabelText('Available commands');
    Object.defineProperties(viewport, {
      clientHeight: { configurable: true, value: 300 },
      scrollHeight: { configurable: true, value: 900 },
      scrollTop: { configurable: true, writable: true, value: 0 },
    });
    fireEvent.scroll(viewport);
    expect(screen.getByText('More commands below')).toBeDefined();

    viewport.scrollTop = 600;
    fireEvent.scroll(viewport);
    expect(screen.getByText('More commands above')).toBeDefined();

    fireEvent.keyDown(input, { key: 'Escape' });
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Command palette' })).toBeNull()
    );
    await waitFor(() => expect(document.activeElement).toBe(trigger));
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
