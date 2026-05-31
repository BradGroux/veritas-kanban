import { readFile, writeFile, mkdir } from 'fs/promises';
import { fileExists } from '../storage/fs-helpers.js';
import { dirname, join } from 'path';
import { createLogger } from '../lib/logger.js';
import { withFileLock } from './file-lock.js';
import type { StatusHistoryRepository } from '../storage/interfaces.js';
import { SqliteDatabase, type SqliteConnectionOptions } from '../storage/sqlite/database.js';
import { SqliteStatusHistoryRepository } from '../storage/sqlite/status-history-repository.js';
const log = createLogger('status-history-service');

export type AgentStatusState = 'idle' | 'working' | 'thinking' | 'sub-agent' | 'error';

export interface StatusHistoryEntry {
  id: string;
  timestamp: string;
  previousStatus: AgentStatusState;
  newStatus: AgentStatusState;
  taskId?: string;
  taskTitle?: string;
  subAgentCount?: number;
  durationMs?: number; // How long the previous status lasted
}

export interface DailySummary {
  date: string; // YYYY-MM-DD
  activeMs: number; // Total time in working/thinking/sub-agent states
  idleMs: number; // Total time in idle state
  errorMs: number; // Total time in error state
  transitions: number; // Number of status changes
  periods: StatusPeriod[];
}

export interface StatusPeriod {
  status: AgentStatusState;
  startTime: string;
  endTime: string;
  durationMs: number;
  taskId?: string;
  taskTitle?: string;
}

export interface StatusHistoryServiceOptions {
  historyFile?: string;
  storageType?: 'file' | 'sqlite';
  sqliteDatabase?: SqliteDatabase;
  sqliteConnectionOptions?: SqliteConnectionOptions;
}

export class StatusHistoryService {
  private historyFile: string;
  private readonly MAX_ENTRIES = 5000; // Keep more entries for historical analysis
  private lastEntry: StatusHistoryEntry | null = null;
  private initPromise: Promise<void>;
  private repository: StatusHistoryRepository | null = null;
  private sqliteDatabase: SqliteDatabase | null = null;
  private ownsSqliteDatabase = false;

  constructor(options: StatusHistoryServiceOptions = {}) {
    this.historyFile =
      options.historyFile || join(process.cwd(), '.veritas-kanban', 'status-history.json');
    const storageType =
      options.storageType ?? (process.env.VERITAS_STORAGE === 'sqlite' ? 'sqlite' : 'file');

    if (storageType === 'sqlite') {
      this.sqliteDatabase =
        options.sqliteDatabase ?? new SqliteDatabase(options.sqliteConnectionOptions);
      this.ownsSqliteDatabase = !options.sqliteDatabase;
      this.sqliteDatabase.open();
      this.repository = new SqliteStatusHistoryRepository(this.sqliteDatabase);
      this.initPromise = Promise.resolve();
    } else {
      this.initPromise = this.ensureDir();
    }
  }

  private async ensureDir(): Promise<void> {
    await mkdir(dirname(this.historyFile), { recursive: true });
  }

  private async getLastEntry(): Promise<StatusHistoryEntry | null> {
    if (this.lastEntry) {
      return this.lastEntry;
    }

    try {
      const entries = await this.getHistory(1);
      this.lastEntry = entries[0] ?? null;
      return this.lastEntry;
    } catch {
      // Intentionally silent: history file may not exist on first run
      this.lastEntry = null;
      return null;
    }
  }

  async getHistory(limit: number = 100, offset: number = 0): Promise<StatusHistoryEntry[]> {
    if (this.repository) {
      return this.repository.getHistory(limit, offset);
    }

    await this.initPromise;

    if (!(await fileExists(this.historyFile))) {
      return [];
    }

    try {
      const content = await readFile(this.historyFile, 'utf-8');
      const entries: StatusHistoryEntry[] = JSON.parse(content);
      return entries.slice(offset, offset + limit);
    } catch {
      // Intentionally silent: corrupted file — return empty list
      return [];
    }
  }

