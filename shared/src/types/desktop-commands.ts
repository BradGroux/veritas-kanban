// Command contracts shared by browser settings and the desktop bridge.
export const DESKTOP_COMMAND_NAMES = [
  'new-task',
  'open-onboarding',
  'open-search',
  'open-settings',
  'open-command-center',
  'reset-layout',
  'import-data',
  'export-data',
  'create-backup',
  'open-logs',
  'restart-local-server',
  'communication-health',
  'show-diagnostics',
  'create-debug-bundle',
  'check-for-updates',
  'download-update',
  'install-update',
  'test-notification',
  'test-squad-webhook',
  'copy-redacted-diagnostics',
  'export-work-product',
  'quit',
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
