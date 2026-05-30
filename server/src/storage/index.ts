/**
 * Storage factory / registry.
 *
 * Usage:
 *   import { initStorage, getStorage } from './storage/index.js';
 *
 *   await initStorage();                // call once at startup
 *   const storage = getStorage();       // anywhere in the app
 *   const tasks   = await storage.tasks.findAll();
 */

import type { StorageProvider } from './interfaces.js';
import { FileStorageProvider, type FileStorageOptions } from './file-storage.js';
import { SqliteStorageProvider, type SqliteStorageOptions } from './sqlite/sqlite-storage.js';

export type {
  TaskRepository,
  SettingsRepository,
  ActivityRepository,
  TemplateRepository,
  StatusHistoryRepository,
  ManagedListRepository,
  ManagedListProvider,
  TelemetryRepository,
  StorageProvider,
} from './interfaces.js';
export {
  FileStorageProvider,
  FileTaskRepository,
  FileSettingsRepository,
  FileActivityRepository,
  FileTemplateRepository,
  FileStatusHistoryRepository,
  FileManagedListRepository,
  FileManagedListProvider,
  FileTelemetryRepository,
} from './file-storage.js';
export type { FileStorageOptions } from './file-storage.js';
export {
  DEFAULT_SQLITE_FILENAME,
  SqliteDatabase,
  calculateMigrationChecksum,
  resolveSqliteDatabasePath,
} from './sqlite/database.js';
export type { SqliteConnectionOptions } from './sqlite/database.js';
export { SQLITE_BASE_MIGRATIONS, sortedMigrations } from './sqlite/migrations.js';
export type { SqliteMigration } from './sqlite/migrations.js';
export { SqliteStorageProvider } from './sqlite/sqlite-storage.js';
export type { SqliteStorageOptions } from './sqlite/sqlite-storage.js';

// ---------------------------------------------------------------------------
// Supported backend types (extend this union as new backends are added)
// ---------------------------------------------------------------------------
export type StorageType = 'file' | 'sqlite';
type StorageOptions = FileStorageOptions | SqliteStorageOptions;

// ---------------------------------------------------------------------------
// Module-level singleton
// ---------------------------------------------------------------------------
let activeProvider: StorageProvider | null = null;

export function getStorageTypeFromEnv(env: NodeJS.ProcessEnv = process.env): StorageType {
  const storageType = env.VERITAS_STORAGE?.trim() || 'file';

  if (storageType === 'file' || storageType === 'sqlite') {
    return storageType;
  }

  throw new Error(`Unsupported VERITAS_STORAGE value: ${storageType}`);
}

export function getSqlitePathFromEnv(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const sqlitePath = env.VERITAS_SQLITE_PATH?.trim();
  return sqlitePath && sqlitePath.length > 0 ? sqlitePath : undefined;
}

/**
 * Initialise the storage layer.
 *
 * @param type    Backend type.
 * @param options Backend-specific options forwarded to the provider.
 */
export async function initStorage(
  type: StorageType = getStorageTypeFromEnv(),
  options?: StorageOptions
): Promise<void> {
  // Shut down any previously-active provider
  if (activeProvider) {
    await activeProvider.shutdown();
    activeProvider = null;
  }

  switch (type) {
    case 'file':
      activeProvider = new FileStorageProvider(options as FileStorageOptions | undefined);
      break;
    case 'sqlite':
      activeProvider = new SqliteStorageProvider(options as SqliteStorageOptions | undefined);
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

export async function shutdownStorage(): Promise<void> {
  if (!activeProvider) {
    return;
  }

  await activeProvider.shutdown();
  activeProvider = null;
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
