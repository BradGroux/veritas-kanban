import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@veritas-kanban/shared';
import { Command } from 'commander';
const { mockApi } = vi.hoisted(() => ({ mockApi: vi.fn() }));
vi.mock('../utils/api.js', () => ({ api: mockApi }));
import { registerTaskCommands } from '../commands/tasks.js';

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
async function execute(command: string, id: string) {
  const program = new Command();
  program.exitOverride();
  registerTaskCommands(program);
  await program.parseAsync(
    [command, id, ...(command === 'update' ? ['--title', 'Updated'] : []), '--json'],
    { from: 'user' }
  );
}

describe('task mutation identifier resolution', () => {
  beforeEach(() => {
    mockApi.mockReset();
    mockApi.mockImplementation(async (path, options) =>
      options?.method ? task(path.split('/')[3]) : tasks
    );
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('CLI exit');
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it('writes structured API error metadata for JSON commands', async () => {
    mockApi.mockRejectedValue(
      new ApiError('Conflict', { status: 409, code: 'CONFLICT', details: { currentRevision: 4 } })
    );
    await expect(execute('update', 'task_target_abc')).rejects.toThrow('CLI exit');
    const output = vi.mocked(console.error).mock.calls.at(-1)?.[0];
    expect(JSON.parse(output)).toEqual({
      error: {
        message: 'HTTP 409 [CONFLICT] Conflict',
        status: 409,
        code: 'CONFLICT',
        details: { currentRevision: 4 },
      },
    });
    expect(mockApi).toHaveBeenCalledOnce();
  });

  for (const command of ['update', 'archive', 'delete']) {
    it(`${command} rejects blank and ambiguous IDs without a write`, async () => {
      for (const id of ['', '   ', 'abc']) {
        mockApi.mockClear();
        await expect(execute(command, id)).rejects.toThrow('CLI exit');
        expect(mockApi.mock.calls.filter(([, options]) => options?.method)).toEqual([]);
        if (!id.trim()) expect(mockApi).not.toHaveBeenCalled();
      }
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('Ambiguous task identifier')
      );
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('task_target_abc'));
    });

    it(`${command} prefers exact IDs and supports unique suffixes`, async () => {
      for (const [id, expected] of [
        ['task_target_abc', 'task_target_abc'],
        ['unique', 'task_unique'],
      ]) {
        mockApi.mockClear();
        await execute(command, id);
        const writes = mockApi.mock.calls.filter(([, options]) => options?.method);
        expect(writes).toHaveLength(1);
        expect(writes[0][0]).toBe(
          `/api/tasks/${expected}${command === 'archive' ? '/archive' : ''}`
        );
      }
    });

    it(`${command} reports a missing task without a write`, async () => {
      await expect(execute(command, 'missing')).rejects.toThrow('CLI exit');
      expect(mockApi.mock.calls.filter(([, options]) => options?.method)).toEqual([]);
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Task not found'));
    });
  }
});
