/**
 * Telemetry file I/O utilities.
 * Handles reading NDJSON event files (plain and gzipped) with streaming support.
 */
import { createReadStream } from '../../storage/fs-helpers.js';
import fs from 'fs/promises';
import path from 'path';
import readline from 'readline';
import { createGunzip } from 'zlib';
import type { SQLInputValue } from 'node:sqlite';
import type { AnyTelemetryEvent, TelemetryEventType, StreamEventHandler } from './types.js';
import { createLogger } from '../../lib/logger.js';
import { SqliteDatabase } from '../../storage/sqlite/database.js';
const log = createLogger('telemetry-reader');

interface SqliteTelemetryPayloadRow {
  payload_json: string;
}

interface SqliteTelemetryStartRow {
  first_date: string | null;
}

/**
 * Get list of event files within a date range (includes .ndjson and .ndjson.gz)
 * If since is null, returns all event files (for 'all' period)
 */
export async function getEventFiles(telemetryDir: string, since: string | null): Promise<string[]> {
  try {
    const files = await fs.readdir(telemetryDir);
    const eventFiles = files.filter(
      (f) => f.startsWith('events-') && (f.endsWith('.ndjson') || f.endsWith('.ndjson.gz'))
    );

    if (!since) {
      // Return all event files (for 'all' period)
      return eventFiles.map((f) => path.join(telemetryDir, f));
    }

    const sinceDate = since.slice(0, 10);
    return eventFiles
      .filter((filename) => {
        const match = filename.match(/events-(\d{4}-\d{2}-\d{2})\.ndjson(\.gz)?$/);
        if (!match) return false;
        return match[1] >= sinceDate;
      })
      .map((f) => path.join(telemetryDir, f));
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

/**
 * Create a readline interface for an event file (handles both .ndjson and .ndjson.gz)
 */
export function createLineReader(filePath: string): readline.Interface {
  if (filePath.endsWith('.gz')) {
    const fileStream = createReadStream(filePath);
    const gunzip = createGunzip();
    const decompressed = fileStream.pipe(gunzip);
    return readline.createInterface({
      input: decompressed,
      crlfDelay: Infinity,
    });
  }
  const fileStream = createReadStream(filePath, { encoding: 'utf-8' });
  return readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });
}

/**
 * Stream events from NDJSON files with filtering.
 * Performance-optimized: reads line by line, filters early, accumulates in memory-efficient way.
 */
export async function streamEvents<T>(
  files: string[],
  types: TelemetryEventType[],
  since: string | null,
  project: string | undefined,
  accumulator: T,
  handler: StreamEventHandler<T>,
  until?: string
): Promise<T> {
  for (const filePath of files) {
    try {
      const rl = createLineReader(filePath);

      for await (const line of rl) {
        if (!line.trim()) continue;

        try {
          const event = JSON.parse(line) as AnyTelemetryEvent;

          // Early filtering for performance
          if (!types.includes(event.type)) continue;
          if (since && event.timestamp < since) continue;
          if (until && event.timestamp > until) continue;
          if (project && event.project !== project) continue;

          handler(event, accumulator);
        } catch {
          // Skip malformed lines
          continue;
        }
      }
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        log.error(`[Metrics] Error reading ${filePath}:`, error.message);
      }
    }
  }

  return accumulator;
}

/**
 * Visit telemetry events from the active storage backend.
 * File mode streams NDJSON files; SQLite mode reads telemetry_events directly so
 * dashboard metrics do not fall back to file reads after the v5 migration.
 */
export async function visitTelemetryEvents(
  telemetryDir: string,
  types: TelemetryEventType[],
  since: string | null,
  project: string | undefined,
  until: string | undefined,
  visitor: (event: AnyTelemetryEvent) => void
): Promise<void> {
  if (process.env.VERITAS_STORAGE === 'sqlite') {
    visitSqliteTelemetryEvents(types, since, project, until, visitor);
    return;
  }

  const files = await getEventFiles(telemetryDir, since);
  for (const filePath of files) {
    try {
      const rl = createLineReader(filePath);

      for await (const line of rl) {
        if (!line.trim()) continue;

        try {
          const event = JSON.parse(line) as AnyTelemetryEvent;

          if (!types.includes(event.type)) continue;
          if (since && event.timestamp < since) continue;
          if (until && event.timestamp > until) continue;
          if (project && event.project !== project) continue;

          visitor(event);
        } catch {
          continue;
        }
      }
    } catch (error: unknown) {
      if (!isNodeError(error) || error.code !== 'ENOENT') {
        const message = error instanceof Error ? error.message : String(error);
        log.error({ filePath, message }, '[Metrics] Error reading telemetry file');
      }
    }
  }
}

export async function getTelemetryStartDate(telemetryDir: string): Promise<string | null> {
  if (process.env.VERITAS_STORAGE === 'sqlite') {
    const database = new SqliteDatabase();
    try {
      database.open();
      const row = database
        .getConnection()
        .prepare(
          `
            SELECT MIN(substr(created_at, 1, 10)) AS first_date
            FROM telemetry_events
            WHERE workspace_id = 'local'
          `
        )
        .get() as unknown as SqliteTelemetryStartRow;
      return row.first_date;
    } finally {
      database.close();
    }
  }

  const files = await getEventFiles(telemetryDir, null);
  const dates = files
    .map((filePath) => {
      const match = filePath.match(/events-(\d{4}-\d{2}-\d{2})\.ndjson(\.gz)?$/);
      return match?.[1];
    })
    .filter((date): date is string => Boolean(date))
    .sort();

  return dates[0] ?? null;
}

function visitSqliteTelemetryEvents(
  types: TelemetryEventType[],
  since: string | null,
  project: string | undefined,
  until: string | undefined,
  visitor: (event: AnyTelemetryEvent) => void
): void {
  const database = new SqliteDatabase();

  try {
    database.open();
    const clauses = ["workspace_id = 'local'"];
    const params: SQLInputValue[] = [];

    if (types.length > 0) {
      clauses.push(`type IN (${types.map(() => '?').join(', ')})`);
      params.push(...types);
    }

    if (since) {
      clauses.push('created_at >= ?');
      params.push(since);
    }

    if (until) {
      clauses.push('created_at <= ?');
      params.push(until);
    }

    if (project) {
      clauses.push('project_id = ?');
      params.push(project);
    }

    const rows = database
      .getConnection()
      .prepare(
        `
          SELECT payload_json
          FROM telemetry_events
          WHERE ${clauses.join(' AND ')}
          ORDER BY datetime(created_at) ASC, id ASC
        `
      )
      .all(...params) as unknown as SqliteTelemetryPayloadRow[];

    for (const row of rows) {
      try {
        const event = JSON.parse(row.payload_json) as AnyTelemetryEvent;

        if (!types.includes(event.type)) continue;
        if (since && event.timestamp < since) continue;
        if (until && event.timestamp > until) continue;
        if (project && event.project !== project) continue;

        visitor(event);
      } catch {
        continue;
      }
    }
  } finally {
    database.close();
  }
}

function isNodeError(error: unknown): error is { code: string } {
  return typeof error === 'object' && error !== null && 'code' in error;
}
