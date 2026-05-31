import type { DesktopAppInfo, DesktopStatusSnapshot } from '../main/types.js';

export const DESKTOP_REDACTED_VALUE = '[redacted]';
export const DESKTOP_RESTART_CONFIRMATION = 'restart-local-server';

export const DESKTOP_BRIDGE_CAPABILITIES = [
  'setup',
  'serverLifecycle',
  'connection',
  'secrets',
  'logs',
  'backupImport',
  'diagnostics',
  'updates',
  'notifications',
  'deepLinks',
  'shell',
] as const;

export type DesktopBridgeCapability = (typeof DESKTOP_BRIDGE_CAPABILITIES)[number];
export type DesktopBridgeClientMode = 'desktop' | 'browser' | 'remote' | 'mobile';
export type DesktopBridgeHealthState = 'ok' | 'warning' | 'failed' | 'unknown' | 'unsupported';
export type DesktopBridgeValidatorName =
  | 'restartLocalServer'
  | 'openExternal'
  | 'validateConnectionConfig'
  | 'dispatchCommand'
  | 'pickUploadFiles'
  | 'createDiagnosticsBundle'
  | 'performNotificationAction'
  | 'exportWorkProduct';

interface DesktopBridgeMethodDefinition {
  capability: DesktopBridgeCapability;
  channel: string;
  desktopOnly: boolean;
  dangerous: boolean;
  validator?: DesktopBridgeValidatorName;
}

export interface DesktopRestartLocalServerRequest {
  confirmation: typeof DESKTOP_RESTART_CONFIRMATION;
}

export interface OpenExternalRequest {
  url: string;
}

export type DesktopConnectionModeRequest = 'local' | 'remote';

export interface DesktopConnectionConfigRequest {
  mode: DesktopConnectionModeRequest;
  serverUrl?: string;
  workspaceId?: string;
}

export interface DesktopConnectionValidationResult {
  mode: DesktopConnectionModeRequest;
  valid: boolean;
  normalizedServerUrl: string | null;
  warnings: string[];
  errors: string[];
}

export interface DesktopSupportSnapshot {
  generatedAt: string;
  status: DesktopStatusSnapshot;
  warnings: string[];
}

export interface DesktopSetupDiagnosticCheck {
  name: string;
  state: DesktopBridgeHealthState;
  detail: string;
  checkedAt: string;
}

export interface DesktopSetupDiagnostics {
  generatedAt: string;
  checks: DesktopSetupDiagnosticCheck[];
  supportSnapshot: DesktopSupportSnapshot;
}

export const DESKTOP_COMMAND_NAMES = [
  'open-settings',
  'open-command-center',
  'restart-local-server',
  'show-diagnostics',
  'check-for-updates',
  'export-work-product',
] as const;

export type DesktopCommandName = (typeof DESKTOP_COMMAND_NAMES)[number];
export type DesktopCommandSource = 'renderer' | 'menu' | 'shortcut' | 'deep-link';

export interface DesktopCommandDispatchRequest {
  command: DesktopCommandName;
  source?: DesktopCommandSource;
  payload?: Record<string, unknown>;
}

export interface DesktopCommandDispatchResult {
  command: DesktopCommandName;
  accepted: boolean;
  handledBy: 'desktop' | 'renderer' | 'unsupported';
  message?: string;
}

export const DESKTOP_FILE_PICKER_PURPOSES = [
  'attachment-upload',
  'markdown-import',
  'work-product-import',
  'backup-restore',
] as const;

export type DesktopFilePickerPurpose = (typeof DESKTOP_FILE_PICKER_PURPOSES)[number];

export interface DesktopFilePickerRequest {
  purpose: DesktopFilePickerPurpose;
  allowMultiple?: boolean;
  allowedExtensions?: string[];
  initialPath?: string;
}

export interface DesktopSelectedFile {
  path: string;
  name: string;
  sizeBytes?: number;
  mimeType?: string;
}

export interface DesktopFilePickerResult {
  cancelled: boolean;
  files: DesktopSelectedFile[];
}

export interface DesktopDiagnosticsBundleRequest {
  includeLogs?: boolean;
  includeRuntimeState?: boolean;
  reason?: string;
}

export interface DesktopDiagnosticsBundleResult {
  bundlePath: string | null;
  redacted: boolean;
  warnings: string[];
}

export interface DesktopUpdateStatus {
  state: 'unsupported' | 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'failed';
  currentVersion: string;
  channel: 'dev' | 'beta' | 'stable';
  checkedAt: string;
  detail?: string;
}

