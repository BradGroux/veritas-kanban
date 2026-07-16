import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';

const { mockApi, mockFindTask } = vi.hoisted(() => ({
  mockApi: vi.fn(),
  mockFindTask: vi.fn(),
}));

vi.mock('../utils/api.js', () => ({ api: mockApi }));
vi.mock('../utils/find.js', () => ({ findTask: mockFindTask }));

import { registerAgentCommands } from '../commands/agents.js';

describe('vk agent runtime capability controls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindTask.mockResolvedValue({
      id: 'task_1',
      type: 'code',
      git: { worktreePath: '/tmp/task_1' },
    });
    mockApi.mockImplementation(async (url: string) =>
      url.endsWith('/status')
        ? { running: true, attemptId: 'attempt_1' }
        : { attemptId: 'attempt_1' }
    );
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  it('forwards required runtime capabilities to the launch API', async () => {
    const program = new Command();
    program.exitOverride();
    registerAgentCommands(program);

    await program.parseAsync(
      [
        'start',
        'task_1',
        '--agent',
        'codex',
        '--require-capability',
        'tool.mcp',
        'output.structured',
        '--json',
      ],
      { from: 'user' }
    );

    expect(mockApi).toHaveBeenCalledWith('/api/agents/task_1/start', {
      method: 'POST',
      body: JSON.stringify({
        agent: 'codex',
        profileId: undefined,
        requiredRuntimeCapabilities: ['tool.mcp', 'output.structured'],
      }),
    });
  });

  it('surfaces authoritative fail-closed stop errors from the API', async () => {
    mockApi
      .mockResolvedValueOnce({ running: true, attemptId: 'attempt_1' })
      .mockRejectedValueOnce(
        new Error('Provider runtime does not support stop run: run.stop is unsupported.')
      );
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((
      _code?: number | string | null
    ) => {
      throw new Error('process.exit called');
    }) as typeof process.exit);
    const program = new Command();
    program.exitOverride();
    registerAgentCommands(program);

    try {
      await expect(program.parseAsync(['stop', 'task_1'], { from: 'user' })).rejects.toThrow(
        'process.exit called'
      );
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('run.stop is unsupported'));
      expect(exitSpy).toHaveBeenCalledWith(1);
    } finally {
      errorSpy.mockRestore();
      exitSpy.mockRestore();
    }
  });

  it('binds stop requests to the attempt returned by status', async () => {
    const program = new Command();
    program.exitOverride();
    registerAgentCommands(program);

    await program.parseAsync(['stop', 'task_1', '--json'], { from: 'user' });

    expect(mockApi).toHaveBeenNthCalledWith(1, '/api/agents/task_1/status');
    expect(mockApi).toHaveBeenNthCalledWith(2, '/api/agents/task_1/stop', {
      method: 'POST',
      body: JSON.stringify({ attemptId: 'attempt_1' }),
    });
  });

  it('forwards attempt and manifest provenance when completing a run', async () => {
    const program = new Command();
    program.exitOverride();
    registerAgentCommands(program);
    const digest = `sha256:${'a'.repeat(64)}`;

    await program.parseAsync(
      [
        'agents:complete',
        'task_1',
        '--attempt-id',
        'attempt_1',
        '--manifest-digest',
        digest,
        '--summary',
        'Done',
      ],
      { from: 'user' }
    );

    expect(mockApi).toHaveBeenCalledWith('/api/agents/task_1/complete', {
      method: 'POST',
      body: JSON.stringify({
        attemptId: 'attempt_1',
        providerRuntimeManifestDigest: digest,
        success: true,
        summary: 'Done',
        error: undefined,
      }),
    });
  });
});
