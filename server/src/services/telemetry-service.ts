import fs from 'fs/promises';
import { createReadStream, createWriteStream } from 'fs';
import path from 'path';
import { createGzip, gunzipSync } from 'zlib';
import { pipeline } from 'stream/promises';
import { nanoid } from 'nanoid';
import type {
  TelemetryEvent,
  TelemetryEventType,
  TelemetryConfig,
  TelemetryQueryOptions,
  AnyTelemetryEvent,
} from '@veritas-kanban/shared';

// Default paths - resolve to project root
const PROJECT_ROOT = path.resolve(process.cwd(), '..');
const TELEMETRY_DIR = path.join(PROJECT_ROOT, '.veritas-kanban', 'telemetry');

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
  async emit<T extends TelemetryEvent>(event: Omit<T, 'id' | 'timestamp'>): Promise<T> {
    if (!this.config.enabled) {
      // Return a fake event when disabled
      return {
        ...event,
        id: `disabled_${nanoid(8)}`,
        timestamp: new Date().toISOString(),
      } as T;
    }

    await this.init();

    const fullEvent: T = {
      ...event,
      id: `evt_${nanoid(12)}`,
      timestamp: new Date().toISOString(),
    } as T;

    // Add to queue with size limit - drop oldest if exceeded
    this.pendingWrites.push(fullEvent);
    if (this.pendingWrites.length > this.MAX_QUEUE_SIZE) {
      const dropped = this.pendingWrites.shift();
      console.warn(
        `[Telemetry] Queue size exceeded (${this.MAX_QUEUE_SIZE}), dropped event:`,
        dropped?.type
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
        console.error('[Telemetry] Failed to write event:', err);
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

    // Determine which files to read based on date range
    const files = await this.getEventFiles(since, until);

    let events: AnyTelemetryEvent[] = [];

    for (const file of files) {
      const fileEvents = await this.readEventFile(file);
      events.push(...fileEvents);
    }

    // Apply filters
    events = events.filter((event) => {
      // Type filter
      if (type) {
        const types = Array.isArray(type) ? type : [type];
        if (!types.includes(event.type)) return false;
      }

      // Time range filters
      if (since && event.timestamp < since) return false;
      if (until && event.timestamp > until) return false;

      // Task filter
      if (taskId && event.taskId !== taskId) return false;

      // Project filter
      if (project && event.project !== project) return false;

      return true;
    });

    // Sort by timestamp (newest first)
    events.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

    // Apply limit
    if (limit && events.length > limit) {
      events = events.slice(0, limit);
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
  async getBulkTaskEvents(taskIds: string[]): Promise<Map<string, AnyTelemetryEvent[]>> {
    if (taskIds.length === 0) {
      return new Map();
    }

    await this.init();

    // Get all recent event files (last 90 days should cover most use cases)
    const files = await this.getEventFiles();

    // Read all events
    let allEvents: AnyTelemetryEvent[] = [];
    for (const file of files) {
      const fileEvents = await this.readEventFile(file);
      allEvents.push(...fileEvents);
    }

    // Create a Set for O(1) lookup
    const taskIdSet = new Set(taskIds);

    // Group events by taskId
    const result = new Map<string, AnyTelemetryEvent[]>();
    for (const taskId of taskIds) {
      result.set(taskId, []);
    }

    for (const event of allEvents) {
      if (event.taskId && taskIdSet.has(event.taskId)) {
        result.get(event.taskId)!.push(event);
      }
    }

    // Sort events within each task by timestamp (newest first)
    for (const [, events] of result) {
      events.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
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
        id: event.id,
        type: event.type,
        timestamp: event.timestamp,
        taskId: event.taskId || '',
        project: event.project || '',
        agent: String(fields.agent ?? ''),
        success: String(fields.success ?? ''),
        durationMs: String(fields.durationMs ?? ''),
        inputTokens: String(fields.inputTokens ?? ''),
        outputTokens: String(fields.outputTokens ?? ''),
        cacheTokens: String(fields.cacheTokens ?? ''),
        cost: String(fields.cost ?? ''),
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
    if (field.includes(',') || field.includes('"') || field.includes('\n')) {
      return `"${field.replace(/"/g, '""')}"`;
    }
    return field;
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
   * Read events from a single file (supports .ndjson and .ndjson.gz)
   */
  private async readEventFile(filename: string): Promise<AnyTelemetryEvent[]> {
    const filepath = path.join(this.telemetryDir, filename);
    const isGzipped = filename.endsWith('.gz');

    try {
      let content: string;
      if (isGzipped) {
        const buffer = await fs.readFile(filepath);
        content = gunzipSync(buffer).toString('utf-8');
      } else {
        content = await fs.readFile(filepath, 'utf-8');
      }

      const lines = content.trim().split('\n').filter(Boolean);

      return lines
        .map((line) => {
          try {
            return JSON.parse(line) as AnyTelemetryEvent;
          } catch {
            console.error('[Telemetry] Failed to parse line:', line);
            return null;
          }
        })
        .filter((e): e is AnyTelemetryEvent => e !== null);
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        return [];
      }
      throw error;
    }
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
          console.error(`[Telemetry] Failed to compress ${filename}:`, err);
        }
      }
    }

    if (deleted > 0 || compressed > 0) {
      console.log(
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