export const DESKTOP_NOTIFICATION_ACTIONS = ['open', 'dismiss', 'snooze', 'complete-task'] as const;

export type DesktopNotificationAction = (typeof DESKTOP_NOTIFICATION_ACTIONS)[number];

export interface DesktopNotificationActionRequest {
  notificationId: string;
  action: DesktopNotificationAction;
  taskId?: string;
}

export interface DesktopNotificationActionResult {
  notificationId: string;
  action: DesktopNotificationAction;
  accepted: boolean;
  message?: string;
}

export interface DesktopWorkProductExportRequest {
  taskId: string;
  workProductId: string;
  targetPath?: string;
  openWhenDone?: boolean;
}

export interface DesktopWorkProductExportResult {
  exportedPath: string | null;
  opened: boolean;
  warnings: string[];
}

export const DESKTOP_BRIDGE_METHODS = {
  getAppInfo: {
    capability: 'setup',
    channel: 'desktop:get-app-info',
    desktopOnly: true,
    dangerous: false,
  },
  getConnectionStatus: {
    capability: 'connection',
    channel: 'desktop:get-connection-status',
    desktopOnly: true,
    dangerous: false,
  },
  getSetupDiagnostics: {
    capability: 'setup',
    channel: 'desktop:get-setup-diagnostics',
    desktopOnly: true,
    dangerous: false,
  },
  validateConnectionConfig: {
    capability: 'connection',
    channel: 'desktop:validate-connection-config',
    desktopOnly: true,
    dangerous: true,
    validator: 'validateConnectionConfig',
  },
  restartLocalServer: {
    capability: 'serverLifecycle',
    channel: 'desktop:restart-local-server',
    desktopOnly: true,
    dangerous: true,
    validator: 'restartLocalServer',
  },
  getSupportSnapshot: {
    capability: 'diagnostics',
    channel: 'desktop:get-support-snapshot',
    desktopOnly: true,
    dangerous: false,
  },
  getUpdateStatus: {
    capability: 'updates',
    channel: 'desktop:get-update-status',
    desktopOnly: true,
    dangerous: false,
  },
  dispatchCommand: {
    capability: 'shell',
    channel: 'desktop:dispatch-command',
    desktopOnly: true,
    dangerous: true,
    validator: 'dispatchCommand',
  },
  pickUploadFiles: {
    capability: 'backupImport',
    channel: 'desktop:pick-upload-files',
    desktopOnly: true,
    dangerous: true,
    validator: 'pickUploadFiles',
  },
  createDiagnosticsBundle: {
    capability: 'diagnostics',
    channel: 'desktop:create-diagnostics-bundle',
    desktopOnly: true,
    dangerous: true,
    validator: 'createDiagnosticsBundle',
  },
  performNotificationAction: {
    capability: 'notifications',
    channel: 'desktop:perform-notification-action',
    desktopOnly: true,
    dangerous: true,
    validator: 'performNotificationAction',
  },
  exportWorkProduct: {
    capability: 'backupImport',
    channel: 'desktop:export-work-product',
    desktopOnly: true,
    dangerous: true,
    validator: 'exportWorkProduct',
  },
  openExternal: {
    capability: 'shell',
    channel: 'desktop:open-external',
    desktopOnly: true,
    dangerous: true,
    validator: 'openExternal',
  },
} as const satisfies Record<string, DesktopBridgeMethodDefinition>;

export const DESKTOP_BRIDGE_METHOD_NAMES = [
  'getAppInfo',
  'getConnectionStatus',
  'getSetupDiagnostics',
  'validateConnectionConfig',
  'restartLocalServer',
  'getSupportSnapshot',
  'getUpdateStatus',
  'dispatchCommand',
  'pickUploadFiles',
  'createDiagnosticsBundle',
  'performNotificationAction',
  'exportWorkProduct',
  'openExternal',
] as const;

export type DesktopBridgeMethod = (typeof DESKTOP_BRIDGE_METHOD_NAMES)[number];

