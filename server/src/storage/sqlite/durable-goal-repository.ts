import type {
  DurableGoalCompareAndSetInput,
  DurableGoalCompareAndSetResult,
  DurableGoalListQuery,
  DurableGoalRecord,
} from '@veritas-kanban/shared';
import { DurableGoalRecordSchema } from '../../schemas/durable-goal-schemas.js';
import type { DurableGoalRepository } from '../interfaces.js';
import type { SqliteDatabase } from './database.js';

interface GoalRow {
  goal_json: string;
}

export class SqliteDurableGoalRepository implements DurableGoalRepository {
  constructor(private readonly database: SqliteDatabase) {}

  async create(record: DurableGoalRecord): Promise<DurableGoalRecord> {
    const parsed = DurableGoalRecordSchema.parse(record);
    if (parsed.revision !== 1) throw new Error('New durable goals must start at revision 1.');
    this.database
      .getConnection()
      .prepare(
        `INSERT INTO durable_goals (
           id, workspace_id, root_task_id, root_workflow_id, state, revision,
           goal_json, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        parsed.id,
        parsed.workspaceId,
        rootTaskId(parsed),
        parsed.root.kind === 'workflow' ? parsed.root.workflowId : null,
        parsed.state,
        parsed.revision,
        JSON.stringify(parsed),
        parsed.createdAt,
        parsed.updatedAt
      );
    return parsed;
  }

  async get(id: string): Promise<DurableGoalRecord | null> {
    const row = this.database
      .getConnection()
      .prepare('SELECT goal_json FROM durable_goals WHERE id = ?')
      .get(id) as GoalRow | undefined;
    return row ? DurableGoalRecordSchema.parse(JSON.parse(row.goal_json)) : null;
  }

  async list(query: DurableGoalListQuery): Promise<DurableGoalRecord[]> {
    const clauses = ['workspace_id = ?'];
    const parameters: Array<string | number> = [query.workspaceId];
    if (query.states?.length) {
      clauses.push(`state IN (${query.states.map(() => '?').join(', ')})`);
      parameters.push(...query.states);
    }
    if (query.rootTaskId) {
      clauses.push('root_task_id = ?');
      parameters.push(query.rootTaskId);
    }
    if (query.rootWorkflowId) {
      clauses.push('root_workflow_id = ?');
      parameters.push(query.rootWorkflowId);
    }
    const limit = Math.min(Math.max(query.limit ?? 100, 1), 1_000);
    parameters.push(limit);
    const rows = this.database
      .getConnection()
      .prepare(
        `SELECT goal_json
         FROM durable_goals
         WHERE ${clauses.join(' AND ')}
         ORDER BY updated_at DESC
         LIMIT ?`
      )
      .all(...parameters) as unknown as GoalRow[];
    return rows.map((row) => DurableGoalRecordSchema.parse(JSON.parse(row.goal_json)));
  }

  async compareAndSet(
    input: DurableGoalCompareAndSetInput
  ): Promise<DurableGoalCompareAndSetResult> {
    const connection = this.database.getConnection();
    connection.exec('BEGIN IMMEDIATE');
    try {
      const row = connection
        .prepare('SELECT goal_json FROM durable_goals WHERE id = ?')
        .get(input.id) as GoalRow | undefined;
      if (!row) {
        connection.exec('COMMIT');
        return { updated: false, reason: 'not-found' };
      }
      const current = DurableGoalRecordSchema.parse(JSON.parse(row.goal_json));
      if (current.revision !== input.expectedRevision) {
        connection.exec('COMMIT');
        return { record: current, updated: false, reason: 'stale-revision' };
      }
      if (input.next.revision !== input.expectedRevision + 1 || input.next.id !== input.id) {
        connection.exec('COMMIT');
        return { record: current, updated: false, reason: 'invalid-revision' };
      }
      const next = DurableGoalRecordSchema.parse(input.next);
      const result = connection
        .prepare(
          `UPDATE durable_goals
           SET root_task_id = ?, root_workflow_id = ?, state = ?, revision = ?,
               goal_json = ?, updated_at = ?
           WHERE id = ? AND revision = ?`
        )
        .run(
          rootTaskId(next),
          next.root.kind === 'workflow' ? next.root.workflowId : null,
          next.state,
          next.revision,
          JSON.stringify(next),
          next.updatedAt,
          next.id,
          input.expectedRevision
        );
      if (result.changes !== 1) {
        throw new Error('Durable goal compare-and-set changed unexpectedly.');
      }
      connection.exec('COMMIT');
      return { record: next, updated: true };
    } catch (error) {
      connection.exec('ROLLBACK');
      throw error;
    }
  }
}

function rootTaskId(record: DurableGoalRecord): string | null {
  return record.root.kind === 'task' ? record.root.taskId : (record.root.taskId ?? null);
}
