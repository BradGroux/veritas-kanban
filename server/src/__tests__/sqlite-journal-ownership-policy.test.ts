import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  getSqliteStorageDiagnostics,
  SqliteDatabase,
  SqliteFilesystemSafetyError,
} from '../storage/sqlite/database.js';
import {
  createSqliteJournalPolicy,
  writeSqliteJournalPolicy,
} from '../storage/sqlite/sqlite-journal-policy.js';
import {
  acquireSqliteOwnershipLease,
  getSqliteOwnershipLockPath,
  resetSqliteOwnershipLocksForTests,
  SqliteOwnershipLockError,
} from '../storage/sqlite/sqlite-ownership-lock.js';

const supportedFilesystem = () => ({
  platform: process.platform,
  filesystemType: 'test-local',
  posture: 'supported-local' as const,
  detectionSource: 'test',
  reasonCode: 'test-supported-local',
});

function createDeleteDatabase(path: string): void {
  const database = new DatabaseSync(path);
  database.exec('PRAGMA journal_mode = DELETE; CREATE TABLE items (id INTEGER PRIMARY KEY);');
  database.close();
}

describe('SQLite journal ownership and policy', () => {
  let directory: string;
  let databasePath: string;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'veritas-sqlite-owner-'));
    databasePath = join(directory, 'veritas.db');
    process.env.VERITAS_ADMIN_KEY = 'test-admin-key-that-is-long-enough';
    process.env.VERITAS_SQLITE_HOST_ID = 'test-host-a';
    process.env.VERITAS_SQLITE_TOPOLOGY = 'single-host';
  });

  afterEach(() => {
    resetSqliteOwnershipLocksForTests();
    rmSync(directory, { recursive: true, force: true });
    process.env = { ...originalEnv };
  });

  function writeActiveDeletePolicy(expiresAt = new Date(Date.now() + 60_000).toISOString()) {
    const policy = createSqliteJournalPolicy({
      databasePath,
      mode: 'delete',
      actor: 'test-admin',
      reason: 'Explicit single-host compatibility',
      expiresAt,
      operationId: randomUUID(),
      source: 'single-host-compatibility',
    });
    writeSqliteJournalPolicy(databasePath, policy);
    return policy;
  }

  it('reference-counts the same process and releases after the last connection', () => {
    createDeleteDatabase(databasePath);
    writeActiveDeletePolicy();
    const first = new SqliteDatabase({
      databasePath,
      applyMigrations: false,
      filesystemClassifier: supportedFilesystem,
    });
    const second = new SqliteDatabase({
      databasePath,
      applyMigrations: false,
      filesystemClassifier: supportedFilesystem,
    });

    first.open();
    second.open();
    expect(existsSync(getSqliteOwnershipLockPath(databasePath))).toBe(true);
    first.close();
    expect(existsSync(getSqliteOwnershipLockPath(databasePath))).toBe(true);
    second.close();
    expect(existsSync(getSqliteOwnershipLockPath(databasePath))).toBe(false);
  });

  it('fails closed on malformed locks without deleting them', () => {
    createDeleteDatabase(databasePath);
    const lockPath = getSqliteOwnershipLockPath(databasePath);
    writeFileSync(lockPath, '{"malformed":true}\n', { mode: 0o600 });

    expect(() => acquireSqliteOwnershipLease(databasePath, 'delete')).toThrowError(
      SqliteOwnershipLockError
    );
    expect(existsSync(lockPath)).toBe(true);
  });

  it('serializes acquisition and never steals a lock during stale-owner recovery', () => {
    createDeleteDatabase(databasePath);
    const acquisitionPath = `${getSqliteOwnershipLockPath(databasePath)}.acquire`;
    writeFileSync(acquisitionPath, '{"reclaimer":"active"}\n', { mode: 0o600 });

    expect(() => acquireSqliteOwnershipLease(databasePath, 'delete')).toThrowError(
      expect.objectContaining({ code: 'SQLITE_OWNER_LOCK_BUSY' })
    );
    expect(existsSync(acquisitionPath)).toBe(true);
    expect(existsSync(getSqliteOwnershipLockPath(databasePath))).toBe(false);
  });

  it('does not unlink a replaced or tampered lock during release', () => {
    createDeleteDatabase(databasePath);
    const lease = acquireSqliteOwnershipLease(databasePath, 'delete');
    const lockPath = getSqliteOwnershipLockPath(databasePath);
    writeFileSync(lockPath, '{"replacement":true}\n', { mode: 0o600 });

    expect(() => lease.release()).toThrowError(SqliteOwnershipLockError);
    expect(existsSync(lockPath)).toBe(true);
  });

  it('refuses expired policies before SQLite opens', () => {
    createDeleteDatabase(databasePath);
    writeActiveDeletePolicy(new Date(Date.now() - 1_000).toISOString());
    const database = new SqliteDatabase({
      databasePath,
      applyMigrations: false,
      filesystemClassifier: supportedFilesystem,
    });

    expect(() => database.open()).toThrowError(
      expect.objectContaining({ code: 'SQLITE_POLICY_EXPIRED' })
    );
    expect(database.isOpen()).toBe(false);
  });

  it('refuses a tampered policy before SQLite opens', () => {
    createDeleteDatabase(databasePath);
    writeActiveDeletePolicy();
    const policyPath = `${databasePath}.journal-policy.json`;
    const policy = JSON.parse(readFileSync(policyPath, 'utf8')) as Record<string, unknown>;
    policy.reason = 'tampered policy reason';
    writeFileSync(policyPath, `${JSON.stringify(policy)}\n`, 'utf8');
    const database = new SqliteDatabase({
      databasePath,
      applyMigrations: false,
      filesystemClassifier: supportedFilesystem,
    });

    expect(() => database.open()).toThrowError(
      expect.objectContaining({ code: 'SQLITE_POLICY_TAMPERED' })
    );
    expect(database.isOpen()).toBe(false);
  });

  it('refuses a signed policy after the database file is replaced at the same path', () => {
    createDeleteDatabase(databasePath);
    writeActiveDeletePolicy();
    const replacementPath = join(directory, 'replacement.db');
    createDeleteDatabase(replacementPath);
    renameSync(replacementPath, databasePath);
    const database = new SqliteDatabase({
      databasePath,
      applyMigrations: false,
      filesystemClassifier: supportedFilesystem,
    });

    expect(() => database.open()).toThrowError(
      expect.objectContaining({ code: 'SQLITE_POLICY_DATABASE_MISMATCH' })
    );
    expect(database.isOpen()).toBe(false);
  });

  it('refuses compatibility policy when topology is not explicitly single-host', () => {
    createDeleteDatabase(databasePath);
    writeActiveDeletePolicy();
    process.env.VERITAS_SQLITE_TOPOLOGY = 'clustered';
    const database = new SqliteDatabase({
      databasePath,
      applyMigrations: false,
      filesystemClassifier: supportedFilesystem,
    });

    expect(() => database.open()).toThrowError(
      expect.objectContaining({ code: 'SQLITE_POLICY_TOPOLOGY_REJECTED' })
    );
  });

  it('never lets a policy override a known-unsafe filesystem', () => {
    createDeleteDatabase(databasePath);
    writeActiveDeletePolicy();
    const database = new SqliteDatabase({
      databasePath,
      applyMigrations: false,
      filesystemClassifier: () => ({
        platform: process.platform,
        filesystemType: 'nfs',
        posture: 'known-unsafe',
        detectionSource: 'test',
        reasonCode: 'network-filesystem',
      }),
    });

    expect(() => database.open()).toThrowError(SqliteFilesystemSafetyError);
    expect(getSqliteStorageDiagnostics(databasePath)).toMatchObject({
      filesystemType: 'nfs',
      healthPosture: 'degraded',
      overrideSource: 'operator-policy',
    });
    expect(JSON.stringify(getSqliteStorageDiagnostics(databasePath))).not.toContain(databasePath);
    expect(JSON.stringify(getSqliteStorageDiagnostics(databasePath))).not.toContain(
      'Explicit single-host compatibility'
    );
  });
});
