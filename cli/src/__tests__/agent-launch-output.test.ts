import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentQueueStatus } from '@veritas-kanban/shared';
const { api, findTask } = vi.hoisted(() => ({ api: vi.fn(), findTask: vi.fn() }));
vi.mock('../utils/api.js', () => ({ api }));
vi.mock('../utils/find.js', () => ({ findTask }));
import { registerAgentCommands } from '../commands/agents.js';

const queued: AgentQueueStatus = {
  taskId: 'task_fixture',
  attemptId: 'attempt_fixture',
  agent: 'codex',
  status: 'queued',
  queueId: 'queue_fixture',
  enqueuedAt: '2026-10-23T00:00:00.000Z',
  retryAfterMs: 1_000,
  limitingScopes: [{ scope: 'provider', scopeId: 'codex-cli' }],
};
const running = {
  taskId: queued.taskId,
  attemptId: queued.attemptId,
  agent: 'codex',
  status: 'running',
};
let priorExitCode: typeof process.exitCode;
beforeEach(() => {
  vi.clearAllMocks();
  priorExitCode = process.exitCode;
  findTask.mockResolvedValue({
    id: queued.taskId,
    type: 'code',
    git: { worktreePath: '/fixture/worktree' },
  });
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = priorExitCode;
});
async function launch(json = false) {
  const program = new Command();
  program.exitOverride();
  registerAgentCommands(program);
  await program.parseAsync(
    ['start', queued.taskId, '--agent', 'codex', ...(json ? ['--json'] : [])],
    { from: 'user' }
  );
}
function output() {
  return vi
    .mocked(console.log)
    .mock.calls.map(([text]) => text)
    .join('\n');
}

describe('CLI admission launch output', () => {
  it('reports durable queue ownership and safe hints without claiming execution', async () => {
    api.mockResolvedValue(queued);
    await launch();
    expect(output()).toContain('Status: queued');
    expect(output()).toContain('Queue ID: queue_fixture');
    expect(output()).toContain('Attempt ID: attempt_fixture');
    expect(output()).toContain('Retry after: 1000 ms');
    expect(output()).toContain('provider:codex-cli');
    expect(output()).toContain('Do not resubmit');
    expect(output()).not.toMatch(/started|Working in:/i);
    expect(api).toHaveBeenCalledTimes(1);
    expect(process.exitCode).toBe(priorExitCode);
  });
  it.each([queued, running])('preserves the full $status response in JSON', async (result) => {
    api.mockResolvedValue(result);
    await launch(true);
    expect(JSON.parse(output())).toEqual(result);
    expect(api).toHaveBeenCalledTimes(1);
  });
  it('retains admitted attempt identity and working directory', async () => {
    api.mockResolvedValue(running);
    await launch();
    expect(output()).toContain('Agent started: codex');
    expect(output()).toContain('Status: running');
    expect(output()).toContain('Attempt ID: attempt_fixture');
    expect(output()).toContain('Working in: /fixture/worktree');
    expect(output()).not.toContain('Queue ID:');
  });
  it.each(['pending', 'complete', 'failed'])(
    'reports an immediate %s result accurately',
    async (status) => {
      api.mockResolvedValue({ ...running, status });
      await launch();
      expect(output()).toContain(`Status: ${status}`);
      expect(output()).not.toContain('Agent started:');
      expect(process.exitCode).toBe(status === 'failed' ? 1 : priorExitCode);
    }
  );
  it('retains failed JSON evidence and a failing exit code', async () => {
    const result = { ...running, status: 'failed' };
    api.mockResolvedValue(result);
    await launch(true);
    expect(JSON.parse(output())).toEqual(result);
    expect(process.exitCode).toBe(1);
  });
  it('reports launch rejection without another submission', async () => {
    api.mockRejectedValue(new Error('Admission queue is full.'));
    vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('fixture exit');
    }) as typeof process.exit);
    await expect(launch()).rejects.toThrow('fixture exit');
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Admission queue is full.'));
    expect(output()).not.toContain('Agent started:');
    expect(api).toHaveBeenCalledTimes(1);
  });
});
