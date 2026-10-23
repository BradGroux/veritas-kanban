/**
 * Metrics Helpers Tests
 * Tests pure utility functions used across metrics modules.
 */
import { describe, it, expect } from 'vitest';
import {
  getPeriodStart,
  getPreviousPeriodRange,
  calculateTrend,
  calculateChange,
  percentile,
  formatDurationForRecommendation,
  formatTokensForRecommendation,
} from '../services/metrics/helpers.js';

describe('Metrics Helpers', () => {
  describe('getPeriodStart', () => {
    it('should return a timestamp 24 hours ago for "24h"', () => {
      const now = Date.now();
      const start = getPeriodStart('24h');
      const startTime = new Date(start).getTime();
      // Should be roughly 24 hours ago (within 1 second tolerance)
      const expected = now - 24 * 60 * 60 * 1000;
      expect(Math.abs(startTime - expected)).toBeLessThan(1000);
    });

    it('should return a timestamp 7 days ago for "7d"', () => {
      const now = Date.now();
      const start = getPeriodStart('7d');
      const startTime = new Date(start).getTime();
      const expected = now - 7 * 24 * 60 * 60 * 1000;
      expect(Math.abs(startTime - expected)).toBeLessThan(1000);
    });

    it('should return a timestamp 30 days ago for "30d"', () => {
      const now = Date.now();
      const start = getPeriodStart('30d');
      const startTime = new Date(start).getTime();
      const expected = now - 30 * 24 * 60 * 60 * 1000;
      expect(Math.abs(startTime - expected)).toBeLessThan(1000);
    });

    it('should return a valid ISO string', () => {
      const start = getPeriodStart('24h');
      expect(() => new Date(start)).not.toThrow();
      expect(start).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
  });

  describe('getPreviousPeriodRange', () => {
    it('should return a range before the current period for "24h"', () => {
      const range = getPreviousPeriodRange('24h');
      const since = new Date(range.since).getTime();
      const until = new Date(range.until).getTime();

      // Until should be ~24h ago
      const now = Date.now();
      expect(Math.abs(until - (now - 24 * 60 * 60 * 1000))).toBeLessThan(1000);
      // Since should be ~48h ago
      expect(Math.abs(since - (now - 48 * 60 * 60 * 1000))).toBeLessThan(1000);
    });

    it('should return a range before the current period for "7d"', () => {
      const range = getPreviousPeriodRange('7d');
      const since = new Date(range.since).getTime();
      const until = new Date(range.until).getTime();

      const now = Date.now();
      const weekMs = 7 * 24 * 60 * 60 * 1000;
      expect(Math.abs(until - (now - weekMs))).toBeLessThan(1000);
      expect(Math.abs(since - (now - 2 * weekMs))).toBeLessThan(1000);
    });

    it('should return valid ISO strings', () => {
      const range = getPreviousPeriodRange('30d');
      expect(() => new Date(range.since)).not.toThrow();
      expect(() => new Date(range.until)).not.toThrow();
    });
  });

  describe('calculateTrend', () => {
    it('should return "up" when current is higher and higher is better', () => {
      expect(calculateTrend(100, 50, true)).toBe('up');
    });

    it('should return "down" when current is lower and higher is better', () => {
      expect(calculateTrend(50, 100, true)).toBe('down');
    });

    it('should return "flat" when change is less than 5%', () => {
      expect(calculateTrend(100, 98, true)).toBe('flat');
      expect(calculateTrend(100, 102, true)).toBe('flat');
    });

    it('should invert logic when higher is NOT better', () => {
      // Lower is better (e.g., duration) — current > previous should be "down" (worse)
      expect(calculateTrend(100, 50, false)).toBe('down');
      // Lower is better — current < previous should be "up" (better)
      expect(calculateTrend(50, 100, false)).toBe('up');
    });

    it('should handle zero previous value', () => {
      expect(calculateTrend(10, 0)).toBe('up');
      expect(calculateTrend(0, 0)).toBe('flat');
    });
  });

  describe('calculateChange', () => {
    it('should return percentage change', () => {
      expect(calculateChange(150, 100)).toBe(50);
      expect(calculateChange(50, 100)).toBe(-50);
    });

    it('should return 100 when previous is 0 and current > 0', () => {
      expect(calculateChange(10, 0)).toBe(100);
    });

    it('should return 0 when both are 0', () => {
      expect(calculateChange(0, 0)).toBe(0);
    });

    it('should round to nearest integer', () => {
      expect(calculateChange(133, 100)).toBe(33);
    });
  });

  describe('percentile', () => {
    it('should return 0 for empty array', () => {
      expect(percentile([], 50)).toBe(0);
    });

    it('should return the only element for single-element array', () => {
      expect(percentile([42], 50)).toBe(42);
      expect(percentile([42], 95)).toBe(42);
    });

    it('should calculate p50 (median) correctly', () => {
      const sorted = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      const p50 = percentile(sorted, 50);
      expect(p50).toBe(5);
    });

    it('should calculate p95 correctly', () => {
      const sorted = Array.from({ length: 100 }, (_, i) => i + 1);
      const p95 = percentile(sorted, 95);
      expect(p95).toBe(95);
    });
  });

  describe('formatDurationForRecommendation', () => {
    it('should format milliseconds as seconds', () => {
      expect(formatDurationForRecommendation(5000)).toBe('5s');
      expect(formatDurationForRecommendation(30000)).toBe('30s');
    });

    it('should format milliseconds as minutes', () => {
      expect(formatDurationForRecommendation(60000)).toBe('1m');
      expect(formatDurationForRecommendation(120000)).toBe('2m');
      expect(formatDurationForRecommendation(300000)).toBe('5m');
    });

    it('should format milliseconds as hours', () => {
      expect(formatDurationForRecommendation(3600000)).toBe('1.0h');
      expect(formatDurationForRecommendation(7200000)).toBe('2.0h');
    });
  });

  describe('formatTokensForRecommendation', () => {
    it('should format small numbers as-is', () => {
      expect(formatTokensForRecommendation(500)).toBe('500');
      expect(formatTokensForRecommendation(999)).toBe('999');
    });

    it('should format thousands with K suffix', () => {
      expect(formatTokensForRecommendation(1000)).toBe('1.0K');
      expect(formatTokensForRecommendation(5500)).toBe('5.5K');
    });

    it('should format millions with M suffix', () => {
      expect(formatTokensForRecommendation(1000000)).toBe('1.00M');
      expect(formatTokensForRecommendation(2500000)).toBe('2.50M');
    });
  });
});
