import { Menu, type MenuItemConstructorOptions } from 'electron';

import {
  createDesktopCommandRequest,
  DESKTOP_COMMAND_REGISTRY,
  type DesktopCommandDispatcher,
} from './commands.js';
import type { DesktopStatusSnapshot } from './types.js';
import type {
  DesktopCommandName,
  DesktopUpdateStatus,
} from '../shared/desktop-bridge-contracts.js';

export interface ConfigureDesktopMenuOptions {
  dispatch(command: DesktopCommandName): void;
  status: DesktopStatusSnapshot;
  updateStatus?: DesktopUpdateStatus;
}

export function configureDesktopMenu(options: ConfigureDesktopMenuOptions): void {
  Menu.setApplicationMenu(Menu.buildFromTemplate(createDesktopMenuTemplate(options)));
}

export function createDesktopMenuTemplate(
  options: ConfigureDesktopMenuOptions
): MenuItemConstructorOptions[] {
  const command = (name: DesktopCommandName): MenuItemConstructorOptions => {
    const definition = DESKTOP_COMMAND_REGISTRY[name];
    return {
      label: definition.label,
      accelerator: definition.accelerator,
      enabled: isCommandEnabled(name, options.status, options.updateStatus),
      click: () => options.dispatch(name),
    };
  };

  return [
    {
      label: 'Veritas Kanban',
      submenu: [
        command('open-onboarding'),
        command('open-settings'),
        command('communication-health'),
        { type: 'separator' },
        command('check-for-updates'),
        command('download-update'),
        command('install-update'),
        { type: 'separator' },
        command('quit'),
      ],
    },
    {
      label: 'File',
      submenu: [
        command('new-task'),
        command('import-data'),
        command('export-data'),
        command('create-backup'),
      ],
    },
    {
      label: 'Navigate',
      submenu: [command('open-command-center'), command('open-search'), command('open-settings')],
    },
    {
      label: 'Desktop',
      submenu: [
        command('restart-local-server'),
        command('open-logs'),
        command('show-diagnostics'),
        command('create-debug-bundle'),
        { type: 'separator' },
        command('test-notification'),
        command('test-squad-webhook'),
        command('copy-redacted-diagnostics'),
      ],
    },
  ];
}

export function dispatchDesktopMenuCommand(
  dispatcher: DesktopCommandDispatcher,
  command: DesktopCommandName
): void {
  void dispatcher.dispatch(createDesktopCommandRequest(command, 'menu'));
}

function isCommandEnabled(
  command: DesktopCommandName,
  status: DesktopStatusSnapshot,
  updateStatus?: DesktopUpdateStatus
): boolean {
  if (command === 'restart-local-server') {
    return status.mode === 'local-dev' || status.mode === 'local-production';
  }
  if (command === 'open-logs') {
    return Boolean(status.logsDir);
  }
  if (command === 'test-squad-webhook') {
    return status.server.state === 'ready';
  }
  if (command === 'download-update') {
    return updateStatus?.state === 'available';
  }
  if (command === 'install-update') {
    return updateStatus?.state === 'ready';
  }
  return true;
}
