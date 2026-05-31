import { app, BrowserWindow, ipcMain, shell } from 'electron';
import path from 'node:path';
import { mkdirSync } from 'node:fs';

import { DESKTOP_APP_ID, DESKTOP_APP_NAME, DESKTOP_MIN_WINDOW } from './app-metadata.js';
import { registerDesktopBridge } from './bridge.js';
import { createDesktopPaths, resolveRepoRoot } from './paths.js';
import { findAvailablePort } from './ports.js';
import { DesktopRuntime } from './runtime.js';
import { statusPageUrl } from './status-page.js';
import { DESKTOP_BRIDGE_EVENTS } from '../shared/desktop-bridge-contracts.js';

let mainWindow: BrowserWindow | null = null;
let runtime: DesktopRuntime | null = null;
let quitting = false;
let shutdownStarted = false;

function isPackagedRuntime(): boolean {
  return app.isPackaged || process.env.VERITAS_DESKTOP_PRODUCTION === 'true';
}

const launchPackaged = isPackagedRuntime();
const launchRepoRoot = resolveRepoRoot(app.getAppPath());
const launchProfile = process.env.VERITAS_DESKTOP_PROFILE || 'default';

if (!launchPackaged) {
  const devUserDataPath = path.join(
    launchRepoRoot,
    '.veritas-desktop-dev',
    launchProfile,
    'app-home'
  );
  mkdirSync(devUserDataPath, { recursive: true });
  app.setPath('userData', devUserDataPath);
}

function createMainWindow(): BrowserWindow {
  const preloadPath = path.join(__dirname, '../preload/index.mjs');

  const window = new BrowserWindow({
    title: DESKTOP_APP_NAME,
    minWidth: DESKTOP_MIN_WINDOW.width,
    minHeight: DESKTOP_MIN_WINDOW.height,
    width: 1360,
    height: 900,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    backgroundColor: '#111318',
    show: false,
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  window.once('ready-to-show', () => window.show());
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    const current = runtime?.getRendererOrigin();
    if (current && !url.startsWith(current)) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });
  window.webContents.on('did-fail-load', (_event, _code, description) => {
    if (!quitting) {
      void window.loadURL(
        statusPageUrl('Veritas Kanban could not load', description, runtime?.snapshot())
      );
    }
  });

  return window;
}

async function boot(): Promise<void> {
  app.setName(DESKTOP_APP_NAME);
  app.setAppUserModelId(DESKTOP_APP_ID);

  const packaged = launchPackaged;
  const repoRoot = launchRepoRoot;
  const profile = launchProfile;
  const paths = createDesktopPaths({
    userDataPath: app.getPath('userData'),
    repoRoot,
    isPackaged: packaged,
    profile,
  });

  const serverPort = await findAvailablePort(
    Number(process.env.VERITAS_DESKTOP_SERVER_PORT || 3001)
  );
  const webPort = await findAvailablePort(Number(process.env.VERITAS_DESKTOP_WEB_PORT || 3000));

  mainWindow = createMainWindow();
  await mainWindow.loadURL(statusPageUrl('Starting Veritas Kanban', 'Preparing the local app.'));

  runtime = new DesktopRuntime({
    repoRoot,
    paths,
    serverPort,
    webPort,
    isPackaged: packaged,
    profile,
  });

  registerDesktopBridge(ipcMain, runtime, shell, packaged);
  runtime.on('status', (status) => {
    mainWindow?.webContents.send(DESKTOP_BRIDGE_EVENTS.serverStatus.channel, status);
  });

  try {
    await runtime.start();
    await mainWindow.loadURL(runtime.getRendererOrigin());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await mainWindow.loadURL(
      statusPageUrl('Veritas Kanban startup failed', message, runtime.snapshot())
    );
  }
}

app.on('ready', () => {
  void boot();
});

app.on('before-quit', (event) => {
  quitting = true;
  if (runtime && !shutdownStarted) {
    event.preventDefault();
    shutdownStarted = true;
    void runtime.stop().finally(() => app.quit());
  }
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    void boot();
  }
});

process.on('uncaughtException', (error) => {
  mainWindow?.loadURL(
    statusPageUrl('Veritas Kanban desktop error', error.message, runtime?.snapshot())
  );
});

process.on('unhandledRejection', (reason) => {
  const message = reason instanceof Error ? reason.message : String(reason);
  mainWindow?.loadURL(statusPageUrl('Veritas Kanban desktop error', message, runtime?.snapshot()));
});
