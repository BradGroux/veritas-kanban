/**
 * Circuit Breaker Tests
 * Tests state transitions, failure tracking, and recovery logic.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CircuitBreaker, CircuitOpenError } from '../services/circuit-breaker.js';

vi.mock('../lib/logger.js', () => ({
  createLogger: () => ({
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

const ok = () => Promise.resolve('ok');
const fail = () => Promise.reject(new Error('service error'));

describe('CircuitBreaker', () => {
  let cb: CircuitBreaker;

  beforeEach(() => {
    cb = new CircuitBreaker({
      name: 'test',
      failureThreshold: 3,
      resetTimeout: 100,
      monitorWindow: 5000,
    });
  });

  describe('closed state', () => {
    it('starts in closed state', () => {
      expect(cb.state).toBe('closed');
    });

    it('passes successful calls through', async () => {
      const result = await cb.execute(ok);
      expect(result).toBe('ok');
      expect(cb.state).toBe('closed');
    });

    it('propagates errors from wrapped fn without opening', async () => {
      await expect(cb.execute(fail)).rejects.toThrow('service error');
      expect(cb.state).toBe('closed');
    });

    it('stays closed below the failure threshold', async () => {
      for (let i = 0; i < 2; i++) await cb.execute(fail).catch(() => {});
      expect(cb.state).toBe('closed');
    });

    it('opens after reaching failure threshold', async () => {
      for (let i = 0; i < 3; i++) await cb.execute(fail).catch(() => {});
      expect(cb.state).toBe('open');
    });
  });

  describe('open state', () => {
    async function trip() {
      for (let i = 0; i < 3; i++) await cb.execute(fail).catch(() => {});
    }

    it('throws CircuitOpenError immediately when open', async () => {
      await trip();
      await expect(cb.execute(ok)).rejects.toBeInstanceOf(CircuitOpenError);
    });

    it('CircuitOpenError has the correct circuit name', async () => {
      await trip();
      const err = await cb.execute(ok).catch((e) => e);
      expect(err.circuitName).toBe('test');
    });

    it('does not call the wrapped fn while open', async () => {
      await trip();
      const spy = vi.fn().mockResolvedValue('nope');
      await cb.execute(spy).catch(() => {});
      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe('half-open state', () => {
    async function tripAndWait() {
      for (let i = 0; i < 3; i++) await cb.execute(fail).catch(() => {});
      await new Promise((r) => setTimeout(r, 110));
    }

    it('transitions to half-open after reset timeout elapses', async () => {
      await tripAndWait();
      expect(cb.state).toBe('half-open');
    });

    it('closes circuit on a successful probe', async () => {
      await tripAndWait();
      await cb.execute(ok);
      expect(cb.state).toBe('closed');
    });

    it('re-opens circuit on a failed probe', async () => {
      await tripAndWait();
      await cb.execute(fail).catch(() => {});
      expect(cb.state).toBe('open');
    });

    it('rejects a second concurrent request in half-open', async () => {
      await tripAndWait();
      let resolveFirst!: () => void;
      const first = cb.execute(
        () =>
          new Promise<string>((res) => {
            resolveFirst = () => res('ok');
          })
      );
      await expect(cb.execute(ok)).rejects.toBeInstanceOf(CircuitOpenError);
      resolveFirst();
      await first;
    });
  });

  describe('reset()', () => {
    it('resets an open circuit back to closed', async () => {
      for (let i = 0; i < 3; i++) await cb.execute(fail).catch(() => {});
      cb.reset();
      expect(cb.state).toBe('closed');
    });

    it('clears failure history after reset', async () => {
      for (let i = 0; i < 2; i++) await cb.execute(fail).catch(() => {});
      cb.reset();
      for (let i = 0; i < 2; i++) await cb.execute(fail).catch(() => {});
      expect(cb.state).toBe('closed');
    });
  });

  describe('getStatus()', () => {
    it('returns closed/zero initially', () => {
      const s = cb.getStatus();
      expect(s.state).toBe('closed');
      expect(s.failures).toBe(0);
      expect(s.lastFailure).toBeNull();
      expect(s.nextAttempt).toBeNull();
    });

    it('reports failure count', async () => {
      await cb.execute(fail).catch(() => {});
      expect(cb.getStatus().failures).toBe(1);
    });

    it('reports nextAttempt when open', async () => {
      for (let i = 0; i < 3; i++) await cb.execute(fail).catch(() => {});
      const s = cb.getStatus();
      expect(s.state).toBe('open');
      expect(s.nextAttempt).not.toBeNull();
    });
  });

  describe('sliding monitor window', () => {
    it('evicts old failures outside the window', async () => {
      const shortCb = new CircuitBreaker({
        name: 'short-window',
        failureThreshold: 3,
        resetTimeout: 5000,
        monitorWindow: 50,
      });
      for (let i = 0; i < 2; i++) await shortCb.execute(fail).catch(() => {});
      await new Promise((r) => setTimeout(r, 60));
      for (let i = 0; i < 2; i++) await shortCb.execute(fail).catch(() => {});
      expect(shortCb.state).toBe('closed');
    });
  });
});
