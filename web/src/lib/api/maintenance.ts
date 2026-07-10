import type {
  MaintenanceDebugBundle,
  MaintenanceLogTail,
  MaintenanceSqliteExportInput,
  MaintenanceSqliteImportInput,
  MaintenanceSummary,
} from '@veritas-kanban/shared';
import { API_BASE, apiFetch } from './helpers';

export interface SqlitePortabilityReport {
  operation: 'file-to-sqlite' | 'sqlite-export' | 'sqlite-import';
  dryRun: boolean;
  startedAt: string;
  completedAt: string;
  sqlitePath?: string;
  sourceRoot?: string;
  backupPath?: string;
  bundlePath?: string;
  counts: Array<{
    entity: string;
    scanned: number;
    written: number;
    skipped: number;
  }>;
  warnings: Array<{
    entity: string;
    source?: string;
    message: string;
  }>;
}

function buildQuery(params: Record<string, string | number | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) query.set(key, String(value));
  }
  const serialized = query.toString();
  return serialized ? `?${serialized}` : '';
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  return apiFetch<T>(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export const maintenanceApi = {
  summary: async (): Promise<MaintenanceSummary> => {
    return apiFetch<MaintenanceSummary>(`${API_BASE}/maintenance/summary`);
  },

  tailLog: async (source: string, tail = 200): Promise<MaintenanceLogTail> => {
    return apiFetch<MaintenanceLogTail>(
      `${API_BASE}/maintenance/logs${buildQuery({ source, tail })}`
    );
  },

  createDebugBundle: async (): Promise<MaintenanceDebugBundle> =>
    postJson<MaintenanceDebugBundle>('/maintenance/debug-bundle', {}),

  exportSqlite: async (input: MaintenanceSqliteExportInput): Promise<SqlitePortabilityReport> =>
    postJson<SqlitePortabilityReport>('/maintenance/sqlite/export', input),

  importSqlite: async (input: MaintenanceSqliteImportInput): Promise<SqlitePortabilityReport> =>
    postJson<SqlitePortabilityReport>('/maintenance/sqlite/import', input),
};
