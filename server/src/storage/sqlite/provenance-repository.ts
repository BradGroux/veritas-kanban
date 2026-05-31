import type { SQLInputValue } from 'node:sqlite';
import type { SqliteDatabase } from './database.js';

export type SqliteOperationalProvenanceKind =
  | 'work-product'
  | 'task-deliverable'
  | 'task-attachment'
  | 'workflow-run'
  | 'scheduled-deliverable-run'
  | 'notification'
  | 'chat-message';

export interface SqliteOperationalProvenanceRecord {
  kind: SqliteOperationalProvenanceKind;
  id: string;
  workspaceId: string;
  title: string;
  status?: string;
  subtype?: string;
  taskId?: string;
  sourceRunId?: string;
  workflowId?: string;
  agent?: string;
  model?: string;
  path?: string;
  targetUrl?: string;
  contentType?: string;
  redactionLevel?: string;
  cleanupEligible?: boolean;
  createdAt: string;
  updatedAt?: string;
}

interface ProvenanceRow {
  kind: SqliteOperationalProvenanceKind;
  id: string;
  workspace_id: string;
  title: string | null;
  status: string | null;
  subtype: string | null;
  task_id: string | null;
  source_run_id: string | null;
  workflow_id: string | null;
  agent: string | null;
  model: string | null;
  path: string | null;
  target_url: string | null;
  content_type: string | null;
  redaction_json: string | null;
  cleanup_eligible: number | null;
  created_at: string;
  updated_at: string | null;
  sort_at: string;
}

export class SqliteOperationalProvenanceRepository {
  constructor(private readonly database: SqliteDatabase) {}

  listForTask(
    taskId: string,
    options: { limit?: number } = {}
  ): SqliteOperationalProvenanceRecord[] {
    return this.query(this.baseQuery('task'), [taskId, taskId, taskId, taskId, taskId, taskId], {
      limit: options.limit,
    });
  }

  listForRun(
    sourceRunId: string,
    options: { limit?: number } = {}
  ): SqliteOperationalProvenanceRecord[] {
    return this.query(this.baseQuery('run'), [sourceRunId, sourceRunId, sourceRunId, sourceRunId], {
      limit: options.limit,
    });
  }

  listRecent(options: { limit?: number } = {}): SqliteOperationalProvenanceRecord[] {
    return this.query(this.baseQuery('recent'), [], options);
  }

  private query(
    sql: string,
    params: SQLInputValue[],
    options: { limit?: number }
  ): SqliteOperationalProvenanceRecord[] {
    const limit = Math.min(Math.max(options.limit ?? 100, 1), 500);
    const rows = this.database
      .getConnection()
      .prepare(sql)
      .all(...params, limit) as unknown as ProvenanceRow[];

    return rows.map((row) => this.mapRow(row));
  }