export const DESKTOP_BRIDGE_EVENTS = {
  setupProgress: {
    capability: 'setup',
    channel: 'desktop:setup-progress',
    desktopOnly: true,
  },
  communicationCheck: {
    capability: 'connection',
    channel: 'desktop:communication-check',
    desktopOnly: true,
  },
  serverStatus: {
    capability: 'serverLifecycle',
    channel: 'desktop:server-status',
    desktopOnly: true,
  },
  runProgress: {
    capability: 'logs',
    channel: 'desktop:run-progress',
    desktopOnly: true,
  },
  updateStatus: {
    capability: 'updates',
    channel: 'desktop:update-status',
    desktopOnly: true,
  },
  notificationAction: {
    capability: 'notifications',
    channel: 'desktop:notification-action',
    desktopOnly: true,
  },
  menuCommand: {
    capability: 'shell',
    channel: 'desktop:menu-command',
    desktopOnly: true,
  },
  uploadProgress: {
    capability: 'backupImport',
    channel: 'desktop:upload-progress',
    desktopOnly: true,
  },
  workProductExportProgress: {
    capability: 'backupImport',
    channel: 'desktop:work-product-export-progress',
    desktopOnly: true,
  },
  externalDeliveryVerification: {
    capability: 'connection',
    channel: 'desktop:external-delivery-verification',
    desktopOnly: true,
  },
} as const satisfies Record<
  string,
  { capability: DesktopBridgeCapability; channel: string; desktopOnly: boolean }
>;

export const DESKTOP_BRIDGE_EVENT_NAMES = [
  'setupProgress',
  'communicationCheck',
  'serverStatus',
  'runProgress',
  'updateStatus',
  'notificationAction',
  'menuCommand',
  'uploadProgress',
  'workProductExportProgress',
  'externalDeliveryVerification',
] as const;

export type DesktopBridgeEvent = (typeof DESKTOP_BRIDGE_EVENT_NAMES)[number];

export const DESKTOP_PRELOAD_EVENT_METHODS = {
  setupProgress: 'onSetupProgress',
  communicationCheck: 'onCommunicationCheck',
  serverStatus: 'onServerStatus',
  runProgress: 'onRunProgress',
  updateStatus: 'onUpdateStatus',
  notificationAction: 'onNotificationAction',
  menuCommand: 'onMenuCommand',
  uploadProgress: 'onUploadProgress',
  workProductExportProgress: 'onWorkProductExportProgress',
  externalDeliveryVerification: 'onExternalDeliveryVerification',
} as const satisfies Record<DesktopBridgeEvent, string>;

export const DESKTOP_PRELOAD_API_METHODS = [
  ...DESKTOP_BRIDGE_METHOD_NAMES,
  ...Object.values(DESKTOP_PRELOAD_EVENT_METHODS),
] as const;

export interface DesktopBridgeRequestMap {
  getAppInfo: undefined;
  getConnectionStatus: undefined;
  getSetupDiagnostics: undefined;
  validateConnectionConfig: DesktopConnectionConfigRequest;
  restartLocalServer: DesktopRestartLocalServerRequest;
  getSupportSnapshot: undefined;
  getUpdateStatus: undefined;
  dispatchCommand: DesktopCommandDispatchRequest;
  pickUploadFiles: DesktopFilePickerRequest;
  createDiagnosticsBundle: DesktopDiagnosticsBundleRequest;
  performNotificationAction: DesktopNotificationActionRequest;
  exportWorkProduct: DesktopWorkProductExportRequest;
  openExternal: OpenExternalRequest;
}

export interface DesktopBridgeResponseMap {
  getAppInfo: DesktopAppInfo;
  getConnectionStatus: DesktopStatusSnapshot;
  getSetupDiagnostics: DesktopSetupDiagnostics;
  validateConnectionConfig: DesktopConnectionValidationResult;
  restartLocalServer: DesktopStatusSnapshot;
  getSupportSnapshot: DesktopSupportSnapshot;
  getUpdateStatus: DesktopUpdateStatus;
  dispatchCommand: DesktopCommandDispatchResult;
  pickUploadFiles: DesktopFilePickerResult;
  createDiagnosticsBundle: DesktopDiagnosticsBundleResult;
  performNotificationAction: DesktopNotificationActionResult;
  exportWorkProduct: DesktopWorkProductExportResult;
  openExternal: undefined;
}

