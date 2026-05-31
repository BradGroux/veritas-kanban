import { describe, expect, it, vi } from 'vitest';
import type { IpcMain, Shell } from 'electron';

import {
  createDesktopBridgeHandlers,
  registerDesktopBridge,
  type DesktopBridgeHandlerMap,
} from '../bridge.js';
import type { DesktopRuntime } from '../runtime.js';
import type { DesktopStatusSnapshot } from '../types.js';
import {
  assertDesktopBridgeMethodAvailable,
  createDesktopBridgeEventCleanup,
  createDesktopSetupDiagnostics,
  createDesktopSupportSnapshot,
  DESKTOP_BRIDGE_CAPABILITIES,
  DESKTOP_BRIDGE_EVENT_NAMES,
  DESKTOP_BRIDGE_EVENTS,
  DESKTOP_BRIDGE_METHOD_NAMES,
  DESKTOP_BRIDGE_METHOD_VALIDATORS,
  DESKTOP_BRIDGE_METHODS,
  DESKTOP_COMMAND_NAMES,
  DESKTOP_FILE_PICKER_PURPOSES,
  DESKTOP_PRELOAD_API_METHODS,
  DESKTOP_PRELOAD_EVENT_METHODS,
  DESKTOP_REDACTED_VALUE,
  DESKTOP_RESTART_CONFIRMATION,
  redactDesktopBridgeError,
  redactDesktopBridgeValue,
  validateConnectionConfigRequest,
  validateDesktopCommandDispatchRequest,
  validateDiagnosticsBundleRequest,
  validateFilePickerRequest,
  validateNotificationActionRequest,
  validateOpenExternalRequest,
  validateRestartLocalServerRequest,
  validateWorkProductExportRequest,
} from '../../shared/desktop-bridge-contracts.js';

function snapshot(): DesktopStatusSnapshot {
  return {
    mode: 'local-dev',
    server: {
      name: 'server',
      state: 'ready',
      pid: 123,
      port: 3001,
      lastError: null,
      startedAt: '2026-05-31T00:00:00.000Z',
      exitedAt: null,
    },
    web: {
      name: 'web',
      state: 'ready',
      pid: 124,
      port: 3000,
      lastError: null,
      startedAt: '2026-05-31T00:00:00.000Z',
      exitedAt: null,
    },
    serverOrigin: 'http://127.0.0.1:3001',
    rendererOrigin: 'http://127.0.0.1:3000',
    appHome: '/Users/bradgroux/Projects/veritas-kanban/.veritas-desktop-dev/fresh',
    lastError: null,
  };
}

function runtime(): DesktopRuntime {
  const currentSnapshot = snapshot();
  return {
    snapshot: vi.fn(() => currentSnapshot),
    restartLocalServer: vi.fn(async () => currentSnapshot),
  } as unknown as DesktopRuntime;
}

function shell(): Shell {
  return {
    openExternal: vi.fn(async () => undefined),
  } as unknown as Shell;
}

function handlers(): DesktopBridgeHandlerMap {
  return createDesktopBridgeHandlers(runtime(), shell(), false);
}

