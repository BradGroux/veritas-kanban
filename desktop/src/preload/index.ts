import { contextBridge, ipcRenderer } from 'electron';

import type { DesktopAppInfo, DesktopStatusSnapshot } from '../main/types.js';
import type {
  DesktopBridgeEventPayload,
  DesktopCommandDispatchRequest,
  DesktopCommandDispatchResult,
  DesktopConnectionConfigRequest,
  DesktopConnectionValidationResult,
  DesktopDiagnosticsBundleRequest,
  DesktopDiagnosticsBundleResult,
  DesktopFilePickerRequest,
  DesktopFilePickerResult,
  DesktopNotificationActionRequest,
  DesktopNotificationActionResult,
  DesktopSetupDiagnostics,
  DesktopSupportSnapshot,
  DesktopUpdateStatus,
  DesktopWindowToggleMaximizeResult,
  DesktopWorkProductExportRequest,
  DesktopWorkProductExportResult,
} from '../shared/desktop-bridge-contracts.js';

const DESKTOP_RESTART_CONFIRMATION = 'restart-local-server';

const DESKTOP_BRIDGE_METHODS = {
  getAppInfo: { channel: 'desktop:get-app-info' },
  getConnectionStatus: { channel: 'desktop:get-connection-status' },
  getSetupDiagnostics: { channel: 'desktop:get-setup-diagnostics' },
  validateConnectionConfig: { channel: 'desktop:validate-connection-config' },
  restartLocalServer: { channel: 'desktop:restart-local-server' },
  getSupportSnapshot: { channel: 'desktop:get-support-snapshot' },
  getUpdateStatus: { channel: 'desktop:get-update-status' },
  dispatchCommand: { channel: 'desktop:dispatch-command' },
  pickUploadFiles: { channel: 'desktop:pick-upload-files' },
  createDiagnosticsBundle: { channel: 'desktop:create-diagnostics-bundle' },
  performNotificationAction: { channel: 'desktop:perform-notification-action' },
  exportWorkProduct: { channel: 'desktop:export-work-product' },
  openExternal: { channel: 'desktop:open-external' },
  toggleWindowMaximize: { channel: 'desktop:toggle-window-maximize' },
} as const;

const DESKTOP_BRIDGE_EVENTS = {
  setupProgress: { channel: 'desktop:setup-progress' },
  communicationCheck: { channel: 'desktop:communication-check' },
  serverStatus: { channel: 'desktop:server-status' },
  runProgress: { channel: 'desktop:run-progress' },
  updateStatus: { channel: 'desktop:update-status' },
  notificationAction: { channel: 'desktop:notification-action' },
  menuCommand: { channel: 'desktop:menu-command' },
  uploadProgress: { channel: 'desktop:upload-progress' },
  workProductExportProgress: { channel: 'desktop:work-product-export-progress' },
  externalDeliveryVerification: { channel: 'desktop:external-delivery-verification' },
} as const;

type DesktopBridgeEvent = keyof typeof DESKTOP_BRIDGE_EVENTS;

function createDesktopBridgeEventCleanup<Handler>(
  channel: string,
  handler: Handler,
  detach: (channel: string, handler: Handler) => void
): () => void {
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    detach(channel, handler);
  };
}

export interface VeritasDesktopApi {
  getAppInfo(): Promise<DesktopAppInfo>;
  getConnectionStatus(): Promise<DesktopStatusSnapshot>;
  getSetupDiagnostics(): Promise<DesktopSetupDiagnostics>;
  validateConnectionConfig(
    request: DesktopConnectionConfigRequest
  ): Promise<DesktopConnectionValidationResult>;
  restartLocalServer(): Promise<DesktopStatusSnapshot>;
  getSupportSnapshot(): Promise<DesktopSupportSnapshot>;
  getUpdateStatus(): Promise<DesktopUpdateStatus>;
  dispatchCommand(request: DesktopCommandDispatchRequest): Promise<DesktopCommandDispatchResult>;
  pickUploadFiles(request: DesktopFilePickerRequest): Promise<DesktopFilePickerResult>;
  createDiagnosticsBundle(
    request: DesktopDiagnosticsBundleRequest
  ): Promise<DesktopDiagnosticsBundleResult>;
  performNotificationAction(
    request: DesktopNotificationActionRequest
  ): Promise<DesktopNotificationActionResult>;
  exportWorkProduct(
    request: DesktopWorkProductExportRequest
  ): Promise<DesktopWorkProductExportResult>;
  openExternal(url: string): Promise<void>;
  toggleWindowMaximize(): Promise<DesktopWindowToggleMaximizeResult>;
  onSetupProgress(listener: BridgeEventListener<'setupProgress'>): () => void;
  onCommunicationCheck(listener: BridgeEventListener<'communicationCheck'>): () => void;
  onServerStatus(listener: (status: DesktopStatusSnapshot) => void): () => void;
  onRunProgress(listener: BridgeEventListener<'runProgress'>): () => void;
  onUpdateStatus(listener: BridgeEventListener<'updateStatus'>): () => void;
  onNotificationAction(listener: BridgeEventListener<'notificationAction'>): () => void;
  onMenuCommand(listener: BridgeEventListener<'menuCommand'>): () => void;
  onUploadProgress(listener: BridgeEventListener<'uploadProgress'>): () => void;
  onWorkProductExportProgress(
    listener: BridgeEventListener<'workProductExportProgress'>
  ): () => void;
  onExternalDeliveryVerification(
    listener: BridgeEventListener<'externalDeliveryVerification'>
  ): () => void;
}

