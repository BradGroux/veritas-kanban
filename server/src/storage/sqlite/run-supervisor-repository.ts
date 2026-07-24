import type {
  RunSupervisorCompareAndSetInput,
  RunSupervisorCompareAndSetResult,
  RunSupervisorListQuery,
  RunSupervisorRecord,
} from '@veritas-kanban/shared';
import { RunSupervisorRecordSchema } from '../../schemas/run-supervisor-schemas.js';
import type { RunSupervisorRepository } from '../interfaces.js';
import type { SqliteDatabase } from './database.js';

interface SupervisorRow {
  supervisor_json: string;
}

export class SqliteRunSupervisorRepository implements RunSupervisorRepository {
  constructor(private readonly database: SqliteDatabase) {}

  async create(record: RunSupervisorRecord): Promise<RunSupervisorRecord> {
    const parsed = RunSupervisorRecordSchema.parse(record);
    if (parsed.revision !== 1)
      throw new Error('New run supervisor records must start at revision 1.');
    this.database
      .getConnection()
      .prepare(
        `INSERT INTO run_supervisors (
           id, workspace_id, task_id, attempt_id, provider, state, revision,
           lease_owner_id, lease_expires_at, supervisor_json, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        parsed.id,
        parsed.workspaceId,
        parsed.taskId,
        parsed.attemptId,
        parsed.bindings.provider,
        parsed.state,
        parsed.revision,
        parsed.lease.ownerId,
        parsed.lease.expiresAt,
        JSON.stringify(parsed),
        parsed.createdAt,
        parsed.updatedAt
      );
    return parsed;
  }

  async get(id: string): Promise<RunSupervisorRecord | null> {
    const row = this.database
      .getConnection()
      .prepare('SELECT supervisor_json FROM run_supervisors WHERE id = ?')
      .get(id) as SupervisorRow | undefined;
    return row ? RunSupervisorRecordSchema.parse(JSON.parse(row.supervisor_json)) : null;
  }

  async list(query: RunSupervisorListQuery): Promise<RunSupervisorRecord[]> {
    const clauses = ['workspace_id = ?'];
    const parameters: Array<string | number> = [query.workspaceId];
    if (query.taskId) {
      clauses.push('task_id = ?');
      parameters.push(query.taskId);
    }
    if (query.attemptId) {
      clauses.push('attempt_id = ?');
      parameters.push(query.attemptId);
    }
    if (query.states?.length) {
      clauses.push(`state IN (${query.states.map(() => '?').join(', ')})`);
      parameters.push(...query.states);
    }
    const rows = this.database
      .getConnection()
      .prepare(
        `SELECT supervisor_json
         FROM run_supervisors
         WHERE ${clauses.join(' AND ')}
         ORDER BY updated_at DESC`
      )
      .all(...parameters) as unknown as SupervisorRow[];
    return rows.map((row) => RunSupervisorRecordSchema.parse(JSON.parse(row.supervisor_json)));
  }

  async compareAndSet(
    input: RunSupervisorCompareAndSetInput
  ): Promise<RunSupervisorCompareAndSetResult> {
    const connection = this.database.getConnection();
    connection.exec('BEGIN IMMEDIATE');
    try {
      const row = connection
        .prepare('SELECT supervisor_json FROM run_supervisors WHERE id = ?')
        .get(input.id) as SupervisorRow | undefined;
      if (!row) {
        connection.exec('COMMIT');
        return { updated: false, reason: 'not-found' };
      }
      const current = RunSupervisorRecordSchema.parse(JSON.parse(row.supervisor_json));
      if (current.revision !== input.expectedRevision) {
        connection.exec('COMMIT');
        return { record: current, updated: false, reason: 'stale-revision' };
      }
      if (input.next.revision !== input.expectedRevision + 1 || input.next.id !== input.id) {
        connection.exec('COMMIT');
        return { record: current, updated: false, reason: 'invalid-revision' };
      }
      const next = RunSupervisorRecordSchema.parse(input.next);
      const result = connection
        .prepare(
          `UPDATE run_supervisors
           SET state = ?, revision = ?, lease_owner_id = ?, lease_expires_at = ?,
               supervisor_json = ?, updated_at = ?
           WHERE id = ? AND revision = ?`
        )
        .run(
          next.state,
          next.revision,
          next.lease.ownerId,
          next.lease.expiresAt,
          JSON.stringify(next),
          next.updatedAt,
          next.id,
          input.expectedRevision
        );
      if (result.changes !== 1) {
        throw new Error('Run supervisor compare-and-set changed unexpectedly.');
      }
      connection.exec('COMMIT');
      return { record: next, updated: true };
    } catch (error) {
      connection.exec('ROLLBACK');
      throw error;
    }
  }
}
