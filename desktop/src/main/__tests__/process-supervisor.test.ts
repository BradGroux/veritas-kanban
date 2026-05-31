import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { ProcessSupervisor } from '../process-supervisor.js';
import type { DesktopProcessState, ManagedProcessConfig } from '../types.js';

async function createConfig(args: string[]): Promise<ManagedProcessConfig> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'veritas-process-supervisor-'));

  return {
    name: 'server',
    command: process.execPath,
    args,
    cwd: process.cwd(),
    env: process.env,
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
});
