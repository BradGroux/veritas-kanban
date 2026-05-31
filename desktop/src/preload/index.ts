import { contextBridge, ipcRenderer } from 'electron';

import type { DesktopAppInfo, DesktopStatusSnapshot } from '../main/types.js';

export interface VeritasDesktopApi {
  getAppInfo(): Promise<DesktopAppInfo>;
  getConnectionStatus(): Promise<DesktopStatusSnapshot>;
  restartLocalServer(): Promise<DesktopStatusSnapshot>;
  openExternal(url: string): Promise<void>;
  onServerStatus(listener: (status: DesktopStatusSnapshot) => void): () => void;
}

const api: VeritasDesktopApi = {
  getAppInfo: () => ipcRenderer.invoke('desktop:get-app-info') as Promise<DesktopAppInfo>,
  getConnectionStatus: () =>
    ipcRenderer.invoke('desktop:get-connection-status') as Promise<DesktopStatusSnapshot>,
  restartLocalServer: () =>
    ipcRenderer.invoke('desktop:restart-local-server') as Promise<DesktopStatusSnapshot>,
  openExternal: (url: string) => ipcRenderer.invoke('desktop:open-external', url) as Promise<void>,
  onServerStatus: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, status: DesktopStatusSnapshot): void => {
      listener(status);
    };
    ipcRenderer.on('desktop:server-status', handler);
    return () => ipcRenderer.off('desktop:server-status', handler);
  },
};

contextBridge.exposeInMainWorld('veritasDesktop', api);
