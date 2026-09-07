import { beforeEach, describe, expect, it, vi } from 'vitest';
const { mockApi } = vi.hoisted(() => ({ mockApi: vi.fn() }));
vi.mock('../utils/api.js', () => ({ api: mockApi }));
import { handleTaskTool } from '../tools/tasks.js';
const task = (id: string) => ({
  id,
  title: 'Fixture',
  type: 'code',
  status: 'todo',
  priority: 'medium',
  created: '2026-09-07T00:00:00Z',
  updated: '2026-09-07T00:00:00Z',
});
const tasks = [task('task_prefix_task_target_abc'), task('task_target_abc'), task('task_unique')];

describe('task mutation identifier resolution', () => {
  beforeEach(() => {
    mockApi.mockReset();
    mockApi.mockImplementation(async (path, options) =>
      options?.method ? task(path.split('/')[3]) : tasks
    );
  });
  for (const name of ['update_task', 'archive_task', 'delete_task']) {
    it(`${name} rejects blank and ambiguous IDs without a write`, async () => {
      for (const id of ['', '   ', 'abc']) {
        mockApi.mockClear();
        await expect(
          handleTaskTool(name, { id, ...(name === 'update_task' ? { title: 'Updated' } : {}) })
        ).rejects.toThrow();
        expect(mockApi.mock.calls.filter(([, options]) => options?.method)).toEqual([]);
        if (!id.trim()) expect(mockApi).not.toHaveBeenCalled();
      }
      await expect(handleTaskTool(name, { id: 'abc' })).rejects.toThrow(
        'Ambiguous task identifier'
      );
    });
    it(`${name} prefers exact IDs and accepts unique suffixes`, async () => {
      for (const [id, expected] of [
        ['task_target_abc', 'task_target_abc'],
        ['unique', 'task_unique'],
      ]) {
        mockApi.mockClear();
        await handleTaskTool(name, { id, ...(name === 'update_task' ? { title: 'Updated' } : {}) });
        const writes = mockApi.mock.calls.filter(([, options]) => options?.method);
        expect(writes).toHaveLength(1);
        expect(writes[0][0]).toBe(
          `/api/tasks/${expected}${name === 'archive_task' ? '/archive' : ''}`
        );
      }
    });
    it(`${name} reports missing IDs without a write`, async () => {
      const result = await handleTaskTool(name, { id: 'missing' });
      expect(result.isError).toBe(true);
      expect(mockApi.mock.calls.filter(([, options]) => options?.method)).toEqual([]);
    });
  }
});
