import type {
  AdmissionReservation,
  AdmissionReservationClaimInput,
  AdmissionReservationClaimResult,
  AdmissionReservationCompareAndSetInput,
  AdmissionReservationCompareAndSetResult,
  AdmissionReservationListQuery,
} from '@veritas-kanban/shared';
import { AdmissionReservationSchema } from '../../schemas/admission-control-schemas.js';
import { findLimitingAdmissionPolicies } from '../admission-capacity.js';
import type { AdmissionReservationRepository } from '../interfaces.js';
import type { SqliteDatabase } from './database.js';

interface ReservationRow {
  reservation_json: string;
}

export class SqliteAdmissionReservationRepository implements AdmissionReservationRepository {
  constructor(private readonly database: SqliteDatabase) {}

  async claim(input: AdmissionReservationClaimInput): Promise<AdmissionReservationClaimResult> {
    const requested = AdmissionReservationSchema.parse(input.record);
    if (requested.revision !== 1) {
      throw new Error('New admission reservations must start at revision 1.');
    }
    const connection = this.database.getConnection();
    connection.exec('BEGIN IMMEDIATE');
    try {
      this.expireInTransaction(input.now);
      const existingRow = connection
        .prepare('SELECT reservation_json FROM admission_reservations WHERE id = ?')
        .get(requested.id) as ReservationRow | undefined;
      if (existingRow) {
        const existing = AdmissionReservationSchema.parse(JSON.parse(existingRow.reservation_json));
        if (existing.request.idempotencyKey !== requested.request.idempotencyKey) {
          throw new Error(`Admission reservation ${requested.id} has conflicting identity.`);
        }
        if (existing.state !== 'expired' || !input.reclaimExpired) {
          connection.exec('COMMIT');
          return { record: existing, created: false, limitingPolicies: [] };
        }
        const reclaimed = AdmissionReservationSchema.parse({
          ...requested,
          revision: existing.revision + 1,
          createdAt: existing.createdAt,
        });
        const limitingPolicies = findLimitingAdmissionPolicies(
          this.activeReservations().filter((record) => record.id !== existing.id),
          reclaimed
        );
        if (limitingPolicies.length > 0) {
          connection.exec('COMMIT');
          return { created: false, limitingPolicies };
        }
        this.updateRow(reclaimed, existing.revision);
        connection.exec('COMMIT');
        return {
          record: reclaimed,
          created: false,
          reclaimed: true,
          limitingPolicies: [],
        };
      }
      const limitingPolicies = findLimitingAdmissionPolicies(this.activeReservations(), requested);
      if (limitingPolicies.length > 0) {
        connection.exec('COMMIT');
        return { created: false, limitingPolicies };
      }
      connection
        .prepare(
          `INSERT INTO admission_reservations (
             id, workspace_id, task_id, root_task_id, provider, host_id, state, revision,
             idempotency_key, lease_expires_at, workflow_run_id, workflow_step_id,
             root_reservation_id, reservation_json, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          requested.id,
          requested.request.workspaceId,
          requested.request.taskId,
          requested.request.rootTaskId,
          requested.request.provider,
          requested.request.hostId,
          requested.state,
          requested.revision,
          requested.request.idempotencyKey,
          requested.lease.expiresAt,
          requested.request.workflowRunId ?? null,
          requested.request.workflowStepId ?? null,
          requested.request.rootReservationId ?? null,
          JSON.stringify(requested),
          requested.createdAt,
          requested.updatedAt
        );
      connection.exec('COMMIT');
      return { record: requested, created: true, limitingPolicies: [] };
    } catch (error) {
      connection.exec('ROLLBACK');
      throw error;
    }
  }

  async get(id: string): Promise<AdmissionReservation | null> {
    const row = this.database
      .getConnection()
      .prepare('SELECT reservation_json FROM admission_reservations WHERE id = ?')
      .get(id) as ReservationRow | undefined;
    return row ? AdmissionReservationSchema.parse(JSON.parse(row.reservation_json)) : null;
  }

  async list(query: AdmissionReservationListQuery): Promise<AdmissionReservation[]> {
    const clauses: string[] = [];
    const parameters: Array<string | number> = [];
    const add = (clause: string, value: string) => {
      clauses.push(clause);
      parameters.push(value);
    };
    if (query.workspaceId) add('workspace_id = ?', query.workspaceId);
    if (query.taskId) add('task_id = ?', query.taskId);
    if (query.rootTaskId) add('root_task_id = ?', query.rootTaskId);
    if (query.provider) add('provider = ?', query.provider);
    if (query.hostId) add('host_id = ?', query.hostId);
    if (query.workflowRunId) add('workflow_run_id = ?', query.workflowRunId);
    if (query.workflowStepId) add('workflow_step_id = ?', query.workflowStepId);
    if (query.rootReservationId) add('root_reservation_id = ?', query.rootReservationId);
    if (query.states?.length) {
      clauses.push(`state IN (${query.states.map(() => '?').join(', ')})`);
      parameters.push(...query.states);
    }
    parameters.push(query.limit ?? 100);
    const rows = this.database
      .getConnection()
      .prepare(
        `SELECT reservation_json
         FROM admission_reservations
         ${clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''}
         ORDER BY updated_at DESC
         LIMIT ?`
      )
      .all(...parameters) as unknown as ReservationRow[];
    return rows.map((row) => AdmissionReservationSchema.parse(JSON.parse(row.reservation_json)));
  }

  async compareAndSet(
    input: AdmissionReservationCompareAndSetInput
  ): Promise<AdmissionReservationCompareAndSetResult> {
    const connection = this.database.getConnection();
    connection.exec('BEGIN IMMEDIATE');
    try {
      const row = connection
        .prepare('SELECT reservation_json FROM admission_reservations WHERE id = ?')
        .get(input.id) as ReservationRow | undefined;
      if (!row) {
        connection.exec('COMMIT');
        return { updated: false, reason: 'not-found' };
      }
      const current = AdmissionReservationSchema.parse(JSON.parse(row.reservation_json));
      if (current.revision !== input.expectedRevision) {
        connection.exec('COMMIT');
        return { record: current, updated: false, reason: 'stale-revision' };
      }
      if (input.next.revision !== input.expectedRevision + 1 || input.next.id !== input.id) {
        connection.exec('COMMIT');
        return { record: current, updated: false, reason: 'invalid-revision' };
      }
      const next = AdmissionReservationSchema.parse(input.next);
      this.updateRow(next, input.expectedRevision);
      connection.exec('COMMIT');
      return { record: next, updated: true };
    } catch (error) {
      connection.exec('ROLLBACK');
      throw error;
    }
  }

  async expireLeases(now: string): Promise<AdmissionReservation[]> {
    const connection = this.database.getConnection();
    connection.exec('BEGIN IMMEDIATE');
    try {
      const expired = this.expireInTransaction(now);
      connection.exec('COMMIT');
      return expired;
    } catch (error) {
      connection.exec('ROLLBACK');
      throw error;
    }
  }

  private activeReservations(): AdmissionReservation[] {
    const rows = this.database
      .getConnection()
      .prepare(`SELECT reservation_json FROM admission_reservations WHERE state = 'active'`)
      .all() as unknown as ReservationRow[];
    return rows.map((row) => AdmissionReservationSchema.parse(JSON.parse(row.reservation_json)));
  }

  private expireInTransaction(now: string): AdmissionReservation[] {
    const rows = this.database
      .getConnection()
      .prepare(
        `SELECT reservation_json FROM admission_reservations
         WHERE state = 'active' AND lease_expires_at <= ?`
      )
      .all(now) as unknown as ReservationRow[];
    return rows.map((row) => {
      const current = AdmissionReservationSchema.parse(JSON.parse(row.reservation_json));
      const expired = AdmissionReservationSchema.parse({
        ...current,
        revision: current.revision + 1,
        state: 'expired',
        updatedAt: now,
      });
      this.updateRow(expired, current.revision);
      return expired;
    });
  }

  private updateRow(record: AdmissionReservation, expectedRevision: number): void {
    const result = this.database
      .getConnection()
      .prepare(
        `UPDATE admission_reservations
         SET workspace_id = ?, task_id = ?, root_task_id = ?, provider = ?, host_id = ?,
             state = ?, revision = ?, idempotency_key = ?, lease_expires_at = ?,
             workflow_run_id = ?, workflow_step_id = ?, root_reservation_id = ?,
             reservation_json = ?, updated_at = ?
         WHERE id = ? AND revision = ?`
      )
      .run(
        record.request.workspaceId,
        record.request.taskId,
        record.request.rootTaskId,
        record.request.provider,
        record.request.hostId,
        record.state,
        record.revision,
        record.request.idempotencyKey,
        record.lease.expiresAt,
        record.request.workflowRunId ?? null,
        record.request.workflowStepId ?? null,
        record.request.rootReservationId ?? null,
        JSON.stringify(record),
        record.updatedAt,
        record.id,
        expectedRevision
      );
    if (result.changes !== 1) {
      throw new Error('Admission reservation compare-and-set changed unexpectedly.');
    }
  }
}
