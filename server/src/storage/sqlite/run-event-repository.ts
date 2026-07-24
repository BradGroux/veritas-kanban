import {
  RUN_EVENT_SCHEMA_VERSION,
  type RunEventAppendResult,
  type RunEventPage,
  type RunEventQuery,
} from '@veritas-kanban/shared';
import type { RunEventRepository, RunEventRepositoryAppendInput } from '../interfaces.js';
import type { SqliteDatabase } from './database.js';
import { RunEventEnvelopeSchema } from '../../schemas/run-event-schemas.js';

const MAX_EVENTS_PER_ATTEMPT = 50_000;
const DEFAULT_REPLAY_LIMIT = 200;
const MAX_REPLAY_LIMIT = 500;

interface EventRow {
  event_json: string;
}

interface SequenceRow {
  sequence: number;
}

interface CountRow {
  count: number;
}

export class SqliteRunEventRepository implements RunEventRepository {
  constructor(private readonly database: SqliteDatabase) {}

  async append(event: RunEventRepositoryAppendInput): Promise<RunEventAppendResult> {
    const connection = this.database.getConnection();
    connection.exec('BEGIN IMMEDIATE');
    try {
      if (event.dedupeKey) {
        const duplicate = connection
          .prepare(
            `SELECT event_json
             FROM run_events
             WHERE workspace_id = 'local'
               AND task_id = ?
               AND attempt_id = ?
               AND dedupe_key = ?`
          )
          .get(event.taskId, event.attemptId, event.dedupeKey) as EventRow | undefined;
        if (duplicate) {
          connection.exec('COMMIT');
          return {
            event: RunEventEnvelopeSchema.parse(JSON.parse(duplicate.event_json)),
            appended: false,
          };
        }
      }
      const count = connection
        .prepare(
          `SELECT COUNT(*) AS count
           FROM run_events
           WHERE workspace_id = 'local' AND task_id = ? AND attempt_id = ?`
        )
        .get(event.taskId, event.attemptId) as unknown as CountRow;
      if (count.count >= MAX_EVENTS_PER_ATTEMPT) {
        throw new Error('Run event journal reached its bounded event limit');
      }
      const latest = connection
        .prepare(
          `SELECT sequence
           FROM run_events
           WHERE workspace_id = 'local' AND task_id = ? AND attempt_id = ?
           ORDER BY sequence DESC
           LIMIT 1`
        )
        .get(event.taskId, event.attemptId) as SequenceRow | undefined;
      const persisted = RunEventEnvelopeSchema.parse({
        ...event,
        sequence: (latest?.sequence ?? 0) + 1,
      });
      connection
        .prepare(
          `INSERT INTO run_events (
             event_id,
             workspace_id,
             task_id,
             attempt_id,
             sequence,
             provider_event_id,
             dedupe_key,
             received_at,
             event_json
           ) VALUES (?, 'local', ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          persisted.eventId,
          persisted.taskId,
          persisted.attemptId,
          persisted.sequence,
          persisted.providerEventId ?? null,
          persisted.dedupeKey ?? null,
          persisted.receivedAt,
          JSON.stringify(persisted)
        );
      connection.exec('COMMIT');
      return { event: persisted, appended: true };
    } catch (error) {
      connection.exec('ROLLBACK');
      throw error;
    }
  }

  async list(query: RunEventQuery): Promise<RunEventPage> {
    const afterSequence = Math.max(0, query.afterSequence ?? 0);
    const limit = Math.min(Math.max(query.limit ?? DEFAULT_REPLAY_LIMIT, 1), MAX_REPLAY_LIMIT);
    const rows = this.database
      .getConnection()
      .prepare(
        `SELECT event_json
         FROM run_events
         WHERE workspace_id = 'local'
           AND task_id = ?
           AND attempt_id = ?
           AND sequence > ?
         ORDER BY sequence ASC
         LIMIT ?`
      )
      .all(query.taskId, query.attemptId, afterSequence, limit + 1) as unknown as EventRow[];
    const hasMore = rows.length > limit;
    const events = rows
      .slice(0, limit)
      .map((row) => RunEventEnvelopeSchema.parse(JSON.parse(row.event_json)));
    return {
      schemaVersion: RUN_EVENT_SCHEMA_VERSION,
      taskId: query.taskId,
      attemptId: query.attemptId,
      events,
      nextCursor: events.at(-1)?.sequence ?? afterSequence,
      hasMore,
    };
  }
}
