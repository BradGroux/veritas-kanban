import type { SQLInputValue } from 'node:sqlite';
import type {
  WorkflowACL,
  WorkflowAuditEvent,
  WorkflowDefinition,
  WorkflowRun,
} from '../../types/workflow.js';
import type { SqliteDatabase } from './database.js';

type WorkflowMetadata = Pick<WorkflowDefinition, 'id' | 'name' | 'version' | 'description'>;
type WorkflowRunMetadata = Pick<
  WorkflowRun,
  | 'id'
  | 'workflowId'
  | 'workflowVersion'
  | 'taskId'
  | 'status'
  | 'startedAt'
  | 'completedAt'
  | 'error'
>;

interface WorkflowDefinitionRow {
  workflow_json: string;
}

interface WorkflowMetadataRow {
  id: string;
  name: string;
  version: number;
  description: string | null;
}

interface WorkflowAclRow {
  acl_json: string;
}

interface WorkflowRunRow {
  run_json: string;
}

interface WorkflowRunMetadataRow {
  id: string;
  workflow_id: string;
  workflow_version: number;
  task_id: string | null;
  status: WorkflowRun['status'];
  started_at: string;
  completed_at: string | null;
  error: string | null;
}

export class SqliteWorkflowDefinitionRepository {
  constructor(private readonly database: SqliteDatabase) {}

  count(): number {
    const row = this.database
      .getConnection()
      .prepare(
        `
          SELECT COUNT(*) AS count
          FROM workflow_definitions
          WHERE workspace_id = 'local'
        `
      )
      .get() as { count: number } | undefined;

    return row?.count ?? 0;
  }

  get(id: string): WorkflowDefinition | null {
    const row = this.database
      .getConnection()
      .prepare(
        `
          SELECT workflow_json
          FROM workflow_definitions
          WHERE workspace_id = 'local'
            AND id = ?
        `
      )
      .get(id) as WorkflowDefinitionRow | undefined;

    return row ? (JSON.parse(row.workflow_json) as WorkflowDefinition) : null;
  }

  list(): WorkflowDefinition[] {
    const rows = this.database
      .getConnection()
      .prepare(
        `
          SELECT workflow_json
          FROM workflow_definitions
          WHERE workspace_id = 'local'
          ORDER BY name ASC, id ASC
        `
      )
      .all() as unknown as WorkflowDefinitionRow[];

    return rows.map((row) => JSON.parse(row.workflow_json) as WorkflowDefinition);
  }

  listMetadata(): WorkflowMetadata[] {
    const rows = this.database
      .getConnection()
      .prepare(
        `
          SELECT id, name, version, description
          FROM workflow_definitions
          WHERE workspace_id = 'local'
          ORDER BY name ASC, id ASC
        `
      )
      .all() as unknown as WorkflowMetadataRow[];

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      version: row.version,
      description: row.description ?? '',
    }));
  }

  save(workflow: WorkflowDefinition): void {
    const now = new Date().toISOString();
    this.database
      .getConnection()
      .prepare(
        `
          INSERT INTO workflow_definitions (
            id,
            workspace_id,
            name,
            version,
            description,
            workflow_json,
            created_at,
            updated_at
          )
          VALUES (?, 'local', ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            version = excluded.version,
            description = excluded.description,
            workflow_json = excluded.workflow_json,
            updated_at = excluded.updated_at
        `
      )
      .run(
        workflow.id,
        workflow.name,
        workflow.version,
        workflow.description ?? null,
        JSON.stringify(workflow),
        now,
        now
      );
  }

  delete(id: string): boolean {
    const result = this.database
      .getConnection()
      .prepare(
        `
          DELETE FROM workflow_definitions
          WHERE workspace_id = 'local'
            AND id = ?
        `
      )
      .run(id);

    return Number(result.changes) > 0;
  }

  getAcl(workflowId: string): WorkflowACL | null {
    const row = this.database
      .getConnection()
      .prepare(
        `
          SELECT acl_json
          FROM workflow_acls
          WHERE workspace_id = 'local'
            AND workflow_id = ?
        `
      )
      .get(workflowId) as WorkflowAclRow | undefined;

    return row ? (JSON.parse(row.acl_json) as WorkflowACL) : null;
  }

  saveAcl(acl: WorkflowACL): void {
    this.database
      .getConnection()
      .prepare(
        `
          INSERT INTO workflow_acls (
            workflow_id,
            workspace_id,
            acl_json,
            updated_at
          )
          VALUES (?, 'local', ?, ?)
          ON CONFLICT(workflow_id) DO UPDATE SET
            acl_json = excluded.acl_json,
            updated_at = excluded.updated_at
        `
      )
      .run(acl.workflowId, JSON.stringify(acl), new Date().toISOString());
  }

  appendAuditEvent(event: WorkflowAuditEvent): void {
    this.database
      .getConnection()
      .prepare(
        `
          INSERT INTO workflow_audit_events (
            workspace_id,
            workflow_id,
            action,
            user_id,
            event_json,
            created_at
          )
          VALUES ('local', ?, ?, ?, ?, ?)
        `
      )
      .run(event.workflowId, event.action, event.userId, JSON.stringify(event), event.timestamp);
  }
}

