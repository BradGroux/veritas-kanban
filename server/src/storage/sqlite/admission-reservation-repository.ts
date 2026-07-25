import type {
  AdmissionQueueCompareAndSetInput,
  AdmissionQueueCompareAndSetResult,
  AdmissionQueueEntry,
  AdmissionQueueListQuery,
  AdmissionQueuedClaimInput,
  AdmissionQueuedClaimResult,
  AdmissionReservation,
  AdmissionReservationClaimInput,
  AdmissionReservationClaimOrQueueInput,
  AdmissionReservationClaimOrQueueResult,
  AdmissionReservationClaimResult,
  AdmissionReservationCompareAndSetInput,
  AdmissionReservationCompareAndSetResult,
  AdmissionReservationListQuery,
} from '@veritas-kanban/shared';
import { ADMISSION_QUEUE_ENTRY_SCHEMA_VERSION } from '@veritas-kanban/shared';
import {
  AdmissionQueueEntrySchema,
  AdmissionReservationSchema,
} from '../../schemas/admission-control-schemas.js';
import { findLimitingAdmissionPolicies } from '../admission-capacity.js';
import { sameAdmissionQueueTarget } from '../admission-queue-identity.js';
import {
  findLimitingExecutionTreeBudgetPolicies,
  reactivateExecutionTreeBudget,
  releaseExecutionTreeBudget,
} from '../execution-tree-budget.js';
import type { AdmissionReservationRepository } from '../interfaces.js';
import type { SqliteDatabase } from './database.js';

interface ReservationRow {
  reservation_json: string;
}

