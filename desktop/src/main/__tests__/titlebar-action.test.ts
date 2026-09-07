import { describe, expect, it, vi } from 'vitest';
import { applyTitlebarAction, resolveTitlebarAction } from '../titlebar-action.js';

describe('system titlebar action', () => {
  it.each([
    ['Maximize', 'zoom'],
    ['Fill', 'zoom'],
    ['Minimize', 'minimize'],
    ['None', 'none'],
    ['', 'zoom'],
    ['future-value', 'none'],
  ] as const)('maps macOS preference %s to %s', (preference, action) => {
    expect(resolveTitlebarAction('darwin', preference)).toBe(action);
  });
  it.each(['linux', 'win32'] as const)('preserves maximize on %s', (platform) => {
    expect(resolveTitlebarAction(platform, 'Minimize')).toBe('zoom');
  });
  it('applies only the selected action and restores a zoomed window', () => {
    let maximized = false;
    const window = {
      isMaximized: () => maximized,
      maximize: vi.fn(() => {
        maximized = true;
      }),
      unmaximize: vi.fn(() => {
        maximized = false;
      }),
      minimize: vi.fn(),
    };
    applyTitlebarAction(window as never, 'none');
    expect(window.maximize).not.toHaveBeenCalled();
    expect(window.minimize).not.toHaveBeenCalled();
    expect(applyTitlebarAction(window as never, 'zoom')).toEqual({ maximized: true });
    expect(applyTitlebarAction(window as never, 'zoom')).toEqual({ maximized: false });
    applyTitlebarAction(window as never, 'minimize');
    expect(window.minimize).toHaveBeenCalledOnce();
    expect(window.maximize).toHaveBeenCalledOnce();
    expect(window.unmaximize).toHaveBeenCalledOnce();
  });
});
