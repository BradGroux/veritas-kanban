import type { IpcMain, Shell } from 'electron';

import { DESKTOP_APP_ID, DESKTOP_APP_NAME } from './app-metadata.js';
import type { DesktopAppInfo } from './types.js';
import type { DesktopRuntime } from './runtime.js';

const SAFE_EXTERNAL_PROTOCOLS = new Set(['https:', 'http:', 'mailto:']);

export function registerDesktopBridge(
  ipcMain: IpcMain,
  runtime: DesktopRuntime,
  shell: Shell,
  packaged: boolean
): void {
  ipcMain.handle(
    'desktop:get-app-info',
    (): DesktopAppInfo => ({
      name: DESKTOP_APP_NAME,
      appId: DESKTOP_APP_ID,
      version: process.env.npm_package_version || '0.0.0',
      platform: process.platform,
      packaged,
    })
  );

  ipcMain.handle('desktop:get-connection-status', () => runtime.snapshot());
  ipcMain.handle('desktop:restart-local-server', () => runtime.restartLocalServer());
  ipcMain.handle('desktop:open-external', async (_event, url: unknown) => {
    if (typeof url !== 'string') {
      throw new Error('URL must be a string');
    }

    const parsed = new URL(url);
    if (!SAFE_EXTERNAL_PROTOCOLS.has(parsed.protocol)) {
      throw new Error(`External URL protocol is not allowed: ${parsed.protocol}`);
    }

    await shell.openExternal(parsed.toString());
  });
}
