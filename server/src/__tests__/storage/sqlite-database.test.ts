import { describe, expect, it } from 'vitest';
import { existsSync } from 'fs';
import type { SqliteMigration } from '../../storage/index.js';
import { SqliteDatabase } from '../../storage/index.js';
import { createTestSqliteDatabase } from '../../storage/sqlite/test-helpers.js';

describe('SqliteDatabase', () => {
  it('opens a file database, applies safe pragmas, and closes cleanly', () => {
    const fixture = createTestSqliteDatabase();

    try {
      fixture.database.open();
      const db = fixture.database.getConnection();

      const foreignKeys = db.prepare('PRAGMA foreign_keys;').get() as { foreign_keys: number };
      const journalMode = db.prepare('PRAGMA journal_mode;').get() as { journal_mode: string };

      expect(existsSync(fixture.databasePath)).toBe(true);
      expect(foreignKeys.foreign_keys).toBe(1);
      expect(journalMode.journal_mode).toBe('wal');

      fixture.database.close();
      expect(fixture.database.isOpen()).toBe(false);
    } finally {
      fixture.cleanup();
    }
  });

  it('runs migrations in version order and records schema_migrations rows', () => {
    const migrations: SqliteMigration[] = [
      {
        version: 2,
        name: '0002_insert_probe',
        up: "INSERT INTO migration_probe (id, name) VALUES (1, 'ordered');",
      },
      {
        version: 1,
        name: '0001_create_probe',
        up: 'CREATE TABLE migration_probe (id INTEGER PRIMARY KEY, name TEXT NOT NULL);',
      },
    ];
    const fixture = createTestSqliteDatabase({ migrations });

    try {
      fixture.database.open();
      const db = fixture.database.getConnection();
      const appliedRows = db
        .prepare('SELECT version, name FROM schema_migrations ORDER BY version ASC;')
        .all() as Array<{ version: number; name: string }>;
      const probeRow = db.prepare('SELECT name FROM migration_probe WHERE id = 1;').get() as {
        name: string;
      };

      expect(appliedRows.map((row) => row.version)).toEqual([1, 2]);
      expect(appliedRows.map((row) => row.name)).toEqual([
        '0001_create_probe',
        '0002_insert_probe',
      ]);
      expect(probeRow.name).toBe('ordered');
    } finally {
      fixture.cleanup();
    }
  });

  it('skips already-applied migrations on rerun', () => {
    const migrations: SqliteMigration[] = [
      {
        version: 1,
        name: '0001_create_and_insert_probe',
        up: `
          CREATE TABLE migration_probe (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
          INSERT INTO migration_probe (id, name) VALUES (1, 'once');
        `,
      },
    ];
    const fixture = createTestSqliteDatabase({ migrations });

    try {
      fixture.database.open();
      fixture.database.runMigrations(migrations);

      const db = fixture.database.getConnection();
      const migrationCount = db
        .prepare('SELECT COUNT(*) AS count FROM schema_migrations;')
        .get() as {
        count: number;
      };
      const dataCount = db.prepare('SELECT COUNT(*) AS count FROM migration_probe;').get() as {
        count: number;
      };

      expect(migrationCount.count).toBe(1);
      expect(dataCount.count).toBe(1);
    } finally {
      fixture.cleanup();
    }
  });

  it('rejects an already-applied version when the migration content changes', () => {
    const initialMigration: SqliteMigration = {
      version: 1,
      name: '0001_create_probe',
      up: 'CREATE TABLE migration_probe (id INTEGER PRIMARY KEY);',
    };
    const changedMigration: SqliteMigration = {
      version: 1,
      name: '0001_create_probe',
      up: 'CREATE TABLE migration_probe (id INTEGER PRIMARY KEY, name TEXT);',
    };
    const fixture = createTestSqliteDatabase({ migrations: [initialMigration] });

    try {
      fixture.database.open();

      expect(() => fixture.database.runMigrations([changedMigration])).toThrow(
        'already applied with different content'
      );
    } finally {
      fixture.cleanup();
    }
  });

  it('rolls back failed migrations without recording them as applied', () => {
    const migrations: SqliteMigration[] = [
      {
        version: 1,
        name: '0001_failing_probe',
        up: `
          CREATE TABLE rollback_probe (id INTEGER PRIMARY KEY);
          INSERT INTO missing_table (id) VALUES (1);
        `,
      },
    ];
    const fixture = createTestSqliteDatabase({ migrations });

    try {
      expect(() => fixture.database.open()).toThrow('SQLite migration 1');

      const db = fixture.database.getConnection();
      const rollbackProbe = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'rollback_probe';")
        .get();
      const appliedRows = db.prepare('SELECT version FROM schema_migrations;').all();

      expect(rollbackProbe).toBeUndefined();
      expect(appliedRows).toHaveLength(0);
    } finally {
      fixture.cleanup();
    }
  });

  it('makes close idempotent and guards access after close', () => {
    const fixture = createTestSqliteDatabase();

    try {
      fixture.database.open();
      expect(fixture.database.isOpen()).toBe(true);

      fixture.database.close();
      fixture.database.close();

      expect(fixture.database.isOpen()).toBe(false);
      expect(() => fixture.database.getConnection()).toThrow('SQLite database is not open');
    } finally {
      fixture.cleanup();
    }
  });

  it('creates isolated test database helpers', () => {
    const first = createTestSqliteDatabase({ applyMigrations: false });
    const second = createTestSqliteDatabase({ applyMigrations: false });

    try {
      expect(first.databasePath).not.toBe(second.databasePath);
      expect(first.rootDir).not.toBe(second.rootDir);

      first.database.open();
      second.database.open();

      first.database.getConnection().exec('CREATE TABLE only_first (id INTEGER PRIMARY KEY);');
      const tableInSecond = second.database
        .getConnection()
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'only_first';")
        .get();

      expect(tableInSecond).toBeUndefined();
    } finally {
      first.cleanup();
      second.cleanup();
    }
  });

  it('uses the configured path when a database path is provided', () => {
    const fixture = createTestSqliteDatabase({ applyMigrations: false });

    try {
      const db = new SqliteDatabase({
        databasePath: fixture.databasePath,
        applyMigrations: false,
      });

      db.open();
      expect(db.databasePath).toBe(fixture.databasePath);
      db.close();
    } finally {
      fixture.cleanup();
    }
  });
});
