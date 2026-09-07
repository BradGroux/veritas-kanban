import { randomUUID } from 'node:crypto';
import type { IpcMain, WebContents } from 'electron';
import type {
  DesktopCommandDispatchRequest,
  DesktopCommandDispatchResult,
} from '../shared/desktop-bridge-contracts.js';

/** A receipt is tied to the exact renderer and request, never just a command name. */
export function sendAcknowledgedRendererCommand(
  ipc: IpcMain,
  target: WebContents | undefined,
  request: DesktopCommandDispatchRequest,
  timeoutMs = 3000
): Promise<DesktopCommandDispatchResult> {
  const unavailable = (message: string): DesktopCommandDispatchResult => ({
    command: request.command,
    accepted: false,
    handledBy: 'unsupported',
    message,
  });
  if (!target || target.isDestroyed()) {
    return Promise.resolve(
      unavailable('Open the main window, finish setup and unlock the workspace, then try again.')
    );
  }
  return new Promise((resolve) => {
    const requestId = randomUUID();
    const finish = (result: DesktopCommandDispatchResult) => {
      clearTimeout(timer);
      ipc.off('desktop:menu-command-result', acknowledge);
      target.off('destroyed', closed);
      resolve(result);
    };
    const closed = () =>
      finish(unavailable('The window closed before handling the command. Open it and try again.'));
    const acknowledge = (event: Electron.IpcMainEvent, receipt: unknown) => {
      if (
        event.sender !== target ||
        event.senderFrame !== target.mainFrame ||
        !receipt ||
        typeof receipt !== 'object'
      )
        return;
      const value = receipt as Record<string, unknown>;
      if (value.requestId !== requestId || typeof value.accepted !== 'boolean') return;
      finish({
        command: request.command,
        accepted: value.accepted,
        handledBy: value.accepted ? 'renderer' : 'unsupported',
        message: typeof value.message === 'string' ? value.message.slice(0, 500) : undefined,
      });
    };
    const timer = setTimeout(
      () =>
        finish(
          unavailable(
            'The workspace did not handle this command. Finish setup or unlock it, then try again.'
          )
        ),
      timeoutMs
    );
    ipc.on('desktop:menu-command-result', acknowledge);
    target.once('destroyed', closed);
    try {
      target.send('desktop:menu-command', { ...request, requestId });
    } catch {
      finish(unavailable('The window is unavailable. Open it and try again.'));
    }
  });
}
