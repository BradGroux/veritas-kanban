export type SqliteFilesystemPosture =
  'supported-local' | 'known-unsafe' | 'unknown' | 'not-applicable';

export type SqliteJournalModePosture = 'wal' | 'delete' | 'memory' | 'refused' | 'unknown';

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
  decisionSource: 'automatic' | 'memory' | 'single-host-compatibility' | 'expert-override';
  overrideSource: null | 'operator-policy';
  healthPosture?: 'healthy' | 'degraded' | 'refused';
  lockingPosture?: 'wal-coordinated' | 'single-host-owner-lock' | 'none' | 'failed';
  ownershipState?: 'owned' | 'available' | 'foreign-host' | 'malformed';
  override?: import('./sqlite-maintenance.types.js').SqliteJournalPolicySummary;
  lastMaintenanceOperation?: Pick<
    import('./sqlite-maintenance.types.js').SqliteJournalOperationStatus,
    'id' | 'state' | 'updatedAt' | 'recoveryRequired'
  >;
  lastIntegrityCheck?: SqliteIntegrityCheckPosture;
}
