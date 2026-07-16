import {
  closeSync,
  existsSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { resolve } from 'node:path';
import { z } from 'zod';
import type { SqliteJournalOwnershipState, SqliteJournalTarget } from '@veritas-kanban/shared';
import { getSqliteHostIdHash } from './sqlite-journal-policy.js';

const lockSchema = z.object({
  schemaVersion: z.literal('sqlite-owner-lock/v1'),
  nonce: z.string().uuid(),
  hostIdHash: z.string().regex(/^[a-f0-9]{64}$/),
  pid: z.number().int().positive(),
  processStartedAt: z.string().datetime(),
  acquiredAt: z.string().datetime(),
  mode: z.enum(['wal', 'delete']),
  signature: z.string().regex(/^[a-f0-9]{64}$/),
});

type OwnerLockRecord = z.infer<typeof lockSchema>;

interface HeldLease {
  record: OwnerLockRecord;
  count: number;
}

const heldLeases = new Map<string, HeldLease>();
const processStartedAt = new Date(Date.now() - Math.floor(process.uptime() * 1000)).toISOString();

export class SqliteOwnershipLockError extends Error {
  readonly code: string;
  readonly ownershipState: SqliteJournalOwnershipState;

  constructor(code: string, message: string, state: SqliteJournalOwnershipState) {
    super(message);
    this.name = 'SqliteOwnershipLockError';
    this.code = code;
    this.ownershipState = state;
  }
}

function key(): string {
  const value = process.env.VERITAS_ADMIN_KEY?.trim();
  if (!value)
    throw new SqliteOwnershipLockError(
      'SQLITE_LOCK_KEY_MISSING',
      'VERITAS_ADMIN_KEY is required for SQLite ownership locking.',
      'malformed'
    );
  return value;
}

export function getSqliteOwnershipLockPath(databasePath: string): string {
  return `${resolve(databasePath)}.owner.lock`;
}

function getSqliteOwnershipAcquisitionPath(databasePath: string): string {
  return `${getSqliteOwnershipLockPath(databasePath)}.acquire`;
}

function unsigned(record: OwnerLockRecord): Omit<OwnerLockRecord, 'signature'> {
  const { signature: _signature, ...rest } = record;
  return rest;
}

function sign(record: Omit<OwnerLockRecord, 'signature'>): string {
  return createHmac('sha256', key()).update(JSON.stringify(record)).digest('hex');
}

function validSignature(record: OwnerLockRecord): boolean {
  const expected = Buffer.from(sign(unsigned(record)), 'hex');
  const actual = Buffer.from(record.signature, 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function readRecord(lockPath: string): OwnerLockRecord {
  if (!lstatSync(lockPath).isFile() || lstatSync(lockPath).isSymbolicLink()) {
    throw new SqliteOwnershipLockError(
      'SQLITE_OWNER_LOCK_MALFORMED',
      'SQLite ownership lock is not a regular file.',
      'malformed'
    );
  }
  try {
    const record = lockSchema.parse(JSON.parse(readFileSync(lockPath, 'utf8')));
    if (!validSignature(record)) throw new Error('signature');
    return record;
  } catch {
    throw new SqliteOwnershipLockError(
      'SQLITE_OWNER_LOCK_MALFORMED',
      'SQLite ownership lock is malformed or tampered.',
      'malformed'
    );
  }
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

function removeDeadSameHostLock(lockPath: string, record: OwnerLockRecord): boolean {
  if (record.hostIdHash !== getSqliteHostIdHash() || processExists(record.pid)) return false;
  const current = readRecord(lockPath);
  if (current.nonce !== record.nonce) return false;
  unlinkSync(lockPath);
  return true;
}

export function inspectSqliteOwnershipLock(databasePath: string): SqliteJournalOwnershipState {
  const canonical = resolve(databasePath);
  if (heldLeases.has(canonical)) return 'owned';
  const lockPath = getSqliteOwnershipLockPath(canonical);
  if (existsSync(getSqliteOwnershipAcquisitionPath(canonical))) return 'owned';
  if (!existsSync(lockPath)) return 'available';
  try {
    const record = readRecord(lockPath);
    if (record.hostIdHash !== getSqliteHostIdHash()) return 'foreign-host';
    return 'owned';
  } catch {
    return 'malformed';
  }
}

export interface SqliteOwnershipLease {
  release(): void;
}

export function acquireSqliteOwnershipLease(
  databasePath: string,
  mode: SqliteJournalTarget
): SqliteOwnershipLease {
  const canonical = resolve(databasePath);
  const existing = heldLeases.get(canonical);
  if (existing) {
    existing.count += 1;
    return leaseHandle(canonical, existing.record.nonce);
  }

  const lockPath = getSqliteOwnershipLockPath(canonical);
  const acquisitionPath = getSqliteOwnershipAcquisitionPath(canonical);
  let acquisitionDescriptor: number;
  try {
    acquisitionDescriptor = openSync(acquisitionPath, 'wx', 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new SqliteOwnershipLockError(
        'SQLITE_OWNER_LOCK_BUSY',
        'SQLite ownership acquisition is already in progress.',
        'owned'
      );
    }
    throw error;
  }
  const acquisitionIdentity = fstatSync(acquisitionDescriptor);
  try {
    writeFileSync(
      acquisitionDescriptor,
      `${JSON.stringify({ pid: process.pid, nonce: randomUUID(), acquiredAt: new Date().toISOString() })}\n`,
      'utf8'
    );
    fsyncSync(acquisitionDescriptor);
  } finally {
    closeSync(acquisitionDescriptor);
  }

  try {
    if (existsSync(lockPath)) {
      const existingRecord = readRecord(lockPath);
      if (!removeDeadSameHostLock(lockPath, existingRecord)) {
        const state =
          existingRecord.hostIdHash === getSqliteHostIdHash() ? 'owned' : 'foreign-host';
        throw new SqliteOwnershipLockError(
          'SQLITE_OWNER_LOCK_BUSY',
          'SQLite is owned by another host or process.',
          state
        );
      }
    }

    const base: Omit<OwnerLockRecord, 'signature'> = {
      schemaVersion: 'sqlite-owner-lock/v1',
      nonce: randomUUID(),
      hostIdHash: getSqliteHostIdHash(),
      pid: process.pid,
      processStartedAt,
      acquiredAt: new Date().toISOString(),
      mode,
    };
    const record: OwnerLockRecord = { ...base, signature: sign(base) };
    let descriptor: number;
    try {
      descriptor = openSync(lockPath, 'wx', 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new SqliteOwnershipLockError(
          'SQLITE_OWNER_LOCK_BUSY',
          'SQLite ownership lock was acquired concurrently.',
          'owned'
        );
      }
      throw error;
    }
    try {
      writeFileSync(descriptor, `${JSON.stringify(record)}\n`, 'utf8');
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
    heldLeases.set(canonical, { record, count: 1 });
    return leaseHandle(canonical, record.nonce);
  } finally {
    if (existsSync(acquisitionPath)) {
      const current = lstatSync(acquisitionPath);
      if (current.dev === acquisitionIdentity.dev && current.ino === acquisitionIdentity.ino) {
        unlinkSync(acquisitionPath);
      }
    }
  }
}

function leaseHandle(databasePath: string, nonce: string): SqliteOwnershipLease {
  let released = false;
  return {
    release() {
      if (released) return;
      released = true;
      const held = heldLeases.get(databasePath);
      if (!held || held.record.nonce !== nonce) return;
      held.count -= 1;
      if (held.count > 0) return;
      const lockPath = getSqliteOwnershipLockPath(databasePath);
      try {
        const current = readRecord(lockPath);
        if (current.nonce === nonce) unlinkSync(lockPath);
      } finally {
        heldLeases.delete(databasePath);
      }
    },
  };
}

export function resetSqliteOwnershipLocksForTests(): void {
  for (const [databasePath, held] of heldLeases) {
    try {
      const lockPath = getSqliteOwnershipLockPath(databasePath);
      if (existsSync(lockPath) && readRecord(lockPath).nonce === held.record.nonce)
        unlinkSync(lockPath);
    } catch {
      // Tests can inspect malformed external locks themselves.
    }
  }
  heldLeases.clear();
}