  async logStatusChange(
    previousStatus: AgentStatusState,
    newStatus: AgentStatusState,
    taskId?: string,
    taskTitle?: string,
    subAgentCount?: number
  ): Promise<StatusHistoryEntry> {
    if (this.repository) {
      const entry = await this.repository.logStatusChange(
        previousStatus,
        newStatus,
        taskId,
        taskTitle,
        subAgentCount
      );

      log.info(
        `[StatusHistory] ${previousStatus} → ${newStatus}${taskId ? ` (task: ${taskId})` : ''}`
      );

      return entry;
    }

    await this.initPromise;

    const now = new Date();
    const timestamp = now.toISOString();

    // Calculate duration of previous status
    let durationMs: number | undefined;
    const previousEntry = await this.getLastEntry();
    if (previousEntry) {
      const lastTime = new Date(previousEntry.timestamp).getTime();
      durationMs = now.getTime() - lastTime;
    }

    const entry: StatusHistoryEntry = {
      id: `status_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp,
      previousStatus,
      newStatus,
      taskId,
      taskTitle,
      subAgentCount,
      durationMs,
    };

    await withFileLock(this.historyFile, async () => {
      let entries: StatusHistoryEntry[] = [];

      if (await fileExists(this.historyFile)) {
        try {
          const content = await readFile(this.historyFile, 'utf-8');
          entries = JSON.parse(content);
        } catch {
          // Intentionally silent: corrupted history file — start fresh
          entries = [];
        }
      }

      // Prepend new entry and limit to MAX_ENTRIES
      entries = [entry, ...entries].slice(0, this.MAX_ENTRIES);

      await writeFile(this.historyFile, JSON.stringify(entries, null, 2), 'utf-8');
    });

    this.lastEntry = entry;

    log.info(
      `[StatusHistory] ${previousStatus} → ${newStatus}${taskId ? ` (task: ${taskId})` : ''}`
    );

    return entry;
  }

  async getHistoryByDateRange(startDate: string, endDate: string): Promise<StatusHistoryEntry[]> {
    if (this.repository) {
      return this.repository.getHistoryByDateRange(startDate, endDate);
    }

    const entries = await this.getHistory(this.MAX_ENTRIES);
    const start = new Date(startDate).getTime();
    const end = new Date(endDate).getTime();

    return entries.filter((entry) => {
      const entryTime = new Date(entry.timestamp).getTime();
      return entryTime >= start && entryTime <= end;
    });
  }

  async getDailySummary(date?: string): Promise<DailySummary> {
    if (this.repository) {
      return this.repository.getDailySummary(date);
    }

    const targetDate = date || new Date().toISOString().split('T')[0];
    const startOfDay = new Date(`${targetDate}T00:00:00.000Z`);
    const endOfDay = new Date(`${targetDate}T23:59:59.999Z`);

    const entries = await this.getHistoryByDateRange(
      startOfDay.toISOString(),
      endOfDay.toISOString()
    );

    // Reverse to process chronologically
    const chronological = [...entries].reverse();

    let activeMs = 0;
    let idleMs = 0;
    let errorMs = 0;
    const periods: StatusPeriod[] = [];

    // Process each transition
    for (let i = 0; i < chronological.length; i++) {
      const entry = chronological[i];
      const nextEntry = chronological[i + 1];

      // Calculate how long this status lasted
      let endTime: Date;
      if (nextEntry) {
        endTime = new Date(nextEntry.timestamp);
      } else {
        // Last entry - use current time or end of day if analyzing past dates
        const now = new Date();
        endTime = now < endOfDay ? now : endOfDay;
      }

      const startTime = new Date(entry.timestamp);
      const durationMs = endTime.getTime() - startTime.getTime();

      // Only count positive durations within the day
      if (durationMs > 0) {
        // Categorize the time
        if (entry.newStatus === 'idle') {
          idleMs += durationMs;
        } else if (entry.newStatus === 'error') {
          errorMs += durationMs;
        } else {
          activeMs += durationMs;
        }

        // Add to periods
        periods.push({
          status: entry.newStatus,
          startTime: entry.timestamp,
          endTime: endTime.toISOString(),
          durationMs,
          taskId: entry.taskId,
          taskTitle: entry.taskTitle,
        });
      }
    }

    // If no entries for the day, check the last status from before this day
    if (chronological.length === 0) {
      const allEntries = await this.getHistory(this.MAX_ENTRIES);
      const beforeDay = allEntries.filter(
        (e) => new Date(e.timestamp).getTime() < startOfDay.getTime()
      );

      if (beforeDay.length > 0) {
        // The most recent entry before this day determines the starting status
        const lastBeforeDay = beforeDay[0];
        const now = new Date();
        const effectiveEnd = now < endOfDay ? now : endOfDay;
        const durationMs = effectiveEnd.getTime() - startOfDay.getTime();

        if (durationMs > 0) {
          if (lastBeforeDay.newStatus === 'idle') {
            idleMs = durationMs;
          } else if (lastBeforeDay.newStatus === 'error') {
            errorMs = durationMs;
          } else {
            activeMs = durationMs;
          }

          periods.push({
            status: lastBeforeDay.newStatus,
            startTime: startOfDay.toISOString(),
            endTime: effectiveEnd.toISOString(),
            durationMs,
            taskId: lastBeforeDay.taskId,
            taskTitle: lastBeforeDay.taskTitle,
          });
        }
      }
    }

    return {
      date: targetDate,
      activeMs,
      idleMs,
      errorMs,
      transitions: entries.length,
      periods,
    };
  }

  async getWeeklySummary(): Promise<DailySummary[]> {
    if (this.repository) {
      return this.repository.getWeeklySummary();
    }

    const summaries: DailySummary[] = [];
    const today = new Date();

    for (let i = 0; i < 7; i++) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      summaries.push(await this.getDailySummary(dateStr));
    }

    return summaries;
  }

  async clearHistory(): Promise<void> {
    if (this.repository) {
      await this.repository.clearHistory();
      this.lastEntry = null;
      return;
    }

    await this.initPromise;
    await writeFile(this.historyFile, '[]', 'utf-8');
    this.lastEntry = null;
  }

  dispose(): void {
    if (this.ownsSqliteDatabase) {
      this.sqliteDatabase?.close();
    }
    this.sqliteDatabase = null;
    this.repository = null;
    this.lastEntry = null;
  }
}

// Singleton instance
export const statusHistoryService = new StatusHistoryService();
