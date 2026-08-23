import { join } from 'node:path';
import { createLogger } from '../lib/logger.js';
import type { StatusHistoryRepository } from '../storage/interfaces.js';
import { FileStatusHistoryStore } from '../storage/status-history-repository.js';
import { SqliteDatabase, type SqliteConnectionOptions } from '../storage/sqlite/database.js';
import { SqliteStatusHistoryRepository } from '../storage/sqlite/status-history-repository.js';
import { getRuntimeDir } from '../utils/paths.js';

const log = createLogger('status-history-service');
const MAX_ENTRIES = 5000;

export type AgentStatusState = 'idle' | 'working' | 'thinking' | 'sub-agent' | 'error';

export interface StatusHistoryEntry {
  id: string;
  timestamp: string;
  previousStatus: AgentStatusState;
  newStatus: AgentStatusState;
  taskId?: string;
  taskTitle?: string;
  subAgentCount?: number;
  durationMs?: number;
}

export interface DailySummary {
  date: string;
  activeMs: number;
  idleMs: number;
  errorMs: number;
  transitions: number;
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
  repository?: StatusHistoryRepository;
  sqliteDatabase?: SqliteDatabase;
  sqliteConnectionOptions?: SqliteConnectionOptions;
  now?: () => Date;
}

export class StatusHistoryService {
  private lastEntry: StatusHistoryEntry | null = null;
  private readonly repository: StatusHistoryRepository | null;
  private readonly fileStore: FileStatusHistoryStore | null;
  private sqliteDatabase: SqliteDatabase | null = null;
  private ownsSqliteDatabase = false;
  private readonly now: () => Date;

  constructor(options: StatusHistoryServiceOptions = {}) {
    this.now = options.now ?? (() => new Date());
    if (options.repository) {
      this.repository = options.repository;
      this.fileStore = null;
      return;
    }

    const storageType =
      options.storageType ?? (process.env.VERITAS_STORAGE === 'sqlite' ? 'sqlite' : 'file');
    if (storageType === 'sqlite') {
      this.sqliteDatabase =
        options.sqliteDatabase ?? new SqliteDatabase(options.sqliteConnectionOptions);
      this.ownsSqliteDatabase = !options.sqliteDatabase;
      this.sqliteDatabase.open();
      this.repository = new SqliteStatusHistoryRepository(this.sqliteDatabase);
      this.fileStore = null;
      return;
    }

    this.repository = null;
    this.fileStore = new FileStatusHistoryStore(
      options.historyFile ?? join(getRuntimeDir(), 'status-history.json')
    );
  }

  async getHistory(limit = 100, offset = 0): Promise<StatusHistoryEntry[]> {
    if (this.repository) return this.repository.getHistory(limit, offset);
    const entries = await this.getFileStore().read();
    return entries.slice(offset, offset + limit);
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
      this.logChange(previousStatus, newStatus, taskId);
      return entry;
    }

    const now = this.now();
    const timestamp = now.toISOString();
    const previousEntry = this.lastEntry ?? (await this.getHistory(1))[0];
    const entry: StatusHistoryEntry = {
      id: `status_${now.getTime()}_${Math.random().toString(36).slice(2, 11)}`,
      timestamp,
      previousStatus,
      newStatus,
      taskId,
      taskTitle,
      subAgentCount,
      durationMs: previousEntry
        ? now.getTime() - new Date(previousEntry.timestamp).getTime()
        : undefined,
    };

    await this.getFileStore().update((entries) => [entry, ...entries].slice(0, MAX_ENTRIES));
    this.lastEntry = entry;
    this.logChange(previousStatus, newStatus, taskId);
    return entry;
  }

  async getHistoryByDateRange(startDate: string, endDate: string): Promise<StatusHistoryEntry[]> {
    if (this.repository) return this.repository.getHistoryByDateRange(startDate, endDate);
    const entries = await this.getHistory(MAX_ENTRIES);
    const start = new Date(startDate).getTime();
    const end = new Date(endDate).getTime();
    return entries.filter((entry) => {
      const entryTime = new Date(entry.timestamp).getTime();
      return entryTime >= start && entryTime <= end;
    });
  }

  async getDailySummary(date?: string): Promise<DailySummary> {
    if (this.repository) return this.repository.getDailySummary(date);
    const targetDate = date || this.now().toISOString().split('T')[0];
    const startOfDay = new Date(`${targetDate}T00:00:00.000Z`);
    const endOfDay = new Date(`${targetDate}T23:59:59.999Z`);
    const entries = await this.getHistoryByDateRange(
      startOfDay.toISOString(),
      endOfDay.toISOString()
    );
    const chronological = [...entries].reverse();
    let activeMs = 0;
    let idleMs = 0;
    let errorMs = 0;
    const periods: StatusPeriod[] = [];

    for (let index = 0; index < chronological.length; index++) {
      const entry = chronological[index];
      const nextEntry = chronological[index + 1];
      const endTime = nextEntry ? new Date(nextEntry.timestamp) : this.getOpenPeriodEnd(endOfDay);
      const startTime = new Date(entry.timestamp);
      const durationMs = endTime.getTime() - startTime.getTime();
      if (durationMs <= 0) continue;

      if (entry.newStatus === 'idle') idleMs += durationMs;
      else if (entry.newStatus === 'error') errorMs += durationMs;
      else activeMs += durationMs;

      periods.push({
        status: entry.newStatus,
        startTime: entry.timestamp,
        endTime: endTime.toISOString(),
        durationMs,
        taskId: entry.taskId,
        taskTitle: entry.taskTitle,
      });
    }

    if (chronological.length === 0) {
      const lastBeforeDay = (await this.getHistory(MAX_ENTRIES)).find(
        (entry) => new Date(entry.timestamp).getTime() < startOfDay.getTime()
      );
      if (lastBeforeDay) {
        const effectiveEnd = this.getOpenPeriodEnd(endOfDay);
        const durationMs = effectiveEnd.getTime() - startOfDay.getTime();
        if (durationMs > 0) {
          if (lastBeforeDay.newStatus === 'idle') idleMs = durationMs;
          else if (lastBeforeDay.newStatus === 'error') errorMs = durationMs;
          else activeMs = durationMs;
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
    if (this.repository) return this.repository.getWeeklySummary();
    const summaries: DailySummary[] = [];
    const today = this.now();
    for (let offset = 0; offset < 7; offset++) {
      const date = new Date(today);
      date.setDate(date.getDate() - offset);
      summaries.push(await this.getDailySummary(date.toISOString().split('T')[0]));
    }
    return summaries;
  }

  async clearHistory(): Promise<void> {
    if (this.repository) await this.repository.clearHistory();
    else await this.getFileStore().clear();
    this.lastEntry = null;
  }

  dispose(): void {
    if (this.ownsSqliteDatabase) this.sqliteDatabase?.close();
    this.sqliteDatabase = null;
    this.lastEntry = null;
  }

  private getFileStore(): FileStatusHistoryStore {
    if (!this.fileStore) throw new Error('File status history store is unavailable');
    return this.fileStore;
  }

  private getOpenPeriodEnd(endOfDay: Date): Date {
    const now = this.now();
    return now < endOfDay ? now : endOfDay;
  }

  private logChange(
    previousStatus: AgentStatusState,
    newStatus: AgentStatusState,
    taskId?: string
  ): void {
    log.info(
      `[StatusHistory] ${previousStatus} → ${newStatus}${taskId ? ` (task: ${taskId})` : ''}`
    );
  }
}

export const statusHistoryService = new StatusHistoryService();
