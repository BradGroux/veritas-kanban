import type {
  RunApprovalListQuery,
  RunApprovalRequest,
  RunApprovalTransitionInput,
  RunApprovalTransitionResult,
} from '@veritas-kanban/shared';
import type { RunApprovalRepository } from '../interfaces.js';
import { RunApprovalRequestSchema } from '../../schemas/run-approval-schemas.js';
import type { SqliteDatabase } from './database.js';

interface ApprovalRow {
  approval_json: string;
}

export class SqliteRunApprovalRepository implements RunApprovalRepository {
  constructor(private readonly database: SqliteDatabase) {}

  async create(request: RunApprovalRequest): Promise<RunApprovalRequest> {
    const parsed = RunApprovalRequestSchema.parse(request);
    if (parsed.status !== 'pending' || parsed.revision !== 1) {
      throw new Error('New run approvals must start pending at revision 1.');
    }
    this.database
      .getConnection()
      .prepare(
        `INSERT INTO run_approvals (
           id,
           workspace_id,
           task_id,
           attempt_id,
           provider,
           agent_id,
           provider_request_id,
           status,
           revision,
           action_hash,
           expires_at,
           approval_json,
           created_at,
           updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        parsed.id,
        parsed.workspaceId,
        parsed.taskId,
        parsed.attemptId,
        parsed.provider,
        parsed.agentId,
        parsed.providerRequestId,
        parsed.status,
        parsed.revision,
        parsed.actionHash,
        parsed.expiresAt,
        JSON.stringify(parsed),
        parsed.createdAt,
        parsed.updatedAt
      );
    return parsed;
  }

  async get(id: string): Promise<RunApprovalRequest | null> {
    const row = this.database
      .getConnection()
      .prepare('SELECT approval_json FROM run_approvals WHERE id = ?')
      .get(id) as ApprovalRow | undefined;
    return row ? RunApprovalRequestSchema.parse(JSON.parse(row.approval_json)) : null;
  }

  async list(query: RunApprovalListQuery): Promise<RunApprovalRequest[]> {
    const clauses = ['workspace_id = ?'];
    const parameters: Array<string> = [query.workspaceId];
    if (query.status) {
      clauses.push('status = ?');
      parameters.push(query.status);
    }
    if (query.taskId) {
      clauses.push('task_id = ?');
      parameters.push(query.taskId);
    }
    if (query.attemptId) {
      clauses.push('attempt_id = ?');
      parameters.push(query.attemptId);
    }
    if (query.agentId) {
      clauses.push('agent_id = ?');
      parameters.push(query.agentId);
    }
    const rows = this.database
      .getConnection()
      .prepare(
        `SELECT approval_json
         FROM run_approvals
         WHERE ${clauses.join(' AND ')}
         ORDER BY created_at DESC`
      )
      .all(...parameters) as unknown as ApprovalRow[];
    return rows.map((row) => RunApprovalRequestSchema.parse(JSON.parse(row.approval_json)));
  }

  async transition(input: RunApprovalTransitionInput): Promise<RunApprovalTransitionResult> {
    const connection = this.database.getConnection();
    connection.exec('BEGIN IMMEDIATE');
    try {
      const row = connection
        .prepare('SELECT approval_json FROM run_approvals WHERE id = ?')
        .get(input.id) as ApprovalRow | undefined;
      if (!row) {
        connection.exec('COMMIT');
        return { transitioned: false, reason: 'not-found' };
      }
      const current = RunApprovalRequestSchema.parse(JSON.parse(row.approval_json));
      if (current.status !== 'pending') {
        connection.exec('COMMIT');
        return { request: current, transitioned: false, reason: 'already-resolved' };
      }
      if (current.revision !== input.expectedRevision) {
        connection.exec('COMMIT');
        return { request: current, transitioned: false, reason: 'stale-revision' };
      }
      if (current.actionHash !== input.expectedActionHash) {
        connection.exec('COMMIT');
        return { request: current, transitioned: false, reason: 'action-changed' };
      }

      const next = RunApprovalRequestSchema.parse({
        ...current,
        status: input.status,
        revision: current.revision + 1,
        updatedAt: input.resolution.decidedAt,
        resolution: input.resolution,
      });
      const result = connection
        .prepare(
          `UPDATE run_approvals
           SET status = ?, revision = ?, approval_json = ?, updated_at = ?
           WHERE id = ?
             AND status = 'pending'
             AND revision = ?
             AND action_hash = ?`
        )
        .run(
          next.status,
          next.revision,
          JSON.stringify(next),
          next.updatedAt,
          next.id,
          input.expectedRevision,
          input.expectedActionHash
        );
      if (result.changes !== 1) {
        throw new Error('Run approval compare-and-set changed unexpectedly.');
      }
      connection.exec('COMMIT');
      return { request: next, transitioned: true };
    } catch (error) {
      connection.exec('ROLLBACK');
      throw error;
    }
  }
}
