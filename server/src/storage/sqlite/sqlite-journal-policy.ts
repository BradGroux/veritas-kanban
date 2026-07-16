import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { basename, dirname, join, resolve } from 'node:path';
import { z } from 'zod';
import type { SqliteJournalPolicySummary, SqliteJournalTarget } from '@veritas-kanban/shared';

const policySchema = z.object({
  schemaVersion: z.literal('sqlite-journal-policy/v1'),
  id: z.string().uuid(),
  databaseId: z.string().regex(/^[a-f0-9]{64}$/),
  mode: z.enum(['wal', 'delete']),
  source: z.enum(['single-host-compatibility', 'expert-override']),
  singleHost: z.literal(true),
  hostIdHash: z.string().regex(/^[a-f0-9]{64}$/),
  actor: z.string().min(1).max(200),
  reason: z.string().min(8).max(1000),
  createdAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  operationId: z.string().uuid(),
  revokedAt: z.string().datetime().optional(),
  revokedBy: z.string().min(1).max(200).optional(),
  revokeReason: z.string().min(1).max(1000).optional(),
  signature: z.string().regex(/^[a-f0-9]{64}$/),
});

export type SqliteJournalPolicy = z.infer<typeof policySchema>;

export class SqliteJournalPolicyError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'SqliteJournalPolicyError';
    this.code = code;
  }
}

function signingKey(): string {
  const key = process.env.VERITAS_ADMIN_KEY?.trim();
  if (!key) {
    throw new SqliteJournalPolicyError(
      'SQLITE_POLICY_SIGNING_KEY_MISSING',
      'VERITAS_ADMIN_KEY is required to verify SQLite journal policy.'
    );
  }
  return key;
}

export function getSqliteHostIdHash(): string {
  const hostId = process.env.VERITAS_SQLITE_HOST_ID?.trim();
  if (!hostId) {
    throw new SqliteJournalPolicyError(
      'SQLITE_HOST_ID_REQUIRED',
      'VERITAS_SQLITE_HOST_ID is required for single-host SQLite journal policy.'
    );
  }
  return createHash('sha256').update(hostId).digest('hex');
}

export function getSqliteDatabaseId(databasePath: string): string {
  const absolute = resolve(databasePath);
  const file = lstatSync(absolute, { bigint: true });
  if (!file.isFile() || file.isSymbolicLink()) {
    throw new SqliteJournalPolicyError(
      'SQLITE_POLICY_DATABASE_INVALID',
      'SQLite journal policy requires a regular authoritative database file.'
    );
  }
  return createHash('sha256')
    .update(`${realpathSync(absolute)}\0${file.dev.toString()}\0${file.ino.toString()}`)
    .digest('hex');
}

export function getSqliteJournalPolicyPath(databasePath: string): string {
  return `${resolve(databasePath)}.journal-policy.json`;
}

function unsignedPolicy(policy: SqliteJournalPolicy): Omit<SqliteJournalPolicy, 'signature'> {
  const { signature: _signature, ...unsigned } = policy;
  return unsigned;
}

function signPolicy(policy: Omit<SqliteJournalPolicy, 'signature'>): string {
  return createHmac('sha256', signingKey()).update(JSON.stringify(policy)).digest('hex');
}

