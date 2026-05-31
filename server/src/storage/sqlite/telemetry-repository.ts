import { nanoid } from 'nanoid';
import type { SQLInputValue } from 'node:sqlite';
import type {
  AnyTelemetryEvent,
  TelemetryConfig,
  TelemetryEvent,
  TelemetryEventType,
  TelemetryQueryOptions,
} from '@veritas-kanban/shared';
import type { TelemetryRepository } from '../interfaces.js';
import type { SqliteDatabase } from './database.js';
import { createLogger } from '../../lib/logger.js';

const log = createLogger('sqlite-telemetry-repository');
const DEFAULT_CONFIG: TelemetryConfig = {
  enabled: true,
  retention: 30,
  traces: false,
};
const MAX_DURATION_MS = 604800000;

interface TelemetryRow {
  payload_json: string;
}

interface TelemetryCountRow {
  count: number;
}

export interface SqliteTelemetryRepositoryOptions {
  config?: Partial<TelemetryConfig>;
}

export class SqliteTelemetryRepository implements TelemetryRepository {
  private config: TelemetryConfig;

  constructor(
    private readonly database: SqliteDatabase,
    options: SqliteTelemetryRepositoryOptions = {}
  ) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...options.config,
    };
  }

  async init(): Promise<void> {
    await this.cleanupOldEvents();
  }

  async emit<T extends TelemetryEvent>(
    event: Omit<T, 'id' | 'timestamp'> & { timestamp?: string }
  ): Promise<T> {
    if (!this.config.enabled) {
      return {
        ...event,
        id: `disabled_${nanoid(8)}`,
        timestamp: event.timestamp ?? new Date().toISOString(),
      } as T;
    }

    const mutableEvent = event as T & { durationMs?: number };
    if (typeof mutableEvent.durationMs === 'number' && mutableEvent.durationMs > MAX_DURATION_MS) {
      log.warn(
        { originalDuration: mutableEvent.durationMs, cappedDuration: MAX_DURATION_MS },
        'durationMs exceeds 7 days, capping to maximum'
      );
      mutableEvent.durationMs = MAX_DURATION_MS;
    }

    const fullEvent = {
      ...event,
      id: `evt_${nanoid(12)}`,
      timestamp: event.timestamp ?? new Date().toISOString(),
    } as T;

    this.insertEvent(fullEvent as unknown as AnyTelemetryEvent);
    return fullEvent;
  }

  async getEvents(options: TelemetryQueryOptions = {}): Promise<AnyTelemetryEvent[]> {
    const { sql, params } = this.buildEventQuery(options, false);
    const rows = this.database
      .getConnection()
      .prepare(sql)
      .all(...params) as unknown as TelemetryRow[];

    return rows.map((row) => JSON.parse(row.payload_json) as AnyTelemetryEvent);
  }

  async getTaskEvents(taskId: string): Promise<AnyTelemetryEvent[]> {
    return this.getEvents({ taskId });
  }

  async getBulkTaskEvents(
    taskIds: string[],
    perTaskLimit = 200
  ): Promise<Map<string, AnyTelemetryEvent[]>> {
    const result = new Map<string, AnyTelemetryEvent[]>();
    for (const taskId of taskIds) {
      result.set(taskId, []);
    }

    if (taskIds.length === 0) {
      return result;
    }

    const effectivePerTaskLimit = Math.min(Math.max(perTaskLimit, 1), 1000);
    const placeholders = taskIds.map(() => '?').join(', ');
    const rows = this.database
      .getConnection()
      .prepare(
        `
          SELECT payload_json
          FROM telemetry_events
          WHERE workspace_id = 'local'
            AND task_id IN (${placeholders})
          ORDER BY datetime(created_at) DESC, id DESC
        `
      )
      .all(...taskIds) as unknown as TelemetryRow[];

    for (const row of rows) {
      const event = JSON.parse(row.payload_json) as AnyTelemetryEvent;
      if (!event.taskId) continue;

      const bucket = result.get(event.taskId);
      if (!bucket || bucket.length >= effectivePerTaskLimit) continue;

      bucket.push(event);
    }

    return result;
  }

  async getEventsSince(since: string): Promise<AnyTelemetryEvent[]> {
    return this.getEvents({ since });
  }

  async countEvents(
    type: TelemetryEventType | TelemetryEventType[],
    since?: string,
    until?: string
  ): Promise<number> {
    const { sql, params } = this.buildEventQuery({ type, since, until }, true);
    const row = this.database
      .getConnection()
      .prepare(sql)
      .get(...params) as unknown as TelemetryCountRow;
    return row.count;
  }

  async clear(): Promise<void> {
    this.database
      .getConnection()
      .prepare("DELETE FROM telemetry_events WHERE workspace_id = 'local'")
      .run();
  }

  async flush(): Promise<void> {
    return;
  }

  async exportAsJson(options: TelemetryQueryOptions = {}): Promise<string> {
    const events = await this.getEvents(options);
    return JSON.stringify(events, null, 2);
  }

  async exportAsCsv(options: TelemetryQueryOptions = {}): Promise<string> {
    const events = await this.getEvents(options);

    if (events.length === 0) {
      return 'id,type,timestamp,taskId,project,agent,success,durationMs,inputTokens,outputTokens,cacheTokens,cost,error\n';
    }

    const headers = [
      'id',
      'type',
      'timestamp',
      'taskId',
      'project',
      'agent',
      'success',
      'durationMs',
      'inputTokens',
      'outputTokens',
      'cacheTokens',
      'cost',
      'error',
    ];

    const rows = events.map((event) => {
      const fields = event as unknown as Record<string, unknown>;
      const row: Record<string, string> = {
        id: this.escapeCsvField(event.id),
        type: this.escapeCsvField(event.type),
        timestamp: this.escapeCsvField(event.timestamp),
        taskId: this.escapeCsvField(event.taskId || ''),
        project: this.escapeCsvField(event.project || ''),
        agent: this.escapeCsvField(String(fields.agent ?? '')),
        success: this.escapeCsvField(String(fields.success ?? '')),
        durationMs: this.escapeCsvField(String(fields.durationMs ?? '')),
        inputTokens: this.escapeCsvField(String(fields.inputTokens ?? '')),
        outputTokens: this.escapeCsvField(String(fields.outputTokens ?? '')),
        cacheTokens: this.escapeCsvField(String(fields.cacheTokens ?? '')),
        cost: this.escapeCsvField(String(fields.cost ?? '')),
        error: this.escapeCsvField(String(fields.error ?? '')),
      };
      return headers.map((header) => row[header]).join(',');
    });

    return [headers.join(','), ...rows].join('\n');
  }

  configure(config: Partial<TelemetryConfig>): void {
    this.config = { ...this.config, ...config };
  }

  getConfig(): TelemetryConfig {
    return { ...this.config };
  }

  isEnabled(): boolean {
    return this.config.enabled;
  }

  private insertEvent(event: AnyTelemetryEvent): void {
    const fields = event as unknown as Record<string, unknown>;
    this.database
      .getConnection()
      .prepare(
        `
          INSERT INTO telemetry_events (
            id,
            workspace_id,
            type,
            task_id,
            project_id,
            agent,
            model,
            attempt_id,
            success,
            duration_ms,
            exit_code,
            input_tokens,
            output_tokens,
            cache_tokens,
            total_tokens,
            cost,
            error,
            stack_trace,
            session_key,
            payload_json,
            created_at
          )
          VALUES (?, 'local', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        event.id,
        event.type,
        event.taskId ?? null,
        event.project ?? null,
        this.optionalString(fields.agent),
        this.optionalString(fields.model),
        this.optionalString(fields.attemptId),
        typeof fields.success === 'boolean' ? (fields.success ? 1 : 0) : null,
        this.optionalNumber(fields.durationMs),
        this.optionalNumber(fields.exitCode),
        this.optionalNumber(fields.inputTokens),
        this.optionalNumber(fields.outputTokens),
        this.optionalNumber(fields.cacheTokens),
        this.optionalNumber(fields.totalTokens),
        this.optionalNumber(fields.cost),
        this.optionalString(fields.error),
        this.optionalString(fields.stackTrace),
        this.optionalString(fields.sessionKey),
        JSON.stringify(event),
        event.timestamp
      );
  }

  private buildEventQuery(
    options: TelemetryQueryOptions,
    countOnly: boolean
  ): { sql: string; params: SQLInputValue[] } {
    const clauses = ["workspace_id = 'local'"];
    const params: SQLInputValue[] = [];
    const types = options.type
      ? Array.isArray(options.type)
        ? options.type
        : [options.type]
      : null;

    if (types && types.length > 0) {
      clauses.push(`type IN (${types.map(() => '?').join(', ')})`);
      params.push(...types);
    }

    if (options.since) {
      clauses.push('created_at >= ?');
      params.push(options.since);
    }

    if (options.until) {
      clauses.push('created_at <= ?');
      params.push(options.until);
    }

    if (options.taskId) {
      clauses.push('task_id = ?');
      params.push(options.taskId);
    }

    if (options.project) {
      clauses.push('project_id = ?');
      params.push(options.project);
    }

    if (countOnly) {
      return {
        sql: `
          SELECT COUNT(*) AS count
          FROM telemetry_events
          WHERE ${clauses.join(' AND ')}
        `,
        params,
      };
    }

    const effectiveLimit = Math.min(Math.max(options.limit ?? 1000, 1), 10_000);
    params.push(effectiveLimit);

    return {
      sql: `
        SELECT payload_json
        FROM telemetry_events
        WHERE ${clauses.join(' AND ')}
        ORDER BY datetime(created_at) DESC, id DESC
        LIMIT ?
      `,
      params,
    };
  }

  private async cleanupOldEvents(): Promise<void> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - this.config.retention);
    this.database
      .getConnection()
      .prepare(
        `
          DELETE FROM telemetry_events
          WHERE workspace_id = 'local'
            AND created_at < ?
        `
      )
      .run(cutoff.toISOString());
  }

  private optionalString(value: unknown): string | null {
    return typeof value === 'string' ? value : null;
  }

  private optionalNumber(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  }

  private escapeCsvField(field: string): string {
    let sanitized = field;
    if (/^[=+\-@]/.test(sanitized)) {
      sanitized = `'${sanitized}`;
    }
    if (sanitized.includes(',') || sanitized.includes('"') || sanitized.includes('\n')) {
      return `"${sanitized.replace(/"/g, '""')}"`;
    }
    return sanitized;
  }
}
