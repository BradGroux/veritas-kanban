import fs from 'fs/promises';
import { createReadStream, createWriteStream } from '../storage/fs-helpers.js';
import path from 'path';
import { getTelemetryDir } from '../utils/paths.js';
import { createGzip, createGunzip } from 'zlib';
import { pipeline } from 'stream/promises';
import readline from 'readline';
import { nanoid } from 'nanoid';
import type {
  TelemetryEvent,
  TelemetryEventType,
  TelemetryConfig,
  TelemetryQueryOptions,
  AnyTelemetryEvent,
} from '@veritas-kanban/shared';
import { createLogger } from '../lib/logger.js';
const log = createLogger('telemetry-service');

// Default paths - resolve via shared paths helper (respects DATA_DIR/VERITAS_DATA_DIR)
const TELEMETRY_DIR = getTelemetryDir();

const DEFAULT_CONFIG: TelemetryConfig = {
  enabled: true,
  retention: 30, // 30 days
  traces: false,
};

export interface TelemetryServiceOptions {
  telemetryDir?: string;
  config?: Partial<TelemetryConfig>;
}

/**
 * Lightweight telemetry service for event logging.
 *
 * Events are stored as newline-delimited JSON (NDJSON) in date-partitioned files.
 * This allows for easy querying, tailing, and cleanup.
 */
export class TelemetryService {
  private telemetryDir: string;
  private config: TelemetryConfig;
  private compressAfterDays: number;
  private initialized: boolean = false;
  private writeQueue: Promise<void> = Promise.resolve();
  private pendingWrites: Array<TelemetryEvent> = [];
  private readonly MAX_QUEUE_SIZE = 10000;

  constructor(options: TelemetryServiceOptions = {}) {
    this.telemetryDir = options.telemetryDir || TELEMETRY_DIR;

    // Read retention from env var, falling back to options, then default
    const envRetention = process.env.TELEMETRY_RETENTION_DAYS;
    const envRetentionParsed = envRetention ? parseInt(envRetention, 10) : NaN;

    // Read compression threshold from env var (default: 7 days, 0 = disabled)
    const envCompress = process.env.TELEMETRY_COMPRESS_DAYS;
    this.compressAfterDays = envCompress ? parseInt(envCompress, 10) : 7;
    if (isNaN(this.compressAfterDays) || this.compressAfterDays < 0) {
      this.compressAfterDays = 7;
    }

    this.config = {
      ...DEFAULT_CONFIG,
      ...options.config,
      ...(!isNaN(envRetentionParsed) && envRetentionParsed > 0
        ? { retention: envRetentionParsed }
        : {}),
    };
  }

  /**
   * Initialize the service - creates directory and runs retention cleanup
   */
  async init(): Promise<void> {
    if (this.initialized) return;

    await fs.mkdir(this.telemetryDir, { recursive: true });
    await this.cleanupOldEvents();
    this.initialized = true;
  }

