import { app, BrowserWindow, clipboard, ipcMain, Notification, safeStorage, shell } from 'electron';
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

import { DESKTOP_APP_ID, DESKTOP_APP_NAME, DESKTOP_MIN_WINDOW } from './app-metadata.js';
import { registerDesktopBridge } from './bridge.js';
import { DesktopCommandDispatcher } from './commands.js';
import { extractDeepLinkFromArgv, parseDesktopDeepLink } from './deep-links.js';
import { configureDesktopMenu, dispatchDesktopMenuCommand } from './menu.js';
import { DesktopNotificationCenter, ElectronNotificationAdapter } from './notifications.js';
import { createDesktopPaths, resolveRepoRoot } from './paths.js';
import { findAvailablePort } from './ports.js';
import { DesktopRuntime } from './runtime.js';
import { DesktopSecretStore } from './secrets.js';
import { statusPageUrl } from './status-page.js';
import {
  DesktopUpdateService,
  ElectronAutoUpdaterAdapter,
  resolveDesktopUpdateChannel,
} from './updates.js';
import {
  DESKTOP_BRIDGE_EVENTS,
  redactDesktopBridgeValue,
  type DesktopUpdateStatus,
} from '../shared/desktop-bridge-contracts.js';
import {
  applyDesktopWindowState,
  captureDesktopWindowState,
  readDesktopWindowState,
  writeDesktopWindowStateSync,
  type DesktopWindowState,
} from './window-state.js';

const require = createRequire(import.meta.url);
const { autoUpdater } = require('electron-updater') as typeof import('electron-updater');

let mainWindow: BrowserWindow | null = null;
let runtime: DesktopRuntime | null = null;
let commandDispatcher: DesktopCommandDispatcher | null = null;
let updateService: DesktopUpdateService | null = null;
let windowStatePaths: ReturnType<typeof createDesktopPaths> | null = null;
let quitting = false;
let shutdownStarted = false;
const pendingDeepLinks: string[] = [];

function isPackagedRuntime(): boolean {
  return app.isPackaged || process.env.VERITAS_DESKTOP_PRODUCTION === 'true';
}

const launchPackaged = isPackagedRuntime();
const launchRepoRoot = resolveRepoRoot(app.getAppPath());
const launchProfile = process.env.VERITAS_DESKTOP_PROFILE || 'default';
const launchWorkspace = process.env.VERITAS_DESKTOP_WORKSPACE || 'local';

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

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