function verifyPolicySignature(policy: SqliteJournalPolicy): boolean {
  const expected = Buffer.from(signPolicy(unsignedPolicy(policy)), 'hex');
  const actual = Buffer.from(policy.signature, 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function atomicWriteJson(filePath: string, value: unknown): void {
  const directory = dirname(filePath);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const tempPath = join(directory, `.${basename(filePath)}.${randomUUID()}.tmp`);
  const descriptor = openSync(tempPath, 'wx', 0o600);
  try {
    writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  renameSync(tempPath, filePath);
  if (process.platform !== 'win32') {
    const directoryDescriptor = openSync(directory, 'r');
    try {
      fsyncSync(directoryDescriptor);
    } finally {
      closeSync(directoryDescriptor);
    }
  }
}

export function createSqliteJournalPolicy(input: {
  databasePath: string;
  mode: SqliteJournalTarget;
  actor: string;
  reason: string;
  expiresAt: string;
  operationId: string;
  source: SqliteJournalPolicy['source'];
}): SqliteJournalPolicy {
  if (process.env.VERITAS_SQLITE_TOPOLOGY !== 'single-host') {
    throw new SqliteJournalPolicyError(
      'SQLITE_SINGLE_HOST_REQUIRED',
      'Set VERITAS_SQLITE_TOPOLOGY=single-host before enabling compatibility or override mode.'
    );
  }
  const unsigned: Omit<SqliteJournalPolicy, 'signature'> = {
    schemaVersion: 'sqlite-journal-policy/v1',
    id: randomUUID(),
    databaseId: getSqliteDatabaseId(input.databasePath),
    mode: input.mode,
    source: input.source,
    singleHost: true,
    hostIdHash: getSqliteHostIdHash(),
    actor: input.actor,
    reason: input.reason,
    createdAt: new Date().toISOString(),
    expiresAt: input.expiresAt,
    operationId: input.operationId,
  };
  return { ...unsigned, signature: signPolicy(unsigned) };
}

export function writeSqliteJournalPolicy(databasePath: string, policy: SqliteJournalPolicy): void {
  atomicWriteJson(getSqliteJournalPolicyPath(databasePath), policy);
}

export function rebindSqliteJournalPolicy(
  databasePath: string,
  policy: SqliteJournalPolicy
): SqliteJournalPolicy {
  if (!verifyPolicySignature(policy)) {
    throw new SqliteJournalPolicyError(
      'SQLITE_POLICY_TAMPERED',
      'SQLite journal policy signature is invalid.'
    );
  }
  const unsigned: Omit<SqliteJournalPolicy, 'signature'> = {
    ...unsignedPolicy(policy),
    databaseId: getSqliteDatabaseId(databasePath),
  };
  return { ...unsigned, signature: signPolicy(unsigned) };
}

export function removeSqliteJournalPolicy(databasePath: string): void {
  const policyPath = getSqliteJournalPolicyPath(databasePath);
  if (existsSync(policyPath)) unlinkSync(policyPath);
}

export function loadSqliteJournalPolicy(
  databasePath: string,
  options: { allowInactive?: boolean } = {}
): SqliteJournalPolicy | undefined {
  const policyPath = getSqliteJournalPolicyPath(databasePath);
  if (!existsSync(policyPath)) return undefined;
  if (!lstatSync(policyPath).isFile() || lstatSync(policyPath).isSymbolicLink()) {
    throw new SqliteJournalPolicyError(
      'SQLITE_POLICY_INVALID',
      'SQLite journal policy is not a regular file.'
    );
  }

  let policy: SqliteJournalPolicy;
  try {
    policy = policySchema.parse(JSON.parse(readFileSync(policyPath, 'utf8')));
  } catch {
    throw new SqliteJournalPolicyError(
      'SQLITE_POLICY_INVALID',
      'SQLite journal policy is malformed.'
    );
  }
  if (!verifyPolicySignature(policy)) {
    throw new SqliteJournalPolicyError(
      'SQLITE_POLICY_TAMPERED',
      'SQLite journal policy signature is invalid.'
    );
  }
  if (policy.databaseId !== getSqliteDatabaseId(databasePath)) {
    throw new SqliteJournalPolicyError(
      'SQLITE_POLICY_DATABASE_MISMATCH',
      'SQLite journal policy belongs to another database.'
    );
  }
  if (policy.hostIdHash !== getSqliteHostIdHash()) {
    throw new SqliteJournalPolicyError(
      'SQLITE_POLICY_HOST_MISMATCH',
      'SQLite journal policy belongs to another host.'
    );
  }
  if (process.env.VERITAS_SQLITE_TOPOLOGY !== 'single-host') {
    throw new SqliteJournalPolicyError(
      'SQLITE_POLICY_TOPOLOGY_REJECTED',
      'SQLite journal policy requires explicit single-host topology.'
    );
  }
  if (!options.allowInactive) {
    if (policy.revokedAt) {
      throw new SqliteJournalPolicyError(
        'SQLITE_POLICY_REVOKED',
        'SQLite journal policy has been revoked.'
      );
    }
    if (Date.parse(policy.expiresAt) <= Date.now()) {
      throw new SqliteJournalPolicyError(
        'SQLITE_POLICY_EXPIRED',
        'SQLite journal policy has expired.'
      );
    }
  }
  return policy;
}

export function summarizeSqliteJournalPolicy(
  policy: SqliteJournalPolicy,
  options: { restartRequired?: boolean } = {}
): SqliteJournalPolicySummary {
  const status = policy.revokedAt
    ? 'revoked'
    : Date.parse(policy.expiresAt) <= Date.now()
      ? 'expired'
      : 'active';
  return {
    id: policy.id,
    mode: policy.mode,
    status,
    source: policy.source,
    singleHost: true,
    hostBound: true,
    expiresAt: policy.expiresAt,
    revokedAt: policy.revokedAt,
    restartRequired: options.restartRequired ?? status !== 'active',
  };
}

export function revokeSqliteJournalPolicy(input: {
  databasePath: string;
  actor: string;
  reason: string;
}): SqliteJournalPolicy {
  const current = loadSqliteJournalPolicy(input.databasePath, { allowInactive: true });
  if (!current) {
    throw new SqliteJournalPolicyError(
      'SQLITE_POLICY_NOT_FOUND',
      'No SQLite journal override is configured.'
    );
  }
  const unsigned: Omit<SqliteJournalPolicy, 'signature'> = {
    ...unsignedPolicy(current),
    revokedAt: new Date().toISOString(),
    revokedBy: input.actor,
    revokeReason: input.reason,
  };
  const revoked = { ...unsigned, signature: signPolicy(unsigned) };
  writeSqliteJournalPolicy(input.databasePath, revoked);
  return revoked;
}
