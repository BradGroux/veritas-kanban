export type SqliteFilesystemPosture =
  'supported-local' | 'known-unsafe' | 'unknown' | 'not-applicable';

export type SqliteJournalModePosture = 'wal' | 'memory' | 'refused' | 'unknown';

export interface SqliteIntegrityCheckPosture {
  checkedAt: string;
  status: 'ok' | 'failed';
  result: string;
}

/**
 * Redacted runtime evidence for the authoritative SQLite database.
 * Raw database paths, mount points, and mount sources are intentionally omitted.
 */
export interface SqliteStorageDiagnostics {
  schemaVersion: 'sqlite-storage/v1';
  databaseLocation: 'memory' | 'configured' | 'runtime-default';
  platform: string;
  filesystemType: string;
  filesystemPosture: SqliteFilesystemPosture;
  detectionSource: string;
  reasonCode: string;
  journalMode: SqliteJournalModePosture;
  decisionSource: 'automatic' | 'memory';
  overrideSource: null;
  lastIntegrityCheck?: SqliteIntegrityCheckPosture;
}
