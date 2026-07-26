import { mkdtemp, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type {
  RunEventAppendInput,
  RunEventEnvelope,
  RunTerminalExecuteRequest,
} from '@veritas-kanban/shared';
import {
  RunTerminalService,
  type RunTerminalLaunchContext,
} from '../services/run-terminal-service.js';

const launchManifestDigest = `sha256:${'a'.repeat(64)}`;
let requestSequence = 0;

async function fixture(
  options: {
    outputLimitBytes?: number;
    maximumOutputBytes?: number;
    chunkLimitBytes?: number;
    terminationGraceMs?: number;
  } = {}
) {
  const worktreeRoot = await mkdtemp(path.join(os.tmpdir(), 'vk-run-terminal-'));
  const events: RunEventAppendInput[] = [];
  const persistedEvents: RunEventEnvelope[] = [];
  const journal = {
    append: async (event: RunEventAppendInput) => {
      events.push(event);
      const duplicate = event.dedupeKey
        ? persistedEvents.find((candidate) => candidate.dedupeKey === event.dedupeKey)
        : undefined;
      if (duplicate) return { event: duplicate, appended: false };
      const envelope = {
        schemaVersion: 'run-event/v1',
        eventId: `event_${persistedEvents.length + 1}`,
        taskId: event.taskId,
        runId: event.attemptId,
        attemptId: event.attemptId,
        sequence: persistedEvents.length + 1,
        receivedAt: new Date().toISOString(),
        kind: event.kind,
        source: event.source,
        redaction: {
          status: 'none',
          fields: [],
          originalBytes: 0,
          persistedBytes: 0,
        },
        payload: structuredClone(event.payload),
        payloadHash: '0'.repeat(64),
        dedupeKey: event.dedupeKey,
      } as RunEventEnvelope;
      persistedEvents.push(envelope);
      return { event: envelope, appended: true };
    },
    list: async (query: {
      taskId: string;
      attemptId: string;
      afterSequence?: number;
      limit?: number;
    }) => {
      const afterSequence = query.afterSequence ?? 0;
      const limit = query.limit ?? 200;
      const available = persistedEvents.filter(
        (event) =>
          event.taskId === query.taskId &&
          event.attemptId === query.attemptId &&
          event.sequence > afterSequence
      );
      const page = available.slice(0, limit);
      return {
        schemaVersion: 'run-event/v1' as const,
        taskId: query.taskId,
        attemptId: query.attemptId,
        events: page,
        nextCursor: page.at(-1)?.sequence ?? afterSequence,
        hasMore: available.length > page.length,
      };
    },
  };
  const service = new RunTerminalService({
    ...options,
    journal,
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
  return { service, context, events, persistedEvents, journal };
}

function request(script: string): RunTerminalExecuteRequest {
  return {
    requestId: `terminal-request-${++requestSequence}`,
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
    expect(
      service.assertScope(started.id, context.workspaceId, context.taskId, context.attemptId)
    ).toMatchObject({ id: started.id });
    expect(() =>
      service.assertScope(started.id, 'workspace_other', context.taskId, context.attemptId)
    ).toThrow('not found');
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

  it('deduplicates approved request retries and applies the server-owned launch wrapper', async () => {
    const { service, context, events } = await fixture();
    const wrap = vi.fn((command: string, args: string[], cwd: string) => ({
      command,
      args,
      cwd,
      environment: { WRAPPED_FLAG: 'enforced' },
    }));
    const approvedRequest = request(
      'setTimeout(() => process.stdout.write(process.env.WRAPPED_FLAG || "missing"), 25)'
    );

    const [first, retried] = await Promise.all([
      service.execute({ ...context, wrap }, approvedRequest),
      service.execute({ ...context, wrap }, approvedRequest),
    ]);

    expect(retried.id).toBe(first.id);
    expect(first).toMatchObject({
      requestId: approvedRequest.requestId,
      requestDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
    });
    await service.wait(first.id, 5_000);
    expect(
      service
        .output(first.id)
        .chunks.map((chunk) => chunk.content)
        .join('')
    ).toBe('enforced');
    expect(wrap).toHaveBeenCalledTimes(1);
    expect(events.filter((event) => event.kind === 'command.started')).toHaveLength(1);
    await expect(
      service.execute({ ...context, wrap }, { ...approvedRequest, args: ['-e', 'process.exit(1)'] })
    ).rejects.toThrow('reused for a changed command');
  });

  it('fails closed when ownership cannot be persisted before handle return', async () => {
    const { context } = await fixture();
    const service = new RunTerminalService({
      journal: {
        append: async () => {
          throw new Error('journal unavailable');
        },
        list: async (query) => ({
          schemaVersion: 'run-event/v1',
          taskId: query.taskId,
          attemptId: query.attemptId,
          events: [],
          nextCursor: query.afterSequence ?? 0,
          hasMore: false,
        }),
      },
    });

    await expect(service.execute(context, request('setInterval(() => {}, 1000)'))).rejects.toThrow(
      'ownership could not be persisted'
    );
    expect(service.list(context.workspaceId, context.taskId, context.attemptId)).toEqual([]);
  });

  it('does not report a durable completion when terminal evidence cannot be persisted', async () => {
    const { context } = await fixture();
    let appendCount = 0;
    const service = new RunTerminalService({
      journal: {
        append: async () => {
          appendCount += 1;
          if (appendCount > 1) throw new Error('journal unavailable');
          return {} as never;
        },
        list: async (query) => ({
          schemaVersion: 'run-event/v1',
          taskId: query.taskId,
          attemptId: query.attemptId,
          events: [],
          nextCursor: query.afterSequence ?? 0,
          hasMore: false,
        }),
      },
    });
    const started = await service.execute(context, request('process.exit(0)'));

    await expect(service.wait(started.id, 5_000)).rejects.toThrow('journal evidence is incomplete');
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

  it('keeps durable stream events below the journal spill threshold', async () => {
    const { service, context, events } = await fixture();
    const started = await service.execute(
      context,
      request('process.stdout.write("safe output line\\n".repeat(500))')
    );
    await service.wait(started.id, 5_000);

    const streamEvents = events.filter((event) => event.kind === 'stream.stdout');
    expect(streamEvents.length).toBeGreaterThan(1);
    expect(
      streamEvents.every(
        (event) => Buffer.byteLength(String(event.payload.content ?? ''), 'utf8') <= 6 * 1024
      )
    ).toBe(true);
    expect(
      streamEvents.every(
        (event) => Buffer.byteLength(JSON.stringify(event.payload), 'utf8') < 8 * 1024
      )
    ).toBe(true);
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
    expect(events.find((event) => event.kind === 'run.error')).toMatchObject({
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

  it('waits for any handle without blocking the remaining process', async () => {
    const { service, context } = await fixture();
    const fast = await service.execute(context, request('setTimeout(() => process.exit(0), 40)'));
    const slow = await service.execute(context, request('setTimeout(() => process.exit(0), 1000)'));

    expect(await service.waitAny([fast.id, slow.id], 5_000)).toMatchObject({
      mode: 'any',
      completed: true,
      timedOut: false,
      selectedHandleId: fast.id,
      completedHandleIds: [fast.id],
      pendingHandleIds: [slow.id],
    });
    await service.terminate(slow.id);
  });

  it('waits for all handles with a bounded timeout', async () => {
    const { service, context } = await fixture();
    const first = await service.execute(context, request('setTimeout(() => process.exit(0), 40)'));
    const second = await service.execute(
      context,
      request('setTimeout(() => process.exit(0), 100)')
    );

    expect(await service.waitAll([first.id, second.id], 0)).toMatchObject({
      mode: 'all',
      completed: false,
      timedOut: true,
    });
    expect(await service.waitAll([first.id, second.id], 5_000)).toMatchObject({
      mode: 'all',
      completed: true,
      timedOut: false,
      completedHandleIds: expect.arrayContaining([first.id, second.id]),
      pendingHandleIds: [],
    });
  });

  it('detaches a foreground handle without losing output or ownership', async () => {
    const { service, context, events } = await fixture();
    const started = await service.execute(context, {
      ...request('setTimeout(() => process.stdout.write("detached"), 40)'),
      startMode: 'foreground',
    });

    expect(started.startMode).toBe('foreground');
    expect(await service.detach(started.id)).toMatchObject({
      id: started.id,
      attemptId: context.attemptId,
      startMode: 'background',
    });
    await service.wait(started.id, 5_000);
    expect(
      service
        .output(started.id)
        .chunks.map((chunk) => chunk.content)
        .join('')
    ).toBe('detached');
    expect(events.map((event) => event.kind)).toContain('command.detached');
  });

  it('terminates detached jobs when their owning attempt is cleaned up', async () => {
    const { service, context } = await fixture({ terminationGraceMs: 100 });
    const started = await service.execute(context, {
      ...request('setInterval(() => process.stdout.write("detached\\n"), 20)'),
      startMode: 'foreground',
    });
    await service.detach(started.id);

    const results = await service.cleanupAttempt(
      context.workspaceId,
      context.taskId,
      context.attemptId
    );

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      handle: {
        id: started.id,
        startMode: 'background',
        state: 'terminated',
        signal: 'SIGTERM',
      },
    });
  });

  it('reconstructs terminal handles and retained output from the durable journal', async () => {
    const { service, context, journal } = await fixture();
    const started = await service.execute(
      context,
      request('process.stdout.write("durable output")')
    );
    await service.wait(started.id, 5_000);

    await expect(
      new RunTerminalService({ journal }).reconcileAttempt(
        'workspace_other',
        context.taskId,
        context.attemptId
      )
    ).rejects.toThrow('scope does not match');
    const restarted = new RunTerminalService({ journal });
    const reconciliation = await restarted.reconcileAttempt(
      context.workspaceId,
      context.taskId,
      context.attemptId
    );

    expect(reconciliation).toMatchObject({
      schemaVersion: 'run-terminal-reconciliation/v1',
      recoveredHandleIds: [started.id],
      interruptedHandleIds: [],
      handles: [{ id: started.id, state: 'exited', exitCode: 0 }],
    });
    expect(
      restarted
        .output(started.id)
        .chunks.map((chunk) => chunk.content)
        .join('')
    ).toBe('durable output');
  });

  it('migrates pre-request-identity v1 handles during durable replay', async () => {
    const { service, context, persistedEvents, journal } = await fixture();
    const started = await service.execute(context, request('process.stdout.write("legacy")'));
    await service.wait(started.id, 5_000);
    for (const event of persistedEvents) {
      const handle = event.payload.handle;
      if (!handle || typeof handle !== 'object' || Array.isArray(handle)) continue;
      delete (handle as Record<string, unknown>).requestId;
      delete (handle as Record<string, unknown>).requestDigest;
    }

    const restarted = new RunTerminalService({ journal });
    const reconciliation = await restarted.reconcileAttempt(
      context.workspaceId,
      context.taskId,
      context.attemptId
    );

    expect(reconciliation.handles).toContainEqual(
      expect.objectContaining({
        id: started.id,
        requestId: `legacy:${started.id}`,
        requestDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      })
    );
  });

  it('fails closed by interrupting a dangling handle after restart', async () => {
    const { service, context, events, journal } = await fixture();
    const started = await service.execute(context, request('setInterval(() => {}, 1000)'));
    try {
      await new Promise((resolve) => setImmediate(resolve));

      const restarted = new RunTerminalService({ journal });
      const reconciliation = await restarted.reconcileAttempt(
        context.workspaceId,
        context.taskId,
        context.attemptId
      );

      expect(reconciliation).toMatchObject({
        recoveredHandleIds: [started.id],
        interruptedHandleIds: [started.id],
        handles: [
          {
            id: started.id,
            state: 'interrupted',
            capabilities: { restartReattachment: 'unsupported' },
          },
        ],
      });
      expect(restarted.get(started.id).failure).toContain('cannot reattach inherited pipes');
      expect(
        events.filter(
          (event) => event.dedupeKey === `run-terminal:${started.id}:restart-interrupted`
        )
      ).toHaveLength(1);
    } finally {
      await service.terminate(started.id);
    }
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

  it('fails closed for PTY mode until its controls exist', async () => {
    const { service, context } = await fixture();

    await expect(service.execute(context, { ...request(''), mode: 'pty' })).rejects.toThrow(
      'PTY mode is not supported'
    );
  });

  it('rejects cwd traversal and unapproved environment keys before spawn', async () => {
    const { service, context } = await fixture();

    await expect(service.execute(context, { ...request(''), cwd: '../outside' })).rejects.toThrow();
    await expect(
      service.execute(context, {
        ...request(''),
        environmentKeys: ['OPENAI_API_KEY'],
      })
    ).rejects.toThrow('not approved by the run launch manifest');
  });

  it.runIf(process.platform !== 'win32')(
    'rejects a symlinked cwd outside the worktree',
    async () => {
      const { service, context } = await fixture();
      const outside = await mkdtemp(path.join(os.tmpdir(), 'vk-run-terminal-outside-'));
      await symlink(outside, path.join(context.worktreeRoot, 'escape'));

      await expect(service.execute(context, { ...request(''), cwd: 'escape' })).rejects.toThrow();
    }
  );
});
