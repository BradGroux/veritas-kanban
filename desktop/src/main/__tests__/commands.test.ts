import { describe, expect, it, vi } from 'vitest';
import type { Shell } from 'electron';

import {
  DESKTOP_COMMAND_REGISTRY,
  DesktopCommandDispatcher,
  createDesktopCommandRequest,
} from '../commands.js';
import type { DesktopRuntime } from '../runtime.js';
import type { DesktopStatusSnapshot } from '../types.js';
import {
  DESKTOP_COMMAND_NAMES,
  type DesktopUpdateStatus,
} from '../../shared/desktop-bridge-contracts.js';

function status(): DesktopStatusSnapshot {
  return {
    mode: 'local-dev',
    profile: 'fresh',
    workspace: 'local',
    server: {
      name: 'server',
      state: 'ready',
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

function updateStatus(state: DesktopUpdateStatus['state'] = 'idle'): DesktopUpdateStatus {
  return {
    state,
    currentVersion: '4.3.2',
    channel: 'stable',
    checkedAt: '2026-05-31T00:00:00.000Z',
  };
}

function dispatcher() {
  const runtime = {
    snapshot: vi.fn(status),
    restartLocalServer: vi.fn(async () => status()),
  } as unknown as DesktopRuntime;
  const shell = {
    openPath: vi.fn(async () => ''),
  } as unknown as Shell;
  const sendRendererCommand = vi.fn();
  const checkForUpdates = vi.fn(async () => updateStatus('idle'));
  const downloadUpdate = vi.fn(async () => updateStatus('ready'));
  const installUpdate = vi.fn(() => updateStatus('ready'));
  const showTestNotification = vi.fn();
  const copyRedactedDiagnostics = vi.fn();

  return {
    runtime,
    shell,
    sendRendererCommand,
    checkForUpdates,
    downloadUpdate,
    installUpdate,
    showTestNotification,
    copyRedactedDiagnostics,
    dispatcher: new DesktopCommandDispatcher({
      runtime,
      shell,
      quit: vi.fn(),
      sendRendererCommand,
      checkForUpdates,
      downloadUpdate,
      installUpdate,
      showTestNotification,
      copyRedactedDiagnostics,
    }),
  };
}

describe('desktop command registry', () => {
  it('defines every typed desktop command exactly once', () => {
    expect(Object.keys(DESKTOP_COMMAND_REGISTRY).sort()).toEqual([...DESKTOP_COMMAND_NAMES].sort());
    expect(DESKTOP_COMMAND_REGISTRY['new-task'].accelerator).toBe('CommandOrControl+N');
    expect(DESKTOP_COMMAND_REGISTRY['open-command-center'].accelerator).toBe('CommandOrControl+K');
  });

  it('routes renderer commands through the menu command event path', async () => {
    const harness = dispatcher();
    const result = await harness.dispatcher.dispatch(
      createDesktopCommandRequest('new-task', 'menu')
    );

    expect(result).toEqual({
      command: 'new-task',
      accepted: true,
      handledBy: 'renderer',
      message: undefined,
    });
    expect(harness.sendRendererCommand).toHaveBeenCalledWith({
      command: 'new-task',
      source: 'menu',
      payload: undefined,
    });
  });

  it('handles native desktop commands without exposing shell primitives to the renderer', async () => {
    const harness = dispatcher();

    await expect(
      harness.dispatcher.dispatch(createDesktopCommandRequest('restart-local-server', 'menu'))
    ).resolves.toMatchObject({
      command: 'restart-local-server',
      accepted: true,
      handledBy: 'desktop',
    });
    await harness.dispatcher.dispatch(createDesktopCommandRequest('open-logs', 'menu'));
    await harness.dispatcher.dispatch(createDesktopCommandRequest('check-for-updates', 'menu'));
    await harness.dispatcher.dispatch(createDesktopCommandRequest('download-update', 'menu'));
    await harness.dispatcher.dispatch(createDesktopCommandRequest('install-update', 'menu'));
    await harness.dispatcher.dispatch(createDesktopCommandRequest('test-notification', 'menu'));
    await harness.dispatcher.dispatch(
      createDesktopCommandRequest('copy-redacted-diagnostics', 'menu')
    );

    expect(harness.runtime.restartLocalServer).toHaveBeenCalledTimes(1);
    expect(harness.shell.openPath).toHaveBeenCalledWith('/tmp/veritas/logs');
    expect(harness.checkForUpdates).toHaveBeenCalledTimes(1);
    expect(harness.downloadUpdate).toHaveBeenCalledTimes(1);
    expect(harness.installUpdate).toHaveBeenCalledTimes(1);
    expect(harness.showTestNotification).toHaveBeenCalledTimes(1);
    expect(harness.copyRedactedDiagnostics).toHaveBeenCalledWith(status());
  });
});
