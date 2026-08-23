/**
 * StatusHistoryService Tests
 * Tests status logging and daily summary generation.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { StatusHistoryService } from '../services/status-history-service.js';

describe('StatusHistoryService', () => {
  let service: StatusHistoryService;
  let testDir: string;
  let historyFile: string;

  beforeEach(async () => {
    const suffix = Math.random().toString(36).substring(7);
    testDir = path.join(os.tmpdir(), `veritas-test-status-history-${suffix}`);
    const configDir = path.join(testDir, '.veritas-kanban');
    await fs.mkdir(configDir, { recursive: true });
    historyFile = path.join(configDir, 'status-history.json');

    service = new StatusHistoryService({ historyFile });
  });

  afterEach(async () => {
    if (testDir) {
      await fs.rm(testDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  describe('getHistory', () => {
    it('should return empty array when no history exists', async () => {
      const history = await service.getHistory();
      expect(history).toEqual([]);
    });

    it('should return entries when history file exists', async () => {
      const entries = [
        {
          id: 'status_1',
          timestamp: new Date().toISOString(),
          previousStatus: 'idle',
          newStatus: 'working',
        },
        {
          id: 'status_2',
          timestamp: new Date().toISOString(),
          previousStatus: 'working',
          newStatus: 'idle',
        },
      ];
      await fs.writeFile(historyFile, JSON.stringify(entries), 'utf-8');

      const history = await service.getHistory();
      expect(history).toHaveLength(2);
    });

    it('should respect limit and offset', async () => {
      const entries = Array.from({ length: 10 }, (_, i) => ({
        id: `status_${i}`,
        timestamp: new Date().toISOString(),
        previousStatus: 'idle',
        newStatus: 'working',
      }));
      await fs.writeFile(historyFile, JSON.stringify(entries), 'utf-8');

      const limited = await service.getHistory(3, 2);
      expect(limited).toHaveLength(3);
      expect(limited[0].id).toBe('status_2');
    });
  });

  describe('logStatusChange', () => {
    it('should log a status change and return the entry', async () => {
      const entry = await service.logStatusChange('idle', 'working', 'task_123', 'Test Task');

      expect(entry.previousStatus).toBe('idle');
      expect(entry.newStatus).toBe('working');
      expect(entry.taskId).toBe('task_123');
      expect(entry.taskTitle).toBe('Test Task');
      expect(entry.id).toMatch(/^status_/);
      expect(entry.timestamp).toBeDefined();
    });

    it('should persist entries to file', async () => {
      await service.logStatusChange('idle', 'working');
      await service.logStatusChange('working', 'idle');

      const history = await service.getHistory();
      expect(history).toHaveLength(2);
      // Most recent first (prepended)
      expect(history[0].newStatus).toBe('idle');
      expect(history[1].newStatus).toBe('working');
    });

    it('should calculate duration from previous entry', async () => {
      let nowMs = Date.parse('2026-08-23T15:00:00.000Z');
      service = new StatusHistoryService({ historyFile, now: () => new Date(nowMs) });
      await service.logStatusChange('idle', 'working');
      nowMs += 50;
      const second = await service.logStatusChange('working', 'idle');
      expect(second.durationMs).toBe(50);
    });

    it('should include subAgentCount when provided', async () => {
      const entry = await service.logStatusChange('idle', 'sub-agent', undefined, undefined, 3);
      expect(entry.subAgentCount).toBe(3);
    });
  });

  describe('getHistoryByDateRange', () => {
    it('should filter entries by date range', async () => {
      const entries = [
        {
          id: 'status_1',
          timestamp: '2024-06-15T10:00:00.000Z',
          previousStatus: 'idle',
          newStatus: 'working',
        },
        {
          id: 'status_2',
          timestamp: '2024-06-16T10:00:00.000Z',
          previousStatus: 'working',
          newStatus: 'idle',
        },
        {
          id: 'status_3',
          timestamp: '2024-06-17T10:00:00.000Z',
          previousStatus: 'idle',
          newStatus: 'working',
        },
      ];
      await fs.writeFile(historyFile, JSON.stringify(entries), 'utf-8');

      const filtered = await service.getHistoryByDateRange(
        '2024-06-16T00:00:00.000Z',
        '2024-06-16T23:59:59.999Z'
      );
      expect(filtered).toHaveLength(1);
      expect(filtered[0].id).toBe('status_2');
    });
  });

  describe('clearHistory', () => {
    it('should clear all history', async () => {
      await service.logStatusChange('idle', 'working');
      await service.logStatusChange('working', 'idle');

      await service.clearHistory();

      const history = await service.getHistory();
      expect(history).toEqual([]);
    });
  });

  describe('getDailySummary', () => {
    it('should return zero summary for no entries on given date', async () => {
      const summary = await service.getDailySummary('2024-01-01');
      expect(summary.date).toBe('2024-01-01');
      expect(summary.transitions).toBe(0);
      expect(summary.periods).toHaveLength(0);
    });

    it('should calculate active, idle, and error time', async () => {
      // Entries are stored most-recent-first (as logStatusChange does)
      const entries = [
        {
          id: 'status_4',
          timestamp: '2024-06-15T11:30:00.000Z',
          previousStatus: 'error',
          newStatus: 'idle',
        },
        {
          id: 'status_3',
          timestamp: '2024-06-15T11:00:00.000Z',
          previousStatus: 'idle',
          newStatus: 'error',
        },
        {
          id: 'status_2',
          timestamp: '2024-06-15T10:00:00.000Z',
          previousStatus: 'working',
          newStatus: 'idle',
        },
        {
          id: 'status_1',
          timestamp: '2024-06-15T09:00:00.000Z',
          previousStatus: 'idle',
          newStatus: 'working',
        },
      ];
      await fs.writeFile(historyFile, JSON.stringify(entries), 'utf-8');

      const summary = await service.getDailySummary('2024-06-15');
      expect(summary.date).toBe('2024-06-15');
      expect(summary.transitions).toBe(4);
      // working from 09:00-10:00 = 1h active
      expect(summary.activeMs).toBeGreaterThan(0);
      // idle from 10:00-11:00 = 1h idle
      expect(summary.idleMs).toBeGreaterThan(0);
      // error from 11:00-11:30 = 30m error
      expect(summary.errorMs).toBeGreaterThan(0);
    });
  });
});
