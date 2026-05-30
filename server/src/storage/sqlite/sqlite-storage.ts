import type { StorageProvider } from '../interfaces.js';
import { FileStorageProvider, type FileStorageOptions } from '../file-storage.js';
import { SqliteDatabase, type SqliteConnectionOptions } from './database.js';

export interface SqliteStorageOptions {
  database?: SqliteConnectionOptions;
  fileStorageOptions?: FileStorageOptions;
}

export class SqliteStorageProvider implements StorageProvider {
  readonly tasks: StorageProvider['tasks'];
  readonly settings: StorageProvider['settings'];
  readonly activities: StorageProvider['activities'];
  readonly templates: StorageProvider['templates'];
  readonly statusHistory: StorageProvider['statusHistory'];
  readonly managedLists: StorageProvider['managedLists'];
  readonly telemetry: StorageProvider['telemetry'];

  private readonly sqlite: SqliteDatabase;
  private readonly fileProvider: FileStorageProvider;

  constructor(options: SqliteStorageOptions = {}) {
    this.sqlite = new SqliteDatabase(options.database);
    this.fileProvider = new FileStorageProvider(options.fileStorageOptions);

    // Repository parity lands incrementally in #330+. Until then, SQLite mode
    // owns the database lifecycle while delegating existing behavior to files.
    this.tasks = this.fileProvider.tasks;
    this.settings = this.fileProvider.settings;
    this.activities = this.fileProvider.activities;
    this.templates = this.fileProvider.templates;
    this.statusHistory = this.fileProvider.statusHistory;
    this.managedLists = this.fileProvider.managedLists;
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
