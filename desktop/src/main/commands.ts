import type { Shell } from 'electron';

import type { DesktopRuntime } from './runtime.js';
import type { DesktopStatusSnapshot } from './types.js';
import {
  DESKTOP_COMMAND_NAMES,
  type DesktopCommandDispatchRequest,
  type DesktopCommandDispatchResult,
  type DesktopCommandName,
  type DesktopCommandSource,
  type DesktopUpdateStatus,
  validateDesktopCommandDispatchRequest,
} from '../shared/desktop-bridge-contracts.js';

export type DesktopCommandNativeAction =
  | 'renderer'
  | 'restart-server'
  | 'open-logs'
  | 'show-diagnostics'
  | 'create-debug-bundle'
  | 'check-updates'
  | 'test-notification'
  | 'test-external-delivery'
  | 'copy-diagnostics'
  | 'quit';

export interface DesktopCommandDefinition {
  name: DesktopCommandName;
  label: string;
  accelerator?: string;
  nativeAction: DesktopCommandNativeAction;
  privacySensitive: boolean;
}

export const DESKTOP_COMMAND_REGISTRY: Record<DesktopCommandName, DesktopCommandDefinition> =
  Object.fromEntries(
    DESKTOP_COMMAND_NAMES.map((name) => [
      name,
      {
        name,
        label: commandLabel(name),
        accelerator: commandAccelerator(name),
        nativeAction: commandNativeAction(name),
        privacySensitive: commandPrivacySensitive(name),
      },
    ])
  ) as Record<DesktopCommandName, DesktopCommandDefinition>;

function commandLabel(name: DesktopCommandName): string {
  switch (name) {
    case 'new-task':
      return 'New Task';
    case 'open-search':
      return 'Search';
    case 'open-settings':
      return 'Settings';
    case 'open-command-center':
      return 'Command Center';
    case 'import-data':
      return 'Import';
    case 'export-data':
      return 'Export';
    case 'create-backup':
      return 'Create Backup';
    case 'open-logs':
      return 'Open Logs';
    case 'restart-local-server':
      return 'Restart Local Server';
    case 'communication-health':
      return 'Communication Health';
    case 'show-diagnostics':
      return 'Diagnostics';
    case 'create-debug-bundle':
      return 'Create Debug Bundle';
    case 'check-for-updates':
      return 'Check for Updates';
    case 'test-notification':
      return 'Test Local Notification';
    case 'test-squad-webhook':
      return 'Test External Delivery';
    case 'copy-redacted-diagnostics':
      return 'Copy Redacted Diagnostics';
    case 'export-work-product':
      return 'Export Work Product';
    case 'quit':
      return 'Quit Veritas Kanban';
  }
}

function commandAccelerator(name: DesktopCommandName): string | undefined {
  switch (name) {
    case 'new-task':
      return 'CommandOrControl+N';
    case 'open-search':
      return 'CommandOrControl+F';
    case 'open-settings':
      return 'CommandOrControl+,';
    case 'open-command-center':
      return 'CommandOrControl+K';
    case 'restart-local-server':
      return 'CommandOrControl+R';
    default:
      return undefined;
  }
}

function commandNativeAction(name: DesktopCommandName): DesktopCommandNativeAction {
  switch (name) {
    case 'restart-local-server':
      return 'restart-server';
    case 'open-logs':
      return 'open-logs';
    case 'show-diagnostics':
      return 'show-diagnostics';
    case 'create-debug-bundle':
      return 'create-debug-bundle';
    case 'check-for-updates':
      return 'check-updates';
    case 'test-notification':
      return 'test-notification';
    case 'test-squad-webhook':
      return 'test-external-delivery';
    case 'copy-redacted-diagnostics':
      return 'copy-diagnostics';
    case 'quit':
      return 'quit';
    default:
      return 'renderer';
  }
}

function commandPrivacySensitive(name: DesktopCommandName): boolean {
  return name === 'export-work-product' || name === 'copy-redacted-diagnostics';
}

export interface DesktopCommandDispatcherOptions {
  runtime: DesktopRuntime;
  shell: Shell;
  quit(): void;
  sendRendererCommand(command: DesktopCommandDispatchRequest): void;
  sendUpdateStatus(status: DesktopUpdateStatus): void;
  showTestNotification(): void;
  copyRedactedDiagnostics(status: DesktopStatusSnapshot): void;
}

export class DesktopCommandDispatcher {
  constructor(private readonly options: DesktopCommandDispatcherOptions) {}

  async dispatch(payload: unknown): Promise<DesktopCommandDispatchResult> {
    const request = validateDesktopCommandDispatchRequest(payload);
    const definition = DESKTOP_COMMAND_REGISTRY[request.command];

    switch (definition.nativeAction) {
      case 'renderer':
        this.options.sendRendererCommand(request);
        return accepted(request, 'renderer');
      case 'restart-server':
        await this.options.runtime.restartLocalServer();
        this.options.sendRendererCommand(request);
        return accepted(request, 'desktop');
      case 'open-logs':
        await this.options.shell.openPath(this.options.runtime.snapshot().logsDir);
        return accepted(request, 'desktop');
      case 'show-diagnostics':
      case 'create-debug-bundle':
        this.options.sendRendererCommand(request);
        return accepted(request, 'renderer');
      case 'check-updates':
        this.options.sendUpdateStatus({
          state: 'unsupported',
          currentVersion: process.env.npm_package_version || '0.0.0',
          channel: 'dev',
          checkedAt: new Date().toISOString(),
          detail: 'Updater implementation is tracked in the desktop release pipeline issue.',
        });
        return accepted(request, 'desktop');
      case 'test-notification':
        this.options.showTestNotification();
        return accepted(request, 'desktop');
      case 'test-external-delivery':
        this.options.sendRendererCommand(request);
        return accepted(
          request,
          'renderer',
          'External delivery test requires configured delivery.'
        );
      case 'copy-diagnostics':
        this.options.copyRedactedDiagnostics(this.options.runtime.snapshot());
        return accepted(request, 'desktop');
      case 'quit':
        this.options.quit();
        return accepted(request, 'desktop');
    }
  }
}

function accepted(
  request: DesktopCommandDispatchRequest,
  handledBy: DesktopCommandDispatchResult['handledBy'],
  message?: string
): DesktopCommandDispatchResult {
  return {
    command: request.command,
    accepted: true,
    handledBy,
    message,
  };
}

export function createDesktopCommandRequest(
  command: DesktopCommandName,
  source: DesktopCommandSource,
  payload?: Record<string, unknown>
): DesktopCommandDispatchRequest {
  return {
    command,
    source,
    payload,
  };
}
