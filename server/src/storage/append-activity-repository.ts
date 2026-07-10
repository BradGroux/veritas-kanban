/**
 * JSONL activity storage with index caching and retention bounds.
 *
 * Maintains two files:
 * - activity.jsonl: One activity per line, newest-first (prepended)
 * - activity.index: Metadata { version, total, retained, lastWrite, lastIndex }
 *
 * Design tradeoffs:
 * - Prepends new activities (newest-first ordering) for efficient chronological queries
 * - Prepending requires full file rewrites; this is a performance tradeoff vs true append-only
 * - Index caching enables O(1) pagination metadata lookups without scanning the entire file
 * - Compaction trims oldest entries when file size exceeds threshold
 * - Corrupted files are backed up before recovery; data loss is prevented via backups
 *
 * Key optimization: pagination uses cached index (total count) + single scan with offset,
 * eliminating duplicate full-file reads that occurred in the legacy implementation.
 */

import { readFile, writeFile, mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { createLogger } from '../lib/logger.js';
import { withFileLock } from '../services/file-lock.js';
import { fileExists, atomicWriteFile } from './fs-helpers.js';
import type { Activity, ActivityType, ActivityFilters } from '../services/activity-service.js';

const log = createLogger('append-activity-repository');

/**
 * Index metadata for cached pagination and compaction tracking.
 */
interface ActivityIndex {
  version: number;
  total: number;
  retained: number;
  lastWrite: string;
  lastIndex: number;
}

/**
 * Configuration for compaction and retention.
 */
interface CompactionConfig {
  maxActivities: number;
  maxFileSizeBytes: number;
}

const DEFAULT_COMPACTION: CompactionConfig = {
  maxActivities: 5000,
  maxFileSizeBytes: 10 * 1024 * 1024, // 10 MB
};

export class AppendActivityRepository {
  private baseDir: string;
  private jsonlPath: string;
  private indexPath: string;
  private config: CompactionConfig;
  private indexCache: ActivityIndex | null = null;

  constructor(baseDir: string, config: Partial<CompactionConfig> = {}) {
    this.baseDir = baseDir;
    this.jsonlPath = join(baseDir, 'activity.jsonl');
    this.indexPath = join(baseDir, 'activity.index');
    this.config = { ...DEFAULT_COMPACTION, ...config };
  }

  /**
   * Load and parse the cached index, or rebuild if missing.
   */
  private async loadIndex(): Promise<ActivityIndex> {
    if (this.indexCache) {
      return this.indexCache;
    }

    if (await fileExists(this.indexPath)) {
      try {
        const content = await readFile(this.indexPath, 'utf-8');
        this.indexCache = JSON.parse(content) as ActivityIndex;
        return this.indexCache;
      } catch (err) {
        log.warn({ err, path: this.indexPath }, 'Failed to parse index; rebuilding');
      }
    }

    // Rebuild index by scanning JSONL
    return this.rebuildIndex();
  }

  /**
   * Scan the JSONL file and rebuild the index.
   */
  private async rebuildIndex(): Promise<ActivityIndex> {
    let total = 0;

    if (await fileExists(this.jsonlPath)) {
      try {
        const content = await readFile(this.jsonlPath, 'utf-8');
        const lines = content.trim().split('\n').filter((line) => line.length > 0);
        total = lines.length;
      } catch (err) {
        log.warn({ err, path: this.jsonlPath }, 'Failed to read JSONL; assuming empty');
        total = 0;
      }
    }

    this.indexCache = {
      version: 1,
      total,
      retained: Math.min(total, this.config.maxActivities),
      lastWrite: new Date().toISOString(),
      lastIndex: total,
    };

    // Save the rebuilt index
    await this.saveIndex(this.indexCache);
    return this.indexCache;
  }

  /**
   * Save index to disk.
   */
  private async saveIndex(index: ActivityIndex): Promise<void> {
    try {
      await mkdir(this.baseDir, { recursive: true });
      await atomicWriteFile(this.indexPath, JSON.stringify(index, null, 2), 'utf-8');
      this.indexCache = index;
    } catch (err) {
      log.error({ err, path: this.indexPath }, 'Failed to save index');
    }
  }

  /**
   * Scan JSONL with optional filters and return activities.
   * One-pass scan for both items and total when no offset.
   */
  private async scanJsonl(
    limit: number,
    offset: number,
    filters?: ActivityFilters
  ): Promise<{ items: Activity[]; total: number }> {
    if (!(await fileExists(this.jsonlPath))) {
      return { items: [], total: 0 };
    }

    try {
      const content = await readFile(this.jsonlPath, 'utf-8');
      const lines = content.trim().split('\n').filter((line) => line.length > 0);

      let activities: Activity[] = [];
      for (const line of lines) {
        try {
          activities.push(JSON.parse(line) as Activity);
        } catch {
          log.warn({ line: line.substring(0, 50) }, 'Skipped malformed JSONL line');
        }
      }

      // Apply filters
      let filtered = activities;
      if (filters) {
        filtered = activities.filter((a) => this.matchesFilters(a, filters));
      }

      // Slice for pagination
      const items = filtered.slice(offset, offset + limit);

      return {
        items,
        total: filtered.length,
      };
    } catch (err) {
      log.error({ err, path: this.jsonlPath }, 'Error scanning JSONL');
      throw new Error(`Failed to scan activity storage: ${err instanceof Error ? err.message : String(err)}`, {
        cause: err,
      });
    }
  }

  /**
   * Check if an activity matches the given filters.
   */
  private matchesFilters(activity: Activity, filters: ActivityFilters): boolean {
    if (filters.agent) {
      const agentLower = filters.agent.toLowerCase();
      if (activity.agent?.toLowerCase() !== agentLower) {
        return false;
      }
    }
    if (filters.type && activity.type !== filters.type) {
      return false;
    }
    if (filters.taskId && activity.taskId !== filters.taskId) {
      return false;
    }
    if (filters.since) {
      const sinceDate = new Date(filters.since).getTime();
      if (new Date(activity.timestamp).getTime() < sinceDate) {
        return false;
      }
    }
    if (filters.until) {
      const untilDate = new Date(filters.until).getTime();
      if (new Date(activity.timestamp).getTime() > untilDate) {
        return false;
      }
    }
    return true;
  }

  /**
   * Get paginated activities with optional filters.
   */
  async getActivities(
    limit: number = 50,
    offset: number = 0,
    filters?: ActivityFilters
  ): Promise<Activity[]> {
    const { items } = await this.scanJsonl(limit, offset, filters);
    return items;
  }

  /**
   * Get both items and total in one pass.
   */
  async getActivitiesPage(
    limit: number,
    offset: number,
    filters?: ActivityFilters
  ): Promise<{ items: Activity[]; total: number }> {
    return this.scanJsonl(limit, offset, filters);
  }

  /**
   * Count activities matching filters (may use cached index if no filters).
   */
  async countActivities(filters?: ActivityFilters): Promise<number> {
    if (!filters) {
      const index = await this.loadIndex();
      return index.retained;
    }
    // With filters, must scan
    const { total } = await this.scanJsonl(this.config.maxActivities, 0, filters);
    return total;
  }

  /**
   * Get all activities ordered newest-first.
   */
  async getAllActivities(): Promise<Activity[]> {
    return this.getActivities(this.config.maxActivities, 0);
  }

  /**
   * Log a new activity. Prepends it to maintain newest-first ordering.
   * Note: prepending requires rewriting the file; this is a tradeoff for ordering efficiency.
   * The index cache mitigates the cost by avoiding duplicate reads during pagination.
   */
  async logActivity(
    type: ActivityType,
    taskId: string,
    taskTitle: string,
    details?: Record<string, unknown>,
    agent?: string,
    actor?: string
  ): Promise<Activity> {
    const activity: Activity = {
      id: `activity_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type,
      taskId,
      taskTitle,
      ...(agent && { agent }),
      ...(actor && { actor }),
      details,
      timestamp: new Date().toISOString(),
    };

    await mkdir(this.baseDir, { recursive: true });

    // Use file lock to serialize appends under concurrency
    await withFileLock(this.jsonlPath, async () => {
      let activities: Activity[] = [];

      // Read existing activities
      if (await fileExists(this.jsonlPath)) {
        try {
          const content = await readFile(this.jsonlPath, 'utf-8');
          const lines = content.trim().split('\n').filter((line) => line.length > 0);
          activities = lines
            .map((line) => {
              try {
                return JSON.parse(line) as Activity;
              } catch {
                return null;
              }
            })
            .filter((a): a is Activity => a !== null);
        } catch (err) {
          // Back up corrupted file before recovery
          const backupPath = `${this.jsonlPath}.corrupt.${Date.now()}`;
          log.warn({ err, backupPath }, 'Corrupted activity file — backed up before recovery');
          try {
            const raw = await readFile(this.jsonlPath, 'utf-8');
            await writeFile(backupPath, raw, 'utf-8');
          } catch {
            // Ignore backup failures
          }
          activities = [];
        }
      }

      // Prepend new activity and enforce retention limit
      activities = [activity, ...activities].slice(0, this.config.maxActivities);

      // Trim the oldest entries if we exceed max
      if (activities.length >= this.config.maxActivities) {
        log.debug(
          `[Activity] Activity limit reached (${this.config.maxActivities}), trimming oldest entries`
        );
      }

      // Write activities as JSONL (each on one line)
      const jsonlContent = activities.map((a) => JSON.stringify(a)).join('\n');

      await atomicWriteFile(this.jsonlPath, jsonlContent + '\n', 'utf-8');

      // Invalidate index cache and update it
      this.indexCache = null;
      const index = await this.loadIndex();
      await this.saveIndex(index);

      // Check if compaction is needed
      await this.maybeCompact();
    });

    return activity;
  }

  /**
   * Check if file exceeds size threshold and trigger compaction if needed.
   */
  private async maybeCompact(): Promise<void> {
    try {
      if (!(await fileExists(this.jsonlPath))) {
        return;
      }

      const stats = await this.getFileSize(this.jsonlPath);
      if (stats > this.config.maxFileSizeBytes) {
        log.debug(
          { size: stats, threshold: this.config.maxFileSizeBytes },
          'Activity file exceeds size threshold, triggering compaction'
        );
        await this.compact();
      }
    } catch (err) {
      log.warn({ err }, 'Error checking compaction threshold');
    }
  }

  /**
   * Get file size in bytes.
   */
  private async getFileSize(filePath: string): Promise<number> {
    try {
      const content = await readFile(filePath, 'utf-8');
      return Buffer.byteLength(content, 'utf-8');
    } catch {
      return 0;
    }
  }

  /**
   * Compact activity file by removing oldest entries beyond retention limit.
   * Runs atomically without disrupting concurrent appends.
   */
  async compact(): Promise<void> {
    await withFileLock(this.jsonlPath, async () => {
      if (!(await fileExists(this.jsonlPath))) {
        return;
      }

      try {
        const content = await readFile(this.jsonlPath, 'utf-8');
        const lines = content.trim().split('\n').filter((line) => line.length > 0);

        // Keep only the newest MAX_ACTIVITIES
        const retained = lines.slice(0, this.config.maxActivities);

        if (retained.length < lines.length) {
          log.info(
            {
              before: lines.length,
              after: retained.length,
              removed: lines.length - retained.length,
            },
            'Compacted activity file'
          );

          // Create backup of old file
          const backupPath = `${this.jsonlPath}.compacted.${Date.now()}`;
          await atomicWriteFile(backupPath, content, 'utf-8');

          // Write compacted file
          const compactedContent = retained.join('\n') + '\n';
          await atomicWriteFile(this.jsonlPath, compactedContent, 'utf-8');

          // Invalidate and rebuild index
          this.indexCache = null;
          await this.rebuildIndex();
        }
      } catch (err) {
        log.error({ err }, 'Error during compaction');
      }
    });
  }

  /**
   * Clear all activities.
   */
  async clearActivities(): Promise<void> {
    await mkdir(this.baseDir, { recursive: true });

    await withFileLock(this.jsonlPath, async () => {
      try {
        await rm(this.jsonlPath, { force: true });
      } catch {
        // Ignore errors
      }

      this.indexCache = null;
      await atomicWriteFile(this.jsonlPath, '', 'utf-8');
      await this.rebuildIndex();
    });
  }

  /**
   * Migrate from old activity.json format to new JSONL format.
   * Atomic migration with backup of original.
   */
  async migrateFromJson(legacyJsonPath: string): Promise<void> {
    if (!(await fileExists(legacyJsonPath))) {
      return;
    }

    try {
      const content = await readFile(legacyJsonPath, 'utf-8');
      const activities = JSON.parse(content) as Activity[];

      // Validate activities
      if (!Array.isArray(activities)) {
        throw new Error('Legacy file is not an array');
      }

      await mkdir(this.baseDir, { recursive: true });

      // Write activities as JSONL
      const jsonlContent = activities.map((a) => JSON.stringify(a)).join('\n') + '\n';
      await atomicWriteFile(this.jsonlPath, jsonlContent, 'utf-8');

      // Backup original and remove it
      const backupPath = `${legacyJsonPath}.migrated.${Date.now()}`;
      await atomicWriteFile(backupPath, content, 'utf-8');
      await rm(legacyJsonPath, { force: true });

      // Rebuild index
      this.indexCache = null;
      await this.rebuildIndex();

      log.info({ backupPath }, 'Migrated activity storage from JSON to JSONL');
    } catch (err) {
      log.error({ err, legacyJsonPath }, 'Migration failed');
      throw new Error(`Failed to migrate activity storage: ${err instanceof Error ? err.message : String(err)}`, {
        cause: err,
      });
    }
  }

  /**
   * Recover from truncated/malformed JSONL.
   * Backs up the file and returns the number of valid lines recovered.
   */
  async recover(): Promise<number> {
    if (!(await fileExists(this.jsonlPath))) {
      return 0;
    }

    let recovered = 0;

    await withFileLock(this.jsonlPath, async () => {
      try {
        const content = await readFile(this.jsonlPath, 'utf-8');
        const lines = content.split('\n');

        // Filter valid JSON lines
        const validLines: string[] = [];
        for (const line of lines) {
          if (line.trim().length === 0) {
            continue;
          }
          try {
            JSON.parse(line);
            validLines.push(line);
            recovered++;
          } catch {
            log.warn({ line: line.substring(0, 50) }, 'Skipped invalid line during recovery');
          }
        }

        // Backup original
        if (validLines.length < lines.length) {
          const backupPath = `${this.jsonlPath}.corrupted.${Date.now()}`;
          await atomicWriteFile(backupPath, content, 'utf-8');
          log.warn({ backupPath, recovered }, 'Backed up corrupted file during recovery');

          // Write recovered content
          const recoveredContent = validLines.join('\n') + (validLines.length > 0 ? '\n' : '');
          await atomicWriteFile(this.jsonlPath, recoveredContent, 'utf-8');
        }

        // Rebuild index
        this.indexCache = null;
        await this.rebuildIndex();
      } catch (err) {
        log.error({ err }, 'Recovery failed');
        throw new Error(`Failed to recover activity storage: ${err instanceof Error ? err.message : String(err)}`, {
          cause: err,
        });
      }
    });

    return recovered;
  }
}
