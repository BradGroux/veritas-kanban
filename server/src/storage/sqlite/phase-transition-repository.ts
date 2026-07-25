import type {
  PhaseTransitionAppendInput,
  PhaseTransitionAppendResult,
  PhaseTransitionQuery,
  PhaseTransitionRecord,
} from '@veritas-kanban/shared';
import { phaseTransitionRecordSchema } from '../../schemas/phase-capability-schemas.js';
import type { PhaseTransitionRepository } from '../interfaces.js';
import type { SqliteDatabase } from './database.js';

interface PhaseTransitionRow {
  transition_json: string;
}

export class SqlitePhaseTransitionRepository implements PhaseTransitionRepository {
  constructor(private readonly database: SqliteDatabase) {}

  async getCurrent(
    workspaceId: string,
    taskId: string,
    attemptId: string
  ): Promise<PhaseTransitionRecord | null> {
    const row = this.database
      .getConnection()
      .prepare(
        `SELECT transition_json
         FROM phase_transitions
         WHERE workspace_id = ? AND task_id = ? AND attempt_id = ?
         ORDER BY sequence DESC
         LIMIT 1`
      )
      .get(workspaceId, taskId, attemptId) as PhaseTransitionRow | undefined;
    return row ? phaseTransitionRecordSchema.parse(JSON.parse(row.transition_json)) : null;
  }

  async getByOperationId(
    workspaceId: string,
    taskId: string,
    attemptId: string,
    operationId: string
  ): Promise<PhaseTransitionRecord | null> {
    const row = this.database
      .getConnection()
      .prepare(
        `SELECT transition_json
         FROM phase_transitions
         WHERE workspace_id = ? AND task_id = ? AND attempt_id = ? AND operation_id = ?`
      )
      .get(workspaceId, taskId, attemptId, operationId) as PhaseTransitionRow | undefined;
    return row ? phaseTransitionRecordSchema.parse(JSON.parse(row.transition_json)) : null;
  }

  async list(query: PhaseTransitionQuery): Promise<PhaseTransitionRecord[]> {
    const limit = Math.max(1, Math.min(1_000, Math.trunc(query.limit ?? 100)));
    const rows = this.database
      .getConnection()
      .prepare(
        `SELECT transition_json
         FROM (
           SELECT sequence, transition_json
           FROM phase_transitions
           WHERE workspace_id = ? AND task_id = ? AND attempt_id = ?
           ORDER BY sequence DESC
           LIMIT ?
         )
         ORDER BY sequence ASC`
      )
      .all(
        query.workspaceId,
        query.taskId,
        query.attemptId,
        limit
      ) as unknown as PhaseTransitionRow[];
    return rows.map((row) => phaseTransitionRecordSchema.parse(JSON.parse(row.transition_json)));
  }

  async append(input: PhaseTransitionAppendInput): Promise<PhaseTransitionAppendResult> {
    const record = phaseTransitionRecordSchema.parse(input.record);
    const connection = this.database.getConnection();
    connection.exec('BEGIN IMMEDIATE');
    try {
      const existingRow = connection
        .prepare(
          `SELECT transition_json
           FROM phase_transitions
           WHERE workspace_id = ? AND task_id = ? AND attempt_id = ? AND operation_id = ?`
        )
        .get(record.workspaceId, record.taskId, record.attemptId, record.operationId) as
        PhaseTransitionRow | undefined;
      if (existingRow) {
        const existing = phaseTransitionRecordSchema.parse(JSON.parse(existingRow.transition_json));
        connection.exec('COMMIT');
        return idempotentResult(existing, input);
      }

      const currentRow = connection
        .prepare(
          `SELECT transition_json
           FROM phase_transitions
           WHERE workspace_id = ? AND task_id = ? AND attempt_id = ?
           ORDER BY sequence DESC
           LIMIT 1`
        )
        .get(record.workspaceId, record.taskId, record.attemptId) as PhaseTransitionRow | undefined;
      const current = currentRow
        ? phaseTransitionRecordSchema.parse(JSON.parse(currentRow.transition_json))
        : null;
      const conflict = compareAndSetConflict(current, input);
      if (conflict || record.sequence !== input.expectedSequence + 1) {
        connection.exec('COMMIT');
        return {
          record: current ?? undefined,
          appended: false,
          reason: conflict ?? 'stale-sequence',
        };
      }

      connection
        .prepare(
          `INSERT INTO phase_transitions (
             id, workspace_id, task_id, attempt_id, sequence, operation_id,
             from_evidence_digest, to_evidence_digest, manifest_digest,
             transition_json, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          record.id,
          record.workspaceId,
          record.taskId,
          record.attemptId,
          record.sequence,
          record.operationId,
          record.priorEvidence.digest,
          record.effectiveEvidence.digest,
          record.manifestDigest,
          JSON.stringify(record),
          record.createdAt
        );
      connection.exec('COMMIT');
      return { record, appended: true };
    } catch (error) {
      connection.exec('ROLLBACK');
      throw error;
    }
  }
}

function compareAndSetConflict(
  current: PhaseTransitionRecord | null,
  input: PhaseTransitionAppendInput
): PhaseTransitionAppendResult['reason'] | undefined {
  if ((current?.sequence ?? 0) !== input.expectedSequence) return 'stale-sequence';
  const currentDigest = current?.effectiveEvidence.digest ?? input.record.priorEvidence.digest;
  if (
    currentDigest !== input.expectedPhaseEvidenceDigest ||
    input.record.priorEvidence.digest !== input.expectedPhaseEvidenceDigest
  ) {
    return 'stale-phase-evidence';
  }
  if (
    (current && current.manifestDigest !== input.expectedManifestDigest) ||
    input.record.manifestDigest !== input.expectedManifestDigest
  ) {
    return 'stale-manifest';
  }
  return undefined;
}

function idempotentResult(
  existing: PhaseTransitionRecord,
  input: PhaseTransitionAppendInput
): PhaseTransitionAppendResult {
  const same =
    existing.sequence === input.expectedSequence + 1 &&
    existing.priorEvidence.digest === input.expectedPhaseEvidenceDigest &&
    existing.effectiveEvidence.digest === input.record.effectiveEvidence.digest &&
    existing.manifestDigest === input.expectedManifestDigest;
  return {
    record: existing,
    appended: false,
    ...(same ? {} : { reason: 'operation-reused' as const }),
  };
}