describe('desktop bridge contracts', () => {
  it('keeps contract registries and name lists in sync', () => {
    expect(Object.keys(DESKTOP_BRIDGE_METHODS).sort()).toEqual(
      [...DESKTOP_BRIDGE_METHOD_NAMES].sort()
    );
    expect(Object.keys(DESKTOP_BRIDGE_EVENTS).sort()).toEqual(
      [...DESKTOP_BRIDGE_EVENT_NAMES].sort()
    );
    expect(Object.keys(handlers()).sort()).toEqual([...DESKTOP_BRIDGE_METHOD_NAMES].sort());
  });

  it('registers exactly one native handler for each declared bridge method', () => {
    const registered = new Map<string, unknown>();
    const ipcMain = {
      handle: vi.fn((channel: string, handler: unknown) => {
        registered.set(channel, handler);
      }),
    } as unknown as IpcMain;

    registerDesktopBridge(ipcMain, runtime(), shell(), false);

    expect([...registered.keys()].sort()).toEqual(
      DESKTOP_BRIDGE_METHOD_NAMES.map((method) => DESKTOP_BRIDGE_METHODS[method].channel).sort()
    );
    expect(registered.size).toBe(DESKTOP_BRIDGE_METHOD_NAMES.length);
  });

  it('keeps the preload API method list aligned to invoke and event contracts', () => {
    expect(DESKTOP_PRELOAD_API_METHODS).toEqual([
      ...DESKTOP_BRIDGE_METHOD_NAMES,
      ...Object.values(DESKTOP_PRELOAD_EVENT_METHODS),
    ]);

    for (const method of DESKTOP_BRIDGE_METHOD_NAMES) {
      expect(DESKTOP_BRIDGE_CAPABILITIES).toContain(DESKTOP_BRIDGE_METHODS[method].capability);
    }

    for (const event of DESKTOP_BRIDGE_EVENT_NAMES) {
      expect(DESKTOP_BRIDGE_CAPABILITIES).toContain(DESKTOP_BRIDGE_EVENTS[event].capability);
      expect(DESKTOP_PRELOAD_API_METHODS).toContain(DESKTOP_PRELOAD_EVENT_METHODS[event]);
    }
  });

  it('requires validators for every dangerous bridge method', () => {
    for (const method of DESKTOP_BRIDGE_METHOD_NAMES) {
      if (DESKTOP_BRIDGE_METHODS[method].dangerous) {
        expect(DESKTOP_BRIDGE_METHODS[method].validator).toBeDefined();
        expect(DESKTOP_BRIDGE_METHOD_VALIDATORS[method]).toEqual(expect.any(Function));
      }
    }
  });

  it('blocks desktop-only bridge methods from unsupported client modes', () => {
    expect(() => assertDesktopBridgeMethodAvailable('openExternal', 'desktop')).not.toThrow();
    expect(() => assertDesktopBridgeMethodAvailable('openExternal', 'browser')).toThrow(
      'desktop client'
    );
    expect(() => assertDesktopBridgeMethodAvailable('restartLocalServer', 'mobile')).toThrow(
      'desktop client'
    );
  });

  it('validates dangerous openExternal requests before shell execution', async () => {
    const fakeShell = shell();
    const bridgeHandlers: DesktopBridgeHandlerMap = createDesktopBridgeHandlers(
      runtime(),
      fakeShell,
      false
    );

    await expect(
      bridgeHandlers.openExternal({ url: 'file:///Users/bradgroux/.ssh/id_ed25519' })
    ).rejects.toThrow('protocol is not allowed');
    await expect(bridgeHandlers.openExternal('https://example.com' as never)).rejects.toThrow(
      'typed request object'
    );
    await expect(
      bridgeHandlers.openExternal({ url: 'https://user:pass@example.com' })
    ).rejects.toThrow('credentials are not allowed');

    await bridgeHandlers.openExternal({ url: 'https://example.com/docs' });

    expect(fakeShell.openExternal).toHaveBeenCalledTimes(1);
    expect(fakeShell.openExternal).toHaveBeenCalledWith('https://example.com/docs');
  });

  it('validates restart confirmation before restarting the local server', async () => {
    const fakeRuntime = runtime();
    const bridgeHandlers = createDesktopBridgeHandlers(fakeRuntime, shell(), false);

    expect(() => bridgeHandlers.restartLocalServer({ confirmation: 'restart' } as never)).toThrow(
      'explicit restart confirmation'
    );

    await bridgeHandlers.restartLocalServer({ confirmation: DESKTOP_RESTART_CONFIRMATION });

    expect(fakeRuntime.restartLocalServer).toHaveBeenCalledTimes(1);
    expect(
      validateRestartLocalServerRequest({ confirmation: DESKTOP_RESTART_CONFIRMATION })
    ).toEqual({
      confirmation: DESKTOP_RESTART_CONFIRMATION,
    });
  });

  it('validates connection config without accepting credentials or unsupported protocols', () => {
    expect(validateConnectionConfigRequest({ mode: 'local' })).toEqual({ mode: 'local' });
    expect(
      validateConnectionConfigRequest({
        mode: 'remote',
        serverUrl: ' https://example.com/veritas ',
        workspaceId: 'workspace-1',
      })
    ).toEqual({
      mode: 'remote',
      serverUrl: 'https://example.com/veritas',
      workspaceId: 'workspace-1',
    });
    expect(() =>
      validateConnectionConfigRequest({ mode: 'remote', serverUrl: 'ftp://example.com' })
    ).toThrow('protocol is not allowed');
    expect(() =>
      validateConnectionConfigRequest({ mode: 'remote', serverUrl: 'https://user@example.com' })
    ).toThrow('credentials are not allowed');
  });

  it('validates command names, file paths, notification actions, and work product exports', () => {
    expect(
      validateDesktopCommandDispatchRequest({
        command: DESKTOP_COMMAND_NAMES[0],
        source: 'menu',
        payload: { route: 'settings' },
      })
    ).toEqual({
      command: DESKTOP_COMMAND_NAMES[0],
      source: 'menu',
      payload: { route: 'settings' },
    });
    expect(() => validateDesktopCommandDispatchRequest({ command: 'rm -rf' })).toThrow(
      'command is not allowed'
    );

    expect(
      validateFilePickerRequest({
        purpose: DESKTOP_FILE_PICKER_PURPOSES[0],
        allowMultiple: true,
        allowedExtensions: ['.MD', '.json'],
        initialPath: '/Users/bradgroux/Desktop',
      })
    ).toEqual({
      purpose: DESKTOP_FILE_PICKER_PURPOSES[0],
      allowMultiple: true,
      allowedExtensions: ['.md', '.json'],
      initialPath: '/Users/bradgroux/Desktop',
    });
    expect(() =>
      validateFilePickerRequest({
        purpose: DESKTOP_FILE_PICKER_PURPOSES[0],
        initialPath: 'https://example.com/file.md',
      })
    ).toThrow('local filesystem path');

    expect(validateDiagnosticsBundleRequest({ includeLogs: true, reason: 'support' })).toEqual({
      includeLogs: true,
      includeRuntimeState: undefined,
      reason: 'support',
    });

    expect(
      validateNotificationActionRequest({
        notificationId: 'notice-1',
        action: 'complete-task',
        taskId: 'task-1',
      })
    ).toEqual({
      notificationId: 'notice-1',
      action: 'complete-task',
      taskId: 'task-1',
    });
    expect(() =>
      validateNotificationActionRequest({ notificationId: 'notice-1', action: 'exec' })
    ).toThrow('action is not allowed');

    expect(
      validateWorkProductExportRequest({
        taskId: 'task-1',
        workProductId: 'artifact-1',
        targetPath: '/Users/bradgroux/Desktop/export.md',
        openWhenDone: true,
      })
    ).toEqual({
      taskId: 'task-1',
      workProductId: 'artifact-1',
      targetPath: '/Users/bradgroux/Desktop/export.md',
      openWhenDone: true,
    });
    expect(() =>
      validateWorkProductExportRequest({
        taskId: 'task-1',
        workProductId: 'artifact-1',
        targetPath: 'relative/export.md',
      })
    ).toThrow('absolute local path');
  });

  it('normalizes allowed external URLs', () => {
    expect(validateOpenExternalRequest({ url: ' https://example.com/a ' })).toEqual({
      url: 'https://example.com/a',
    });
    expect(validateOpenExternalRequest({ url: 'mailto:help@example.com' })).toEqual({
      url: 'mailto:help@example.com',
    });
  });

  it('event cleanup unsubscribes once even when cleanup is called repeatedly', () => {
    const detach = vi.fn();
    const handler = vi.fn();
    const cleanup = createDesktopBridgeEventCleanup('desktop:server-status', handler, detach);

    cleanup();
    cleanup();

    expect(detach).toHaveBeenCalledTimes(1);
    expect(detach).toHaveBeenCalledWith('desktop:server-status', handler);
  });

  it('redacts bridge diagnostics and error payloads', () => {
    const redacted = redactDesktopBridgeValue({
      token: 'secret-token',
      message:
        'Authorization: Bearer abc123 VERITAS_ADMIN_KEY=admin-key path=/Users/bradgroux/.ssh',
      nested: {
        webhookSecret: 'hook-secret',
        safe: 'plain value',
      },
    });

    expect(redacted).toEqual({
      token: DESKTOP_REDACTED_VALUE,
      message: `Authorization: Bearer ${DESKTOP_REDACTED_VALUE} VERITAS_ADMIN_KEY=${DESKTOP_REDACTED_VALUE} path=/Users/${DESKTOP_REDACTED_VALUE}/.ssh`,
      nested: {
        webhookSecret: DESKTOP_REDACTED_VALUE,
        safe: 'plain value',
      },
    });

    expect(
      redactDesktopBridgeError(
        new Error('Failed with token=abc123 from /Users/bradgroux/Projects/veritas-kanban')
      )
    ).toBe(
      `Failed with token=${DESKTOP_REDACTED_VALUE} from /Users/${DESKTOP_REDACTED_VALUE}/Projects/veritas-kanban`
    );
  });

  it('returns redacted setup diagnostics and support snapshots', () => {
    const support = createDesktopSupportSnapshot(snapshot(), new Date('2026-05-31T12:00:00.000Z'));
    const diagnostics = createDesktopSetupDiagnostics(
      snapshot(),
      new Date('2026-05-31T12:00:00.000Z')
    );

    expect(support.generatedAt).toBe('2026-05-31T12:00:00.000Z');
    expect(support.status.appHome).toBe(
      `/Users/${DESKTOP_REDACTED_VALUE}/Projects/veritas-kanban/.veritas-desktop-dev/fresh`
    );
    expect(diagnostics.checks.map((check) => check.name)).toEqual([
      'local-server-health',
      'renderer-health',
      'communication-health',
      'cli-auth',
      'mcp-auth',
    ]);
    expect(diagnostics.supportSnapshot.status.appHome).toContain(DESKTOP_REDACTED_VALUE);
  });
});
