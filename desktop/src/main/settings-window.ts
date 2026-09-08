import type { BrowserWindow, IpcMain, IpcMainEvent } from 'electron';
import type {
  DesktopCommandDispatchRequest,
  DesktopCommandDispatchResult,
} from '../shared/desktop-bridge-contracts.js';
import { sendAcknowledgedRendererCommand } from './renderer-commands.js';

export const SETTINGS_WINDOW_COMMANDS = new Set([
  'open-settings',
  'import-data',
  'export-data',
  'create-backup',
  'create-debug-bundle',
  'test-squad-webhook',
]);

/** One modeless window. Closing hides its renderer so queued edits and retries survive. */
export class SettingsWindowController {
  private window: BrowserWindow | null = null;
  private loading: Promise<void> | null = null;
  private rendererReady = false;

  constructor(
    private readonly options: {
      ipc: IpcMain;
      createWindow(): BrowserWindow;
      origin(): string;
      quitting(): boolean;
      returnFocus(): void;
      readyTimeoutMs?: number;
    }
  ) {}

  getWindow() {
    return this.window && !this.window.isDestroyed() ? this.window : null;
  }

  async prepareToQuit(): Promise<boolean> {
    const window = this.getWindow();
    if (!window) return true;
    try {
      await this.loading;
    } catch {
      return true;
    }
    if (!this.rendererReady) return true; // AuthGuard has unmounted the editing session.
    const result = await sendAcknowledgedRendererCommand(
      this.options.ipc,
      window.webContents,
      { command: 'open-settings', source: 'menu', payload: { flushPending: true } },
      15000
    );
    if (!result.accepted && !window.isDestroyed()) {
      if (window.isMinimized()) window.restore();
      window.show();
      window.focus();
    }
    return result.accepted;
  }

  async open(request: DesktopCommandDispatchRequest): Promise<DesktopCommandDispatchResult> {
    let window = this.getWindow();
    if (!window) {
      window = this.options.createWindow();
      this.window = window;
      const createdWindow = window;
      const target = window.webContents;
      this.rendererReady = false;
      const fromTarget = (event: IpcMainEvent) =>
        event.sender === target && event.senderFrame === target.mainFrame;
      const markReady = (event: IpcMainEvent) => {
        if (fromTarget(event)) this.rendererReady = true;
      };
      const markNotReady = (event: IpcMainEvent) => {
        if (fromTarget(event)) this.rendererReady = false;
      };
      this.options.ipc.on('desktop:menu-command-ready', markReady);
      this.options.ipc.on('desktop:menu-command-not-ready', markNotReady);
      target.once('destroyed', () => {
        this.options.ipc.off('desktop:menu-command-ready', markReady);
        this.options.ipc.off('desktop:menu-command-not-ready', markNotReady);
      });
      window.on('close', (event) => {
        if (this.options.quitting()) return;
        event.preventDefault();
        createdWindow.hide();
        this.options.returnFocus();
      });
      window.once('closed', () => {
        if (this.window === window) {
          this.window = null;
          this.loading = null;
        }
      });
      const url = new URL(this.options.origin());
      url.searchParams.set('desktop-settings', '1');
      // Register before loading: the authenticated renderer announces its command listener.
      this.loading = new Promise<void>((resolve, reject) => {
        const cleanup = () => {
          clearTimeout(timer);
          this.options.ipc.off('desktop:menu-command-ready', ready);
          target.off('destroyed', destroyed);
        };
        const fail = (message: string) => {
          cleanup();
          reject(new Error(message));
        };
        const ready = (event: IpcMainEvent) => {
          if (event.sender !== target || event.senderFrame !== target.mainFrame) return;
          cleanup();
          resolve();
        };
        const destroyed = () => fail('Settings closed before it was ready.');
        const timer = setTimeout(
          () => fail('Finish setup or unlock the workspace before opening Settings.'),
          this.options.readyTimeoutMs ?? 8000
        );
        this.options.ipc.on('desktop:menu-command-ready', ready);
        target.once('destroyed', destroyed);
        void createdWindow
          .loadURL(url.href)
          .catch(() => fail('Settings could not load. Try opening it again.'));
      });
    }
    try {
      await this.loading;
      const result = await sendAcknowledgedRendererCommand(
        this.options.ipc,
        window.webContents,
        request
      );
      if (result.accepted && !window.isDestroyed()) {
        if (window.isMinimized()) window.restore();
        window.show();
        window.focus();
      }
      return result;
    } catch (error) {
      // A never-ready window owns no acknowledged editing session and can be recreated.
      if (!window.isDestroyed()) window.destroy();
      return {
        command: request.command,
        accepted: false,
        handledBy: 'unsupported',
        message: error instanceof Error ? error.message : 'Settings is unavailable.',
      };
    }
  }
}
