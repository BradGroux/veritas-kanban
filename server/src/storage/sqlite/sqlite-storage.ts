import type { StorageProvider } from '../interfaces.js';
import type { FileStorageOptions } from '../file-storage.js';
import { SqliteDatabase, type SqliteConnectionOptions } from './database.js';
import { SqliteTaskRepository } from './task-repository.js';
import { SqliteSettingsRepository } from './settings-repository.js';
import { SqliteManagedListProvider } from './managed-list-repository.js';
import { SqliteTemplateRepository } from './template-repository.js';
import { SqlitePromptRegistryRepository } from './prompt-registry-repository.js';
import { SqliteActivityRepository } from './activity-repository.js';
import { SqliteStatusHistoryRepository } from './status-history-repository.js';
import { SqliteTelemetryRepository } from './telemetry-repository.js';
import { SqliteOperationalProvenanceRepository } from './provenance-repository.js';
import { createDefaultConfig, normalizeAppConfig } from '../../services/config-service.js';

export interface SqliteStorageOptions {
  database?: SqliteConnectionOptions;
  fileStorageOptions?: FileStorageOptions;
}

export class SqliteStorageProvider implements StorageProvider {
  readonly tasks: SqliteTaskRepository;
  readonly settings: SqliteSettingsRepository;
  readonly activities: SqliteActivityRepository;
  readonly templates: SqliteTemplateRepository;
  readonly promptRegistry: SqlitePromptRegistryRepository;
  readonly statusHistory: SqliteStatusHistoryRepository;
  readonly managedLists: SqliteManagedListProvider;
  readonly telemetry: SqliteTelemetryRepository;
  readonly provenance: SqliteOperationalProvenanceRepository;

  private readonly sqlite: SqliteDatabase;

  constructor(options: SqliteStorageOptions = {}) {
    this.sqlite = new SqliteDatabase(options.database);

    this.tasks = new SqliteTaskRepository(this.sqlite);
    this.settings = new SqliteSettingsRepository(this.sqlite, {
      defaultConfig: createDefaultConfig(),
      normalizeConfig: normalizeAppConfig,
    });
    this.activities = new SqliteActivityRepository(this.sqlite);
    this.templates = new SqliteTemplateRepository(this.sqlite);
    this.promptRegistry = new SqlitePromptRegistryRepository(this.sqlite);
    this.statusHistory = new SqliteStatusHistoryRepository(this.sqlite);
    this.managedLists = new SqliteManagedListProvider(this.sqlite);
    this.telemetry = new SqliteTelemetryRepository(this.sqlite);
    this.provenance = new SqliteOperationalProvenanceRepository(this.sqlite);
  }

  getDatabase(): SqliteDatabase {
    return this.sqlite;
  }

  async initialize(): Promise<void> {
    this.sqlite.open();
    await this.telemetry.init();
  }

  async shutdown(): Promise<void> {
    await this.telemetry.flush().catch(() => {});
    this.sqlite.close();
  }
}