export class SqliteWorkflowRunRepository {
  constructor(private readonly database: SqliteDatabase) {}

  get(runId: string): WorkflowRun | null {
    const row = this.database
      .getConnection()
      .prepare(
        `
          SELECT run_json
          FROM workflow_runs
          WHERE workspace_id = 'local'
            AND id = ?
        `
      )
      .get(runId) as WorkflowRunRow | undefined;

    return row ? (JSON.parse(row.run_json) as WorkflowRun) : null;
  }

  list(filters: { taskId?: string; workflowId?: string; status?: string } = {}): WorkflowRun[] {
    const rows = this.queryRunRows(filters);
    return rows.map((row) => JSON.parse(row.run_json) as WorkflowRun);
  }

  listMetadata(
    filters: { taskId?: string; workflowId?: string; status?: string } = {}
  ): WorkflowRunMetadata[] {
    const clauses = ["workspace_id = 'local'"];
    const params: SQLInputValue[] = [];

    if (filters.taskId) {
      clauses.push('task_id = ?');
      params.push(filters.taskId);
    }
    if (filters.workflowId) {
      clauses.push('workflow_id = ?');
      params.push(filters.workflowId);
    }
    if (filters.status) {
      clauses.push('status = ?');
      params.push(filters.status);
    }

    const rows = this.database
      .getConnection()
      .prepare(
        `
          SELECT
            id,
            workflow_id,
            workflow_version,
            task_id,
            status,
            started_at,
            completed_at,
            error
          FROM workflow_runs
          WHERE ${clauses.join(' AND ')}
          ORDER BY datetime(started_at) DESC, id DESC
        `
      )
      .all(...params) as unknown as WorkflowRunMetadataRow[];

    return rows.map((row) => ({
      id: row.id,
      workflowId: row.workflow_id,
      workflowVersion: row.workflow_version,
      taskId: row.task_id ?? undefined,
      status: row.status,
      startedAt: row.started_at,
      completedAt: row.completed_at ?? undefined,
      error: row.error ?? undefined,
    }));
  }

  save(run: WorkflowRun): void {
    this.database
      .getConnection()
      .prepare(
        `
          INSERT INTO workflow_runs (
            id,
            workspace_id,
            workflow_id,
            workflow_version,
            task_id,
            status,
            current_step,
            run_json,
            started_at,
            completed_at,
            last_checkpoint,
            error
          )
          VALUES (?, 'local', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            workflow_id = excluded.workflow_id,
            workflow_version = excluded.workflow_version,
            task_id = excluded.task_id,
            status = excluded.status,
            current_step = excluded.current_step,
            run_json = excluded.run_json,
            started_at = excluded.started_at,
            completed_at = excluded.completed_at,
            last_checkpoint = excluded.last_checkpoint,
            error = excluded.error
        `
      )
      .run(
        run.id,
        run.workflowId,
        run.workflowVersion,
        run.taskId ?? null,
        run.status,
        run.currentStep ?? null,
        JSON.stringify(run),
        run.startedAt,
        run.completedAt ?? null,
        run.lastCheckpoint ?? null,
        run.error ?? null
      );
  }

  saveWorkflowSnapshot(runId: string, workflow: WorkflowDefinition): void {
    this.database
      .getConnection()
      .prepare(
        `
          UPDATE workflow_runs
          SET workflow_snapshot_json = ?
          WHERE workspace_id = 'local'
            AND id = ?
        `
      )
      .run(JSON.stringify(workflow), runId);
  }

  private queryRunRows(filters: {
    taskId?: string;
    workflowId?: string;
    status?: string;
  }): WorkflowRunRow[] {
    const clauses = ["workspace_id = 'local'"];
    const params: SQLInputValue[] = [];

    if (filters.taskId) {
      clauses.push('task_id = ?');
      params.push(filters.taskId);
    }
    if (filters.workflowId) {
      clauses.push('workflow_id = ?');
      params.push(filters.workflowId);
    }
    if (filters.status) {
      clauses.push('status = ?');
      params.push(filters.status);
    }

    return this.database
      .getConnection()
      .prepare(
        `
          SELECT run_json
          FROM workflow_runs
          WHERE ${clauses.join(' AND ')}
          ORDER BY datetime(started_at) DESC, id DESC
        `
      )
      .all(...params) as unknown as WorkflowRunRow[];
  }
}
