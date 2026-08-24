/**
 * Immutable Audit Log Service
 *
 * Append-only log with hash chain integrity for security-sensitive operations.
 * Each entry includes a SHA-256 hash of the previous entry, creating a tamper-evident chain.
 *
 * Log files are stored as JSONL (one JSON object per line) with monthly rotation:
 *   {dataDir}/audit/audit-{YYYY-MM}.log
 */
import crypto from 'crypto';
import { createLogger } from '../lib/logger.js';
import { SqliteDatabase } from '../storage/sqlite/database.js';
import { SqliteAuditRepository } from '../storage/sqlite/audit-policy-repositories.js';
import { AuditFileRepository } from '../storage/audit-file-repository.js';

const log = createLogger('audit');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AuditEvent {
  /** Action performed (e.g., auth.login, task.create, settings.update) */
  action: string;
  /** Who performed the action (user ID, API key hash, or "system") */
  actor: string;
  /** What was affected (task ID, setting name, etc.) */
  resource?: string;
  /** Additional context (IP, user agent, etc.) */
  details?: Record<string, unknown>;
}

export interface AuditEntry extends AuditEvent {
  /** ISO 8601 timestamp */
  timestamp: string;
  /** SHA-256 hash of the previous entry (hex). Empty string for the first entry. */
  integrity: string;
}

export interface VerifyResult {
  /** Whether the entire log chain is valid */
  valid: boolean;
  /** Total number of entries checked */
  entries: number;
  /** Index of the first broken link (0-based), if any */
  firstBroken?: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

import { getAuditDir } from '../utils/paths.js';

const AUDIT_DIR = getAuditDir();
const SQLITE_AUDIT_LOG_PATH = 'sqlite://audit/current';
const auditFileRepository = new AuditFileRepository(AUDIT_DIR);

// ---------------------------------------------------------------------------
// Internal State
// ---------------------------------------------------------------------------

/** Hash of the last written entry (in-memory cache to avoid re-reading). */
let lastHash = '';

/** Promise chain to serialise concurrent writes. */
let writeQueue: Promise<void> = Promise.resolve();

/** Cached current log file path (invalidated on month change). */
let currentMonth = '';
let currentLogPath = '';
let sqliteDatabase: SqliteDatabase | null = null;
let auditRepository: SqliteAuditRepository | null = null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** SHA-256 hash of a string, returned as hex. */
function sha256(data: string): string {
  return crypto.createHash('sha256').update(data, 'utf8').digest('hex');
}

/** Build the log file path for a given date. */
function logFilePath(date: Date = new Date()): string {
  if (isSqliteAuditEnabled()) {
    return SQLITE_AUDIT_LOG_PATH;
  }

  const month = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

  // Cache to avoid path.join on every write
  if (month !== currentMonth) {
    currentMonth = month;
    currentLogPath = auditFileRepository.getMonthlyLogPath(date);
  }
  return currentLogPath;
}

/** Ensure the audit directory exists. */
async function ensureAuditDir(): Promise<void> {
  await auditFileRepository.ensureReady();
}

function isSqliteAuditEnabled(): boolean {
  return process.env.VERITAS_STORAGE === 'sqlite';
}

function getAuditRepository(): SqliteAuditRepository {
  if (!auditRepository) {
    sqliteDatabase = new SqliteDatabase();
    sqliteDatabase.open();
    auditRepository = new SqliteAuditRepository(sqliteDatabase);
  }

  return auditRepository;
}

/**
 * Read the last line of the current log file to seed `lastHash`.
 * Called once on first write (or after month rotation).
 */
async function seedLastHash(filePath: string): Promise<void> {
  if (isSqliteAuditEnabled() || filePath === SQLITE_AUDIT_LOG_PATH) {
    const lastLine = getAuditRepository().getLastEntryLine();
    lastHash = lastLine ? sha256(lastLine) : '';
    return;
  }

  lastHash = await auditFileRepository.getLastHash(filePath);
}

/** Track whether we've seeded for the current file. */
let seededForPath = '';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Append an audit entry to the current month's log file.
 *
 * Writes are serialised via a promise chain to prevent interleaving.
 * The `integrity` field contains the SHA-256 hash of the previous entry's
 * JSON line, forming an append-only hash chain.
 */
export function auditLog(event: AuditEvent): Promise<void> {
  // Chain writes so concurrent calls don't interleave
  writeQueue = writeQueue
    .then(() => writeEntry(event))
    .catch((err) => {
      log.error({ err, event }, 'Failed to write audit log entry');
    });
  return writeQueue;
}

async function writeEntry(event: AuditEvent): Promise<void> {
  const filePath = logFilePath();
  if (!isSqliteAuditEnabled()) {
    await ensureAuditDir();
  }

  // Seed lastHash from disk on first write or month rotation
  if (seededForPath !== filePath) {
    await seedLastHash(filePath);
    seededForPath = filePath;
  }

  const entry: AuditEntry = {
    timestamp: new Date().toISOString(),
    action: event.action,
    actor: event.actor,
    resource: event.resource,
    details: event.details,
    integrity: lastHash,
  };

  const line = JSON.stringify(entry);
  if (isSqliteAuditEnabled()) {
    getAuditRepository().save(entry, line);
  } else {
    await auditFileRepository.append(filePath, line);
  }

  // Update the running hash
  lastHash = sha256(line);
}

/**
 * Verify the hash chain integrity of an audit log file.
 *
 * Reads every line, re-computes the expected integrity hash, and compares.
 * Returns a result indicating whether the chain is intact.
 */
export async function verifyAuditLog(filePath: string): Promise<VerifyResult> {
  if (isSqliteAuditEnabled() || filePath === SQLITE_AUDIT_LOG_PATH) {
    return getAuditRepository().verify();
  }

  return auditFileRepository.verify(filePath);
}

/**
 * Read recent audit entries from the current log file.
 * Returns entries in reverse chronological order (newest first).
 */
export async function readRecentAuditEntries(limit = 100): Promise<AuditEntry[]> {
  const filePath = logFilePath();
  if (isSqliteAuditEnabled()) {
    return getAuditRepository().readRecent(limit) as AuditEntry[];
  }

  return auditFileRepository.readRecent(filePath, limit);
}

/**
 * Get the path to the current month's audit log file.
 * Useful for the verify endpoint.
 */
export function getCurrentAuditLogPath(): string {
  return logFilePath();
}

/**
 * Reset internal state. **Only for testing.**
 */
export function _resetAuditState(): void {
  lastHash = '';
  currentMonth = '';
  currentLogPath = '';
  seededForPath = '';
  writeQueue = Promise.resolve();
  auditRepository = null;
  sqliteDatabase?.close();
  sqliteDatabase = null;
}
