import { contextBridge, ipcRenderer } from 'electron';

import type { DesktopAppInfo, DesktopStatusSnapshot } from '../main/types.js';
import {
  createDesktopBridgeEventCleanup,
  DESKTOP_RESTART_CONFIRMATION,
  DESKTOP_BRIDGE_EVENTS,
  DESKTOP_BRIDGE_METHODS,
  type DesktopBridgeEvent,
  type DesktopBridgeEventPayload,
  type DesktopCommandDispatchRequest,
  type DesktopCommandDispatchResult,
  type DesktopConnectionConfigRequest,
  type DesktopConnectionValidationResult,
  type DesktopDiagnosticsBundleRequest,
  type DesktopDiagnosticsBundleResult,
  type DesktopFilePickerRequest,
  type DesktopFilePickerResult,
  type DesktopNotificationActionRequest,
  type DesktopNotificationActionResult,
  type DesktopSetupDiagnostics,
  type DesktopSupportSnapshot,
  type DesktopUpdateStatus,
  type DesktopWorkProductExportRequest,
  type DesktopWorkProductExportResult,
} from '../shared/desktop-bridge-contracts.js';

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
