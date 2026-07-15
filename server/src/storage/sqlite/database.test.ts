import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getSqliteStorageDiagnostics,
  resetSqliteStorageDiagnosticsForTests,
  SqliteDatabase,
  SqliteFilesystemSafetyError,
  SqliteJournalModeMaintenanceError,
} from './database.js';
import type { SqliteFilesystemDecision } from './filesystem-posture.js';

const roots: string[] = [];

function tempDatabasePath(name = 'veritas-test.db'): string {
  const root = mkdtempSync(join(tmpdir(), 'veritas-sqlite-posture-'));
  roots.push(root);
  return join(root, name);
}

function filesystemDecision(
  posture: SqliteFilesystemDecision['posture'],
  filesystemType = posture === 'supported-local' ? 'apfs' : 'nfs'
): SqliteFilesystemDecision {
  return {
    platform: 'darwin',
    filesystemType,
    posture,
    detectionSource: 'test-fixture',
    reasonCode: `${posture}-fixture`,
  };
}

afterEach(() => {
  resetSqliteStorageDiagnosticsForTests();
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('SqliteDatabase filesystem and journal posture', () => {
  it.each([filesystemDecision('known-unsafe', 'nfs'), filesystemDecision('unknown', 'mysteryfs')])(
    'refuses $posture posture before creating the database',
    (decision) => {
      const databasePath = tempDatabasePath();
      const database = new SqliteDatabase({
        databasePath,
        filesystemClassifier: () => decision,
      });

      expect(() => database.open()).toThrow(SqliteFilesystemSafetyError);
      expect(existsSync(databasePath)).toBe(false);
      expect(existsSync(`${databasePath}-wal`)).toBe(false);
      expect(existsSync(`${databasePath}-shm`)).toBe(false);
      expect(getSqliteStorageDiagnostics(databasePath)).toMatchObject({
        filesystemPosture: decision.posture,
        filesystemType: decision.filesystemType,
        journalMode: 'refused',
      });
    }
  );

  it('refuses a database-file symlink before classification or SQLite open', () => {
    const targetPath = tempDatabasePath('remote-target.db');
    const databasePath = tempDatabasePath('configured-link.db');
    symlinkSync(targetPath, databasePath);
    const classifier = vi.fn(() => filesystemDecision('supported-local'));
    const database = new SqliteDatabase({ databasePath, filesystemClassifier: classifier });

    expect(() => database.open()).toThrow(SqliteFilesystemSafetyError);
    expect(classifier).not.toHaveBeenCalled();
    expect(existsSync(targetPath)).toBe(false);
    expect(existsSync(`${targetPath}-wal`)).toBe(false);
    expect(existsSync(`${targetPath}-shm`)).toBe(false);
    expect(getSqliteStorageDiagnostics(databasePath)).toMatchObject({
      filesystemPosture: 'unknown',
      filesystemType: 'symlink',
      detectionSource: 'database-path',
      reasonCode: 'database-file-symlink',
      journalMode: 'refused',
    });
  });

  it('creates a new database in WAL mode and records a quick check', () => {
    const databasePath = tempDatabasePath();
    const database = new SqliteDatabase({
      databasePath,
      applyMigrations: false,
      filesystemClassifier: () => filesystemDecision('supported-local'),
    });

    const connection = database.open();
    expect(
      (connection.prepare('PRAGMA journal_mode;').get() as { journal_mode: string }).journal_mode
    ).toBe('wal');
    expect(getSqliteStorageDiagnostics(databasePath)).toMatchObject({
      filesystemPosture: 'supported-local',
      journalMode: 'wal',
      overrideSource: null,
      lastIntegrityCheck: { status: 'ok', result: 'ok' },
    });
    database.close();
  });

  it('bypasses filesystem classification for memory databases', () => {
    const classifier = vi.fn(() => filesystemDecision('known-unsafe'));
    const database = new SqliteDatabase({
      databasePath: ':memory:',
      applyMigrations: false,
      filesystemClassifier: classifier,
    });

    database.open();
    expect(classifier).not.toHaveBeenCalled();
    expect(getSqliteStorageDiagnostics(':memory:')).toMatchObject({
      filesystemPosture: 'not-applicable',
      journalMode: 'memory',
    });
    database.close();
  });

  it('refuses to convert an existing rollback-journal database during startup', () => {
    const databasePath = tempDatabasePath();
    const raw = new DatabaseSync(databasePath);
    raw.exec('CREATE TABLE sample (id TEXT PRIMARY KEY);');
    raw.close();

    expect(readFileSync(databasePath)[18]).toBe(1);
    const database = new SqliteDatabase({
      databasePath,
      applyMigrations: false,
      filesystemClassifier: () => filesystemDecision('supported-local'),
    });
    expect(() => database.open()).toThrow(SqliteJournalModeMaintenanceError);
  });

  it('opens an existing WAL database without changing its journal posture', () => {
    const databasePath = tempDatabasePath();
    const raw = new DatabaseSync(databasePath);
    raw.exec('PRAGMA journal_mode = WAL; CREATE TABLE sample (id TEXT PRIMARY KEY);');
    raw.close();

    expect(readFileSync(databasePath)[18]).toBe(2);
    const database = new SqliteDatabase({
      databasePath,
      applyMigrations: false,
      filesystemClassifier: () => filesystemDecision('supported-local'),
    });
    const connection = database.open();
    expect(
      connection.prepare('SELECT name FROM sqlite_master WHERE name = ?').get('sample')
    ).toEqual({ name: 'sample' });
    database.close();
  });

  it('refuses unrecognized existing files instead of opening or converting them', () => {
    const databasePath = tempDatabasePath('private-token-name.db');
    writeFileSync(databasePath, 'not sqlite');
    const database = new SqliteDatabase({
      databasePath,
      applyMigrations: false,
      filesystemClassifier: () => filesystemDecision('supported-local'),
    });

    try {
      database.open();
      expect.fail('Expected unrecognized SQLite file refusal');
    } catch (error) {
      expect(error).toBeInstanceOf(SqliteJournalModeMaintenanceError);
      expect((error as Error).message).not.toContain(databasePath);
      expect((error as Error).message).not.toContain('private-token-name.db');
    }
  });

  it('does not expose the database path in filesystem safety errors', () => {
    const databasePath = tempDatabasePath('secret-customer-name.db');
    const database = new SqliteDatabase({
      databasePath,
      filesystemClassifier: () => filesystemDecision('known-unsafe', 'nfs'),
    });

    try {
      database.open();
      expect.fail('Expected unsafe filesystem refusal');
    } catch (error) {
      expect(error).toBeInstanceOf(SqliteFilesystemSafetyError);
      expect((error as Error).message).not.toContain(databasePath);
      expect((error as Error).message).not.toContain('secret-customer-name.db');
    }
  });
});
