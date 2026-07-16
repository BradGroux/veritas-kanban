import { createHash } from 'crypto';
import { closeSync, existsSync, lstatSync, mkdirSync, openSync, readSync, statSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { DatabaseSync } from 'node:sqlite';
import type { SqliteStorageDiagnostics } from '@veritas-kanban/shared';
import { getRuntimeDir } from '../../utils/paths.js';
import { SQLITE_BASE_MIGRATIONS, sortedMigrations, type SqliteMigration } from './migrations.js';
import { detectSqliteFilesystem, type SqliteFilesystemDecision } from './filesystem-posture.js';
import {
  loadSqliteJournalPolicy,
  summarizeSqliteJournalPolicy,
  type SqliteJournalPolicy,
} from './sqlite-journal-policy.js';
import { acquireSqliteOwnershipLease, type SqliteOwnershipLease } from './sqlite-ownership-lock.js';

export const DEFAULT_SQLITE_FILENAME = 'veritas.db';

export interface SqliteConnectionOptions {
  databasePath?: string;
  migrations?: readonly SqliteMigration[];
  applyMigrations?: boolean;
  filesystemClassifier?: (directoryPath: string) => SqliteFilesystemDecision;
}

interface AppliedMigrationRow {
  version: number;
  name: string;
  checksum: string;
}

interface UserVersionRow {
  user_version: number;
}

interface JournalModeRow {
  journal_mode?: string;
}

type ExistingSqliteJournalPosture = 'new' | 'wal' | 'rollback' | 'unrecognized';

const SQLITE_HEADER = 'SQLite format 3\u0000';
const sqliteDiagnostics = new Map<string, SqliteStorageDiagnostics>();
const activeSqliteConnections = new Map<string, number>();

function cloneDiagnostics(
  diagnostics: SqliteStorageDiagnostics | undefined
): SqliteStorageDiagnostics | undefined {
  return diagnostics ? structuredClone(diagnostics) : undefined;
}

export function getSqliteStorageDiagnostics(
  databasePath?: string
): SqliteStorageDiagnostics | undefined {
  const resolvedPath = resolveSqliteDatabasePath(databasePath);
  const diagnostics = cloneDiagnostics(sqliteDiagnostics.get(resolvedPath));
  if (!diagnostics || !diagnostics.overrideSource || resolvedPath === ':memory:')
    return diagnostics;
  try {
    const policy = loadSqliteJournalPolicy(resolvedPath, { allowInactive: true });
    if (!policy) return diagnostics;
    const override = summarizeSqliteJournalPolicy(policy);
    return {
      ...diagnostics,
      override,
      healthPosture: override.status === 'active' ? 'degraded' : 'refused',
    };
  } catch {
    return {
      ...diagnostics,
      healthPosture: 'refused',
      lockingPosture: 'failed',
      ownershipState: 'malformed',
    };
  }
}

export function getActiveSqliteConnectionCount(databasePath?: string): number {
  return activeSqliteConnections.get(resolveSqliteDatabasePath(databasePath)) ?? 0;
}

export function resetSqliteStorageDiagnosticsForTests(): void {
  sqliteDiagnostics.clear();
  activeSqliteConnections.clear();
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

export class SqliteFilesystemSafetyError extends Error {
  readonly code = 'SQLITE_FILESYSTEM_UNSAFE';
  readonly diagnostics: SqliteStorageDiagnostics;

  constructor(diagnostics: SqliteStorageDiagnostics) {
    const posture =
      diagnostics.filesystemPosture === 'known-unsafe' ? 'known unsafe' : 'unverified';
    super(
      `Refusing to open the authoritative SQLite database on ${posture} filesystem type "${diagnostics.filesystemType}" because WAL locking and shared-memory safety cannot be established without risking corruption. Move VERITAS_SQLITE_PATH to local durable storage and use governed backup/export for remote storage.`
    );
    this.name = 'SqliteFilesystemSafetyError';
    this.diagnostics = structuredClone(diagnostics);
  }
}

export class SqliteJournalModeMaintenanceError extends Error {
  readonly code = 'SQLITE_JOURNAL_MODE_MAINTENANCE_REQUIRED';

  constructor(posture: ExistingSqliteJournalPosture) {
    super(
      `Refusing to change journal mode automatically for the authoritative SQLite database (${posture}). Use the governed offline journal-mode maintenance workflow before startup.`
    );
    this.name = 'SqliteJournalModeMaintenanceError';
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
  private readonly filesystemClassifier: (directoryPath: string) => SqliteFilesystemDecision;
  private readonly databaseLocation: SqliteStorageDiagnostics['databaseLocation'];
  private ownershipLease: SqliteOwnershipLease | null = null;
  private connectionRegistered = false;

  constructor(options: SqliteConnectionOptions = {}) {
    this.databasePath = resolveSqliteDatabasePath(options.databasePath);
    this.migrations = options.migrations ?? SQLITE_BASE_MIGRATIONS;
    this.applyMigrations = options.applyMigrations ?? true;
    this.filesystemClassifier = options.filesystemClassifier ?? detectSqliteFilesystem;
    this.databaseLocation =
      this.databasePath === ':memory:'
        ? 'memory'
        : options.databasePath || process.env.VERITAS_SQLITE_PATH
          ? 'configured'
          : 'runtime-default';
  }

  open(): DatabaseSync {
    if (this.db) {
      return this.db;
    }

    let existingJournalPosture: ExistingSqliteJournalPosture = 'new';
    let policy: SqliteJournalPolicy | undefined;

    if (this.isMemoryDatabase()) {
      sqliteDiagnostics.set(this.databasePath, {
        schemaVersion: 'sqlite-storage/v1',
        databaseLocation: 'memory',
        platform: process.platform,
        filesystemType: 'memory',
        filesystemPosture: 'not-applicable',
        detectionSource: 'memory',
        reasonCode: 'memory-database',
        journalMode: 'memory',
        decisionSource: 'memory',
        overrideSource: null,
        healthPosture: 'healthy',
        lockingPosture: 'none',
      });
    } else {
      const databaseDirectory = dirname(this.databasePath);
      mkdirSync(databaseDirectory, { recursive: true });
      const filesystem =
        inspectDatabaseFilePath(this.databasePath) ?? this.filesystemClassifier(databaseDirectory);
      if (existsSync(`${this.databasePath}.maintenance/scheduled.json`)) {
        throw new SqliteJournalModeMaintenanceError('unrecognized');
      }
      policy = loadSqliteJournalPolicy(this.databasePath);
      const priorIntegrity = sqliteDiagnostics.get(this.databasePath)?.lastIntegrityCheck;
      const governedOverride = policy ? summarizeSqliteJournalPolicy(policy) : undefined;
      const diagnostics: SqliteStorageDiagnostics = {
        schemaVersion: 'sqlite-storage/v1',
        databaseLocation: this.databaseLocation,
        platform: filesystem.platform,
        filesystemType: filesystem.filesystemType,
        filesystemPosture: filesystem.posture,
        detectionSource: filesystem.detectionSource,
        reasonCode: filesystem.reasonCode,
        journalMode: filesystem.posture === 'supported-local' ? 'unknown' : 'refused',
        decisionSource: policy?.source ?? 'automatic',
        overrideSource: policy ? 'operator-policy' : null,
        healthPosture:
          filesystem.posture === 'known-unsafe'
            ? 'refused'
            : policy
              ? 'degraded'
              : filesystem.posture === 'supported-local'
                ? 'healthy'
                : 'refused',
        lockingPosture: policy ? 'single-host-owner-lock' : 'wal-coordinated',
        ownershipState: policy ? 'available' : undefined,
        override: governedOverride,
        lastIntegrityCheck: priorIntegrity,
      };
      sqliteDiagnostics.set(this.databasePath, diagnostics);

      if (
        filesystem.posture === 'known-unsafe' ||
        (filesystem.posture !== 'supported-local' && !policy)
      ) {
        throw new SqliteFilesystemSafetyError(diagnostics);
      }

      existingJournalPosture = inspectExistingSqliteJournalPosture(this.databasePath);
      if (policy && existingJournalPosture === 'new') {
        throw new SqliteJournalModeMaintenanceError(existingJournalPosture);
      }
      const expectedPolicyMode =
        existingJournalPosture === 'rollback' ? 'delete' : existingJournalPosture;
      if (policy && expectedPolicyMode !== 'new' && expectedPolicyMode !== policy.mode) {
        throw new SqliteJournalModeMaintenanceError(existingJournalPosture);
      }
      if (
        (existingJournalPosture === 'rollback' && !policy) ||
        existingJournalPosture === 'unrecognized'
      ) {
        throw new SqliteJournalModeMaintenanceError(existingJournalPosture);
      }
      if (policy) {
        this.ownershipLease = acquireSqliteOwnershipLease(this.databasePath, policy.mode);
        sqliteDiagnostics.set(this.databasePath, { ...diagnostics, ownershipState: 'owned' });
      }
    }

    try {
      this.db = new DatabaseSync(this.databasePath);
      this.applyPragmas(existingJournalPosture);
      this.registerConnection();
    } catch (error) {
      this.closeAfterStartupFailure();
      throw error;
    }

    // Preserve the established migration-failure contract: callers may inspect
    // the still-open connection to verify that the migration transaction rolled
    // back cleanly before deciding whether to close or retry.
    if (this.applyMigrations) {
      this.runMigrations();
    }

    try {
      this.verifyIntegrityOnce();
      return this.db;
    } catch (error) {
      this.closeAfterStartupFailure();
      throw error;
    }
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
    this.unregisterConnection();
    this.ownershipLease?.release();
    this.ownershipLease = null;
  }

  private applyPragmas(existingJournalPosture: ExistingSqliteJournalPosture): void {
    const db = this.getConnection();
    db.exec('PRAGMA foreign_keys = ON;');
    db.exec('PRAGMA busy_timeout = 5000;');

    if (!this.isMemoryDatabase()) {
      const row =
        existingJournalPosture === 'new'
          ? (db.prepare('PRAGMA journal_mode = WAL;').get() as JournalModeRow | undefined)
          : (db.prepare('PRAGMA journal_mode;').get() as JournalModeRow | undefined);
      const journalMode = row?.journal_mode?.toLowerCase();
      const expectedMode = existingJournalPosture === 'rollback' ? 'delete' : 'wal';
      if (journalMode !== expectedMode) {
        throw new Error(
          `SQLite refused required ${expectedMode} journal mode (reported ${journalMode ?? 'unknown'})`
        );
      }

      const diagnostics = sqliteDiagnostics.get(this.databasePath);
      if (diagnostics) {
        sqliteDiagnostics.set(this.databasePath, {
          ...diagnostics,
          journalMode: expectedMode,
          healthPosture: expectedMode === 'delete' ? 'degraded' : diagnostics.healthPosture,
        });
      }
    }
  }

  private verifyIntegrityOnce(): void {
    if (this.isMemoryDatabase()) return;

    const diagnostics = sqliteDiagnostics.get(this.databasePath);
    if (diagnostics?.lastIntegrityCheck?.status === 'ok') return;

    const checkedAt = new Date().toISOString();
    const rows = this.getConnection().prepare('PRAGMA quick_check;').all() as Array<
      Record<string, unknown>
    >;
    const messages = rows
      .flatMap((row) => Object.values(row))
      .map(String)
      .filter(Boolean);
    const ok = messages.length === 1 && messages[0].toLowerCase() === 'ok';
    const result = (messages.join('; ') || 'no result').slice(0, 240);

    if (diagnostics) {
      sqliteDiagnostics.set(this.databasePath, {
        ...diagnostics,
        lastIntegrityCheck: { checkedAt, status: ok ? 'ok' : 'failed', result },
      });
    }

    if (!ok) {
      throw new Error(`SQLite quick_check failed: ${result}`);
    }
  }

  private closeAfterStartupFailure(): void {
    try {
      this.db?.close();
    } catch {
      // Preserve the actionable startup error.
    }
    this.db = null;
    this.unregisterConnection();
    this.ownershipLease?.release();
    this.ownershipLease = null;
  }

  private registerConnection(): void {
    if (this.connectionRegistered || this.isMemoryDatabase()) return;
    activeSqliteConnections.set(
      this.databasePath,
      (activeSqliteConnections.get(this.databasePath) ?? 0) + 1
    );
    this.connectionRegistered = true;
  }

  private unregisterConnection(): void {
    if (!this.connectionRegistered || this.isMemoryDatabase()) return;
    const next = (activeSqliteConnections.get(this.databasePath) ?? 1) - 1;
    if (next <= 0) activeSqliteConnections.delete(this.databasePath);
    else activeSqliteConnections.set(this.databasePath, next);
    this.connectionRegistered = false;
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
      UserVersionRow | undefined;
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

function inspectExistingSqliteJournalPosture(databasePath: string): ExistingSqliteJournalPosture {
  if (!existsSync(databasePath) || statSync(databasePath).size === 0) {
    return 'new';
  }

  const header = Buffer.alloc(20);
  const file = openSync(databasePath, 'r');
  try {
    const bytesRead = readSync(file, header, 0, header.length, 0);
    if (bytesRead < header.length || header.subarray(0, 16).toString('utf8') !== SQLITE_HEADER) {
      return 'unrecognized';
    }

    const writeVersion = header[18];
    const readVersion = header[19];
    if (writeVersion === 2 && readVersion === 2) return 'wal';
    if (writeVersion === 1 && readVersion === 1) return 'rollback';
    return 'unrecognized';
  } finally {
    closeSync(file);
  }
}

function inspectDatabaseFilePath(databasePath: string): SqliteFilesystemDecision | undefined {
  try {
    if (!lstatSync(databasePath).isSymbolicLink()) return undefined;
    return {
      platform: process.platform,
      filesystemType: 'symlink',
      posture: 'unknown',
      detectionSource: 'database-path',
      reasonCode: 'database-file-symlink',
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    return {
      platform: process.platform,
      filesystemType: 'unknown',
      posture: 'unknown',
      detectionSource: 'database-path',
      reasonCode: 'database-path-inspection-failed',
    };
  }
}
