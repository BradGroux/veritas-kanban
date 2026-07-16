import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';

const { mockApi, mockFindTask } = vi.hoisted(() => ({
  mockApi: vi.fn(),
  mockFindTask: vi.fn(),
}));

vi.mock('../utils/api.js', () => ({ api: mockApi }));
vi.mock('../utils/find.js', () => ({ findTask: mockFindTask }));

import { registerTaskCommands } from '../commands/tasks.js';

describe('vk task execution policy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApi.mockResolvedValue({
      id: 'task_1',
      title: 'Policy task',
      type: 'code',
      status: 'todo',
      priority: 'medium',
      created: '2026-07-16T00:00:00.000Z',
      updated: '2026-07-16T00:00:00.000Z',
    });
    mockFindTask.mockResolvedValue({ id: 'task_1' });
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  it('forwards a task commit policy on create', async () => {
    const program = new Command();
    program.exitOverride();
    registerTaskCommands(program);

    await program.parseAsync(['create', 'Policy task', '--commit-policy', 'forbidden', '--json'], {
      from: 'user',
    });

    expect(mockApi).toHaveBeenCalledWith('/api/tasks', {
      method: 'POST',
      body: JSON.stringify({
        title: 'Policy task',
        type: 'code',
        description: '',
        priority: 'medium',
        executionPolicy: { commitPolicy: 'forbidden' },
      }),
    });
  });

  it('forwards a task commit policy on update', async () => {
    const program = new Command();
    program.exitOverride();
    registerTaskCommands(program);

    await program.parseAsync(['update', 'task_1', '--commit-policy', 'required', '--json'], {
      from: 'user',
    });

    expect(mockApi).toHaveBeenCalledWith('/api/tasks/task_1', {
      method: 'PATCH',
      body: JSON.stringify({ executionPolicy: { commitPolicy: 'required' } }),
    });
  });
});