export interface DesktopBridgeEventPayloadMap {
  setupProgress: {
    step: string;
    state: DesktopBridgeHealthState;
    message?: string;
    updatedAt: string;
  };
  communicationCheck: {
    target: 'server' | 'renderer' | 'cli' | 'mcp' | 'external';
    state: DesktopBridgeHealthState;
    detail?: string;
    checkedAt: string;
  };
  serverStatus: DesktopStatusSnapshot;
  runProgress: {
    runId: string;
    state: 'queued' | 'running' | 'completed' | 'failed';
    detail?: string;
    updatedAt: string;
  };
  updateStatus: DesktopUpdateStatus;
  notificationAction: DesktopNotificationActionRequest;
  menuCommand: DesktopCommandDispatchRequest;
  uploadProgress: {
    uploadId: string;
    state: 'queued' | 'running' | 'completed' | 'failed';
    uploadedBytes: number;
    totalBytes?: number;
    updatedAt: string;
  };
  workProductExportProgress: {
    exportId: string;
    state: 'queued' | 'running' | 'completed' | 'failed';
    detail?: string;
    updatedAt: string;
  };
  externalDeliveryVerification: {
    deliveryId: string;
    target: string;
    state: DesktopBridgeHealthState;
    checkedAt: string;
  };
}

export type DesktopBridgeRequest<Method extends DesktopBridgeMethod> =
  DesktopBridgeRequestMap[Method];

export type DesktopBridgeResponse<Method extends DesktopBridgeMethod> =
  DesktopBridgeResponseMap[Method];

export type DesktopBridgeEventPayload<Event extends DesktopBridgeEvent> =
  DesktopBridgeEventPayloadMap[Event];

type DesktopBridgeValidatorMap = Partial<{
  [Method in DesktopBridgeMethod]: (payload: unknown) => DesktopBridgeRequest<Method>;
}>;

export const DESKTOP_BRIDGE_METHOD_VALIDATORS: DesktopBridgeValidatorMap = {
  restartLocalServer: validateRestartLocalServerRequest,
  openExternal: validateOpenExternalRequest,
  validateConnectionConfig: validateConnectionConfigRequest,
  dispatchCommand: validateDesktopCommandDispatchRequest,
  pickUploadFiles: validateFilePickerRequest,
  createDiagnosticsBundle: validateDiagnosticsBundleRequest,
  performNotificationAction: validateNotificationActionRequest,
  exportWorkProduct: validateWorkProductExportRequest,
};

export function assertDesktopBridgeMethodAvailable(
  method: DesktopBridgeMethod,
  clientMode: DesktopBridgeClientMode
): void {
  if (DESKTOP_BRIDGE_METHODS[method].desktopOnly && clientMode !== 'desktop') {
    throw new Error(`Bridge method ${method} is available only in the desktop client`);
  }
}

export function createDesktopBridgeEventCleanup<Handler>(
  channel: string,
  handler: Handler,
  detach: (channel: string, handler: Handler) => void
): () => void {
  let active = true;
  return () => {
    if (!active) {
      return;
    }
    active = false;
    detach(channel, handler);
  };
}

const SAFE_EXTERNAL_PROTOCOLS = new Set(['https:', 'http:', 'mailto:']);
const SAFE_CONNECTION_PROTOCOLS = new Set(['https:', 'http:']);
const SAFE_COMMAND_SOURCES = new Set<DesktopCommandSource>([
  'renderer',
  'menu',
  'shortcut',
  'deep-link',
]);
const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const SENSITIVE_KEY_PATTERN =
  /(authorization|cookie|password|secret|token|api[_-]?key|admin[_-]?key|webhook)/i;
const SECRET_ASSIGNMENT_PATTERN =
  /\b([a-z0-9_.-]*(?:token|secret|password|api[_-]?key|admin[_-]?key|webhook)[a-z0-9_.-]*)=([^\s&]+)/gi;
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const USER_PATH_PATTERN = /\/Users\/[^/\s]+/g;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`${label} requires a typed request object`);
  }
  return value;
}

function requireString(value: unknown, label: string, maxLength = 4096): string {
  if (typeof value !== 'string') {
    throw new Error(`${label} must be a string`);
  }

  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    throw new Error(`${label} is empty or too long`);
  }
  return normalized;
}

function optionalBoolean(value: unknown, label: string): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'boolean') {
    throw new Error(`${label} must be a boolean`);
  }
  return value;
}

function optionalSafeId(value: unknown, label: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return validateSafeId(value, label);
}

function validateSafeId(value: unknown, label: string): string {
  const id = requireString(value, label, 128);
  if (!SAFE_ID_PATTERN.test(id)) {
    throw new Error(`${label} contains unsupported characters`);
  }
  return id;
}

function validateOptionalPayload(value: unknown): Record<string, unknown> | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    throw new Error('Command payload must be an object');
  }
  return value;
}

function validateLocalFilesystemPath(value: unknown, label: string): string {
  const targetPath = requireString(value, label);
  if (targetPath.includes('\0') || /[\r\n]/.test(targetPath)) {
    throw new Error(`${label} contains unsupported characters`);
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(targetPath)) {
    throw new Error(`${label} must be a local filesystem path, not a URL`);
  }
  if (!targetPath.startsWith('/') && !targetPath.startsWith('~/')) {
    throw new Error(`${label} must be an absolute local path`);
  }
  return targetPath;
}

