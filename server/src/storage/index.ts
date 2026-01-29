/**
 * Storage factory / registry.
 *
 * Usage:
 *   import { initStorage, getStorage } from './storage/index.js';
 *
 *   await initStorage('file');          // call once at startup
 *   const storage = getStorage();       // anywhere in the app
 *   const tasks   = await storage.tasks.findAll();
 */

import type { StorageProvider } from './interfaces.js';
import { FileStorageProvider, type FileStorageOptions } from './file-storage.js';

export type { TaskRepository, SettingsRepository, StorageProvider } from './interfaces.js';
export { FileStorageProvider, FileTaskRepository, FileSettingsRepository } from './file-storage.js';
export type { FileStorageOptions } from './file-storage.js';

// ---------------------------------------------------------------------------
// Supported backend types (extend this union as new backends are added)
// ---------------------------------------------------------------------------
export type StorageType = 'file';

// ---------------------------------------------------------------------------
// Module-level singleton
// ---------------------------------------------------------------------------
let activeProvider: StorageProvider | null = null;

/**
 * Initialise the storage layer.
 *
 * @param type    Backend type – currently only `'file'`.
 * @param options Backend-specific options forwarded to the provider.
 */
export async function initStorage(
  type: StorageType = 'file',
  options?: FileStorageOptions
): Promise<void> {
  // Shut down any previously-active provider
  if (activeProvider) {
    await activeProvider.shutdown();
    activeProvider = null;
  }

  switch (type) {
    case 'file':
      activeProvider = new FileStorageProvider(options);
      break;
    default: {
      // Exhaustive check – compile error if a new StorageType is added
      // without a matching case.
      const _exhaustive: never = type;
      throw new Error(`Unknown storage type: ${_exhaustive}`);
    }
  }

  await activeProvider.initialize();
}

/**
 * Return the active storage provider.
 *
 * Throws if `initStorage` has not been called yet.
 */
export function getStorage(): StorageProvider {
  if (!activeProvider) {
    throw new Error('Storage has not been initialised. Call initStorage() first.');
  }
  return activeProvider;
}
