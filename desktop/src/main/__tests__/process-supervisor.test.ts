import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { ProcessSupervisor } from '../process-supervisor.js';
import type { DesktopProcessState, ManagedProcessConfig } from '../types.js';

const roots: string[] = [];
const supervisors: ProcessSupervisor[] = [];
afterEach(async () => {
  await Promise.all(supervisors.splice(0).map((supervisor) => supervisor.stop()));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function createConfig(args: string[]): Promise<ManagedProcessConfig> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'veritas-process-supervisor-'));
  roots.push(tempDir);

  return {
    name: 'server',
    command: process.execPath,
    args,
    cwd: tempDir,
    env: {},
    logFile: path.join(tempDir, 'server.log'),
  };
}

function waitForState(
  supervisor: ProcessSupervisor,
  state: DesktopProcessState
): Promise<ReturnType<ProcessSupervisor['snapshot']>> {
  const snapshot = supervisor.snapshot();
  if (snapshot.state === state) {
    return Promise.resolve(snapshot);
  }

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      supervisor.off('state', onState);
      reject(new Error(`Timed out waiting for ${state}`));
    }, 2_000);

    const onState = (next: ReturnType<ProcessSupervisor['snapshot']>) => {
      if (next.state === state) {
        clearTimeout(timeout);
        supervisor.off('state', onState);
        resolve(next);
      }
    };

    supervisor.on('state', onState);
  });
}

async function waitForLog(config: ManagedProcessConfig, text: string, count = 1) {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const log = await readFile(config.logFile, 'utf8').catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return '';
      throw error;
    });
    if (log.split(text).length - 1 >= count) return log;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for fixture log: ${text}`);
}
async function runningFixture(resist = false) {
  const config = await createConfig([
    '-e',
    `process.on('SIGTERM', () => { console.log('TERM_RECEIVED'); ${resist ? '' : 'process.exit(0);'} }); console.log('FIXTURE_READY'); setInterval(() => {}, 1000);`,
  ]);
  config.shutdownTimeoutMs = 50;
  const supervisor = new ProcessSupervisor(config);
  supervisors.push(supervisor);
  await supervisor.start();
  await waitForLog(config, '\nFIXTURE_READY\n');
  supervisor.markReady();
  return { supervisor, config };
}

describe('ProcessSupervisor', () => {
  it('fails when a process exits before readiness, even with code 0', async () => {
    const supervisor = new ProcessSupervisor(await createConfig(['-e', 'process.exit(0)']));

    const failed = waitForState(supervisor, 'failed');
    await supervisor.start();

    const snapshot = await failed;
    expect(snapshot.lastError).toContain('server exited before becoming ready with code 0');
  });

  it('treats a clean exit after readiness as stopped', async () => {
    const supervisor = new ProcessSupervisor(
      await createConfig(['-e', 'setTimeout(() => process.exit(0), 50)'])
    );

    const stopped = waitForState(supervisor, 'stopped');
    await supervisor.start();
    supervisor.markReady();

    const snapshot = await stopped;
    expect(snapshot.lastError).toBeNull();
  });
  it('reaps a SIGTERM-resistant owned child without signaling another fixture', async () => {
    const owned = await runningFixture(true);
    const other = await runningFixture();
    const pid = owned.supervisor.snapshot().pid;
    if (!pid) throw new Error('Expected owned process PID');
    const started = Date.now();
    await owned.supervisor.stop();
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(owned.supervisor.snapshot()).toMatchObject({ state: 'stopped', pid: null });
    expect(() => process.kill(pid, 0)).toThrow();
    const log = await waitForLog(owned.config, 'signal=SIGKILL');
    expect(log).toContain('\nTERM_RECEIVED\n');
    expect(other.supervisor.snapshot().state).toBe('ready');
    const otherPid = other.supervisor.snapshot().pid;
    if (!otherPid) throw new Error('Expected separate process PID');
    expect(process.kill(otherPid, 0)).toBe(true);
  });

  it('allows cooperative shutdown without escalation', async () => {
    const { supervisor, config } = await runningFixture();
    await supervisor.stop();
    const log = await waitForLog(config, 'exited code=0 signal=null');
    expect(log).toContain('\nTERM_RECEIVED\n');
    expect(log).not.toContain('signal=SIGKILL');
    expect(supervisor.snapshot().state).toBe('stopped');
  });

  it('settles concurrent stop calls and repeated already-stopped calls', async () => {
    const { supervisor } = await runningFixture(true);
    await Promise.all([supervisor.stop(), supervisor.stop()]);
    await supervisor.stop();
    expect(supervisor.snapshot()).toMatchObject({ state: 'stopped', pid: null });
  });

  it('settles stop when spawn fails before or during shutdown', async () => {
    for (const stopImmediately of [true, false]) {
      const config = await createConfig([]);
      config.command = path.join(config.cwd, 'missing-owned-command');
      config.shutdownTimeoutMs = 50;
      const supervisor = new ProcessSupervisor(config);
      supervisors.push(supervisor);
      const error = new Promise<Error>((resolve) => supervisor.once('error', resolve));
      await supervisor.start();
      if (stopImmediately) {
        await supervisor.stop();
        expect(supervisor.snapshot()).toMatchObject({ state: 'stopped', pid: null });
      }
      await error;
      await supervisor.stop();
      expect(supervisor.snapshot()).toMatchObject({ state: 'stopped', pid: null });
      expect(supervisor.snapshot().lastError).toContain('ENOENT');
    }
  });

  it('restarts after escalation with a new owned child', async () => {
    const { supervisor, config } = await runningFixture(true);
    const oldPid = supervisor.snapshot().pid;
    await supervisor.restart();
    await waitForLog(config, '\nFIXTURE_READY\n', 2);
    supervisor.markReady();
    expect(supervisor.snapshot().pid).not.toBe(oldPid);
    expect(supervisor.snapshot().state).toBe('ready');
    await supervisor.stop();
  });
});
