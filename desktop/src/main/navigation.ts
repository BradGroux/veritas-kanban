import type { Shell } from 'electron';

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
