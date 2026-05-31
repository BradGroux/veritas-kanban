import type { Deliverable, DeliverableRun } from '../../services/scheduled-deliverables-service.js';
import type { SqliteDatabase } from './database.js';

interface DeliverableRow {
  deliverable_json: string;
}

interface DeliverableRunRow {
  run_json: string;
}

export class SqliteScheduledDeliverablesRepository {
  constructor(private readonly database: SqliteDatabase) {}

  loadDeliverables(): Deliverable[] {
    const rows = this.database
      .getConnection()
      .prepare(
        `
          SELECT deliverable_json
          FROM scheduled_deliverables
          WHERE workspace_id = 'local'
          ORDER BY lower(name) ASC, id ASC
        `
      )
      .all() as unknown as DeliverableRow[];

    return rows.map((row) => JSON.parse(row.deliverable_json) as Deliverable);
  }

  saveDeliverables(deliverables: Deliverable[]): void {
    const db = this.database.getConnection();

    db.exec('BEGIN IMMEDIATE;');
    try {
      db.prepare("DELETE FROM scheduled_deliverables WHERE workspace_id = 'local'").run();

      const insertDeliverable = db.prepare(
        `
          INSERT INTO scheduled_deliverables (
            id,
            workspace_id,
            name,
            description,
            schedule,
            cron_expr,
            schedule_description,
            enabled,
            agent,
            output_path,
            tags_json,
            deliverable_json,
            created_at,
            last_run_at,
            next_run_at,
            total_runs
          )
          VALUES (?, 'local', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
      );

      for (const deliverable of deliverables) {
        insertDeliverable.run(
          deliverable.id,
          deliverable.name,
          deliverable.description,
          deliverable.schedule,
          deliverable.cronExpr ?? null,
          deliverable.scheduleDescription,
          deliverable.enabled ? 1 : 0,
          deliverable.agent ?? null,
          deliverable.outputPath ?? null,
          JSON.stringify(deliverable.tags),
          JSON.stringify(deliverable),
          deliverable.createdAt,
          deliverable.lastRunAt ?? null,
          deliverable.nextRunAt ?? null,
          deliverable.totalRuns
        );
      }

      db.exec('COMMIT;');
    } catch (error) {
      db.exec('ROLLBACK;');
      throw error;
    }
  }

  loadRuns(): DeliverableRun[] {
    const rows = this.database
      .getConnection()
      .prepare(
        `
          SELECT run_json
          FROM scheduled_deliverable_runs
          WHERE workspace_id = 'local'
          ORDER BY datetime(run_at) ASC, id ASC
        `
      )
      .all() as unknown as DeliverableRunRow[];

    return rows.map((row) => JSON.parse(row.run_json) as DeliverableRun);
  }

  saveRuns(runs: DeliverableRun[]): void {
    const db = this.database.getConnection();

    db.exec('BEGIN IMMEDIATE;');
    try {
      db.prepare("DELETE FROM scheduled_deliverable_runs WHERE workspace_id = 'local'").run();

      const insertRun = db.prepare(
        `
          INSERT INTO scheduled_deliverable_runs (
            id,
            workspace_id,
            deliverable_id,
            status,
            output_file,
            summary,
            duration_ms,
            error,
            source_run_id,
            workflow_id,
            snapshot_json,
            run_json,
            run_at
          )
          VALUES (?, 'local', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
      );

      for (const run of runs) {
        insertRun.run(
          run.id,
          run.deliverableId,
          run.status,
          run.outputFile ?? null,
          run.summary ?? null,
          run.durationMs ?? null,
          run.error ?? null,
          run.sourceRunId ?? null,
          run.workflowId ?? null,
          run.snapshot ? JSON.stringify(run.snapshot) : null,
          JSON.stringify(run),
          run.runAt
        );
      }

      db.exec('COMMIT;');
    } catch (error) {
      db.exec('ROLLBACK;');
      throw error;
    }
  }
}
