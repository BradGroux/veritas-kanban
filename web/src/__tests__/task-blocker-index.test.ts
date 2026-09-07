import { describe, expect, it, vi } from 'vitest';
import { getTaskBlockers, isTaskBlocked } from '@/hooks/useTasks';
import { createMockTask } from './test-utils';

describe('board dependency index', () => {
  it('looks up only referenced IDs, deduplicates references and ignores completed/missing tasks', () => {
    const blocker = createMockTask({ id: 'blocker', status: 'todo' });
    const complete = createMockTask({ id: 'complete', status: 'done' });
    const unrelated = Array.from({ length: 5000 }, (_, i) => createMockTask({ id: `other-${i}` }));
    const index = new Map([blocker, complete, ...unrelated].map((task) => [task.id, task]));
    const get = vi.spyOn(index, 'get');
    const task = createMockTask({ blockedBy: ['blocker', 'blocker', 'complete', 'missing'] });
    expect(getTaskBlockers(task, index)).toEqual([blocker]);
    expect(get).toHaveBeenCalledTimes(3);
    expect(isTaskBlocked(task, index)).toBe(true);
  });

  it('retains blockers excluded by board filters and matches legacy array callers', () => {
    const task = createMockTask({ id: 'visible', blockedBy: ['hidden'] });
    const hidden = createMockTask({
      id: 'hidden',
      title: 'Excluded by title filter',
      status: 'blocked',
    });
    const allTasks = [task, hidden];
    expect(getTaskBlockers(task, new Map(allTasks.map((value) => [value.id, value])))).toEqual(
      getTaskBlockers(task, allTasks)
    );
    expect(getTaskBlockers(createMockTask(), new Map())).toEqual([]);
  });
});
