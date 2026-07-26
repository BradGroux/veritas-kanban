import { mkdtemp, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { RunEventAppendInput, RunTerminalExecuteRequest } from '@veritas-kanban/shared';
import {
  RunTerminalService,
  type RunTerminalLaunchContext,
} from '../services/run-terminal-service.js';

const launchManifestDigest = `sha256:${'a'.repeat(64)}`;

async function fixture(options: {
  outputLimitBytes?: number;
  maximumOutputBytes?: number;
  chunkLimitBytes?: number;
  terminationGraceMs?: number;
} = {}) {
  const worktreeRoot = await mkdtemp(path.join(os.tmpdir(), 'vk-run-terminal-'));
  const events: RunEventAppendInput[] = [];
  const service = new RunTerminalService({
    ...options,
    journal: {
      append: async (event) => {
        events.push(event);
        return {} as never;
      },
    },
  });
  const context: RunTerminalLaunchContext = {
    workspaceId: 'workspace_1',
    taskId: 'task_871',
    attemptId: 'attempt_871',
    launchManifestDigest,
    worktreeRoot,
    environment: {},
    allowedCommands: [process.execPath],
  };
  return { service, context, events };
}

function request(script: string): RunTerminalExecuteRequest {
  return {
    command: process.execPath,
    args: ['-e', script],
    mode: 'pipe',
    startMode: 'background',
    environmentKeys: [],
  };
}

describe('RunTerminalService', () => {
  it('executes a pipe command and returns cursor-addressable output', async () => {
    const { service, context, events } = await fixture();
    const started = await service.execute(
      context,
      request('process.stdout.write("hello from terminal")')
    );

    expect(started).toMatchObject({
      schemaVersion: 'run-terminal-handle/v1',
      taskId: context.taskId,
      attemptId: context.attemptId,
      mode: 'pipe',
      startMode: 'background',
    });
    expect(await service.wait(started.id, 5_000)).toMatchObject({
      completed: true,
      timedOut: false,
      handle: { state: 'exited', exitCode: 0 },
    });
    expect(service.output(started.id)).toMatchObject({
      schemaVersion: 'run-terminal-output/v1',
      gap: false,
      chunks: [{ cursor: 1, stream: 'stdout', content: 'hello from terminal' }],
    });
    await new Promise((resolve) => setImmediate(resolve));
    expect(events.map((event) => event.kind)).toEqual([
      'command.started',
      'stream.stdout',
      'command.completed',
    ]);
  });

  it('redacts and truncates bounded output while reporting cursor gaps', async () => {
    const { service, context } = await fixture({
      outputLimitBytes: 4 * 1024,
      chunkLimitBytes: 512,
    });
    const started = await service.execute(
      context,
      request(
        'process.stdout.write("OPENAI_API_KEY=sk-secret-value\\n" + "safe output line\\n".repeat(1000))'
      )
    );
    await service.wait(started.id, 5_000);

    const handle = service.get(started.id);
    expect(handle.output).toMatchObject({
      truncated: true,
      retainedBytes: expect.any(Number),
      droppedBytes: expect.any(Number),
    });
    expect(handle.output.retainedBytes).toBeLessThanOrEqual(4 * 1024);
    const page = service.output(started.id, 1);
    expect(page.gap).toBe(true);
    expect(JSON.stringify(page)).not.toContain('secret-value');
  });

  it('trips the volume circuit before output can flood the run journal', async () => {
    const { service, context, events } = await fixture({
      outputLimitBytes: 4 * 1024,
      maximumOutputBytes: 4 * 1024,
      chunkLimitBytes: 512,
    });
    const started = await service.execute(
      context,
      request('process.stdout.write("safe output line\\n".repeat(1000))')
    );
    const completed = await service.wait(started.id, 5_000);

    expect(completed.handle.output).toMatchObject({
      volumeCircuitTripped: true,
      observedBytes: expect.any(Number),
    });
    expect(
      events.find((event) => event.kind === 'run.error')
    ).toMatchObject({
      payload: { code: 'terminal-output-volume-limit' },
    });
  });

  it('waits without blocking and reports bounded timeouts', async () => {
    const { service, context } = await fixture();
    const started = await service.execute(
      context,
      request('setTimeout(() => process.exit(0), 100)')
    );

    expect(await service.wait(started.id, 0)).toMatchObject({
      completed: false,
      timedOut: true,
    });
    expect(await service.wait(started.id, 5_000)).toMatchObject({
      completed: true,
      timedOut: false,
      handle: { state: 'exited' },
    });
  });

  it('terminates the owned process group gracefully', async () => {
    const { service, context } = await fixture({ terminationGraceMs: 100 });
    const started = await service.execute(
      context,
      request('setInterval(() => process.stdout.write("tick\\n"), 20)')
    );

    const result = await service.terminate(started.id);

    expect(result).toMatchObject({
      gracefulSignalAt: expect.any(String),
      handle: { state: 'terminated', signal: 'SIGTERM' },
    });
    expect(result.forceSignalAt).toBeUndefined();
  });

  it('fails closed for PTY and foreground modes until their controls exist', async () => {
    const { service, context } = await fixture();

    await expect(
      service.execute(context, { ...request(''), mode: 'pty' })
    ).rejects.toThrow('PTY mode is not supported');
    await expect(
      service.execute(context, { ...request(''), startMode: 'foreground' })
    ).rejects.toThrow('Foreground-to-background handoff is not supported');
  });

  it('rejects cwd traversal and unapproved environment keys before spawn', async () => {
    const { service, context } = await fixture();

    await expect(
      service.execute(context, { ...request(''), cwd: '../outside' })
    ).rejects.toThrow();
    await expect(
      service.execute(context, {
        ...request(''),
        environmentKeys: ['OPENAI_API_KEY'],
      })
    ).rejects.toThrow('not approved by the run launch manifest');
  });

  it.runIf(process.platform !== 'win32')('rejects a symlinked cwd outside the worktree', async () => {
    const { service, context } = await fixture();
    const outside = await mkdtemp(path.join(os.tmpdir(), 'vk-run-terminal-outside-'));
    await symlink(outside, path.join(context.worktreeRoot, 'escape'));

    await expect(
      service.execute(context, { ...request(''), cwd: 'escape' })
    ).rejects.toThrow();
  });
});