  /**
   * Update telemetry configuration
   */
  configure(config: Partial<TelemetryConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current configuration
   */
  getConfig(): TelemetryConfig {
    return { ...this.config };
  }

  /**
   * Check if telemetry is enabled
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Emit a telemetry event
   *
   * Events are written asynchronously to avoid blocking the caller.
   * Writes are queued to prevent file corruption from concurrent writes.
   */
  async emit<T extends TelemetryEvent>(
    event: Omit<T, 'id' | 'timestamp'> & { timestamp?: string }
  ): Promise<T> {
    if (!this.config.enabled) {
      // Return a fake event when disabled
      return {
        ...event,
        id: `disabled_${nanoid(8)}`,
        timestamp: event.timestamp ?? new Date().toISOString(),
      } as T;
    }

    await this.init();

    // Validate durationMs for run events (cap at 7 days = 604,800,000 ms)
    const MAX_DURATION_MS = 604800000;
    if ('durationMs' in event && typeof event.durationMs === 'number') {
      if (event.durationMs > MAX_DURATION_MS) {
        log.warn(
          { originalDuration: event.durationMs, cappedDuration: MAX_DURATION_MS },
          'durationMs exceeds 7 days, capping to maximum'
        );
        (event as any).durationMs = MAX_DURATION_MS;
      }
    }

    const fullEvent: T = {
      ...event,
      id: `evt_${nanoid(12)}`,
      timestamp: event.timestamp ?? new Date().toISOString(),
    } as T;

    // Add to queue with size limit - drop oldest if exceeded
    this.pendingWrites.push(fullEvent);
    if (this.pendingWrites.length > this.MAX_QUEUE_SIZE) {
      const dropped = this.pendingWrites.shift();
      log.warn(
        { droppedType: dropped?.type },
        `[Telemetry] Queue size exceeded (${this.MAX_QUEUE_SIZE}), dropped event`
      );
    }

    // Queue the write to prevent concurrent file access issues
    const writePromise = this.writeQueue
      .then(() => {
        const eventToWrite = this.pendingWrites.shift();
        if (eventToWrite) {
          return this.writeEvent(eventToWrite);
        }
      })
      .catch((err) => {
        log.error({ err: err }, '[Telemetry] Failed to write event');
      });

    this.writeQueue = writePromise;

    // Wait for the write to complete
    await writePromise;

    return fullEvent;
  }

  /**
   * Wait for any pending writes to complete
   */
  async flush(): Promise<void> {
    await this.writeQueue;
  }

  /**
   * Query events with optional filters
   */
  async getEvents(options: TelemetryQueryOptions = {}): Promise<AnyTelemetryEvent[]> {
    await this.init();

    const { type, since, until, taskId, project, limit } = options;
    const types = type ? (Array.isArray(type) ? type : [type]) : null;
    const effectiveLimit = Math.min(Math.max(limit ?? 1000, 1), 10_000);

    // Determine which files to read based on date range
    const files = await this.getEventFiles(since, until);

    const events: AnyTelemetryEvent[] = [];

    // Use streaming with early filtering
    for (const file of files) {
      await this.streamEventFile(file, (event) => {
        // Apply filters during streaming (early rejection)
        if (types && !types.includes(event.type)) return;
        if (since && event.timestamp < since) return;
        if (until && event.timestamp > until) return;
        if (taskId && event.taskId !== taskId) return;
        if (project && event.project !== project) return;

        events.push(event);

        // Note: Can't early-terminate by limit here because we need to sort first.
        // However, filtering during streaming reduces memory usage significantly.
      });
    }

    // Sort by timestamp (newest first)
    events.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

    // Apply limit after sort (guardrail default prevents unbounded reads)
    if (events.length > effectiveLimit) {
      return events.slice(0, effectiveLimit);
    }

    return events;
  }

  /**
   * Get events for a specific task
   */
  async getTaskEvents(taskId: string): Promise<AnyTelemetryEvent[]> {
    return this.getEvents({ taskId });
  }

  /**
   * Get events for multiple tasks at once (batch query)
   * Returns a map of taskId -> events[]
   */
  async getBulkTaskEvents(
    taskIds: string[],
    perTaskLimit: number = 200
  ): Promise<Map<string, AnyTelemetryEvent[]>> {
    if (taskIds.length === 0) {
      return new Map();
    }

    await this.init();

    const effectivePerTaskLimit = Math.min(Math.max(perTaskLimit, 1), 1000);
    const files = await this.getEventFiles();

    // Create a Set for O(1) lookup
    const taskIdSet = new Set(taskIds);

    // Group events by taskId with bounded buffers to cap memory use
    const result = new Map<string, AnyTelemetryEvent[]>();
    for (const taskId of taskIds) {
      result.set(taskId, []);
    }

    for (const file of files) {
      await this.streamEventFile(file, (event) => {
        if (!event.taskId || !taskIdSet.has(event.taskId)) return;
        const bucket = result.get(event.taskId);
        if (!bucket) return;

        if (bucket.length < effectivePerTaskLimit) {
          bucket.push(event);
        }
      });
    }

    // Sort events within each task by timestamp (newest first)
    for (const [, events] of result) {
      events.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
      if (events.length > effectivePerTaskLimit) {
        events.length = effectivePerTaskLimit;
      }
    }

    return result;
  }

  /**
   * Get events within a time period
   */
  async getEventsSince(since: string): Promise<AnyTelemetryEvent[]> {
    return this.getEvents({ since });
  }

  /**
   * Count events by type within a time period
   */
  async countEvents(
    type: TelemetryEventType | TelemetryEventType[],
    since?: string,
    until?: string
  ): Promise<number> {
    const events = await this.getEvents({ type, since, until });
    return events.length;
  }

  /**
   * Delete all events (for testing/reset)
   */
  async clear(): Promise<void> {
    await this.init();
    const files = await fs.readdir(this.telemetryDir);

    for (const file of files) {
      if (file.endsWith('.ndjson') || file.endsWith('.ndjson.gz')) {
        await fs.unlink(path.join(this.telemetryDir, file));
      }
    }
  }

  /**
   * Export events as JSON
   */
  async exportAsJson(options: TelemetryQueryOptions = {}): Promise<string> {
    const events = await this.getEvents(options);
    return JSON.stringify(events, null, 2);
  }

  /**
   * Export events as CSV
   */
  async exportAsCsv(options: TelemetryQueryOptions = {}): Promise<string> {
    const events = await this.getEvents(options);

    if (events.length === 0) {
      return 'id,type,timestamp,taskId,project,agent,success,durationMs,inputTokens,outputTokens,cacheTokens,cost,error\n';
    }

    // CSV header
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
      // Access optional union fields via Record — events are a discriminated union
      // and CSV export needs all possible fields regardless of event type
      // SAFETY: AnyTelemetryEvent subtypes have string-keyed fields we need to access generically
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
      return headers.map((h) => row[h]).join(',');
    });