interface QueueRow {
  queue_json: string;
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
      const result = this.claimInTransaction(requested, input);
      connection.exec('COMMIT');
      return result;
    } catch (error) {
      connection.exec('ROLLBACK');
      throw error;
    }
  }

  async claimOrEnqueue(
    input: AdmissionReservationClaimOrQueueInput
  ): Promise<AdmissionReservationClaimOrQueueResult> {
    const requested = AdmissionReservationSchema.parse(input.record);
    const connection = this.database.getConnection();
    connection.exec('BEGIN IMMEDIATE');
    try {
      this.expireInTransaction(input.now);
      this.expireQueueInTransaction(input.now);
      const claimed = this.claimInTransaction(requested, input);
      if (
        claimed.record ||
        (claimed.limitingBudgetPolicies?.length && claimed.budgetRetryable === false)
      ) {
        connection.exec('COMMIT');
        return claimed;
      }

      const existingRow = connection
        .prepare(
          `SELECT queue_json FROM admission_queue
           WHERE task_id = ? AND state IN ('queued', 'leased', 'requeued')
           LIMIT 1`
        )
        .get(input.queue.request.taskId) as QueueRow | undefined;
      if (existingRow) {
        const existing = AdmissionQueueEntrySchema.parse(JSON.parse(existingRow.queue_json));
        connection.exec('COMMIT');
        if (!sameAdmissionQueueTarget(existing, input.queue)) {
          return { ...claimed, queueConflict: true };
        }
        return {
          ...claimed,
          queueEntry: existing,
        };
      }
      const globalCount = (
        connection
          .prepare(
            `SELECT COUNT(*) AS count FROM admission_queue
             WHERE state IN ('queued', 'leased', 'requeued')`
          )
          .get() as { count: number }
      ).count;
      if (globalCount >= input.globalQueueLimit) {
        connection.exec('COMMIT');
        return { ...claimed, queueOverflow: 'global' };
      }
      const workspaceCount = (
        connection
          .prepare(
            `SELECT COUNT(*) AS count FROM admission_queue
             WHERE workspace_id = ? AND state IN ('queued', 'leased', 'requeued')`
          )
          .get(input.queue.request.workspaceId) as { count: number }
      ).count;
      if (workspaceCount >= input.workspaceQueueLimit) {
        connection.exec('COMMIT');
        return { ...claimed, queueOverflow: 'workspace' };
      }
      const enqueueSequence =
        (
          connection
            .prepare('SELECT MAX(enqueue_sequence) AS sequence FROM admission_queue')
            .get() as { sequence: number | null }
        ).sequence ?? 0;
      const entry = AdmissionQueueEntrySchema.parse({
        schemaVersion: ADMISSION_QUEUE_ENTRY_SCHEMA_VERSION,
        ...input.queue,
        limitingPolicies: claimed.limitingPolicies,
        limitingBudgetPolicies: claimed.limitingBudgetPolicies,
        revision: 1,
        state: 'queued',
        enqueueSequence: enqueueSequence + 1,
        retryCount: 0,
        updatedAt: input.now,
      });
      this.insertQueueRow(entry);
      connection.exec('COMMIT');
      return { ...claimed, queueEntry: entry };
    } catch (error) {
      connection.exec('ROLLBACK');
      throw error;
    }
  }

  async claimQueued(input: AdmissionQueuedClaimInput): Promise<AdmissionQueuedClaimResult> {
    const requested = AdmissionReservationSchema.parse(input.record);
    const connection = this.database.getConnection();
    connection.exec('BEGIN IMMEDIATE');
    try {
      this.expireInTransaction(input.now);
      this.expireQueueInTransaction(input.now);
      const headRow = connection
        .prepare(
          `SELECT queue_json FROM admission_queue
           WHERE state IN ('queued', 'requeued') AND available_at <= ?
           ORDER BY enqueue_sequence ASC, id ASC
           LIMIT 1`
        )
        .get(input.now) as QueueRow | undefined;
      const head = headRow
        ? AdmissionQueueEntrySchema.parse(JSON.parse(headRow.queue_json))
        : undefined;
      if (!head || head.id !== input.queueId || head.revision !== input.expectedRevision) {
        connection.exec('COMMIT');
        return { stale: true, limitingPolicies: [] };
      }
      const claimed = this.claimInTransaction(requested, {
        record: requested,
        now: input.now,
        reclaimExpired: true,
        reclaimReleased: true,
      });
      if (!claimed.record) {
        connection.exec('COMMIT');
        return {
          stale: false,
          limitingPolicies: claimed.limitingPolicies,
          limitingBudgetPolicies: claimed.limitingBudgetPolicies,
          budgetRetryable: claimed.budgetRetryable,
        };
      }
      const entry = AdmissionQueueEntrySchema.parse({
        ...head,
        revision: head.revision + 1,
        state: 'leased',
        policies: claimed.record.policies,
        lease: claimed.record.lease,
        reservationId: claimed.record.id,
        updatedAt: input.now,
      });
      this.updateQueueRow(entry, head.revision);
      connection.exec('COMMIT');
      return {
        entry,
        reservation: claimed.record,
        stale: false,
        limitingPolicies: [],
      };
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
    if (query.rootObjectiveId) add('root_objective_id = ?', query.rootObjectiveId);
    if (query.nodeId) add('node_id = ?', query.nodeId);
    if (query.parentNodeId) add('parent_node_id = ?', query.parentNodeId);
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

  async getQueueEntry(id: string): Promise<AdmissionQueueEntry | null> {
    const row = this.database
      .getConnection()
      .prepare('SELECT queue_json FROM admission_queue WHERE id = ?')
      .get(id) as QueueRow | undefined;
    return row ? AdmissionQueueEntrySchema.parse(JSON.parse(row.queue_json)) : null;
  }

  async listQueue(query: AdmissionQueueListQuery): Promise<AdmissionQueueEntry[]> {
    const clauses: string[] = [];
    const parameters: Array<string | number> = [];
    if (query.workspaceId) {
      clauses.push('workspace_id = ?');
      parameters.push(query.workspaceId);
    }
    if (query.taskId) {
      clauses.push('task_id = ?');
      parameters.push(query.taskId);
    }
    if (query.states?.length) {
      clauses.push(`state IN (${query.states.map(() => '?').join(', ')})`);
      parameters.push(...query.states);
    }
    if (query.eligibleAt) {
      clauses.push('available_at <= ?');
      parameters.push(query.eligibleAt);
    }
    parameters.push(query.limit ?? 100);
    const rows = this.database
      .getConnection()
      .prepare(
        `SELECT queue_json FROM admission_queue
         ${clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''}
         ORDER BY enqueue_sequence ASC, id ASC
         LIMIT ?`
      )
      .all(...parameters) as unknown as QueueRow[];
    return rows.map((row) => AdmissionQueueEntrySchema.parse(JSON.parse(row.queue_json)));
  }

  async compareAndSetQueue(
    input: AdmissionQueueCompareAndSetInput
  ): Promise<AdmissionQueueCompareAndSetResult> {
    const connection = this.database.getConnection();
    connection.exec('BEGIN IMMEDIATE');
    try {
      const row = connection
        .prepare('SELECT queue_json FROM admission_queue WHERE id = ?')
        .get(input.id) as QueueRow | undefined;
      if (!row) {
        connection.exec('COMMIT');
        return { updated: false, reason: 'not-found' };
      }
      const current = AdmissionQueueEntrySchema.parse(JSON.parse(row.queue_json));
      if (current.revision !== input.expectedRevision) {
        connection.exec('COMMIT');
        return { record: current, updated: false, reason: 'stale-revision' };
      }
      if (input.next.revision !== input.expectedRevision + 1 || input.next.id !== input.id) {
        connection.exec('COMMIT');
        return { record: current, updated: false, reason: 'invalid-revision' };
      }
      const next = AdmissionQueueEntrySchema.parse(input.next);
      this.updateQueueRow(next, input.expectedRevision);
      connection.exec('COMMIT');
      return { record: next, updated: true };
    } catch (error) {
      connection.exec('ROLLBACK');
      throw error;
    }
  }

  async expireQueueLeases(now: string): Promise<AdmissionQueueEntry[]> {
    const connection = this.database.getConnection();
    connection.exec('BEGIN IMMEDIATE');
    try {
      const expired = this.expireQueueInTransaction(now);
      connection.exec('COMMIT');
      return expired;
    } catch (error) {
      connection.exec('ROLLBACK');
      throw error;
    }
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

  private claimInTransaction(
    requested: AdmissionReservation,
    input: AdmissionReservationClaimInput
  ): AdmissionReservationClaimResult {
    const connection = this.database.getConnection();
    const existingRow = connection
      .prepare('SELECT reservation_json FROM admission_reservations WHERE id = ?')
      .get(requested.id) as ReservationRow | undefined;
    if (existingRow) {
      const existing = AdmissionReservationSchema.parse(JSON.parse(existingRow.reservation_json));
      if (existing.request.idempotencyKey !== requested.request.idempotencyKey) {
        throw new Error(`Admission reservation ${requested.id} has conflicting identity.`);
      }
      const reclaimable =
        (existing.state === 'expired' && input.reclaimExpired) ||
        (existing.state === 'released' && input.reclaimReleased);
      if (!reclaimable) {
        return { record: existing, created: false, limitingPolicies: [] };
      }
      const reclaimed = AdmissionReservationSchema.parse({
        ...requested,
        revision: existing.revision + 1,
        createdAt: existing.createdAt,
        executionBudget: reactivateExecutionTreeBudget(
          existing.executionBudget,
          requested.executionBudget
        ),
      });
      const limitingPolicies = findLimitingAdmissionPolicies(
        this.activeReservations().filter((record) => record.id !== existing.id),
        reclaimed
      );
      if (limitingPolicies.length > 0) return { created: false, limitingPolicies };
      const limitingBudgets = findLimitingExecutionTreeBudgetPolicies(
        this.executionTreeReservations(requested.request.executionTree?.rootObjectiveId).filter(
          (record) => record.id !== existing.id
        ),
        reclaimed
      );
      if (limitingBudgets.terminal.length > 0 || limitingBudgets.retryable.length > 0) {
        return {
          created: false,
          limitingPolicies: [],
          limitingBudgetPolicies:
            limitingBudgets.terminal.length > 0
              ? limitingBudgets.terminal
              : limitingBudgets.retryable,
          budgetRetryable: limitingBudgets.terminal.length === 0,
        };
      }
      this.updateRow(reclaimed, existing.revision);
      return {
        record: reclaimed,
        created: false,
        reclaimed: true,
        limitingPolicies: [],
      };
    }
    const limitingPolicies = findLimitingAdmissionPolicies(this.activeReservations(), requested);
    if (limitingPolicies.length > 0) return { created: false, limitingPolicies };
    const limitingBudgets = findLimitingExecutionTreeBudgetPolicies(
      this.executionTreeReservations(requested.request.executionTree?.rootObjectiveId),
      requested
    );
    if (limitingBudgets.terminal.length > 0 || limitingBudgets.retryable.length > 0) {
      return {
        created: false,
        limitingPolicies: [],
        limitingBudgetPolicies:
          limitingBudgets.terminal.length > 0
            ? limitingBudgets.terminal
            : limitingBudgets.retryable,
        budgetRetryable: limitingBudgets.terminal.length === 0,
      };
    }
    this.insertReservationRow(requested);
    return { record: requested, created: true, limitingPolicies: [] };
  }

  private insertReservationRow(record: AdmissionReservation): void {
    this.database
      .getConnection()
      .prepare(
        `INSERT INTO admission_reservations (
           id, workspace_id, task_id, root_task_id, provider, host_id, state, revision,
           idempotency_key, lease_expires_at, workflow_run_id, workflow_step_id,
           root_reservation_id, root_objective_id, node_id, parent_node_id,
           reservation_json, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        record.id,
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
        record.request.executionTree?.rootObjectiveId ?? null,
        record.request.executionTree?.nodeId ?? null,
        record.request.executionTree?.parentNodeId ?? null,
        JSON.stringify(record),
        record.createdAt,
        record.updatedAt
      );
  }

  private expireQueueInTransaction(now: string): AdmissionQueueEntry[] {
    const rows = this.database
      .getConnection()
      .prepare(
        `SELECT queue_json FROM admission_queue
         WHERE state = 'leased' AND lease_expires_at <= ?`
      )
      .all(now) as unknown as QueueRow[];
    return rows.map((row) => {
      const current = AdmissionQueueEntrySchema.parse(JSON.parse(row.queue_json));
      const retryCount = current.retryCount + 1;
      const terminal = retryCount > current.maxRetries;
      const next = AdmissionQueueEntrySchema.parse({
        ...current,
        revision: current.revision + 1,
        state: terminal ? 'terminal' : 'requeued',
        retryCount,
        availableAt: new Date(Date.parse(now) + current.retryAfterMs).toISOString(),
        lease: undefined,
        reservationId: undefined,
        ...(terminal
          ? {
              terminal: {
                code: 'QUEUE_LEASE_EXPIRED',
                reason: 'The queue lease expired before dispatch ownership became durable.',
                recordedAt: now,
              },
            }
          : {}),
        updatedAt: now,
      });
      this.updateQueueRow(next, current.revision);
      return next;
    });
  }

  private insertQueueRow(entry: AdmissionQueueEntry): void {
    this.database
      .getConnection()
      .prepare(
        `INSERT INTO admission_queue (
           id, workspace_id, task_id, state, revision, enqueue_sequence, available_at,
           lease_expires_at, queue_json, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        entry.id,
        entry.request.workspaceId,
        entry.request.taskId,
        entry.state,
        entry.revision,
        entry.enqueueSequence,
        entry.availableAt,
        entry.lease?.expiresAt ?? null,
        JSON.stringify(entry),
        entry.createdAt,
        entry.updatedAt
      );
  }

  private updateQueueRow(entry: AdmissionQueueEntry, expectedRevision: number): void {
    const result = this.database
      .getConnection()
      .prepare(
        `UPDATE admission_queue
         SET workspace_id = ?, task_id = ?, state = ?, revision = ?, enqueue_sequence = ?,
             available_at = ?, lease_expires_at = ?, queue_json = ?, updated_at = ?
         WHERE id = ? AND revision = ?`
      )
      .run(
        entry.request.workspaceId,
        entry.request.taskId,
        entry.state,
        entry.revision,
        entry.enqueueSequence,
        entry.availableAt,
        entry.lease?.expiresAt ?? null,
        JSON.stringify(entry),
        entry.updatedAt,
        entry.id,
        expectedRevision
      );
    if (result.changes !== 1) {
      throw new Error('Admission queue compare-and-set changed unexpectedly.');
    }
  }

  private activeReservations(): AdmissionReservation[] {
    const rows = this.database
      .getConnection()
      .prepare(`SELECT reservation_json FROM admission_reservations WHERE state = 'active'`)
      .all() as unknown as ReservationRow[];
    return rows.map((row) => AdmissionReservationSchema.parse(JSON.parse(row.reservation_json)));
  }

  private executionTreeReservations(rootObjectiveId: string | undefined): AdmissionReservation[] {
    if (!rootObjectiveId) return [];
    const rows = this.database
      .getConnection()
      .prepare('SELECT reservation_json FROM admission_reservations WHERE root_objective_id = ?')
      .all(rootObjectiveId) as unknown as ReservationRow[];
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
        executionBudget: releaseExecutionTreeBudget(current.executionBudget),
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
             root_objective_id = ?, node_id = ?, parent_node_id = ?,
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
        record.request.executionTree?.rootObjectiveId ?? null,
        record.request.executionTree?.nodeId ?? null,
        record.request.executionTree?.parentNodeId ?? null,
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