function createMainWindow(savedState: DesktopWindowState): BrowserWindow {
  const preloadPath = path.join(__dirname, '../preload/index.mjs');
  const windowBounds = applyDesktopWindowState(savedState);

  const window = new BrowserWindow({
    title: DESKTOP_APP_NAME,
    minWidth: DESKTOP_MIN_WINDOW.width,
    minHeight: DESKTOP_MIN_WINDOW.height,
    ...windowBounds,
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
  if (savedState.maximized) {
    window.maximize();
  }
  window.on('close', () => {
    if (windowStatePaths) {
      writeDesktopWindowStateSync(windowStatePaths, captureDesktopWindowState(window));
    }
  });
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

function handleDeepLink(url: string): void {
  if (!commandDispatcher) {
    pendingDeepLinks.push(url);
    return;
  }

  try {
    const deepLink = parseDesktopDeepLink(url);
    void commandDispatcher.dispatch(deepLink.command);
  } catch (error) {
    mainWindow?.webContents.send(DESKTOP_BRIDGE_EVENTS.communicationCheck.channel, {
      target: 'external',
      state: 'failed',
      detail: error instanceof Error ? error.message : String(error),
      checkedAt: new Date().toISOString(),
    });
  }
}

function flushPendingDeepLinks(): void {
  for (const deepLink of pendingDeepLinks.splice(0)) {
    handleDeepLink(deepLink);
  }
}

function refreshDesktopMenu(): void {
  if (!runtime || !commandDispatcher) {
    return;
  }

  configureDesktopMenu({
    status: runtime.snapshot(),
    updateStatus: updateService?.snapshot(),
    dispatch: (command) => {
      if (commandDispatcher) {
        dispatchDesktopMenuCommand(commandDispatcher, command);
      }
    },
  });
}

function updateServiceFallback(packaged: boolean): DesktopUpdateStatus {
  return {
    state: 'unsupported',
    currentVersion: app.getVersion(),
    channel: packaged ? 'stable' : 'dev',
    checkedAt: new Date().toISOString(),
    detail: 'Updater service is not initialized.',
  };
}

async function boot(): Promise<void> {
  app.setName(DESKTOP_APP_NAME);
  app.setAppUserModelId(DESKTOP_APP_ID);

  const packaged = launchPackaged;
  const repoRoot = launchRepoRoot;
  const profile = launchProfile;
  const workspace = launchWorkspace;
  const paths = createDesktopPaths({
    userDataPath: app.getPath('userData'),
    repoRoot,
    isPackaged: packaged,
    profile,
    workspace,
  });
  windowStatePaths = paths;

  const serverPort = await findAvailablePort(
    Number(process.env.VERITAS_DESKTOP_SERVER_PORT || 3001)
  );
  const webPort = await findAvailablePort(Number(process.env.VERITAS_DESKTOP_WEB_PORT || 3000));

  mainWindow = createMainWindow(await readDesktopWindowState(paths));
  await mainWindow.loadURL(statusPageUrl('Starting Veritas Kanban', 'Preparing the local app.'));

  const secretStore = new DesktopSecretStore({ safeStorage, paths });
  const secretState = secretStore.inspect();
  if (!secretState.available) {
    await mainWindow.loadURL(
      statusPageUrl(
        'Veritas Kanban needs Keychain access',
        `${secretState.error} ${secretState.recoveryActions.join(' ')}`,
        undefined
      )
    );
    return;
  }

  let secrets;
  try {
    secrets = await secretStore.loadRuntimeSecrets();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await mainWindow.loadURL(statusPageUrl('Veritas Kanban secret recovery needed', message));
    return;
  }

  runtime = new DesktopRuntime({
    repoRoot,
    resourcesPath: process.resourcesPath,
    paths,
    serverPort,
    webPort,
    isPackaged: packaged,
    profile,
    workspace,
    secrets,
    secretsBackedByKeychain: secretState.available,
  });

  const notifications = new DesktopNotificationCenter(
    new ElectronNotificationAdapter(Notification),
    (request) => {
      mainWindow?.webContents.send(DESKTOP_BRIDGE_EVENTS.notificationAction.channel, request);
    }
  );
  updateService = new DesktopUpdateService({
    adapter: new ElectronAutoUpdaterAdapter(autoUpdater),
    packaged,
    currentVersion: app.getVersion(),
    channel: resolveDesktopUpdateChannel(
      process.env.VERITAS_UPDATE_CHANNEL,
      app.getVersion(),
      packaged
    ),
    forceDevUpdateConfig: process.env.VERITAS_DESKTOP_UPDATER_FORCE_DEV === 'true',
    emitStatus: (status) => {
      mainWindow?.webContents.send(DESKTOP_BRIDGE_EVENTS.updateStatus.channel, status);
      refreshDesktopMenu();
    },
  });

  commandDispatcher = new DesktopCommandDispatcher({
    runtime,
    shell,
    quit: () => app.quit(),
    sendRendererCommand: (command) => {
      mainWindow?.webContents.send(DESKTOP_BRIDGE_EVENTS.menuCommand.channel, command);
    },
    checkForUpdates: () =>
      updateService?.checkForUpdates() ?? Promise.resolve(updateServiceFallback(packaged)),
    downloadUpdate: () =>
      updateService?.downloadUpdate() ?? Promise.resolve(updateServiceFallback(packaged)),
    installUpdate: () => updateService?.installUpdate() ?? updateServiceFallback(packaged),
    showTestNotification: () => {
      notifications.show({
        id: `setup-test-${Date.now()}`,
        kind: 'setup-test',
        title: 'Veritas Kanban notification test',
        body: 'Local desktop notifications are working.',
        target: { type: 'settings' },
        privacyMode: 'private',
      });
    },
    copyRedactedDiagnostics: (status) => {
      clipboard.writeText(JSON.stringify(redactDesktopBridgeValue(status), null, 2));
    },
  });

  registerDesktopBridge(ipcMain, runtime, shell, packaged, commandDispatcher, updateService);
  refreshDesktopMenu();
  runtime.on('status', (status) => {
    mainWindow?.webContents.send(DESKTOP_BRIDGE_EVENTS.serverStatus.channel, status);
    refreshDesktopMenu();
  });

  try {
    await runtime.start();
    flushPendingDeepLinks();
    await mainWindow.loadURL(runtime.getRendererOrigin());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await mainWindow.loadURL(
      statusPageUrl('Veritas Kanban startup failed', message, runtime.snapshot())
    );
  }
}

app.on('ready', () => {
  app.setAsDefaultProtocolClient('veritas');
  const initialDeepLink = extractDeepLinkFromArgv(process.argv);
  if (initialDeepLink) {
    pendingDeepLinks.push(initialDeepLink);
  }
  void boot();
});

app.on('open-url', (event, url) => {
  event.preventDefault();
  handleDeepLink(url);
});

app.on('second-instance', (_event, argv) => {
  const deepLink = extractDeepLinkFromArgv(argv);
  if (deepLink) {
    handleDeepLink(deepLink);
  }
  if (mainWindow) {
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.focus();
  }
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