function normalizeExtension(value: unknown): string {
  const extension = requireString(value, 'Allowed extension', 32);
  if (!/^\.[A-Za-z0-9][A-Za-z0-9.+-]{0,31}$/.test(extension)) {
    throw new Error('Allowed extension is invalid');
  }
  return extension.toLowerCase();
}

function statusStateToHealth(state: string): DesktopBridgeHealthState {
  if (state === 'ready') {
    return 'ok';
  }
  if (state === 'failed') {
    return 'failed';
  }
  return 'warning';
}

function diagnosticCheck(
  name: string,
  state: DesktopBridgeHealthState,
  detail: string,
  checkedAt: string
): DesktopSetupDiagnosticCheck {
  return {
    name,
    state,
    detail: redactSensitiveString(detail),
    checkedAt,
  };
}

export function validateRestartLocalServerRequest(
  payload: unknown
): DesktopRestartLocalServerRequest {
  const request = requireRecord(payload, 'restartLocalServer');
  if (request.confirmation !== DESKTOP_RESTART_CONFIRMATION) {
    throw new Error('restartLocalServer requires explicit restart confirmation');
  }
  return { confirmation: DESKTOP_RESTART_CONFIRMATION };
}

export function validateOpenExternalRequest(payload: unknown): OpenExternalRequest {
  const request = requireRecord(payload, 'openExternal');
  const url = requireString(request.url, 'External URL');

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('External URL is invalid');
  }

  if (!SAFE_EXTERNAL_PROTOCOLS.has(parsed.protocol)) {
    throw new Error(`External URL protocol is not allowed: ${parsed.protocol}`);
  }

  if (
    (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
    (parsed.username || parsed.password)
  ) {
    throw new Error('External URL credentials are not allowed');
  }

  return { url: parsed.toString() };
}

export function validateConnectionConfigRequest(payload: unknown): DesktopConnectionConfigRequest {
  const request = requireRecord(payload, 'validateConnectionConfig');
  if (request.mode !== 'local' && request.mode !== 'remote') {
    throw new Error('Connection mode must be local or remote');
  }

  const workspaceId = optionalSafeId(request.workspaceId, 'Workspace ID');
  if (request.mode === 'local') {
    return {
      mode: 'local',
      workspaceId,
    };
  }

  const serverUrl = requireString(request.serverUrl, 'Remote server URL');
  let parsed: URL;
  try {
    parsed = new URL(serverUrl);
  } catch {
    throw new Error('Remote server URL is invalid');
  }

  if (!SAFE_CONNECTION_PROTOCOLS.has(parsed.protocol)) {
    throw new Error(`Remote server URL protocol is not allowed: ${parsed.protocol}`);
  }

  if (parsed.username || parsed.password) {
    throw new Error('Remote server URL credentials are not allowed');
  }

  return {
    mode: 'remote',
    serverUrl: parsed.toString(),
    workspaceId,
  };
}

export function validateDesktopCommandDispatchRequest(
  payload: unknown
): DesktopCommandDispatchRequest {
  const request = requireRecord(payload, 'dispatchCommand');
  if (!DESKTOP_COMMAND_NAMES.includes(request.command as DesktopCommandName)) {
    throw new Error('Desktop command is not allowed');
  }
  const source = request.source ?? 'renderer';
  if (!SAFE_COMMAND_SOURCES.has(source as DesktopCommandSource)) {
    throw new Error('Desktop command source is not allowed');
  }
  return {
    command: request.command as DesktopCommandName,
    source: source as DesktopCommandSource,
    payload: validateOptionalPayload(request.payload),
  };
}

export function validateFilePickerRequest(payload: unknown): DesktopFilePickerRequest {
  const request = requireRecord(payload, 'pickUploadFiles');
  if (!DESKTOP_FILE_PICKER_PURPOSES.includes(request.purpose as DesktopFilePickerPurpose)) {
    throw new Error('File picker purpose is not allowed');
  }
  const allowedExtensions = Array.isArray(request.allowedExtensions)
    ? request.allowedExtensions.map((extension) => normalizeExtension(extension))
    : undefined;
  if (allowedExtensions && allowedExtensions.length > 20) {
    throw new Error('Too many allowed file extensions');
  }

  return {
    purpose: request.purpose as DesktopFilePickerPurpose,
    allowMultiple: optionalBoolean(request.allowMultiple, 'allowMultiple'),
    allowedExtensions,
    initialPath:
      request.initialPath === undefined
        ? undefined
        : validateLocalFilesystemPath(request.initialPath, 'Initial path'),
  };
}

