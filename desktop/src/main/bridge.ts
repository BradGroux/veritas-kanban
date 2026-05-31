import type { IpcMain, Shell } from 'electron';

import { DESKTOP_APP_ID, DESKTOP_APP_NAME } from './app-metadata.js';
import type { DesktopAppInfo } from './types.js';
import type { DesktopRuntime } from './runtime.js';
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
} from '../shared/desktop-bridge-contracts.js';

type MaybePromise<T> = T | Promise<T>;

export type DesktopBridgeHandlerMap = {
  [Method in DesktopBridgeMethod]: (
    request: DesktopBridgeRequest<Method>
  ) => MaybePromise<DesktopBridgeResponse<Method>>;
};

export function createDesktopBridgeHandlers(
  runtime: DesktopRuntime,
  shell: Shell,
  packaged: boolean
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
    validateConnectionConfig: (request) => {
      const config = validateConnectionConfigRequest(request);
      return {
        mode: config.mode,
        valid: true,
        normalizedServerUrl: config.serverUrl ?? null,
        warnings: [],
        errors: [],
      };
    },
    restartLocalServer: (request) => {
      validateRestartLocalServerRequest(request);
      return runtime.restartLocalServer();
    },
    getSupportSnapshot: () => createDesktopSupportSnapshot(runtime.snapshot()),
    getUpdateStatus: () => ({
      state: 'unsupported',
      currentVersion: appInfo().version,
      channel: packaged ? 'stable' : 'dev',
      checkedAt: new Date().toISOString(),
      detail: 'Updater implementation is tracked in the desktop release pipeline issue.',
    }),
    dispatchCommand: (request) => {
      const command = validateDesktopCommandDispatchRequest(request);
      return {
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
  packaged: boolean
): void {
  const handlers = createDesktopBridgeHandlers(runtime, shell, packaged);

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
