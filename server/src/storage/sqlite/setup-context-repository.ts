import type { DesktopSetupContext, DesktopSetupDataCounts } from '@veritas-kanban/shared';
import type { SetupContextRepository } from '../interfaces.js';
import type { SqliteDatabase } from './database.js';

const SETUP_COUNT_QUERIES = {
  tasks: 'SELECT COUNT(*) AS count FROM tasks WHERE deleted_at IS NULL',
  squadMessages: 'SELECT COUNT(*) AS count FROM squad_messages',
  telemetryEvents: 'SELECT COUNT(*) AS count FROM telemetry_events',
  workflowDefinitions: 'SELECT COUNT(*) AS count FROM workflow_definitions',
  workflowRuns: 'SELECT COUNT(*) AS count FROM workflow_runs',
} as const satisfies Record<keyof DesktopSetupDataCounts, string>;

interface CountRow {
  count: number;
}

export class SqliteSetupContextRepository implements SetupContextRepository {
  constructor(private readonly database: SqliteDatabase) {}

  getSetupContext(): DesktopSetupContext {
    const connection = this.database.getConnection();
    const countRows = (query: string): number => {
      const row = connection.prepare(query).get() as CountRow | undefined;
      return Number(row?.count ?? 0);
    };
    const counts: DesktopSetupDataCounts = {
      tasks: countRows(SETUP_COUNT_QUERIES.tasks),
      squadMessages: countRows(SETUP_COUNT_QUERIES.squadMessages),
      telemetryEvents: countRows(SETUP_COUNT_QUERIES.telemetryEvents),
      workflowDefinitions: countRows(SETUP_COUNT_QUERIES.workflowDefinitions),
      workflowRuns: countRows(SETUP_COUNT_QUERIES.workflowRuns),
    };

    return {
      storageMode: 'sqlite',
      hasExistingData: Object.values(counts).some((count) => count > 0),
      counts,
    };
  }
}
