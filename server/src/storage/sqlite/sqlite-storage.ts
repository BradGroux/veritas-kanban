import type { StorageProvider } from '../interfaces.js';
import { FileStorageProvider, type FileStorageOptions } from '../file-storage.js';
import { SqliteDatabase, type SqliteConnectionOptions } from './database.js';
import { SqliteTaskRepository } from './task-repository.js';
import { SqliteSettingsRepository } from './settings-repository.js';
import { SqliteManagedListProvider } from './managed-list-repository.js';
import { SqliteTemplateRepository } from './template-repository.js';
import { SqlitePromptRegistryRepository } from './prompt-registry-repository.js';
import { createDefaultConfig, normalizeAppConfig } from '../../services/config-service.js';

export interface SqliteStorageOptions {
  database?: SqliteConnectionOptions;
  fileStorageOptions?: FileStorageOptions;
}

export class SqliteStorageProvider implements StorageProvider {
  readonly tasks: SqliteTaskRepository;
  readonly settings: SqliteSettingsRepository;
  readonly activities: StorageProvider['activities'];
  readonly templates: SqliteTemplateRepository;
  readonly promptRegistry: SqlitePromptRegistryRepository;
  readonly statusHistory: StorageProvider['statusHistory'];
  readonly managedLists: SqliteManagedListProvider;
  readonly telemetry: StorageProvider['telemetry'];

  private readonly sqlite: SqliteDatabase;
  private readonly fileProvider: FileStorageProvider;

  constructor(options: SqliteStorageOptions = {}) {
    this.sqlite = new SqliteDatabase(options.database);
    this.fileProvider = new FileStorageProvider({
      ...(options.fileStorageOptions || {}),
      taskServiceOptions: {
        ...(options.fileStorageOptions?.taskServiceOptions || {}),
        storageType: 'file',
      },
      configServiceOptions: {
        ...(options.fileStorageOptions?.configServiceOptions || {}),
        storageType: 'file',
      },
    });

    this.tasks = new SqliteTaskRepository(this.sqlite);
    this.settings = new SqliteSettingsRepository(this.sqlite, {
      defaultConfig: createDefaultConfig(),
      normalizeConfig: normalizeAppConfig,
    });
    this.activities = this.fileProvider.activities;
    this.templates = new SqliteTemplateRepository(this.sqlite);
    this.promptRegistry = new SqlitePromptRegistryRepository(this.sqlite);
    this.statusHistory = this.fileProvider.statusHistory;
    this.managedLists = new SqliteManagedListProvider(this.sqlite);
    this.telemetry = this.fileProvider.telemetry;
  }

  getDatabase(): SqliteDatabase {
    return this.sqlite;
  }

  async initialize(): Promise<void> {
    this.sqlite.open();
    await this.fileProvider.initialize();
  }

  async shutdown(): Promise<void> {
    try {
      await this.fileProvider.shutdown();
    } finally {
      this.sqlite.close();
    }
  }
}
