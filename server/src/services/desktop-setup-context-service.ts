import type { DesktopSetupContext } from '@veritas-kanban/shared';
import { getStorage, getStorageTypeFromEnv } from '../storage/index.js';
import { createLogger } from '../lib/logger.js';

const log = createLogger('desktop-setup-context');

export function getDesktopSetupContext(): DesktopSetupContext | undefined {
  if (process.env.VERITAS_DESKTOP_RUNTIME !== '1' || getStorageTypeFromEnv() !== 'sqlite') {
    return undefined;
  }

  try {
    const storage = getStorage();
    return storage.setupContext?.getSetupContext();
  } catch (error) {
    log.warn({ err: error }, 'Could not inspect the desktop database during setup');
    return undefined;
  }
}
