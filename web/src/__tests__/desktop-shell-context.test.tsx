import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import {
  DEFAULT_RIGHT_PANEL_WIDTH,
  DesktopShellProvider,
  useDesktopShell,
} from '@/components/layout/DesktopShellContext';

function ShellProbe({ triggerKey = 'original' }: { triggerKey?: string }) {
  const shell = useDesktopShell();

  return (
    <div>
      <button onClick={shell.resetDesktopLayout}>Reset layout</button>
      <output aria-label="left rail">{String(shell.leftRailOpen)}</output>
      <output aria-label="right rail">{String(shell.rightRailOpen)}</output>
      <output aria-label="bottom panel">{shell.bottomPanel ?? 'closed'}</output>
      {shell.bottomPanel && (
        <section id="workbench-right-dock">
          <button type="button">Focused dock control</button>
        </section>
      )}
      <output aria-label="right panel width">{shell.rightPanelWidth}</output>
      <button
        key={triggerKey}
        data-overlay-focus-key="fixture-board-chat"
        type="button"
        onClick={() => shell.openBottomPanel('board-chat')}
      >
        Open board chat
      </button>
      <button type="button" onClick={() => shell.setLeftRailOpen(false)}>
        Close left rail
      </button>
      <button type="button" onClick={() => shell.setLeftRailOpen(true)}>
        Open left rail
      </button>
      <button type="button" onClick={() => shell.setRightRailOpen(true)}>
        Open right rail
      </button>
    </div>
  );
}

