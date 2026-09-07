import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Task } from '@veritas-kanban/shared';
import {
  RunRecoveryCoordinator,
  type RecoveryPendingRun,
  type RunRecoveryHost,
} from '../services/run-recovery-coordinator.js';

function coordinator() {
  const task = {
    id: 'recovery-owner-task',
    attempt: {
      id: 'parent',
      status: 'failed',
      runRetry: { state: 'scheduled', notBefore: new Date(Date.now() + 1000).toISOString() },
    },
  } as Task;
  const getTask = vi.fn(async () => null);
  const host = {
    tasks: { listTasks: async () => [task], getTask },
  } as unknown as RunRecoveryHost<RecoveryPendingRun>;
  return { recovery: new RunRecoveryCoordinator(host), getTask };
}
afterEach(() => vi.useRealTimers());
describe('recovery coordinator ownership', () => {
  it('keeps timers scoped to their owner and cancels only that owner on disposal', async () => {
    vi.useFakeTimers();
    const first = coordinator();
    const second = coordinator();
    await first.recovery.reconcilePendingRecoveries();
    await second.recovery.reconcilePendingRecoveries();
    first.recovery.dispose();
    await vi.advanceTimersByTimeAsync(1000);
    expect(first.getTask).not.toHaveBeenCalled();
    expect(second.getTask).toHaveBeenCalledExactlyOnceWith('recovery-owner-task');
    second.recovery.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });
});
