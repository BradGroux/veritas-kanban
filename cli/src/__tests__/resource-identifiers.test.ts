import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';
const { mockApi } = vi.hoisted(() => ({ mockApi: vi.fn() }));
vi.mock('../utils/api.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../utils/api.js')>()),
  api: mockApi,
}));
import { registerSprintCommands } from '../commands/sprints.js';
import { registerBacklogCommands } from '../commands/backlog.js';

async function execute(args: string[]) {
  const program = new Command().exitOverride();
  registerSprintCommands(program);
  registerBacklogCommands(program);
  await program.parseAsync(args, { from: 'user' });
}

describe('resource identifier compatibility', () => {
  beforeEach(() => {
    mockApi.mockReset();
    mockApi.mockResolvedValue({ id: 'fixture', label: 'Fixture', archived: 0 });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('CLI exit');
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it('keeps a legacy sprint name intact and preserves the force option', async () => {
    await execute(['sprint', 'delete', 'Release / October #1', '--yes', '--force']);
    expect(mockApi).toHaveBeenCalledWith('/api/sprints/Release%20%2F%20October%20%231?force=true', {
      method: 'DELETE',
    });
  });

  it('keeps a backlog identifier as one resource', async () => {
    await execute(['backlog', 'delete', 'task_fixture #1', '--yes']);
    expect(mockApi).toHaveBeenCalledWith('/api/backlog/task_fixture%20%231', { method: 'DELETE' });
  });

  it('does not dispatch non-resource identifiers', async () => {
    await expect(execute(['sprint', 'close', '..', '--yes'])).rejects.toThrow('CLI exit');
    await expect(execute(['backlog', 'delete', '.', '--yes'])).rejects.toThrow('CLI exit');
    expect(mockApi).not.toHaveBeenCalled();
  });
});
