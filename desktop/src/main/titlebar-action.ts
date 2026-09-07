import type { BrowserWindow } from 'electron';

export type TitlebarAction = 'zoom' | 'minimize' | 'none';

export function resolveTitlebarAction(
  platform: NodeJS.Platform,
  preference: string
): TitlebarAction {
  if (platform !== 'darwin') return 'zoom';
  switch (preference) {
    case '': // Unset macOS preference uses the standard zoom behavior.
    case 'Maximize':
    case 'Fill':
      return 'zoom';
    case 'Minimize':
      return 'minimize';
    default:
      return 'none';
  }
}

export function applyTitlebarAction(
  window: BrowserWindow | null,
  action: TitlebarAction
): { maximized: boolean } {
  if (!window) return { maximized: false };
  if (action === 'minimize') window.minimize();
  if (action === 'zoom') {
    if (window.isMaximized()) window.unmaximize();
    else window.maximize();
  }
  return { maximized: window.isMaximized() };
}
