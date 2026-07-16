import type { SqliteFilesystemPosture } from './sqlite-storage.types.js';

export type SqliteJournalTarget = 'wal' | 'delete';

export type SqliteMaintenanceSidecarKind = 'wal' | 'shm' | 'journal';

export interface SqliteMaintenanceSidecar {
  kind: SqliteMaintenanceSidecarKind;
  present: boolean;
  bytes: number;
  fileType: 'regular' | 'symlink' | 'other' | 'missing';
}

export type SqliteJournalOwnershipState =
  'available' | 'server-open' | 'owned' | 'foreign-host' | 'malformed';

export interface SqliteJournalPreviewInput {
  targetMode: SqliteJournalTarget;
  singleHost?: boolean;
  overrideReason?: string;
  expiresAt?: string;
}

export interface SqliteJournalPreview {
  schemaVersion: 'sqlite-journal-preview/v1';
  id: string;
  token: string;
  createdAt: string;
  expiresAt: string;
  targetMode: SqliteJournalTarget;
  currentMode: SqliteJournalTarget | 'new' | 'unknown';
  databaseLocation: 'configured' | 'runtime-default';
  filesystemType: string;
  filesystemPosture: SqliteFilesystemPosture;
  ownershipState: SqliteJournalOwnershipState;
  activeConnectionCount: number;
  sidecars: SqliteMaintenanceSidecar[];
  backupLocation: 'adjacent-secure-directory';
  singleHost: boolean;
  overrideRequired: boolean;
  risks: string[];
  restartRequired: true;
}

export interface ScheduleSqliteJournalOperationInput {
  previewId: string;
  previewToken: string;
  confirm: string;
  acknowledgeRisks: true;
}

export type SqliteJournalOperationState =
  | 'previewed'
  | 'scheduled'
  | 'acquiring-lock'
  | 'backup-created'
  | 'checkpointed'
  | 'source-closed'
  | 'target-set'
  | 'integrity-verified'
  | 'completed'
  | 'rollback-started'
  | 'rolled-back'
  | 'failed'
  | 'recovery-required'
  | 'revoked';

export interface SqliteJournalOperationStatus {
  schemaVersion: 'sqlite-journal-operation/v1';
  id: string;
  previewId: string;
  state: SqliteJournalOperationState;
  targetMode: SqliteJournalTarget;
  originalMode: SqliteJournalTarget | 'new' | 'unknown';
  createdAt: string;
  updatedAt: string;
  actor: string;
  restartRequired: boolean;
  recoveryRequired: boolean;
  backupAvailable: boolean;
  errorCode?: string;
}

export interface SqliteJournalPolicySummary {
  id: string;
  mode: SqliteJournalTarget;
  status: 'active' | 'expired' | 'revoked' | 'invalid';
  source: 'single-host-compatibility' | 'expert-override';
  singleHost: true;
  hostBound: true;
  expiresAt: string;
  revokedAt?: string;
  restartRequired: boolean;
}

export interface RevokeSqliteJournalOverrideInput {
  reason: string;
}
