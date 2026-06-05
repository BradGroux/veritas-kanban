import { createHash } from 'crypto';
import { mkdirSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { DatabaseSync } from 'node:sqlite';
import { getRuntimeDir } from '../../utils/paths.js';
import { SQLITE_BASE_MIGRATIONS, sortedMigrations, type SqliteMigration } from './migrations.js';

export const DEFAULT_SQLITE_FILENAME = 'veritas.db';

export interface SqliteConnectionOptions {
  databasePath?: string;
  migrations?: readonly SqliteMigration[];
  applyMigrations?: boolean;
}

interface AppliedMigrationRow {
  version: number;
  name: string;
  checksum: string;
}

interface UserVersionRow {
  user_version: number;
}

export class UnsupportedSqliteSchemaError extends Error {
  readonly code = 'SQLITE_UNSUPPORTED_SCHEMA';
  readonly appliedVersion: number;
  readonly maxSupportedVersion: number;
  readonly migrationName?: string;

  constructor(input: {
    appliedVersion: number;
    maxSupportedVersion: number;
    migrationName?: string;
  }) {
    const migrationLabel = input.migrationName ? ` (${input.migrationName})` : '';
    super(
      `SQLite database schema version ${input.appliedVersion}${migrationLabel} is newer than this app supports (max ${input.maxSupportedVersion}). Upgrade Veritas Kanban or restore a compatible pre-migration backup.`
    );
    this.name = 'UnsupportedSqliteSchemaError';
    this.appliedVersion = input.appliedVersion;
    this.maxSupportedVersion = input.maxSupportedVersion;
    this.migrationName = input.migrationName;
  }
}

export function resolveSqliteDatabasePath(explicitPath?: string): string {
  const configuredPath = explicitPath ?? process.env.VERITAS_SQLITE_PATH;

  if (configuredPath && configuredPath.trim().length > 0) {
    const trimmed = configuredPath.trim();
    return trimmed === ':memory:' ? trimmed : resolve(trimmed);
  }

  return join(getRuntimeDir(), DEFAULT_SQLITE_FILENAME);
}

export function calculateMigrationChecksum(migration: SqliteMigration): string {
  const normalizedSql = migration.up.replace(/\r\n/g, '\n').trim();
  return createHash('sha256')
    .update(`${migration.version}:${migration.name}:${normalizedSql}`)
    .digest('hex');
}

export class SqliteDatabase {
  readonly databasePath: string;

  private db: DatabaseSync | null = null;
  private readonly migrations: readonly SqliteMigration[];
  private readonly applyMigrations: boolean;

  constructor(options: SqliteConnectionOptions = {}) {
    this.databasePath = resolveSqliteDatabasePath(options.databasePath);
    this.migrations = options.migrations ?? SQLITE_BASE_MIGRATIONS;
    this.applyMigrations = options.applyMigrations ?? true;
  }

  open(): DatabaseSync {
    if (this.db) {
      return this.db;
    }

    if (!this.isMemoryDatabase()) {
      mkdirSync(dirname(this.databasePath), { recursive: true });
    }

    this.db = new DatabaseSync(this.databasePath);
    this.applyPragmas();

    if (this.applyMigrations) {
      this.runMigrations();
    }

    return this.db;
  }

  getConnection(): DatabaseSync {
    if (!this.db) {
      throw new Error('SQLite database is not open. Call open() first.');
    }

    return this.db;
  }

  isOpen(): boolean {
    return this.db !== null;
  }

  runMigrations(migrations: readonly SqliteMigration[] = this.migrations): void {
    const db = this.getConnection();
    const sorted = sortedMigrations(migrations);
    const maxSupportedVersion = sorted.at(-1)?.version ?? 0;

    this.assertSupportedUserVersion(maxSupportedVersion);
    this.ensureSchemaMigrationsTable();

    const appliedByVersion = this.getAppliedMigrations();
    this.assertSupportedAppliedMigrations(appliedByVersion, sorted, maxSupportedVersion);

    for (const migration of sorted) {
      const applied = appliedByVersion.get(migration.version);
      const checksum = calculateMigrationChecksum(migration);

      if (applied) {
        if (applied.checksum !== checksum || applied.name !== migration.name) {
          throw new Error(
            `SQLite migration ${migration.version} was already applied with different content`
          );
        }
        continue;
      }

      this.applyMigration(db, migration, checksum);
      appliedByVersion.set(migration.version, {
        version: migration.version,
        name: migration.name,
        checksum,
      });
    }

    this.setUserVersion(maxSupportedVersion);
  }

  close(): void {
    if (!this.db) {
      return;
    }

    this.db.close();
    this.db = null;
  }

  private applyPragmas(): void {
    const db = this.getConnection();
    db.exec('PRAGMA foreign_keys = ON;');
    db.exec('PRAGMA busy_timeout = 5000;');

    if (!this.isMemoryDatabase()) {
      db.exec('PRAGMA journal_mode = WAL;');
    }
  }

  private ensureSchemaMigrationsTable(): void {
    this.getConnection().exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        checksum TEXT NOT NULL,
        applied_at TEXT NOT NULL,
        execution_ms INTEGER NOT NULL,
        rolled_back_at TEXT
      );
    `);
  }

  private getAppliedMigrations(): Map<number, AppliedMigrationRow> {
    const rows = this.getConnection()
      .prepare(
        `
          SELECT version, name, checksum
          FROM schema_migrations
          WHERE rolled_back_at IS NULL
          ORDER BY version ASC
        `
      )
      .all() as unknown as AppliedMigrationRow[];

    return new Map(rows.map((row) => [row.version, row]));
  }

  private assertSupportedUserVersion(maxSupportedVersion: number): void {
    const row = this.getConnection().prepare('PRAGMA user_version;').get() as unknown as
      | UserVersionRow
      | undefined;
    const rawUserVersion = row?.user_version;
    const userVersion =
      typeof rawUserVersion === 'number' && Number.isInteger(rawUserVersion) ? rawUserVersion : 0;

    if (userVersion > maxSupportedVersion) {
      throw new UnsupportedSqliteSchemaError({
        appliedVersion: userVersion,
        maxSupportedVersion,
      });
    }
  }

  private assertSupportedAppliedMigrations(
    appliedByVersion: Map<number, AppliedMigrationRow>,
    migrations: readonly SqliteMigration[],
    maxSupportedVersion: number
  ): void {
    const knownVersions = new Set(migrations.map((migration) => migration.version));

    for (const applied of appliedByVersion.values()) {
      if (knownVersions.has(applied.version)) {
        continue;
      }

      if (applied.version > maxSupportedVersion) {
        throw new UnsupportedSqliteSchemaError({
          appliedVersion: applied.version,
          maxSupportedVersion,
          migrationName: applied.name,
        });
      }

      throw new Error(
        `SQLite migration ${applied.version} (${applied.name}) was already applied but is not recognized by this app`
      );
    }
  }

  private setUserVersion(version: number): void {
    this.getConnection().exec(`PRAGMA user_version = ${version};`);
  }

  private applyMigration(db: DatabaseSync, migration: SqliteMigration, checksum: string): void {
    const startedAt = Date.now();

    try {
      db.exec('BEGIN IMMEDIATE;');
      db.exec(migration.up);

      const executionMs = Date.now() - startedAt;
      db.prepare(
        `
          INSERT INTO schema_migrations (version, name, checksum, applied_at, execution_ms)
          VALUES (?, ?, ?, ?, ?)
        `
      ).run(migration.version, migration.name, checksum, new Date().toISOString(), executionMs);

      db.exec('COMMIT;');
    } catch (error) {
      try {
        db.exec('ROLLBACK;');
      } catch {
        // The original migration error is the actionable failure.
      }

      throw new Error(`SQLite migration ${migration.version} (${migration.name}) failed`, {
        cause: error,
      });
    }
  }

  private isMemoryDatabase(): boolean {
    return this.databasePath === ':memory:';
  }
}
