import type { IpcMain, Shell } from 'electron';

import { DESKTOP_APP_ID, DESKTOP_APP_NAME } from './app-metadata.js';
import type { DesktopCommandDispatcher } from './commands.js';
import type { DesktopAppInfo } from './types.js';
import type { DesktopRuntime } from './runtime.js';
import type { DesktopUpdateService } from './updates.js';
import {
  createDesktopSetupDiagnostics,
  createDesktopSupportSnapshot,
  DESKTOP_BRIDGE_METHOD_NAMES,
  DESKTOP_BRIDGE_METHODS,
  DESKTOP_BRIDGE_METHOD_VALIDATORS,
  redactDesktopBridgeError,
  validateConnectionConfigRequest,
  validateDesktopCommandDispatchRequest,
  validateDiagnosticsBundleRequest,
  validateFilePickerRequest,
  validateNotificationActionRequest,
  validateOpenExternalRequest,
  validateRestartLocalServerRequest,
  validateWorkProductExportRequest,
  type DesktopBridgeMethod,
  type DesktopBridgeRequest,
  type DesktopBridgeResponse,
  type DesktopConnectionConfigRequest,
  type DesktopConnectionValidationResult,
} from '../shared/desktop-bridge-contracts.js';

type MaybePromise<T> = T | Promise<T>;

export type DesktopBridgeHandlerMap = {
  [Method in DesktopBridgeMethod]: (
    request: DesktopBridgeRequest<Method>
  ) => MaybePromise<DesktopBridgeResponse<Method>>;
};

async function validateRemoteConnection(
  config: DesktopConnectionConfigRequest
): Promise<DesktopConnectionValidationResult> {
  if (!config.serverUrl) {
    return {
      mode: 'remote',
      valid: false,
      normalizedServerUrl: null,
      warnings: [],
      errors: ['Remote server URL is required.'],
    };
  }

  const statusUrl = new URL('/api/auth/status', config.serverUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);

  try {
    const response = await fetch(statusUrl, {
      method: 'GET',
      headers: config.serverToken ? { Authorization: `Bearer ${config.serverToken}` } : undefined,
      signal: controller.signal,
    });
    const warnings: string[] = [];
    if (response.status === 401 || response.status === 403) {
      warnings.push('Remote server is reachable but rejected the supplied credentials.');
    }
    if (response.ok) {
      return {
        mode: 'remote',
        valid: true,
        normalizedServerUrl: config.serverUrl,
        warnings,
        errors: [],
      };
    }

    return {
      mode: 'remote',
      valid: false,
      normalizedServerUrl: config.serverUrl,
      warnings,
      errors: [`Remote server returned HTTP ${response.status}.`],
    };
  } catch (error) {
    return {
      mode: 'remote',
      valid: false,
      normalizedServerUrl: config.serverUrl,
      warnings: [],
      errors: [redactDesktopBridgeError(error)],
    };
  } finally {
    clearTimeout(timeout);
  }
}

export function createDesktopBridgeHandlers(
  runtime: DesktopRuntime,
  shell: Shell,
  packaged: boolean,
  commandDispatcher?: DesktopCommandDispatcher,
  updateService?: DesktopUpdateService
): DesktopBridgeHandlerMap {
  const appInfo = (): DesktopAppInfo => ({
    name: DESKTOP_APP_NAME,
    appId: DESKTOP_APP_ID,
    version: process.env.npm_package_version || '0.0.0',
    platform: process.platform,
    packaged,
  });

  return {
    getAppInfo: appInfo,
    getConnectionStatus: () => runtime.snapshot(),
    getSetupDiagnostics: () => createDesktopSetupDiagnostics(runtime.snapshot()),
    validateConnectionConfig: async (request) => {
      const config = validateConnectionConfigRequest(request);
      if (config.mode === 'remote') {
        return validateRemoteConnection(config);
      }
      const status = runtime.snapshot();
      return {
        mode: config.mode,
        valid: status.server.state === 'ready',
        normalizedServerUrl: config.serverUrl ?? null,
        warnings: status.server.state === 'ready' ? [] : ['Local server is not ready.'],
        errors: status.server.lastError ? [status.server.lastError] : [],
      };
    },
    restartLocalServer: (request) => {
      validateRestartLocalServerRequest(request);
      return runtime.restartLocalServer();
    },
    getSupportSnapshot: () => createDesktopSupportSnapshot(runtime.snapshot()),
    getUpdateStatus: () =>
      updateService?.snapshot() ?? {
        state: 'unsupported',
        currentVersion: appInfo().version,
        channel: packaged ? 'stable' : 'dev',
        checkedAt: new Date().toISOString(),
        detail: 'Updater service is not initialized.',
      },
    dispatchCommand: (request) => {
      const command = validateDesktopCommandDispatchRequest(request);
      return commandDispatcher
        ? commandDispatcher.dispatch(command)
        : {
            command: command.command,
            accepted: false,
            handledBy: 'unsupported',
            message: 'Native command handling is reserved for the desktop menus issue.',
          };
    },
    pickUploadFiles: (request) => {
      validateFilePickerRequest(request);
      return {
        cancelled: true,
        files: [],
      };
    },
    createDiagnosticsBundle: (request) => {
      validateDiagnosticsBundleRequest(request);
      return {
        bundlePath: null,
        redacted: true,
        warnings: ['Diagnostics bundle creation is reserved for the diagnostics workflow.'],
      };
    },
    performNotificationAction: (request) => {
      const action = validateNotificationActionRequest(request);
      return {
        notificationId: action.notificationId,
        action: action.action,
        accepted: false,
        message: 'Native notification handling is reserved for the notifications issue.',
      };
    },
    exportWorkProduct: (request) => {
      validateWorkProductExportRequest(request);
      return {
        exportedPath: null,
        opened: false,
        warnings: ['Native work product export is reserved for the work products issue.'],
      };
    },
    openExternal: async (request) => {
      const { url } = validateOpenExternalRequest(request);
      await shell.openExternal(url);
      return undefined;
    },
  };
}

export function registerDesktopBridge(
  ipcMain: IpcMain,
  runtime: DesktopRuntime,
  shell: Shell,
  packaged: boolean,
  commandDispatcher?: DesktopCommandDispatcher,
  updateService?: DesktopUpdateService
): void {
  const handlers = createDesktopBridgeHandlers(
    runtime,
    shell,
    packaged,
    commandDispatcher,
    updateService
  );

  for (const method of DESKTOP_BRIDGE_METHOD_NAMES) {
    const definition = DESKTOP_BRIDGE_METHODS[method];
    const handler = handlers[method] as (request: unknown) => MaybePromise<unknown>;
    const validator = DESKTOP_BRIDGE_METHOD_VALIDATORS[method] as
      | ((payload: unknown) => unknown)
      | undefined;

    ipcMain.handle(definition.channel, async (_event, request: unknown) => {
      try {
        return await handler(validator ? validator(request) : request);
      } catch (error) {
        throw new Error(redactDesktopBridgeError(error));
      }
    });
  }
}