describe('desktop shell recovery', () => {
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
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1360 });
    Object.defineProperty(window, 'veritasDesktop', {
      configurable: true,
      value: {
        onMenuCommand: vi.fn((listener: (payload: { command: string }) => void) => {
          void listener;
          return vi.fn();
        }),
      },
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    delete (window as Window & { veritasDesktop?: unknown }).veritasDesktop;
    delete document.documentElement.dataset.client;
  });

  it('retires legacy bottom-dock state and defaults to a bounded right dock', () => {
    window.localStorage.setItem('veritas.desktop.bottomPanel', 'board-chat');
    window.localStorage.setItem('veritas.workbench.bottomPanelHeight', '9999');
    window.localStorage.setItem('veritas.workbench.rightPanelWidth', '-20');
    window.localStorage.setItem('veritas.workbench.dockPosition', 'bottom');

    render(
      <DesktopShellProvider>
        <ShellProbe />
      </DesktopShellProvider>
    );

    expect(screen.getByLabelText('bottom panel').textContent).toBe('closed');
    expect(screen.getByLabelText('right panel width').textContent).toBe(
      String(DEFAULT_RIGHT_PANEL_WIDTH)
    );
    expect(window.localStorage.getItem('veritas.desktop.bottomPanel')).toBeNull();
    expect(window.localStorage.getItem('veritas.workbench.bottomPanelHeight')).toBeNull();
    expect(window.localStorage.getItem('veritas.workbench.dockPosition')).toBeNull();
  });

  it('opens the desktop conversation without recreating retired dock preferences', async () => {
    const user = userEvent.setup();
    render(
      <DesktopShellProvider>
        <ShellProbe />
      </DesktopShellProvider>
    );

    await user.click(screen.getByRole('button', { name: 'Open board chat' }));

    expect(screen.getByLabelText('bottom panel').textContent).toBe('board-chat');
    expect(window.localStorage.getItem('veritas.workbench.bottomPanelHeight')).toBeNull();
    expect(window.localStorage.getItem('veritas.workbench.dockPosition')).toBeNull();
  });

  it('closes transient chat layout with Escape or browser Back and restores focus', async () => {
    const user = userEvent.setup();

    render(
      <DesktopShellProvider>
        <ShellProbe />
      </DesktopShellProvider>
    );

    const trigger = screen.getByRole('button', { name: 'Open board chat' });
    await user.click(trigger);
    expect(screen.getByLabelText('bottom panel').textContent).toBe('board-chat');

    await user.keyboard('{Escape}');
    expect(screen.getByLabelText('bottom panel').textContent).toBe('closed');
    await vi.waitFor(() => expect(document.activeElement).toBe(trigger));

    await user.click(screen.getByRole('button', { name: 'Open board chat' }));
    act(() => window.dispatchEvent(new PopStateEvent('popstate', { state: {} })));
    expect(screen.getByLabelText('bottom panel').textContent).toBe('closed');
  });

  it('collapses sidebars and Workbench when the desktop crosses into compact width', async () => {
    const user = userEvent.setup();
    render(
      <DesktopShellProvider>
        <ShellProbe />
      </DesktopShellProvider>
    );

    await user.click(screen.getByRole('button', { name: 'Open right rail' }));
    await user.click(screen.getByRole('button', { name: 'Open board chat' }));
    expect(screen.getByLabelText('left rail').textContent).toBe('true');
    expect(screen.getByLabelText('right rail').textContent).toBe('true');
    expect(screen.getByLabelText('bottom panel').textContent).toBe('board-chat');

    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1180 });
    act(() => window.dispatchEvent(new Event('resize')));

    expect(screen.getByLabelText('left rail').textContent).toBe('false');
    expect(screen.getByLabelText('right rail').textContent).toBe('false');
    expect(screen.getByLabelText('bottom panel').textContent).toBe('closed');
    expect(window.localStorage.getItem('veritas.desktop.leftRailOpen')).toBe('false');
    expect(window.localStorage.getItem('veritas.desktop.rightRailOpen')).toBe('false');
  });

  it('keeps the task history and focus when resize collapses the chat behind it', async () => {
    const user = userEvent.setup();
    render(
      <DesktopShellProvider>
        <ShellProbe />
      </DesktopShellProvider>
    );
    await user.click(screen.getByRole('button', { name: 'Open board chat' }));
    const taskState = { ...window.history.state, veritasTaskDetail: 'task-open-above-chat' };
    window.history.pushState(taskState, '', '/');
    const taskControl = screen.getByRole('button', { name: 'Reset layout' });
    taskControl.focus();
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => {});
    try {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1180 });
      act(() => window.dispatchEvent(new Event('resize')));
      expect(screen.getByLabelText('bottom panel').textContent).toBe('closed');
      expect(window.history.state.veritasTaskDetail).toBe('task-open-above-chat');
      expect(window.history.state.veritasBottomPanel).toBeUndefined();
      expect(back).not.toHaveBeenCalled();
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      expect(document.activeElement).toBe(taskControl);
    } finally {
      back.mockRestore();
    }
  });

  it('returns focused dock content to its visible opener over repeated resize/fullscreen collapses', async () => {
    vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(function (
      this: HTMLElement
    ) {
      return (this.hidden ? [] : [new DOMRect(0, 0, 32, 32)]) as unknown as DOMRectList;
    });
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => {});
    const user = userEvent.setup();
    render(
      <DesktopShellProvider>
        <ShellProbe />
      </DesktopShellProvider>
    );
    const trigger = screen.getByRole('button', { name: 'Open board chat' });
    for (const event of ['resize', 'fullscreenchange']) {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1360 });
      act(() => window.dispatchEvent(new Event('resize')));
      await user.click(trigger);
      screen.getByRole('button', { name: 'Focused dock control' }).focus();
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1180 });
      act(() => (event === 'resize' ? window : document).dispatchEvent(new Event(event)));
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      expect(document.activeElement).toBe(trigger);
      expect(screen.getByLabelText('bottom panel').textContent).toBe('closed');
      expect(window.history.state.veritasBottomPanel).toBeUndefined();
      expect(back).not.toHaveBeenCalled();
    }
  });

  it('resolves the current visible opener if the responsive header remounts before restoration', async () => {
    vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(function (
      this: HTMLElement
    ) {
      return (this.hidden ? [] : [new DOMRect(0, 0, 32, 32)]) as unknown as DOMRectList;
    });
    const user = userEvent.setup();
    const view = render(
      <DesktopShellProvider>
        <ShellProbe />
      </DesktopShellProvider>
    );
    const oldTrigger = screen.getByRole('button', { name: 'Open board chat' });
    await user.click(oldTrigger);
    screen.getByRole('button', { name: 'Focused dock control' }).focus();
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1180 });
    act(() => window.dispatchEvent(new Event('resize')));
    view.rerender(
      <DesktopShellProvider>
        <ShellProbe triggerKey="replacement" />
      </DesktopShellProvider>
    );
    const trigger = screen.getByRole('button', { name: 'Open board chat' });
    expect(trigger).not.toBe(oldTrigger);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    expect(document.activeElement).toBe(trigger);
  });

  it('does not steal newer focus from a surviving task before the restoration frame', async () => {
    vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([
      new DOMRect(0, 0, 32, 32),
    ] as unknown as DOMRectList);
    const user = userEvent.setup();
    render(
      <DesktopShellProvider>
        <ShellProbe />
      </DesktopShellProvider>
    );
    await user.click(screen.getByRole('button', { name: 'Open board chat' }));
    screen.getByRole('button', { name: 'Focused dock control' }).focus();
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1180 });
    act(() => window.dispatchEvent(new Event('resize')));
    const taskControl = screen.getByRole('button', { name: 'Reset layout' });
    taskControl.focus();
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    expect(document.activeElement).toBe(taskControl);
  });

  it('leaves focus in a dock reopened before the previous collapse restoration frame', async () => {
    vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([
      new DOMRect(0, 0, 32, 32),
    ] as unknown as DOMRectList);
    const user = userEvent.setup();
    render(
      <DesktopShellProvider>
        <ShellProbe />
      </DesktopShellProvider>
    );
    const trigger = screen.getByRole('button', { name: 'Open board chat' });
    await user.click(trigger);
    screen.getByRole('button', { name: 'Focused dock control' }).focus();
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1180 });
    act(() => window.dispatchEvent(new Event('resize')));
    fireEvent.click(trigger);
    const current = screen.getByRole('button', { name: 'Focused dock control' });
    current.focus();
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    expect(document.activeElement).toBe(current);
    expect(screen.getByLabelText('bottom panel').textContent).toBe('board-chat');
  });

  it('minimizes both sidebars before opening Workbench at compact width', async () => {
    const user = userEvent.setup();
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1180 });
    render(
      <DesktopShellProvider>
        <ShellProbe />
      </DesktopShellProvider>
    );

    await user.click(screen.getByRole('button', { name: 'Open left rail' }));
    await user.click(screen.getByRole('button', { name: 'Open right rail' }));
    await user.click(screen.getByRole('button', { name: 'Open board chat' }));

    expect(screen.getByLabelText('left rail').textContent).toBe('false');
    expect(screen.getByLabelText('right rail').textContent).toBe('false');
    expect(screen.getByLabelText('bottom panel').textContent).toBe('board-chat');
  });

  it('keeps only one auxiliary surface open when compact sidebars are reopened', async () => {
    const user = userEvent.setup();
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1180 });
    render(
      <DesktopShellProvider>
        <ShellProbe />
      </DesktopShellProvider>
    );
    await user.click(screen.getByRole('button', { name: 'Open board chat' }));
    await user.click(screen.getByRole('button', { name: 'Open left rail' }));
    expect(screen.getByLabelText('bottom panel').textContent).toBe('closed');
    expect(screen.getByLabelText('left rail').textContent).toBe('true');
    await user.click(screen.getByRole('button', { name: 'Open right rail' }));
    expect(screen.getByLabelText('left rail').textContent).toBe('false');
    expect(screen.getByLabelText('right rail').textContent).toBe('true');
  });

  it('resets the complete desktop layout through the shell action', async () => {
    const user = userEvent.setup();

    render(
      <DesktopShellProvider>
        <ShellProbe />
      </DesktopShellProvider>
    );

    await user.click(screen.getByRole('button', { name: 'Close left rail' }));
    await user.click(screen.getByRole('button', { name: 'Open right rail' }));
    await user.click(screen.getByRole('button', { name: 'Open board chat' }));

    await user.click(screen.getByRole('button', { name: 'Reset layout' }));

    expect(screen.getByLabelText('left rail').textContent).toBe('true');
    expect(screen.getByLabelText('right rail').textContent).toBe('false');
    expect(screen.getByLabelText('bottom panel').textContent).toBe('closed');
    expect(screen.getByLabelText('right panel width').textContent).toBe(
      String(DEFAULT_RIGHT_PANEL_WIDTH)
    );
    expect(window.localStorage.getItem('veritas.desktop.leftRailOpen')).toBeNull();
    expect(window.localStorage.getItem('veritas.desktop.rightRailOpen')).toBeNull();
    expect(window.localStorage.getItem('veritas.workbench.bottomPanelHeight')).toBeNull();
    expect(window.localStorage.getItem('veritas.workbench.rightPanelWidth')).toBeNull();
    expect(window.localStorage.getItem('veritas.workbench.dockPosition')).toBeNull();
  });
});
