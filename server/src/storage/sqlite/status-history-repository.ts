import type { StatusHistoryRepository } from '../interfaces.js';
import type {
  AgentStatusState,
  DailySummary,
  StatusHistoryEntry,
  StatusPeriod,
} from '../../services/status-history-service.js';
import type { SqliteDatabase } from './database.js';

const MAX_ENTRIES = 5000;

interface StatusHistoryRow {
  entry_json: string;
}

export class SqliteStatusHistoryRepository implements StatusHistoryRepository {
  constructor(private readonly database: SqliteDatabase) {}

  async getHistory(limit = 100, offset = 0): Promise<StatusHistoryEntry[]> {
    const effectiveLimit = Math.min(Math.max(limit, 1), MAX_ENTRIES);
    const effectiveOffset = Math.max(offset, 0);
    const rows = this.database
      .getConnection()
      .prepare(
        `
          SELECT entry_json
          FROM status_history
          WHERE workspace_id = 'local'
          ORDER BY datetime(created_at) DESC, id DESC
          LIMIT ? OFFSET ?
        `
      )
      .all(effectiveLimit, effectiveOffset) as unknown as StatusHistoryRow[];

    return rows.map((row) => JSON.parse(row.entry_json) as StatusHistoryEntry);
  }

  async logStatusChange(
    previousStatus: AgentStatusState,
    newStatus: AgentStatusState,
    taskId?: string,
    taskTitle?: string,
    subAgentCount?: number
  ): Promise<StatusHistoryEntry> {
    const now = new Date();
    const timestamp = now.toISOString();
    const previousEntry = await this.getLastEntry();
    const durationMs = previousEntry
      ? now.getTime() - new Date(previousEntry.timestamp).getTime()
      : undefined;

    const entry: StatusHistoryEntry = {
      id: `status_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
      timestamp,
      previousStatus,
      newStatus,
      taskId,
      taskTitle,
      subAgentCount,
      durationMs,
    };

    this.transaction(() => {
      this.database
        .getConnection()
        .prepare(
          `
            INSERT INTO status_history (
              id,
              workspace_id,
              previous_status,
              new_status,
              task_id,
              task_title,
              sub_agent_count,
              duration_ms,
              entry_json,
              created_at
            )
            VALUES (?, 'local', ?, ?, ?, ?, ?, ?, ?, ?)
          `
        )
        .run(
          entry.id,
          entry.previousStatus,
          entry.newStatus,
          entry.taskId ?? null,
          entry.taskTitle ?? null,
          entry.subAgentCount ?? null,
          entry.durationMs ?? null,
          JSON.stringify(entry),
          entry.timestamp
        );

      this.trimOldEntries();
    });

    return entry;
  }

  async getHistoryByDateRange(startDate: string, endDate: string): Promise<StatusHistoryEntry[]> {
    const rows = this.database
      .getConnection()
      .prepare(
        `
          SELECT entry_json
          FROM status_history
          WHERE workspace_id = 'local'
            AND created_at >= ?
            AND created_at <= ?
          ORDER BY datetime(created_at) DESC, id DESC
        `
      )
      .all(startDate, endDate) as unknown as StatusHistoryRow[];

    return rows.map((row) => JSON.parse(row.entry_json) as StatusHistoryEntry);
  }

  async getDailySummary(date?: string): Promise<DailySummary> {
    const targetDate = date || new Date().toISOString().split('T')[0];
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

    for (let i = 0; i < chronological.length; i++) {
      const entry = chronological[i];
      const nextEntry = chronological[i + 1];
      const endTime = nextEntry ? new Date(nextEntry.timestamp) : this.getOpenPeriodEnd(endOfDay);
      const startTime = new Date(entry.timestamp);
      const durationMs = endTime.getTime() - startTime.getTime();

      if (durationMs <= 0) {
        continue;
      }

      if (entry.newStatus === 'idle') {
        idleMs += durationMs;
      } else if (entry.newStatus === 'error') {
        errorMs += durationMs;
      } else {
        activeMs += durationMs;
      }

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
      const lastBeforeDay = await this.getLastEntryBefore(startOfDay.toISOString());
      const durationMs = this.applyCarryForwardPeriod(periods, lastBeforeDay, startOfDay, endOfDay);

      if (durationMs > 0 && lastBeforeDay) {
        if (lastBeforeDay.newStatus === 'idle') {
          idleMs = durationMs;
        } else if (lastBeforeDay.newStatus === 'error') {
          errorMs = durationMs;
        } else {
          activeMs = durationMs;
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
    const summaries: DailySummary[] = [];
    const today = new Date();

    for (let i = 0; i < 7; i++) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      summaries.push(await this.getDailySummary(date.toISOString().split('T')[0]));
    }

    return summaries;
  }

  async clearHistory(): Promise<void> {
    this.database
      .getConnection()
      .prepare("DELETE FROM status_history WHERE workspace_id = 'local'")
      .run();
  }

  private async getLastEntry(): Promise<StatusHistoryEntry | null> {
    const rows = await this.getHistory(1);
    return rows[0] ?? null;
  }

  private async getLastEntryBefore(timestamp: string): Promise<StatusHistoryEntry | null> {
    const row = this.database
      .getConnection()
      .prepare(
        `
          SELECT entry_json
          FROM status_history
          WHERE workspace_id = 'local'
            AND created_at < ?
          ORDER BY datetime(created_at) DESC, id DESC
          LIMIT 1
        `
      )
      .get(timestamp) as StatusHistoryRow | undefined;

    return row ? (JSON.parse(row.entry_json) as StatusHistoryEntry) : null;
  }

  private getOpenPeriodEnd(endOfDay: Date): Date {
    const now = new Date();
    return now < endOfDay ? now : endOfDay;
  }

  private applyCarryForwardPeriod(
    periods: StatusPeriod[],
    entry: StatusHistoryEntry | null,
    startOfDay: Date,
    endOfDay: Date
  ): number {
    if (!entry) return 0;

    const effectiveEnd = this.getOpenPeriodEnd(endOfDay);
    const durationMs = effectiveEnd.getTime() - startOfDay.getTime();
    if (durationMs <= 0) return 0;

    periods.push({
      status: entry.newStatus,
      startTime: startOfDay.toISOString(),
      endTime: effectiveEnd.toISOString(),
      durationMs,
      taskId: entry.taskId,
      taskTitle: entry.taskTitle,
    });

    return durationMs;
  }

  private trimOldEntries(): void {
    this.database
      .getConnection()
      .prepare(
        `
        DELETE FROM status_history
        WHERE id IN (
          SELECT id
          FROM status_history
          WHERE workspace_id = 'local'
          ORDER BY datetime(created_at) DESC, id DESC
          LIMIT -1 OFFSET ?
        )
      `
      )
      .run(MAX_ENTRIES);
  }

  private transaction<T>(callback: () => T): T {
    const db = this.database.getConnection();

    try {
      db.exec('BEGIN IMMEDIATE;');
      const result = callback();
      db.exec('COMMIT;');
      return result;
    } catch (error) {
      try {
        db.exec('ROLLBACK;');
      } catch {
        // Preserve the original failure.
      }
      throw error;
    }
  }
}
