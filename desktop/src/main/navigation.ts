import type { IpcMainInvokeEvent, Shell, WebContents } from 'electron';

import {
  redactDesktopBridgeError,
  validateOpenExternalRequest,
} from '../shared/desktop-bridge-contracts.js';

export function hasSameOriginNavigation(url: string, trustedRendererOrigin: string): boolean {
  try {
    return new URL(url).origin === new URL(trustedRendererOrigin).origin;
  } catch {
    return false;
  }
}

export async function openValidatedExternalUrl(shell: Shell, rawUrl: string): Promise<boolean> {
  try {
    const { url } = validateOpenExternalRequest({ url: rawUrl });
    await shell.openExternal(url);
    return true;
  } catch (error) {
    console.warn('Blocked unsafe external navigation', redactDesktopBridgeError(error));
    return false;
  }
}

/** Native IPC belongs only to a known top-level app renderer at the current origin. */
export function isOwnedDesktopSender(
  event: IpcMainInvokeEvent,
  owners: Array<WebContents | undefined>,
  origin: string,
  statusOwner?: WebContents
): boolean {
  const owner = owners.find((candidate) => candidate === event.sender);
  if (!owner || owner.isDestroyed() || event.senderFrame !== owner.mainFrame) return false;
  const url = event.senderFrame.url;
  return (
    hasSameOriginNavigation(url, origin) ||
    (owner === statusOwner && url === owner.getURL() && url.startsWith('data:text/html'))
  );
}
