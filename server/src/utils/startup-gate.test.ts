import { describe, expect, it, vi } from 'vitest';
import { startAfterInitialization } from './startup-gate.js';

describe('startAfterInitialization', () => {
  it('starts only after initialization resolves', async () => {
    const order: string[] = [];
    const initialize = vi.fn(async () => {
      order.push('initialize');
    });
    const start = vi.fn(() => {
      order.push('start');
    });

    await startAfterInitialization(initialize, start);

    expect(order).toEqual(['initialize', 'start']);
  });

  it('does not start when initialization fails', async () => {
    const failure = new Error('unsafe storage posture');
    const start = vi.fn();

    await expect(
      startAfterInitialization(async () => {
        throw failure;
      }, start)
    ).rejects.toBe(failure);
    expect(start).not.toHaveBeenCalled();
  });
});