export function validateDiagnosticsBundleRequest(
  payload: unknown
): DesktopDiagnosticsBundleRequest {
  const request = requireRecord(payload, 'createDiagnosticsBundle');
  return {
    includeLogs: optionalBoolean(request.includeLogs, 'includeLogs'),
    includeRuntimeState: optionalBoolean(request.includeRuntimeState, 'includeRuntimeState'),
    reason:
      request.reason === undefined
        ? undefined
        : requireString(request.reason, 'Bundle reason', 256),
  };
}

export function validateNotificationActionRequest(
  payload: unknown
): DesktopNotificationActionRequest {
  const request = requireRecord(payload, 'performNotificationAction');
  if (!DESKTOP_NOTIFICATION_ACTIONS.includes(request.action as DesktopNotificationAction)) {
    throw new Error('Notification action is not allowed');
  }
  return {
    notificationId: validateSafeId(request.notificationId, 'Notification ID'),
    action: request.action as DesktopNotificationAction,
    taskId: optionalSafeId(request.taskId, 'Task ID'),
  };
}

export function validateWorkProductExportRequest(
  payload: unknown
): DesktopWorkProductExportRequest {
  const request = requireRecord(payload, 'exportWorkProduct');
  return {
    taskId: validateSafeId(request.taskId, 'Task ID'),
    workProductId: validateSafeId(request.workProductId, 'Work product ID'),
    targetPath:
      request.targetPath === undefined
        ? undefined
        : validateLocalFilesystemPath(request.targetPath, 'Export target path'),
    openWhenDone: optionalBoolean(request.openWhenDone, 'openWhenDone'),
  };
}

export function redactSensitiveString(value: string): string {
  return value
    .replace(BEARER_PATTERN, `Bearer ${DESKTOP_REDACTED_VALUE}`)
    .replace(SECRET_ASSIGNMENT_PATTERN, `$1=${DESKTOP_REDACTED_VALUE}`)
    .replace(USER_PATH_PATTERN, `/Users/${DESKTOP_REDACTED_VALUE}`);
}

export function redactDesktopBridgeValue(value: unknown): unknown {
  if (typeof value === 'string') {
    return redactSensitiveString(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactDesktopBridgeValue(item));
  }

  if (!isRecord(value)) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      SENSITIVE_KEY_PATTERN.test(key) ? DESKTOP_REDACTED_VALUE : redactDesktopBridgeValue(entry),
    ])
  );
}

export function redactDesktopBridgeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return redactSensitiveString(message);
}

export function createDesktopSupportSnapshot(
  status: DesktopStatusSnapshot,
  generatedAt = new Date()
): DesktopSupportSnapshot {
  return {
    generatedAt: generatedAt.toISOString(),
    status: redactDesktopBridgeValue(status) as DesktopStatusSnapshot,
    warnings: [],
  };
}

export function createDesktopSetupDiagnostics(
  status: DesktopStatusSnapshot,
  generatedAt = new Date()
): DesktopSetupDiagnostics {
  const checkedAt = generatedAt.toISOString();
  const webState = status.web?.state ?? (status.mode === 'local-production' ? 'ready' : 'unknown');

  return {
    generatedAt: checkedAt,
    checks: [
      diagnosticCheck(
        'local-server-health',
        statusStateToHealth(status.server.state),
        status.server.lastError ?? status.server.state,
        checkedAt
      ),
      diagnosticCheck('renderer-health', statusStateToHealth(webState), webState, checkedAt),
      diagnosticCheck(
        'communication-health',
        status.serverOrigin && status.rendererOrigin ? 'ok' : 'warning',
        status.serverOrigin && status.rendererOrigin
          ? 'Loopback origins are configured.'
          : 'Loopback origins are not fully configured.',
        checkedAt
      ),
      diagnosticCheck(
        'cli-auth',
        'unknown',
        'CLI auth checks are reserved for the desktop setup workflow.',
        checkedAt
      ),
      diagnosticCheck(
        'mcp-auth',
        'unknown',
        'MCP auth checks are reserved for the desktop setup workflow.',
        checkedAt
      ),
    ],
    supportSnapshot: createDesktopSupportSnapshot(status, generatedAt),
  };
}
