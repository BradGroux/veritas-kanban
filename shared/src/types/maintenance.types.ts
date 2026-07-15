import type { WorkProductMaintenancePreview } from './work-product.types.js';
import type { SqliteStorageDiagnostics } from './sqlite-storage.types.js';

export type DataLifecycleClassId =
  | 'workspaceIdentity'
  | 'tasks'
  | 'comments'
  | 'uploadsAttachments'
  | 'workProducts'
  | 'telemetry'
  | 'workflowRuns'
  | 'notifications'
  | 'chat'
  | 'audit'
  | 'deviceAccess'
  | 'configuration'
  | 'backupsExports'
  | 'debugBundles';

export interface DataLifecycleManifestEntry {
  id: DataLifecycleClassId;
  label: string;
  tables: string[];
  rowCount: number;
  defaultRetention: string;
  exportBehavior: string;
  deleteBehavior: string;
  redaction: string;
  containsSecrets: boolean;
  containsPrivatePaths: boolean;
  containsGeneratedContent: boolean;
  workspaceScoped: boolean;
}

export type MaintenanceHealthState = 'ok' | 'warn' | 'fail' | 'unknown';

export interface MaintenanceHealthCheck {
  id: string;
  label: string;
  state: MaintenanceHealthState;
  detail: string;
  checkedAt: string;
}

export interface MaintenanceStorageCategory {
  id: string;
  label: string;
  bytes: number;
  itemCount: number;
  cleanupEligibleCount: number;
  retainedReason: string;
  lastUsedAt?: string;
}

export interface MaintenanceLogSource {
  id: string;
  label: string;
  path: string;
  exists: boolean;
  sizeBytes: number;
  updatedAt?: string;
  redacted: boolean;
}

export interface MaintenanceCleanupPreviewItem {
  id: string;
  label: string;
  category: string;
  cleanupEligible: boolean;
  affectedCount: number;
  estimatedBytes: number;
  retainedReason: string;
  sourceHref?: string;
  lastUsedAt?: string;
}

export interface MaintenanceSummary {
  generatedAt: string;
  mode: 'local' | 'remote';
  storageMode: string;
  sqlite?: SqliteStorageDiagnostics;
  health: MaintenanceHealthCheck[];
  storage: {
    totalBytes: number;
    categories: MaintenanceStorageCategory[];
  };
  logs: MaintenanceLogSource[];
  lifecycle: DataLifecycleManifestEntry[];
  cleanupPreview: {
    items: MaintenanceCleanupPreviewItem[];
    destructiveActionsEnabled: boolean;
    confirmationRequired: true;
    notes: string[];
  };
  workProducts: WorkProductMaintenancePreview;
}

export interface MaintenanceLogTail {
  source: MaintenanceLogSource;
  lines: string[];
  truncated: boolean;
  redacted: true;
}

export interface MaintenanceDebugBundle {
  id: string;
  createdAt: string;
  outputPath: string;
  redacted: true;
  manifest: {
    includedCategories: string[];
    excludedCategories: string[];
    redactionRules: string[];
    files: MaintenanceLogSource[];
  };
}

export interface MaintenanceSqliteExportInput {
  sqlitePath: string;
  outputDir: string;
  workspaceId?: string;
}

export interface MaintenanceSqliteImportInput {
  sqlitePath: string;
  bundleDir: string;
  replaceExisting?: boolean;
}