  private baseQuery(mode: 'task' | 'run' | 'recent'): string {
    const taskFilter = mode === 'task';
    const runFilter = mode === 'run';

    return `
      SELECT *
      FROM (
        SELECT
          'work-product' AS kind,
          id,
          workspace_id,
          title,
          status,
          kind AS subtype,
          task_id,
          source_run_id,
          NULL AS workflow_id,
          agent,
          model,
          NULL AS path,
          NULL AS target_url,
          NULL AS content_type,
          redaction_json,
          NULL AS cleanup_eligible,
          created_at,
          updated_at,
          updated_at AS sort_at
        FROM work_products
        WHERE deleted_at IS NULL
          ${taskFilter ? 'AND task_id = ?' : ''}
          ${runFilter ? 'AND source_run_id = ?' : ''}

        UNION ALL

        SELECT
          'task-deliverable' AS kind,
          id,
          workspace_id,
          title,
          status,
          type AS subtype,
          task_id,
          source_run_id,
          NULL AS workflow_id,
          agent,
          model,
          path,
          NULL AS target_url,
          NULL AS content_type,
          redaction_json,
          NULL AS cleanup_eligible,
          created_at,
          updated_at,
          COALESCE(updated_at, created_at) AS sort_at
        FROM task_deliverables
        WHERE deleted_at IS NULL
          ${taskFilter ? 'AND task_id = ?' : ''}
          ${runFilter ? 'AND source_run_id = ?' : ''}

        UNION ALL

        SELECT
          'task-attachment' AS kind,
          id,
          workspace_id,
          original_name AS title,
          validation_status AS status,
          mime_type AS subtype,
          task_id,
          NULL AS source_run_id,
          NULL AS workflow_id,
          uploaded_by AS agent,
          NULL AS model,
          storage_path AS path,
          NULL AS target_url,
          mime_type AS content_type,
          NULL AS redaction_json,
          cleanup_eligible,
          uploaded_at AS created_at,
          NULL AS updated_at,
          uploaded_at AS sort_at
        FROM task_attachments
        WHERE deleted_at IS NULL
          ${taskFilter ? 'AND task_id = ?' : runFilter ? 'AND 0' : ''}

        UNION ALL

        SELECT
          'workflow-run' AS kind,
          id,
          workspace_id,
          workflow_id AS title,
          status,
          current_step AS subtype,
          task_id,
          id AS source_run_id,
          workflow_id,
          NULL AS agent,
          NULL AS model,
          NULL AS path,
          NULL AS target_url,
          NULL AS content_type,
          NULL AS redaction_json,
          NULL AS cleanup_eligible,
          started_at AS created_at,
          completed_at AS updated_at,
          COALESCE(completed_at, last_checkpoint, started_at) AS sort_at
        FROM workflow_runs
        WHERE 1 = 1
          ${taskFilter ? 'AND task_id = ?' : ''}
          ${runFilter ? 'AND id = ?' : ''}

        UNION ALL

        SELECT
          'scheduled-deliverable-run' AS kind,
          id,
          workspace_id,
          COALESCE(summary, deliverable_id) AS title,
          status,
          deliverable_id AS subtype,
          NULL AS task_id,
          source_run_id,
          workflow_id,
          NULL AS agent,
          NULL AS model,
          output_file AS path,
          NULL AS target_url,
          NULL AS content_type,
          NULL AS redaction_json,
          NULL AS cleanup_eligible,
          run_at AS created_at,
          NULL AS updated_at,
          run_at AS sort_at
        FROM scheduled_deliverable_runs
        WHERE 1 = 1
          ${taskFilter ? 'AND 0' : ''}
          ${runFilter ? 'AND source_run_id = ?' : ''}

        UNION ALL

        SELECT
          'notification' AS kind,
          id,
          workspace_id,
          COALESCE(title, task_title, content) AS title,
          CASE WHEN delivered = 1 THEN 'delivered' ELSE 'unread' END AS status,
          type AS subtype,
          task_id,
          NULL AS source_run_id,
          NULL AS workflow_id,
          from_agent AS agent,
          NULL AS model,
          NULL AS path,
          target_url,
          NULL AS content_type,
          NULL AS redaction_json,
          NULL AS cleanup_eligible,
          created_at,
          delivered_at AS updated_at,
          COALESCE(delivered_at, created_at) AS sort_at
        FROM notifications
        WHERE 1 = 1
          ${taskFilter ? 'AND task_id = ?' : runFilter ? 'AND 0' : ''}

        UNION ALL

        SELECT
          'chat-message' AS kind,
          id,
          workspace_id,
          COALESCE(agent, role) || ' message' AS title,
          role AS status,
          session_id AS subtype,
          task_id,
          NULL AS source_run_id,
          NULL AS workflow_id,
          agent,
          model,
          NULL AS path,
          NULL AS target_url,
          NULL AS content_type,
          NULL AS redaction_json,
          NULL AS cleanup_eligible,
          created_at,
          NULL AS updated_at,
          created_at AS sort_at
        FROM chat_messages
        WHERE 1 = 1
          ${taskFilter ? 'AND task_id = ?' : runFilter ? 'AND 0' : ''}
      )
      ORDER BY datetime(sort_at) DESC, kind ASC, id ASC
      LIMIT ?
    `;
  }

  private mapRow(row: ProvenanceRow): SqliteOperationalProvenanceRecord {
    return {
      kind: row.kind,
      id: row.id,
      workspaceId: row.workspace_id,
      title: row.title ?? row.id,
      status: row.status ?? undefined,
      subtype: row.subtype ?? undefined,
      taskId: row.task_id ?? undefined,
      sourceRunId: row.source_run_id ?? undefined,
      workflowId: row.workflow_id ?? undefined,
      agent: row.agent ?? undefined,
      model: row.model ?? undefined,
      path: row.path ?? undefined,
      targetUrl: row.target_url ?? undefined,
      contentType: row.content_type ?? undefined,
      redactionLevel: this.redactionLevel(row.redaction_json),
      cleanupEligible: row.cleanup_eligible === null ? undefined : row.cleanup_eligible === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at ?? undefined,
    };
  }

  private redactionLevel(redactionJson: string | null): string | undefined {
    if (!redactionJson) return undefined;

    try {
      const parsed = JSON.parse(redactionJson) as { level?: unknown };
      return typeof parsed.level === 'string' ? parsed.level : undefined;
    } catch {
      return undefined;
    }
  }
}
