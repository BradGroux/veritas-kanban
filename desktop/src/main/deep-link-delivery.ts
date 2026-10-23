import type { IpcMain, IpcMainEvent, WebContents } from 'electron';
import type {
  DesktopCommandDispatchRequest,
  DesktopCommandDispatchResult,
} from '../shared/desktop-bridge-contracts.js';
import { hasSameOriginNavigation } from './navigation.js';

/** OS links wait for the authenticated main renderer, not just a loaded window. */
export class DesktopDeepLinkDelivery {
  private pending: DesktopCommandDispatchRequest[] = [];
  private readyTarget: WebContents | null = null;
  private flushing = false;
  private disposed = false;

  constructor(
    private readonly options: {
      ipc: IpcMain;
      target(): WebContents | undefined;
      origin(): string | undefined;
      dispatch(request: DesktopCommandDispatchRequest): Promise<DesktopCommandDispatchResult>;
      report(message: string): void;
    }
  ) {
    options.ipc.on('desktop:menu-command-ready', this.markReady);
    options.ipc.on('desktop:menu-command-not-ready', this.markNotReady);
  }

  enqueue(request: DesktopCommandDispatchRequest) {
    if (this.disposed) return;
    this.pending.push(request);
    void this.flush();
  }

  clearReady(target: WebContents) {
    if (this.readyTarget === target) this.readyTarget = null;
  }

  dispose() {
    this.disposed = true;
    this.readyTarget = null;
    this.pending = [];
    this.options.ipc.off('desktop:menu-command-ready', this.markReady);
    this.options.ipc.off('desktop:menu-command-not-ready', this.markNotReady);
  }

  private owns(event: IpcMainEvent) {
    const target = this.options.target();
    const origin = this.options.origin();
    return Boolean(
      target &&
      origin &&
      !target.isDestroyed() &&
      event.sender === target &&
      event.senderFrame === target.mainFrame &&
      hasSameOriginNavigation(event.senderFrame.url, origin)
    );
  }

  private markReady = (event: IpcMainEvent) => {
    if (!this.owns(event)) return;
    this.readyTarget = event.sender;
    void this.flush();
  };
  private markNotReady = (event: IpcMainEvent) => {
    if (this.owns(event)) this.clearReady(event.sender);
  };

  private canDeliver() {
    const target = this.options.target();
    const origin = this.options.origin();
    return (
      !this.disposed &&
      target &&
      origin &&
      target === this.readyTarget &&
      !target.isDestroyed() &&
      hasSameOriginNavigation(target.getURL(), origin)
    );
  }

  private async flush() {
    if (this.flushing) return;
    this.flushing = true;
    try {
      while (this.pending.length && this.canDeliver()) {
        const request = this.pending.shift();
        if (!request) break;
        try {
          const result = await this.options.dispatch(request);
          // A failed or uncertain receipt is surfaced once, never silently retried.
          if (!result.accepted && !this.disposed)
            this.options.report(
              result.message ??
                'The workspace could not open this link. Try it again after unlocking the workspace.'
            );
        } catch {
          if (!this.disposed)
            this.options.report(
              'The workspace could not open this link. Try it again after unlocking the workspace.'
            );
        }
      }
    } finally {
      this.flushing = false;
    }
  }
}
