import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import {
  getStorage,
  getStorageTypeFromEnv,
  initStorage,
  shutdownStorage,
  SqliteStorageProvider,
  type FileStorageOptions,
} from '../../storage/index.js';

function fileStorageOptionsFor(testRoot: string): FileStorageOptions {
  return {
    taskServiceOptions: {
      tasksDir: path.join(testRoot, 'tasks', 'active'),
      archiveDir: path.join(testRoot, 'tasks', 'archive'),
    },
    configServiceOptions: {
      configDir: path.join(testRoot, '.veritas-kanban'),
      configFile: path.join(testRoot, '.veritas-kanban', 'config.json'),
    },
    telemetryServiceOptions: {
      telemetryDir: path.join(testRoot, '.veritas-kanban', 'telemetry'),
    },
  };
}

describe('SqliteStorageProvider', () => {
  let testRoot: string;

  beforeEach(async () => {
    testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'veritas-sqlite-provider-'));
  });

  afterEach(async () => {
    await shutdownStorage();
    await fs.rm(testRoot, { recursive: true, force: true }).catch(() => {});
  });

  it('opens, migrates, delegates repositories, and closes the SQLite connection', async () => {
    const provider = new SqliteStorageProvider({
      database: {
        databasePath: path.join(testRoot, '.veritas-kanban', 'veritas.db'),
      },
      fileStorageOptions: fileStorageOptionsFor(testRoot),
    });

    await provider.initialize();

    const db = provider.getDatabase().getConnection();
    const localWorkspace = db.prepare("SELECT id FROM workspaces WHERE id = 'local';").get() as {
      id: string;
    };
    const tasks = await provider.tasks.findAll();

    expect(provider.getDatabase().isOpen()).toBe(true);
    expect(localWorkspace.id).toBe('local');
    expect(Array.isArray(tasks)).toBe(true);

    await provider.shutdown();
    expect(provider.getDatabase().isOpen()).toBe(false);
  });

  it('can be selected through the storage factory', async () => {
    await initStorage('sqlite', {
      database: {
        databasePath: path.join(testRoot, '.veritas-kanban', 'factory.db'),
      },
      fileStorageOptions: fileStorageOptionsFor(testRoot),
    });

    const storage = getStorage();

    expect(storage).toBeInstanceOf(SqliteStorageProvider);
  });

  it('parses storage backend env selection', () => {
    expect(getStorageTypeFromEnv({ VERITAS_STORAGE: 'sqlite' })).toBe('sqlite');
    expect(getStorageTypeFromEnv({ VERITAS_STORAGE: 'file' })).toBe('file');
    expect(getStorageTypeFromEnv({})).toBe('file');
    expect(() => getStorageTypeFromEnv({ VERITAS_STORAGE: 'postgres' })).toThrow(
      'Unsupported VERITAS_STORAGE value'
    );
  });
});
