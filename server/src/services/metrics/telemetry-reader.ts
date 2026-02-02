/**
 * Telemetry file I/O utilities.
 * Handles reading NDJSON event files (plain and gzipped) with streaming support.
 */
import { createReadStream } from '../../storage/fs-helpers.js';
import fs from 'fs/promises';
import path from 'path';
import readline from 'readline';
import { createGunzip } from 'zlib';
import type { AnyTelemetryEvent, TelemetryEventType, StreamEventHandler } from './types.js';
import { createLogger } from '../../lib/logger.js';
const log = createLogger('telemetry-reader');

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
