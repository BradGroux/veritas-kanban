import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { SqliteDatabase, type SqliteConnectionOptions } from './database.js';

export interface TestSqliteDatabase {
  database: SqliteDatabase;
  databasePath: string;
  rootDir: string;
  cleanup(): void;
}

export function createTestSqliteDatabase(
  options: Omit<SqliteConnectionOptions, 'databasePath'> = {}
): TestSqliteDatabase {
  const rootDir = mkdtempSync(join(tmpdir(), 'veritas-sqlite-'));
  const databasePath = join(rootDir, 'veritas-test.db');
  const database = new SqliteDatabase({
    ...options,
    databasePath,
  });

  return {
    database,
    databasePath,
    rootDir,
    cleanup() {
      database.close();
      rmSync(rootDir, { recursive: true, force: true });
    },
  };
}