    return [headers.join(','), ...rows].join('\n');
  }

  /**
   * Escape a field for CSV (handles commas, quotes, newlines)
   */
  private escapeCsvField(field: string): string {
    let sanitized = field;
    // Prevent formula injection in spreadsheet applications
    if (/^[=+\-@]/.test(sanitized)) {
      sanitized = `'${sanitized}`;
    }
    if (sanitized.includes(',') || sanitized.includes('"') || sanitized.includes('\n')) {
      return `"${sanitized.replace(/"/g, '""')}"`;
    }
    return sanitized;
  }

  // ============ Private Methods ============

  /**
   * Get the filename for a given date
   */
  private getFilenameForDate(date: Date): string {
    const dateStr = date.toISOString().slice(0, 10); // YYYY-MM-DD
    return `events-${dateStr}.ndjson`;
  }

  /**
   * Write an event to the appropriate date-partitioned file
   */
  private async writeEvent(event: TelemetryEvent): Promise<void> {
    const filename = this.getFilenameForDate(new Date(event.timestamp));
    const filepath = path.join(this.telemetryDir, filename);
    const line = JSON.stringify(event) + '\n';

    await fs.appendFile(filepath, line, 'utf-8');
  }

  /**
   * Stream events from a single file (supports .ndjson and .ndjson.gz)
   * Uses readline for memory-efficient line-by-line processing.
   * Calls the callback for each event; return false to stop early.
   */
  private async streamEventFile(
    filename: string,
    callback: (event: AnyTelemetryEvent) => boolean | void
  ): Promise<void> {
    const filepath = path.join(this.telemetryDir, filename);
    const isGzipped = filename.endsWith('.gz');

    try {
      await fs.access(filepath);
    } catch {
      return; // File doesn't exist
    }

    return new Promise((resolve, reject) => {
      let stream = createReadStream(filepath);

      if (isGzipped) {
        const gunzip = createGunzip();
        stream = stream.pipe(gunzip) as unknown as ReturnType<typeof createReadStream>;
      }

      const rl = readline.createInterface({
        input: stream as NodeJS.ReadableStream,
        crlfDelay: Infinity,
      });

      let stopped = false;

      rl.on('line', (line) => {
        if (stopped || !line.trim()) return;

        try {
          const event = JSON.parse(line) as AnyTelemetryEvent;
          const shouldContinue = callback(event);
          if (shouldContinue === false) {
            stopped = true;
            rl.close();
            stream.destroy();
          }
        } catch {
          log.error({ err: line }, '[Telemetry] Failed to parse line');
        }
      });

      rl.on('close', () => resolve());
      rl.on('error', reject);
      stream.on('error', reject);
    });
  }

  /**
   * Read all events from a single file (backwards compat wrapper)
   * Prefer streamEventFile for large files with filtering/limits.
   */
  private async readEventFile(filename: string): Promise<AnyTelemetryEvent[]> {
    const events: AnyTelemetryEvent[] = [];
    await this.streamEventFile(filename, (event) => {
      events.push(event);
    });
    return events;
  }

  /**
   * Get list of event files within a date range (includes both .ndjson and .ndjson.gz)
   */
  private async getEventFiles(since?: string, until?: string): Promise<string[]> {
    const files = await fs.readdir(this.telemetryDir);
    const eventFiles = files.filter(
      (f) => f.startsWith('events-') && (f.endsWith('.ndjson') || f.endsWith('.ndjson.gz'))
    );

    if (!since && !until) {
      return eventFiles;
    }

    // Extract date from filename and filter by range
    return eventFiles.filter((filename) => {
      const match = filename.match(/events-(\d{4}-\d{2}-\d{2})\.ndjson(\.gz)?$/);
      if (!match) return false;

      const fileDate = match[1];

      if (since) {
        const sinceDate = since.slice(0, 10);
        if (fileDate < sinceDate) return false;
      }

      if (until) {
        const untilDate = until.slice(0, 10);
        if (fileDate > untilDate) return false;
      }

      return true;
    });
  }

  /**
   * Clean up events older than retention period and compress aging files.
   *
   * - Files older than `retention` days are deleted (both .ndjson and .ndjson.gz).
   * - Files older than `compressAfterDays` (but within retention) are gzip-compressed.
   * - Today's file and recent files are left untouched.
   */
  private async cleanupOldEvents(): Promise<void> {
    const now = new Date();

    const retentionCutoff = new Date(now);
    retentionCutoff.setDate(retentionCutoff.getDate() - this.config.retention);
    const retentionCutoffStr = retentionCutoff.toISOString().slice(0, 10);

    const compressCutoff = new Date(now);
    compressCutoff.setDate(compressCutoff.getDate() - this.compressAfterDays);
    const compressCutoffStr = compressCutoff.toISOString().slice(0, 10);

    const files = await fs.readdir(this.telemetryDir);
    let deleted = 0;
    let compressed = 0;

    for (const filename of files) {
      const match = filename.match(/events-(\d{4}-\d{2}-\d{2})\.ndjson(\.gz)?$/);
      if (!match) continue;

      const fileDate = match[1];
      const isCompressed = !!match[2];
      const filepath = path.join(this.telemetryDir, filename);

      // Delete files older than retention period
      if (fileDate < retentionCutoffStr) {
        await fs.unlink(filepath);
        deleted++;
        continue;
      }

      // Compress uncompressed files older than compress threshold
      if (this.compressAfterDays > 0 && !isCompressed && fileDate < compressCutoffStr) {
        try {
          await this.compressFile(filepath);
          compressed++;
        } catch (err) {
          log.error({ err: err }, `[Telemetry] Failed to compress ${filename}`);
        }
      }
    }

    if (deleted > 0 || compressed > 0) {
      log.info(
        `[Telemetry] Cleanup: deleted ${deleted} expired file(s), compressed ${compressed} file(s) ` +
          `(retention=${this.config.retention}d, compress=${this.compressAfterDays}d)`
      );
    }
  }

  /**
   * Compress an NDJSON file to gzip and remove the original.
   */
  private async compressFile(filepath: string): Promise<void> {
    const gzPath = filepath + '.gz';
    await pipeline(createReadStream(filepath), createGzip(), createWriteStream(gzPath));
    await fs.unlink(filepath);
  }
}

// Singleton instance for shared use
let instance: TelemetryService | null = null;

export function getTelemetryService(options?: TelemetryServiceOptions): TelemetryService {
  if (!instance) {
    instance = new TelemetryService(options);
  }
  return instance;
}

export function resetTelemetryService(): void {
  instance = null;
}
