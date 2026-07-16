import {
  closeSync,
  constants,
  createReadStream,
  existsSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { basename, dirname, join, resolve } from 'node:path';
import { backup, DatabaseSync } from 'node:sqlite';
import type {
  RevokeSqliteJournalOverrideInput,
  ScheduleSqliteJournalOperationInput,
  SqliteJournalOperationState,
  SqliteJournalOperationStatus,
  SqliteJournalPreview,
  SqliteJournalPreviewInput,
  SqliteJournalTarget,
  SqliteMaintenanceSidecar,
} from '@veritas-kanban/shared';
import { getActiveSqliteConnectionCount, resolveSqliteDatabasePath } from './database.js';
import { detectSqliteFilesystem } from './filesystem-posture.js';
import {
  acquireSqliteOwnershipLease,
  inspectSqliteOwnershipLock,
} from './sqlite-ownership-lock.js';
import {
  createSqliteJournalPolicy,
  getSqliteHostIdHash,
  loadSqliteJournalPolicy,
  removeSqliteJournalPolicy,
  rebindSqliteJournalPolicy,
  revokeSqliteJournalPolicy,
  summarizeSqliteJournalPolicy,
  writeSqliteJournalPolicy,
  type SqliteJournalPolicy,
} from './sqlite-journal-policy.js';

const PREVIEW_TTL_MS = 15 * 60 * 1000;
const MIN_OVERRIDE_TTL_MS = 5 * 60 * 1000;
const MAX_OVERRIDE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

type FileIdentity = {
  present: boolean;
  fileType: 'regular' | 'symlink' | 'other' | 'missing';
  bytes: number;
  mtimeMs: number;
  dev: string;
  ino: string;
  sha256?: string;
};

interface PreviewRecord extends Omit<SqliteJournalPreview, 'token'> {
  recordSignature?: string;
  tokenHash: string;
  actor: string;
  databaseIdentity: FileIdentity;
  sidecarIdentities: Record<'wal' | 'shm' | 'journal', FileIdentity>;
  overrideReason?: string;
  policyExpiresAt?: string;
  consumedAt?: string;
  consumedByOperationId?: string;
}

interface OperationRecord extends SqliteJournalOperationStatus {
  recordSignature?: string;
  preview: PreviewRecord;
  backupPath: string;
  backupSha256?: string;
  originalPolicy?: SqliteJournalPolicy;
  mutationStarted: boolean;
}

interface CheckpointRow {
  busy?: number;
  log?: number;
  checkpointed?: number;
}

export class SqliteJournalMaintenanceError extends Error {
  readonly code: string;
  readonly statusCode: number;

  constructor(code: string, message: string, statusCode = 409) {
    super(message);
    this.name = 'SqliteJournalMaintenanceError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

function maintenanceKey(): string {
  const key = process.env.VERITAS_ADMIN_KEY?.trim();
  if (!key) {
    throw new SqliteJournalMaintenanceError(
      'SQLITE_MAINTENANCE_KEY_MISSING',
      'VERITAS_ADMIN_KEY is required for SQLite maintenance.',
      503
    );
  }
  return key;
}

function timingSafeHexEqual(expectedHex: string, actualHex: string): boolean {
  const expected = Buffer.from(expectedHex, 'hex');
  const actual = Buffer.from(actualHex, 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function hashToken(token: string): string {
  return createHmac('sha256', maintenanceKey()).update(token).digest('hex');
}

function signRecord<T extends { recordSignature?: string }>(
  record: T
): T & { recordSignature: string } {
  const { recordSignature: _signature, ...unsigned } = record;
  return {
    ...record,
    recordSignature: createHmac('sha256', maintenanceKey())
      .update(JSON.stringify(unsigned))
      .digest('hex'),
  };
}

function verifyRecord<T extends { recordSignature?: string }>(record: T): T {
  const signature = record.recordSignature;
  if (!signature || !/^[a-f0-9]{64}$/.test(signature)) throw new Error('missing signature');
  const expected = signRecord(record).recordSignature;
  if (!timingSafeHexEqual(expected, signature)) throw new Error('invalid signature');
  return record;
}

function secureDirectory(path: string): void {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new SqliteJournalMaintenanceError(
      'SQLITE_MAINTENANCE_PATH_UNSAFE',
      'SQLite maintenance state directory is not a regular directory.'
    );
  }
  if (
    process.platform !== 'win32' &&
    ((typeof process.getuid === 'function' && stat.uid !== process.getuid()) ||
      (stat.mode & 0o077) !== 0)
  ) {
    throw new SqliteJournalMaintenanceError(
      'SQLITE_MAINTENANCE_PATH_UNSAFE',
      'SQLite maintenance state directory must be private and owned by this process user.'
    );
  }
}

function syncDirectory(path: string): void {
  if (process.platform === 'win32') return;
  const descriptor = openSync(path, 'r');
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function atomicWriteJson(path: string, value: unknown): void {
  secureDirectory(dirname(path));
  const tempPath = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
  const descriptor = openSync(tempPath, 'wx', 0o600);
  try {
    writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  renameSync(tempPath, path);
  syncDirectory(dirname(path));
}

function readRegularJson<T>(path: string): T {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('unsafe state file');
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

async function hashFile(path: string): Promise<string> {
  const hash = createHash('sha256');
  await new Promise<void>((resolvePromise, reject) => {
    const stream = createReadStream(path);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', resolvePromise);
    stream.on('error', reject);
  });
  return hash.digest('hex');
}

async function inspectFile(path: string): Promise<FileIdentity> {
  try {
    const stat = lstatSync(path);
    const fileType = stat.isSymbolicLink() ? 'symlink' : stat.isFile() ? 'regular' : 'other';
    return {
      present: true,
      fileType,
      bytes: stat.size,
      mtimeMs: stat.mtimeMs,
      dev: String(stat.dev),
      ino: String(stat.ino),
      sha256: fileType === 'regular' ? await hashFile(path) : undefined,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { present: false, fileType: 'missing', bytes: 0, mtimeMs: 0, dev: '', ino: '' };
    }
    throw error;
  }
}

function sidecarPaths(databasePath: string): Record<'wal' | 'shm' | 'journal', string> {
  return {
    wal: `${databasePath}-wal`,
    shm: `${databasePath}-shm`,
    journal: `${databasePath}-journal`,
  };
}

async function inspectSidecars(databasePath: string): Promise<{
  identities: Record<'wal' | 'shm' | 'journal', FileIdentity>;
  public: SqliteMaintenanceSidecar[];
}> {
  const paths = sidecarPaths(databasePath);
  const [wal, shm, journal] = await Promise.all([
    inspectFile(paths.wal),
    inspectFile(paths.shm),
    inspectFile(paths.journal),
  ]);
  const identities = { wal, shm, journal };
  return {
    identities,
    public: (Object.entries(identities) as Array<['wal' | 'shm' | 'journal', FileIdentity]>).map(
      ([kind, identity]) => ({
        kind,
        present: identity.present,
        bytes: identity.bytes,
        fileType: identity.fileType,
      })
    ),
  };
}

function currentJournalMode(databasePath: string): SqliteJournalTarget | 'new' | 'unknown' {
  if (!existsSync(databasePath) || statSync(databasePath).size === 0) return 'new';
  const descriptor = openSync(databasePath, 'r');
  const header = Buffer.alloc(20);
  try {
    const bytesRead = readSync(descriptor, header, 0, header.length, 0);
    if (bytesRead < header.length) return 'unknown';
  } finally {
    closeSync(descriptor);
  }
  if (header.subarray(0, 16).toString('utf8') !== 'SQLite format 3\u0000') return 'unknown';
  if (header[18] === 2 && header[19] === 2) return 'wal';
  if (header[18] === 1 && header[19] === 1) return 'delete';
  return 'unknown';
}

function requireRegularArtifacts(
  identities: Record<'wal' | 'shm' | 'journal', FileIdentity>
): void {
  for (const [kind, identity] of Object.entries(identities)) {
    if (identity.present && identity.fileType !== 'regular') {
      throw new SqliteJournalMaintenanceError(
        'SQLITE_SIDECAR_UNSAFE',
        `Refusing SQLite maintenance because the ${kind} sidecar is not a regular file.`
      );
    }
  }
  if (identities.wal.present && identities.journal.present) {
    throw new SqliteJournalMaintenanceError(
      'SQLITE_SIDECAR_CONFLICT',
      'Refusing SQLite maintenance because WAL and rollback sidecars are both present.'
    );
  }
}

function integrityResult(database: DatabaseSync, pragma = 'integrity_check'): string {
  const rows = database.prepare(`PRAGMA ${pragma};`).all() as Array<Record<string, unknown>>;
  const messages = rows
    .flatMap((row) => Object.values(row))
    .map(String)
    .filter(Boolean);
  return messages.length === 1 && messages[0]?.toLowerCase() === 'ok'
    ? 'ok'
    : (messages.join('; ') || 'no result').slice(0, 240);
}

function effectiveJournalMode(database: DatabaseSync): string {
  const row = database.prepare('PRAGMA journal_mode;').get() as
    { journal_mode?: string } | undefined;
  return row?.journal_mode?.toLowerCase() ?? 'unknown';
}

function setJournalMode(database: DatabaseSync, mode: SqliteJournalTarget): void {
  const pragma = mode === 'wal' ? 'WAL' : 'DELETE';
  const row = database.prepare(`PRAGMA journal_mode = ${pragma};`).get() as
    { journal_mode?: string } | undefined;
  if (row?.journal_mode?.toLowerCase() !== mode) {
    throw new SqliteJournalMaintenanceError(
      'SQLITE_TARGET_MODE_REFUSED',
      `SQLite refused the requested ${mode} journal mode.`
    );
  }
}

function requireJournalTarget(mode: string): SqliteJournalTarget {
  if (mode === 'wal' || mode === 'delete') return mode;
  throw new SqliteJournalMaintenanceError(
    'SQLITE_SOURCE_MODE_UNKNOWN',
    'SQLite maintenance source journal mode is not recoverable.'
  );
}

function openExclusiveDatabase(databasePath: string): DatabaseSync {
  const database = new DatabaseSync(databasePath, { timeout: 0 });
  try {
    database.exec('PRAGMA busy_timeout = 0;');
    const lockingMode = database.prepare('PRAGMA locking_mode = EXCLUSIVE;').get() as
      { locking_mode?: string } | undefined;
    if (lockingMode?.locking_mode?.toLowerCase() !== 'exclusive') {
      throw new Error('exclusive locking mode unavailable');
    }
    database.exec('BEGIN EXCLUSIVE; COMMIT;');
    return database;
  } catch {
    try {
      database.close();
    } catch {
      // The stable maintenance error below is sufficient.
    }
    throw new SqliteJournalMaintenanceError(
      'SQLITE_BUSY',
      'Another SQLite connection prevented exclusive maintenance ownership.'
    );
  }
}

function maybeCrash(stage: SqliteJournalOperationState): void {
  if (process.env.VERITAS_SQLITE_MAINTENANCE_CRASH_STAGE === stage) process.exit(86);
}

export class SqliteJournalMaintenanceService {
  readonly databasePath: string;
  private readonly maintenanceDirectory: string;
  private readonly operationsDirectory: string;
  private readonly previewsDirectory: string;
  private readonly backupsDirectory: string;
  private readonly scheduledPath: string;
  private readonly eventJournalPath: string;
  private readonly faultInjector?: (stage: SqliteJournalOperationState) => void;
  private readonly postConversionIntegrityCheck?: (database: DatabaseSync) => string;

  constructor(
    input:
      | string
      | {
          databasePath?: string;
          faultInjector?: (stage: SqliteJournalOperationState) => void;
          postConversionIntegrityCheck?: (database: DatabaseSync) => string;
        } = resolveSqliteDatabasePath()
  ) {
    const databasePath = typeof input === 'string' ? input : input.databasePath;
    this.databasePath = resolve(databasePath ?? resolveSqliteDatabasePath());
    this.faultInjector = typeof input === 'string' ? undefined : input.faultInjector;
    this.postConversionIntegrityCheck =
      typeof input === 'string' ? undefined : input.postConversionIntegrityCheck;
    this.maintenanceDirectory = `${this.databasePath}.maintenance`;
    this.operationsDirectory = join(this.maintenanceDirectory, 'operations');
    this.previewsDirectory = join(this.maintenanceDirectory, 'previews');
    this.backupsDirectory = join(this.maintenanceDirectory, 'backups');
    this.scheduledPath = join(this.maintenanceDirectory, 'scheduled.json');
    this.eventJournalPath = join(this.maintenanceDirectory, 'events.jsonl');
  }

  async preview(input: SqliteJournalPreviewInput, actor: string): Promise<SqliteJournalPreview> {
    const databaseIdentity = await inspectFile(this.databasePath);
    if (!databaseIdentity.present || databaseIdentity.fileType !== 'regular') {
      throw new SqliteJournalMaintenanceError(
        'SQLITE_DATABASE_UNAVAILABLE',
        'The configured authoritative SQLite database is missing or is not a regular file.',
        400
      );
    }
    const filesystem = detectSqliteFilesystem(dirname(this.databasePath));
    const currentMode = currentJournalMode(this.databasePath);
    if (currentMode === 'unknown' || currentMode === 'new') {
      throw new SqliteJournalMaintenanceError(
        'SQLITE_SOURCE_MODE_UNKNOWN',
        'The existing SQLite journal mode could not be verified.',
        400
      );
    }
    if (currentMode === input.targetMode) {
      throw new SqliteJournalMaintenanceError(
        'SQLITE_ALREADY_TARGET_MODE',
        `The database already uses ${input.targetMode} journal mode.`,
        400
      );
    }
    if (filesystem.posture === 'known-unsafe') {
      throw new SqliteJournalMaintenanceError(
        'SQLITE_FILESYSTEM_OVERRIDE_REJECTED',
        'Known-unsafe filesystems cannot be enabled through journal override; move authoritative storage to local durable media.'
      );
    }

    const overrideRequired =
      input.targetMode === 'delete' || filesystem.posture !== 'supported-local';
    if (overrideRequired) this.validateOverrideInput(input);

    const sidecars = await inspectSidecars(this.databasePath);
    requireRegularArtifacts(sidecars.identities);
    const activeConnectionCount = getActiveSqliteConnectionCount(this.databasePath);
    const lockState = inspectSqliteOwnershipLock(this.databasePath);
    const ownershipState = activeConnectionCount > 0 ? 'server-open' : lockState;
    const now = new Date();
    const id = randomUUID();
    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(now.getTime() + PREVIEW_TTL_MS).toISOString();
    const risks = [
      'The server must restart before conversion can run with exclusive ownership.',
      'Pre-close failures revert mode in place; ambiguous post-close failures require operator recovery without blindly restoring an older backup.',
    ];
    if (input.targetMode === 'delete') {
      risks.push(
        'DELETE journal mode is degraded, single-host compatibility mode and blocks clustered writers.'
      );
    }
    if (filesystem.posture !== 'supported-local') {
      risks.push(
        'The filesystem is unverified; the expiring expert override remains fail-closed and single-host only.'
      );
    }

    const publicPreview: SqliteJournalPreview = {
      schemaVersion: 'sqlite-journal-preview/v1',
      id,
      token,
      createdAt: now.toISOString(),
      expiresAt,
      targetMode: input.targetMode,
      currentMode,
      databaseLocation: process.env.VERITAS_SQLITE_PATH ? 'configured' : 'runtime-default',
      filesystemType: filesystem.filesystemType,
      filesystemPosture: filesystem.posture,
      ownershipState,
      activeConnectionCount,
      sidecars: sidecars.public,
      backupLocation: 'adjacent-secure-directory',
      singleHost: input.singleHost === true,
      overrideRequired,
      risks,
      restartRequired: true,
    };
    const { token: _token, ...withoutToken } = publicPreview;
    const record: PreviewRecord = {
      ...withoutToken,
      tokenHash: hashToken(token),
      actor,
      databaseIdentity,
      sidecarIdentities: sidecars.identities,
      overrideReason: input.overrideReason?.trim(),
      policyExpiresAt: input.expiresAt,
    };
    atomicWriteJson(this.previewPath(id), signRecord(record));
    await this.appendEvent('sqlite.journal.previewed', id, actor, 'previewed');
    return publicPreview;
  }

  async schedule(
    input: ScheduleSqliteJournalOperationInput,
    actor: string
  ): Promise<SqliteJournalOperationStatus> {
    const preview = this.readPreview(input.previewId);
    if (preview.actor !== actor) {
      throw new SqliteJournalMaintenanceError(
        'SQLITE_PREVIEW_ACTOR_MISMATCH',
        'The preview belongs to a different authenticated actor.',
        403
      );
    }
    if (Date.parse(preview.expiresAt) <= Date.now()) {
      throw new SqliteJournalMaintenanceError(
        'SQLITE_PREVIEW_EXPIRED',
        'The SQLite maintenance preview has expired.'
      );
    }
    if (preview.consumedAt) {
      throw new SqliteJournalMaintenanceError(
        'SQLITE_PREVIEW_REPLAYED',
        'The SQLite maintenance preview has already been consumed.'
      );
    }
    if (input.confirm !== preview.id || !input.acknowledgeRisks) {
      throw new SqliteJournalMaintenanceError(
        'SQLITE_CONFIRMATION_REQUIRED',
        'Confirm the preview ID and acknowledge the listed risks.',
        400
      );
    }
    const actualHash = hashToken(input.previewToken);
    if (!timingSafeHexEqual(preview.tokenHash, actualHash)) {
      throw new SqliteJournalMaintenanceError(
        'SQLITE_PREVIEW_TOKEN_INVALID',
        'The SQLite maintenance preview token is invalid.',
        403
      );
    }
    if (existsSync(this.scheduledPath)) {
      throw new SqliteJournalMaintenanceError(
        'SQLITE_OPERATION_ALREADY_SCHEDULED',
        'Another SQLite journal operation is already scheduled.'
      );
    }
    await this.revalidatePreview(preview);

    const now = new Date().toISOString();
    const id = randomUUID();
    preview.consumedAt = now;
    preview.consumedByOperationId = id;
    atomicWriteJson(this.previewPath(preview.id), signRecord(preview));
    const record: OperationRecord = {
      schemaVersion: 'sqlite-journal-operation/v1',
      id,
      previewId: preview.id,
      state: 'scheduled',
      targetMode: preview.targetMode,
      originalMode: preview.currentMode,
      createdAt: now,
      updatedAt: now,
      actor,
      restartRequired: true,
      recoveryRequired: false,
      backupAvailable: false,
      preview,
      backupPath: join(this.backupsDirectory, `${id}.db`),
      mutationStarted: false,
    };
    this.writeOperation(record);
    atomicWriteJson(
      this.scheduledPath,
      signRecord({ operationId: id, recordSignature: undefined })
    );
    await this.appendEvent('sqlite.journal.scheduled', id, actor, 'scheduled');
    return this.publicOperation(record);
  }

  getOperation(id?: string): SqliteJournalOperationStatus | undefined {
    const operationId = id ?? this.readScheduledId();
    if (!operationId) return undefined;
    return this.publicOperation(this.readOperation(operationId));
  }

  getPolicySummary() {
    const policy = loadSqliteJournalPolicy(this.databasePath, { allowInactive: true });
    return policy ? summarizeSqliteJournalPolicy(policy) : undefined;
  }

  async revoke(input: RevokeSqliteJournalOverrideInput, actor: string) {
    const policy = revokeSqliteJournalPolicy({
      databasePath: this.databasePath,
      actor,
      reason: input.reason.trim(),
    });
    await this.appendEvent('sqlite.journal.override_revoked', policy.operationId, actor, 'revoked');
    return summarizeSqliteJournalPolicy(policy, { restartRequired: true });
  }

  async executeScheduledOperation(): Promise<SqliteJournalOperationStatus | undefined> {
    const operationId = this.readScheduledId();
    if (!operationId) return undefined;
    let operation = this.readOperation(operationId);
    if (
      operation.state === 'completed' ||
      operation.state === 'rolled-back' ||
      operation.state === 'failed'
    ) {
      if (!operation.recoveryRequired) this.clearScheduled(operation.id);
      return this.publicOperation(operation);
    }
    if (
      operation.mutationStarted ||
      ['target-set', 'integrity-verified', 'rollback-started', 'recovery-required'].includes(
        operation.state
      )
    ) {
      const recoveryLease = acquireSqliteOwnershipLease(this.databasePath, operation.targetMode);
      try {
        operation = await this.recoverInterruptedOperation(operation);
        if (!operation.recoveryRequired) this.clearScheduled(operation.id);
        return this.publicOperation(operation);
      } finally {
        recoveryLease.release();
      }
    }

    let lease: ReturnType<typeof acquireSqliteOwnershipLease> | undefined;
    let database: DatabaseSync | undefined;
    let forwardOnly = false;
    try {
      operation = await this.transition(operation, 'acquiring-lock', 'sqlite.journal.started');
      await this.revalidatePreview(operation.preview);
      if (getActiveSqliteConnectionCount(this.databasePath) !== 0) {
        throw new SqliteJournalMaintenanceError(
          'SQLITE_OFFLINE_REQUIRED',
          'SQLite journal conversion requires zero active server connections.'
        );
      }
      lease = acquireSqliteOwnershipLease(this.databasePath, operation.targetMode);
      database = openExclusiveDatabase(this.databasePath);

      operation.originalPolicy = loadSqliteJournalPolicy(this.databasePath, {
        allowInactive: true,
      });
      secureDirectory(this.backupsDirectory);
      operation.backupAvailable = false;
      operation.backupSha256 = undefined;
      this.writeOperation(operation);
      if (existsSync(operation.backupPath)) unlinkSync(operation.backupPath);
      await backup(database, operation.backupPath);
      this.verifyBackup(operation.backupPath);
      operation.backupAvailable = true;
      operation.backupSha256 = await hashFile(operation.backupPath);
      this.syncFile(operation.backupPath);
      syncDirectory(this.backupsDirectory);
      operation = await this.transition(
        operation,
        'backup-created',
        'sqlite.journal.backup_created'
      );

      if (operation.originalMode === 'wal') {
        const row = database.prepare('PRAGMA wal_checkpoint(TRUNCATE);').get() as
          CheckpointRow | undefined;
        if (!row || row.busy !== 0 || (row.log ?? 0) !== (row.checkpointed ?? 0)) {
          throw new SqliteJournalMaintenanceError(
            'SQLITE_CHECKPOINT_BUSY',
            'SQLite WAL checkpoint could not obtain exclusive ownership.'
          );
        }
      }
      operation = await this.transition(operation, 'checkpointed', 'sqlite.journal.checkpointed');
      const closedSidecars = await inspectSidecars(this.databasePath);
      requireRegularArtifacts(closedSidecars.identities);
      if (closedSidecars.identities.wal.bytes > 0 || closedSidecars.identities.journal.bytes > 0) {
        throw new SqliteJournalMaintenanceError(
          'SQLITE_SIDECAR_BUSY',
          'SQLite sidecars remain active after the exclusive checkpoint.'
        );
      }

      operation.mutationStarted = true;
      this.writeOperation(operation);
      setJournalMode(database, operation.targetMode);
      if (effectiveJournalMode(database) !== operation.targetMode) {
        throw new SqliteJournalMaintenanceError(
          'SQLITE_TARGET_MODE_VERIFY_FAILED',
          'SQLite journal mode verification failed before close.'
        );
      }
      const preCloseIntegrity =
        this.postConversionIntegrityCheck?.(database) ?? integrityResult(database);
      if (preCloseIntegrity !== 'ok') {
        throw new SqliteJournalMaintenanceError(
          'SQLITE_INTEGRITY_FAILED',
          'SQLite integrity verification failed after conversion.'
        );
      }
      operation = await this.transition(operation, 'target-set', 'sqlite.journal.target_set');
      database.close();
      database = undefined;
      forwardOnly = true;

      database = openExclusiveDatabase(this.databasePath);
      operation = await this.transition(operation, 'source-closed', 'sqlite.journal.source_closed');
      if (effectiveJournalMode(database) !== operation.targetMode) {
        throw new SqliteJournalMaintenanceError(
          'SQLITE_TARGET_MODE_VERIFY_FAILED',
          'SQLite journal mode verification failed after reopen.'
        );
      }
      const integrity = integrityResult(database);
      if (integrity !== 'ok') {
        throw new SqliteJournalMaintenanceError(
          'SQLITE_INTEGRITY_FAILED',
          'SQLite integrity verification failed after conversion.'
        );
      }
      operation = await this.transition(
        operation,
        'integrity-verified',
        'sqlite.journal.integrity_verified'
      );

      this.persistTargetPolicy(operation);
      operation.restartRequired = false;
      operation.recoveryRequired = false;
      operation = await this.transition(operation, 'completed', 'sqlite.journal.converted');
      database.close();
      database = undefined;
      if (!operation.recoveryRequired) this.clearScheduled(operation.id);
      return this.publicOperation(operation);
    } catch (error) {
      if (operation.mutationStarted) {
        const errorCode =
          error instanceof SqliteJournalMaintenanceError ? error.code : 'SQLITE_MAINTENANCE_FAILED';
        if (forwardOnly) {
          operation = await this.markRecoveryRequired(operation, errorCode);
        } else if (database) {
          operation = await this.rollbackInPlace(operation, errorCode, database);
          database = undefined;
        } else {
          operation = await this.markRecoveryRequired(operation, errorCode);
        }
      } else {
        operation.errorCode =
          error instanceof SqliteJournalMaintenanceError ? error.code : 'SQLITE_MAINTENANCE_FAILED';
        operation.restartRequired = false;
        operation = await this.transition(operation, 'failed', 'sqlite.journal.failed');
      }
      if (!operation.recoveryRequired) this.clearScheduled(operation.id);
      return this.publicOperation(operation);
    } finally {
      try {
        database?.close();
      } catch {
        // Recovery state and the ownership lease remain authoritative.
      }
      lease?.release();
    }
  }

  private validateOverrideInput(input: SqliteJournalPreviewInput): void {
    if (input.singleHost !== true) {
      throw new SqliteJournalMaintenanceError(
        'SQLITE_SINGLE_HOST_ACK_REQUIRED',
        'Explicit single-host acknowledgement is required.',
        400
      );
    }
    if (process.env.VERITAS_SQLITE_TOPOLOGY !== 'single-host') {
      throw new SqliteJournalMaintenanceError(
        'SQLITE_SINGLE_HOST_REQUIRED',
        'Set VERITAS_SQLITE_TOPOLOGY=single-host before scheduling compatibility mode.',
        400
      );
    }
    getSqliteHostIdHash();
    const reason = input.overrideReason?.trim() ?? '';
    if (reason.length < 8) {
      throw new SqliteJournalMaintenanceError(
        'SQLITE_OVERRIDE_REASON_REQUIRED',
        'An override reason of at least 8 characters is required.',
        400
      );
    }
    const expiresAt = input.expiresAt ? Date.parse(input.expiresAt) : Number.NaN;
    const ttl = expiresAt - Date.now();
    if (!Number.isFinite(expiresAt) || ttl < MIN_OVERRIDE_TTL_MS || ttl > MAX_OVERRIDE_TTL_MS) {
      throw new SqliteJournalMaintenanceError(
        'SQLITE_OVERRIDE_EXPIRY_INVALID',
        'Override expiry must be between 5 minutes and 30 days from now.',
        400
      );
    }
  }

  private async revalidatePreview(preview: PreviewRecord): Promise<void> {
    const current = await inspectFile(this.databasePath);
    const sameIdentity =
      current.present &&
      current.fileType === 'regular' &&
      current.dev === preview.databaseIdentity.dev &&
      current.ino === preview.databaseIdentity.ino;
    const sameContent = current.sha256 === preview.databaseIdentity.sha256;
    if (!sameIdentity || (preview.activeConnectionCount === 0 && !sameContent)) {
      throw new SqliteJournalMaintenanceError(
        'SQLITE_PREVIEW_STALE',
        'The database changed after the maintenance preview.'
      );
    }
    const filesystem = detectSqliteFilesystem(dirname(this.databasePath));
    if (
      filesystem.filesystemType !== preview.filesystemType ||
      filesystem.posture !== preview.filesystemPosture
    ) {
      throw new SqliteJournalMaintenanceError(
        'SQLITE_PREVIEW_STALE',
        'The filesystem posture changed after the maintenance preview.'
      );
    }
    const sidecars = await inspectSidecars(this.databasePath);
    requireRegularArtifacts(sidecars.identities);
    if (preview.activeConnectionCount === 0) {
      for (const kind of ['wal', 'shm', 'journal'] as const) {
        if (sidecars.identities[kind].sha256 !== preview.sidecarIdentities[kind].sha256) {
          throw new SqliteJournalMaintenanceError(
            'SQLITE_PREVIEW_STALE',
            'SQLite sidecars changed after the maintenance preview.'
          );
        }
      }
    }
  }

  private verifyBackup(path: string): void {
    const database = new DatabaseSync(path, { readOnly: true });
    try {
      if (integrityResult(database, 'quick_check') !== 'ok') {
        throw new SqliteJournalMaintenanceError(
          'SQLITE_BACKUP_INVALID',
          'SQLite maintenance backup failed verification.'
        );
      }
    } finally {
      database.close();
    }
  }

  private syncFile(path: string): void {
    const descriptor = openSync(path, 'r');
    try {
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
  }

  private persistTargetPolicy(operation: OperationRecord): void {
    if (
      operation.targetMode === 'wal' &&
      operation.preview.filesystemPosture === 'supported-local'
    ) {
      removeSqliteJournalPolicy(this.databasePath);
      return;
    }
    const policy = createSqliteJournalPolicy({
      databasePath: this.databasePath,
      mode: operation.targetMode,
      actor: operation.actor,
      reason: operation.preview.overrideReason ?? 'Approved SQLite journal maintenance',
      expiresAt:
        operation.preview.policyExpiresAt ??
        new Date(Date.now() + MIN_OVERRIDE_TTL_MS).toISOString(),
      operationId: operation.id,
      source: operation.targetMode === 'delete' ? 'single-host-compatibility' : 'expert-override',
    });
    writeSqliteJournalPolicy(this.databasePath, policy);
  }

  private async rollbackInPlace(
    operation: OperationRecord,
    errorCode: string,
    database: DatabaseSync
  ): Promise<OperationRecord> {
    operation.errorCode = errorCode;
    operation.recoveryRequired = true;
    try {
      operation = await this.transition(
        operation,
        'rollback-started',
        'sqlite.journal.rollback_started'
      );
      const originalMode = requireJournalTarget(operation.originalMode);
      setJournalMode(database, originalMode);
      if (effectiveJournalMode(database) !== originalMode || integrityResult(database) !== 'ok') {
        throw new Error('in-place journal rollback verification failed');
      }
      this.restoreOriginalPolicy(operation);
      operation.recoveryRequired = false;
      operation.restartRequired = false;
      operation = await this.transition(
        operation,
        'rolled-back',
        'sqlite.journal.rollback_succeeded'
      );
      database.close();
      return operation;
    } catch {
      try {
        database.close();
      } catch {
        // The recovery-required sentinel remains authoritative.
      }
      operation.recoveryRequired = true;
      operation.restartRequired = true;
      return this.transition(operation, 'recovery-required', 'sqlite.journal.rollback_failed');
    }
  }

  private async recoverInterruptedOperation(operation: OperationRecord): Promise<OperationRecord> {
    let database: DatabaseSync | undefined;
    try {
      if (!existsSync(this.databasePath)) throw new Error('authoritative database unavailable');
      const stat = lstatSync(this.databasePath);
      if (!stat.isFile() || stat.isSymbolicLink()) {
        throw new Error('authoritative database is not a regular file');
      }
      database = openExclusiveDatabase(this.databasePath);
      const mode = effectiveJournalMode(database);
      const originalMode = requireJournalTarget(operation.originalMode);
      if (integrityResult(database) !== 'ok') throw new Error('database integrity failed');

      const rollbackRequested =
        Boolean(operation.errorCode) ||
        operation.state === 'rollback-started' ||
        operation.state === 'recovery-required';
      if (rollbackRequested || mode === originalMode) {
        if (mode !== originalMode) setJournalMode(database, originalMode);
        if (effectiveJournalMode(database) !== originalMode || integrityResult(database) !== 'ok') {
          throw new Error('interrupted rollback verification failed');
        }
        this.restoreOriginalPolicy(operation);
        operation.recoveryRequired = false;
        operation.restartRequired = false;
        operation = await this.transition(
          operation,
          'rolled-back',
          'sqlite.journal.rollback_succeeded'
        );
        return operation;
      }

      if (mode !== operation.targetMode) throw new Error('interrupted target mode is ambiguous');
      operation = await this.transition(operation, 'target-set', 'sqlite.journal.target_set');
      operation = await this.transition(
        operation,
        'integrity-verified',
        'sqlite.journal.integrity_verified'
      );
      this.persistTargetPolicy(operation);
      operation.recoveryRequired = false;
      operation.restartRequired = false;
      operation = await this.transition(operation, 'completed', 'sqlite.journal.converted');
      return operation;
    } catch {
      return this.markRecoveryRequired(operation, 'SQLITE_INTERRUPTED_OPERATION');
    } finally {
      try {
        database?.close();
      } catch {
        // The persisted operation state remains authoritative.
      }
    }
  }

  private restoreOriginalPolicy(operation: OperationRecord): void {
    if (operation.originalPolicy) {
      writeSqliteJournalPolicy(
        this.databasePath,
        rebindSqliteJournalPolicy(this.databasePath, operation.originalPolicy)
      );
    } else {
      removeSqliteJournalPolicy(this.databasePath);
    }
  }

  private markRecoveryRequired(
    operation: OperationRecord,
    errorCode: string
  ): Promise<OperationRecord> {
    operation.errorCode = errorCode;
    operation.recoveryRequired = true;
    operation.restartRequired = true;
    return this.transition(operation, 'recovery-required', 'sqlite.journal.rollback_failed');
  }

  private async transition(
    operation: OperationRecord,
    state: SqliteJournalOperationState,
    event: string
  ): Promise<OperationRecord> {
    operation.state = state;
    operation.updatedAt = new Date().toISOString();
    this.writeOperation(operation);
    await this.appendEvent(event, operation.id, operation.actor, state, operation.errorCode);
    this.faultInjector?.(state);
    maybeCrash(state);
    return operation;
  }

  private async appendEvent(
    action: string,
    operationId: string,
    actor: string,
    state: SqliteJournalOperationState,
    errorCode?: string
  ): Promise<void> {
    secureDirectory(this.maintenanceDirectory);
    const line = JSON.stringify({
      timestamp: new Date().toISOString(),
      action,
      actor,
      operationId,
      state,
      ...(errorCode ? { errorCode } : {}),
    });
    let expectedIdentity: { dev: number; ino: number } | undefined;
    if (existsSync(this.eventJournalPath)) {
      const stat = lstatSync(this.eventJournalPath);
      if (
        !stat.isFile() ||
        stat.isSymbolicLink() ||
        (process.platform !== 'win32' &&
          ((typeof process.getuid === 'function' && stat.uid !== process.getuid()) ||
            (stat.mode & 0o077) !== 0))
      ) {
        throw new SqliteJournalMaintenanceError(
          'SQLITE_MAINTENANCE_PATH_UNSAFE',
          'SQLite maintenance event journal is not a private regular file.'
        );
      }
      expectedIdentity = { dev: stat.dev, ino: stat.ino };
    }
    const noFollow = typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0;
    const descriptor = openSync(
      this.eventJournalPath,
      constants.O_APPEND | constants.O_CREAT | constants.O_WRONLY | noFollow,
      0o600
    );
    try {
      const opened = fstatSync(descriptor);
      if (
        !opened.isFile() ||
        (expectedIdentity &&
          (opened.dev !== expectedIdentity.dev || opened.ino !== expectedIdentity.ino))
      ) {
        throw new SqliteJournalMaintenanceError(
          'SQLITE_MAINTENANCE_PATH_UNSAFE',
          'SQLite maintenance event journal changed during secure open.'
        );
      }
      writeFileSync(descriptor, `${line}\n`, 'utf8');
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
    syncDirectory(this.maintenanceDirectory);
  }

  private previewPath(id: string): string {
    return join(this.previewsDirectory, `${id}.json`);
  }

  private operationPath(id: string): string {
    return join(this.operationsDirectory, `${id}.json`);
  }

  private readPreview(id: string): PreviewRecord {
    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      throw new SqliteJournalMaintenanceError(
        'SQLITE_PREVIEW_INVALID',
        'Invalid SQLite maintenance preview ID.',
        400
      );
    }
    const path = this.previewPath(id);
    if (!existsSync(path)) {
      throw new SqliteJournalMaintenanceError(
        'SQLITE_PREVIEW_NOT_FOUND',
        'SQLite maintenance preview not found.',
        404
      );
    }
    try {
      return verifyRecord(readRegularJson<PreviewRecord>(path));
    } catch {
      throw new SqliteJournalMaintenanceError(
        'SQLITE_PREVIEW_INVALID',
        'SQLite maintenance preview is malformed or tampered.',
        409
      );
    }
  }

  private readScheduledId(): string | undefined {
    if (!existsSync(this.scheduledPath)) return undefined;
    try {
      const parsed = verifyRecord(
        readRegularJson<{ operationId?: string; recordSignature?: string }>(this.scheduledPath)
      );
      return parsed.operationId;
    } catch {
      throw new SqliteJournalMaintenanceError(
        'SQLITE_SCHEDULE_INVALID',
        'Scheduled SQLite maintenance state is malformed.',
        503
      );
    }
  }

  private readOperation(id: string): OperationRecord {
    const path = this.operationPath(id);
    if (!existsSync(path)) {
      throw new SqliteJournalMaintenanceError(
        'SQLITE_OPERATION_NOT_FOUND',
        'SQLite maintenance operation not found.',
        404
      );
    }
    try {
      return verifyRecord(readRegularJson<OperationRecord>(path));
    } catch {
      throw new SqliteJournalMaintenanceError(
        'SQLITE_OPERATION_INVALID',
        'SQLite maintenance operation is malformed or tampered.',
        503
      );
    }
  }

  private writeOperation(operation: OperationRecord): void {
    const signed = signRecord(operation);
    operation.recordSignature = signed.recordSignature;
    atomicWriteJson(this.operationPath(operation.id), signed);
  }

  private clearScheduled(operationId: string): void {
    if (!existsSync(this.scheduledPath)) return;
    const current = this.readScheduledId();
    if (current === operationId) unlinkSync(this.scheduledPath);
  }

  private publicOperation(operation: OperationRecord): SqliteJournalOperationStatus {
    return {
      schemaVersion: operation.schemaVersion,
      id: operation.id,
      previewId: operation.previewId,
      state: operation.state,
      targetMode: operation.targetMode,
      originalMode: operation.originalMode,
      createdAt: operation.createdAt,
      updatedAt: operation.updatedAt,
      actor: operation.actor,
      restartRequired: operation.restartRequired,
      recoveryRequired: operation.recoveryRequired,
      backupAvailable: operation.backupAvailable,
      errorCode: operation.errorCode,
    };
  }
}

let singleton: SqliteJournalMaintenanceService | undefined;

export function getSqliteJournalMaintenanceService(): SqliteJournalMaintenanceService {
  singleton ??= new SqliteJournalMaintenanceService();
  return singleton;
}

export function resetSqliteJournalMaintenanceServiceForTests(): void {
  singleton = undefined;
}

export async function executeScheduledSqliteJournalMaintenance(): Promise<void> {
  if (process.env.VERITAS_STORAGE !== 'sqlite') return;
  const result = await getSqliteJournalMaintenanceService().executeScheduledOperation();
  if (result?.recoveryRequired) {
    throw new SqliteJournalMaintenanceError(
      'SQLITE_RECOVERY_REQUIRED',
      'SQLite journal maintenance recovery is required before startup can continue.',
      503
    );
  }
}
