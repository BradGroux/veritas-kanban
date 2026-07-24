import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import {
  DEFAULT_BOTTOM_PANEL_HEIGHT,
  DesktopShellProvider,
  useDesktopShell,
} from '@/components/layout/DesktopShellContext';

function ShellProbe() {
  const shell = useDesktopShell();

  return (
    <div>
      <output aria-label="left rail">{String(shell.leftRailOpen)}</output>
      <output aria-label="right rail">{String(shell.rightRailOpen)}</output>
      <output aria-label="bottom panel">{shell.bottomPanel ?? 'closed'}</output>
      <output aria-label="bottom panel height">{shell.bottomPanelHeight}</output>
      <button type="button" onClick={() => shell.openBottomPanel('board-chat')}>
        Open board chat
      </button>
      <button type="button" onClick={() => shell.setLeftRailOpen(false)}>
        Close left rail
      </button>
      <button type="button" onClick={() => shell.setRightRailOpen(true)}>
        Open right rail
      </button>
    </div>
  );
}

describe('desktop shell recovery', () => {
  let menuListener: ((payload: { command: string }) => void) | undefined;

  beforeEach(() => {
    const storage = new Map<string, string>();
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        get length() {
          return storage.size;
        },
        clear: () => storage.clear(),
        getItem: (key: string) => storage.get(key) ?? null,
        key: (index: number) => Array.from(storage.keys())[index] ?? null,
        removeItem: (key: string) => storage.delete(key),
        setItem: (key: string, value: string) => storage.set(key, value),
      } satisfies Storage,
    });
    window.localStorage.clear();
    window.history.replaceState({}, '', '/');
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 600 });
    Object.defineProperty(window, 'veritasDesktop', {
      configurable: true,
      value: {
        onMenuCommand: vi.fn((listener: (payload: { command: string }) => void) => {
          menuListener = listener;
          return vi.fn();
        }),
      },
    });
  });

  afterEach(() => {
    cleanup();
    delete (window as Window & { veritasDesktop?: unknown }).veritasDesktop;
    delete document.documentElement.dataset.client;
    menuListener = undefined;
  });

  it('discards obsolete persisted panel visibility and clamps a stale height', () => {
    window.localStorage.setItem('veritas.desktop.bottomPanel', 'board-chat');
    window.localStorage.setItem('veritas.workbench.bottomPanelHeight', '9999');

    render(
      <DesktopShellProvider>
        <ShellProbe />
      </DesktopShellProvider>
    );

    expect(screen.getByLabelText('bottom panel').textContent).toBe('closed');
    expect(screen.getByLabelText('bottom panel height').textContent).toBe('380');
    expect(window.localStorage.getItem('veritas.desktop.bottomPanel')).toBeNull();
  });

  it('closes transient chat layout with Escape or browser Back', async () => {
    const user = userEvent.setup();

    render(
      <DesktopShellProvider>
        <ShellProbe />
      </DesktopShellProvider>
    );

    await user.click(screen.getByRole('button', { name: 'Open board chat' }));
    expect(screen.getByLabelText('bottom panel').textContent).toBe('board-chat');

    await user.keyboard('{Escape}');
    expect(screen.getByLabelText('bottom panel').textContent).toBe('closed');

    await user.click(screen.getByRole('button', { name: 'Open board chat' }));
    act(() => window.dispatchEvent(new PopStateEvent('popstate', { state: {} })));
    expect(screen.getByLabelText('bottom panel').textContent).toBe('closed');
  });

  it('resets the complete desktop layout from the native recovery command', async () => {
    const user = userEvent.setup();

    render(
      <DesktopShellProvider>
        <ShellProbe />
      </DesktopShellProvider>
    );

    await user.click(screen.getByRole('button', { name: 'Close left rail' }));
    await user.click(screen.getByRole('button', { name: 'Open right rail' }));
    await user.click(screen.getByRole('button', { name: 'Open board chat' }));

    act(() => menuListener?.({ command: 'reset-layout' }));

    expect(screen.getByLabelText('left rail').textContent).toBe('true');
    expect(screen.getByLabelText('right rail').textContent).toBe('false');
    expect(screen.getByLabelText('bottom panel').textContent).toBe('closed');
    expect(screen.getByLabelText('bottom panel height').textContent).toBe(
      String(DEFAULT_BOTTOM_PANEL_HEIGHT)
    );
    expect(window.localStorage.getItem('veritas.desktop.leftRailOpen')).toBeNull();
    expect(window.localStorage.getItem('veritas.desktop.rightRailOpen')).toBeNull();
    expect(window.localStorage.getItem('veritas.workbench.bottomPanelHeight')).toBeNull();
  });
});