type BridgeEventListener<Event extends DesktopBridgeEvent> = (
  payload: DesktopBridgeEventPayload<Event>
) => void;

function invokeDesktop<ReturnValue>(channel: string, request?: unknown): Promise<ReturnValue> {
  return ipcRenderer.invoke(channel, request) as Promise<ReturnValue>;
}

function onDesktopEvent<Event extends DesktopBridgeEvent>(
  event: Event,
  listener: BridgeEventListener<Event>
): () => void {
  const channel = DESKTOP_BRIDGE_EVENTS[event].channel;
  const handler = (
    _event: Electron.IpcRendererEvent,
    payload: DesktopBridgeEventPayload<Event>
  ): void => {
    listener(payload);
  };
  ipcRenderer.on(channel, handler);
  return createDesktopBridgeEventCleanup(channel, handler, (eventChannel, eventHandler) => {
    ipcRenderer.off(eventChannel, eventHandler);
  });
}

const api: VeritasDesktopApi = {
  getAppInfo: () => invokeDesktop<DesktopAppInfo>(DESKTOP_BRIDGE_METHODS.getAppInfo.channel),
  getConnectionStatus: () =>
    invokeDesktop<DesktopStatusSnapshot>(DESKTOP_BRIDGE_METHODS.getConnectionStatus.channel),
  getSetupDiagnostics: () =>
    invokeDesktop<DesktopSetupDiagnostics>(DESKTOP_BRIDGE_METHODS.getSetupDiagnostics.channel),
  validateConnectionConfig: (request) =>
    invokeDesktop<DesktopConnectionValidationResult>(
      DESKTOP_BRIDGE_METHODS.validateConnectionConfig.channel,
      request
    ),
  restartLocalServer: () =>
    invokeDesktop<DesktopStatusSnapshot>(DESKTOP_BRIDGE_METHODS.restartLocalServer.channel, {
      confirmation: DESKTOP_RESTART_CONFIRMATION,
    }),
  getSupportSnapshot: () =>
    invokeDesktop<DesktopSupportSnapshot>(DESKTOP_BRIDGE_METHODS.getSupportSnapshot.channel),
  getUpdateStatus: () =>
    invokeDesktop<DesktopUpdateStatus>(DESKTOP_BRIDGE_METHODS.getUpdateStatus.channel),
  dispatchCommand: (request) =>
    invokeDesktop<DesktopCommandDispatchResult>(
      DESKTOP_BRIDGE_METHODS.dispatchCommand.channel,
      request
    ),
  pickUploadFiles: (request) =>
    invokeDesktop<DesktopFilePickerResult>(DESKTOP_BRIDGE_METHODS.pickUploadFiles.channel, request),
  createDiagnosticsBundle: (request) =>
    invokeDesktop<DesktopDiagnosticsBundleResult>(
      DESKTOP_BRIDGE_METHODS.createDiagnosticsBundle.channel,
      request
    ),
  performNotificationAction: (request) =>
    invokeDesktop<DesktopNotificationActionResult>(
      DESKTOP_BRIDGE_METHODS.performNotificationAction.channel,
      request
    ),
  exportWorkProduct: (request) =>
    invokeDesktop<DesktopWorkProductExportResult>(
      DESKTOP_BRIDGE_METHODS.exportWorkProduct.channel,
      request
    ),
  openExternal: (url: string) =>
    invokeDesktop<void>(DESKTOP_BRIDGE_METHODS.openExternal.channel, { url }),
  toggleWindowMaximize: () =>
    invokeDesktop<DesktopWindowToggleMaximizeResult>(
      DESKTOP_BRIDGE_METHODS.toggleWindowMaximize.channel
    ),
  onSetupProgress: (listener) => onDesktopEvent('setupProgress', listener),
  onCommunicationCheck: (listener) => onDesktopEvent('communicationCheck', listener),
  onServerStatus: (listener) => onDesktopEvent('serverStatus', listener),
  onRunProgress: (listener) => onDesktopEvent('runProgress', listener),
  onUpdateStatus: (listener) => onDesktopEvent('updateStatus', listener),
  onNotificationAction: (listener) => onDesktopEvent('notificationAction', listener),
  onMenuCommand: (listener) => onDesktopEvent('menuCommand', listener),
  onUploadProgress: (listener) => onDesktopEvent('uploadProgress', listener),
  onWorkProductExportProgress: (listener) => onDesktopEvent('workProductExportProgress', listener),
  onExternalDeliveryVerification: (listener) =>
    onDesktopEvent('externalDeliveryVerification', listener),
};

contextBridge.exposeInMainWorld('veritasDesktop', api);
