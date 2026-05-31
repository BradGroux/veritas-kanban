import { describe, expect, it, vi } from 'vitest';

import { createDesktopMenuTemplate } from '../menu.js';
import type { DesktopStatusSnapshot } from '../types.js';

function status(state: DesktopStatusSnapshot['server']['state'] = 'ready'): DesktopStatusSnapshot {
  return {
    mode: 'local-dev',
    profile: 'fresh',
    workspace: 'local',
    server: {
      name: 'server',
      state,
      pid: 1,
      port: 3001,
      lastError: null,
      startedAt: '2026-05-31T00:00:00.000Z',
      exitedAt: null,
    },
    web: undefined,
    serverOrigin: 'http://127.0.0.1:3001',
    rendererOrigin: 'http://127.0.0.1:3000',
    appHome: '/tmp/veritas',
    dataDir: '/tmp/veritas/data',
    configDir: '/tmp/veritas/config',
    logsDir: '/tmp/veritas/logs',
    secretsBackedByKeychain: true,
    warnings: [],
    lastError: null,
  };
}

describe('desktop native menu', () => {
  it('exposes common actions with keyboard shortcuts', () => {
    const dispatch = vi.fn();
    const template = createDesktopMenuTemplate({ status: status(), dispatch });
    const labels = template.flatMap((item) =>
      Array.isArray(item.submenu) ? item.submenu.map((child) => child.label) : []
    );

    expect(labels).toContain('New Task');
    expect(labels).toContain('Command Center');
    expect(labels).toContain('Search');
    expect(labels).toContain('Settings');
    expect(labels).toContain('Restart Local Server');

    const fileMenu = template.find((item) => item.label === 'File');
    const newTask = Array.isArray(fileMenu?.submenu)
      ? fileMenu.submenu.find((item) => item.label === 'New Task')
      : null;
    newTask?.click?.(undefined as never, undefined as never, undefined as never);

    expect(newTask?.accelerator).toBe('CommandOrControl+N');
    expect(dispatch).toHaveBeenCalledWith('new-task');
  });

  it('keeps external delivery test status-aware', () => {
    const desktopMenu = createDesktopMenuTemplate({
      status: status('failed'),
      dispatch: vi.fn(),
    }).find((item) => item.label === 'Desktop');
    const externalTest = Array.isArray(desktopMenu?.submenu)
      ? desktopMenu.submenu.find((item) => item.label === 'Test External Delivery')
      : null;

    expect(externalTest?.enabled).toBe(false);
  });
});
