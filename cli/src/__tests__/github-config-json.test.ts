import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
const mocks = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('../utils/api.js', () => ({ api: mocks.api }));
import { registerGitHubCommands } from '../commands/github.js';
const config = {
  enabled: false,
  repo: 'fixture/repo',
  syncMode: 'inbound',
  labelFilter: 'fixture-label',
  pollIntervalMs: 500,
};
let output: MockInstance<typeof console.log>;
beforeEach(() => {
  mocks.api.mockReset();
  mocks.api.mockResolvedValue(config);
  output = vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});
async function run(args: string[]) {
  const program = new Command().exitOverride();
  registerGitHubCommands(program);
  await program.parseAsync(['node', 'vk', 'github', 'config', ...args]);
}
const updates = [
  { args: ['--enable'], patch: { enabled: true } },
  { args: ['--disable'], patch: { enabled: false } },
  { args: ['--repo', 'fixture/other'], patch: { repo: 'fixture/other' } },
  { args: ['--label', 'ready'], patch: { labelFilter: 'ready' } },
  { args: ['--mode', 'outbound'], patch: { syncMode: 'outbound' } },
  { args: ['--interval', '1000'], patch: { pollIntervalMs: 1000 } },
];
describe('GitHub config stdout contract', () => {
  it('prints a single JSON value for a read', async () => {
    await run(['--json']);
    expect(output).toHaveBeenCalledTimes(1);
    expect(JSON.parse(output.mock.calls.map((args) => String(args[0])).join('\n'))).toEqual(config);
    expect(mocks.api).toHaveBeenCalledWith('/api/github/sync/config');
  });
  it.each(updates)('prints only response JSON after $args', async ({ args, patch }) => {
    await run([...args, '--json']);
    expect(output).toHaveBeenCalledTimes(1);
    expect(JSON.parse(output.mock.calls.map((call) => String(call[0])).join('\n'))).toEqual(config);
    expect(mocks.api).toHaveBeenCalledExactlyOnceWith('/api/github/sync/config', {
      method: 'PUT',
      body: JSON.stringify(patch),
      headers: { 'Content-Type': 'application/json' },
    });
  });
  it('preserves all update flags together without a JSON prefix', async () => {
    await run([...updates.flatMap(({ args }) => args), '--json']);
    expect(JSON.parse(output.mock.calls.map((call) => String(call[0])).join('\n'))).toEqual(config);
    expect(mocks.api).toHaveBeenCalledExactlyOnceWith('/api/github/sync/config', {
      method: 'PUT',
      body: JSON.stringify({
        enabled: false,
        repo: 'fixture/other',
        labelFilter: 'ready',
        syncMode: 'outbound',
        pollIntervalMs: 1000,
      }),
      headers: { 'Content-Type': 'application/json' },
    });
  });
  it('retains the acknowledgement and formatted configuration in human mode', async () => {
    await run(['--disable']);
    const stdout = output.mock.calls.map((call) => String(call[0])).join('\n');
    expect(stdout).toContain('Configuration updated');
    expect(stdout).toContain('GitHub Sync Configuration');
    expect(stdout).toContain('fixture/repo');
  });
});
