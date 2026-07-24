import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  RunSupervisorCompareAndSetInput,
  RunSupervisorCompareAndSetResult,
  RunSupervisorListQuery,
  RunSupervisorRecord,
} from '@veritas-kanban/shared';
import type { RunSupervisorRepository } from '../storage/interfaces.js';
import { FileRunSupervisorRepository } from '../storage/run-supervisor-repository.js';
import { SqliteDatabase } from '../storage/sqlite/database.js';
import { SqliteRunSupervisorRepository } from '../storage/sqlite/run-supervisor-repository.js';
import {
  RunSupervisorService,
  type RegisterRunSupervisorInput,
} from '../services/run-supervisor-service.js';
import { ClawdbotAgentService } from '../services/clawdbot-agent-service.js';
import type { RunEventJournalService } from '../services/run-event-journal-service.js';

const roots: string[] = [];
const services: RunSupervisorService[] = [];
const SHA_A = `sha256:${'a'.repeat(64)}`;
const SHA_B = `sha256:${'b'.repeat(64)}`;
const SHA_C = `sha256:${'c'.repeat(64)}`;
const HOST_A = '1'.repeat(64);

afterEach(async () => {
  vi.unstubAllEnvs();
  for (const service of services.splice(0)) service.dispose();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

class InMemoryRunSupervisorRepository implements RunSupervisorRepository {
  private readonly records = new Map<string, RunSupervisorRecord>();

  async create(record: RunSupervisorRecord): Promise<RunSupervisorRecord> {
    if (this.records.has(record.id)) throw new Error('duplicate');
    this.records.set(record.id, structuredClone(record));
    return structuredClone(record);
  }

  async get(id: string): Promise<RunSupervisorRecord | null> {
    const record = this.records.get(id);
    return record ? structuredClone(record) : null;
  }

  async list(query: RunSupervisorListQuery): Promise<RunSupervisorRecord[]> {
    return [...this.records.values()]
      .filter((record) => record.workspaceId === query.workspaceId)
      .filter((record) => !query.taskId || record.taskId === query.taskId)
      .filter((record) => !query.attemptId || record.attemptId === query.attemptId)
      .filter((record) => !query.states || query.states.includes(record.state))
      .map((record) => structuredClone(record));
  }

  async compareAndSet(
    input: RunSupervisorCompareAndSetInput
  ): Promise<RunSupervisorCompareAndSetResult> {
    const current = this.records.get(input.id);
    if (!current) return { updated: false, reason: 'not-found' };
    if (current.revision !== input.expectedRevision) {
      return {
        record: structuredClone(current),
        updated: false,
        reason: 'stale-revision',
      };
    }
    if (input.next.revision !== current.revision + 1) {
      return {
        record: structuredClone(current),
        updated: false,
        reason: 'invalid-revision',
      };
    }
    this.records.set(input.id, structuredClone(input.next));
    return { record: structuredClone(input.next), updated: true };
  }
}

function registerInput(
  overrides: Partial<RegisterRunSupervisorInput> = {}
): RegisterRunSupervisorInput {
  return {
    workspaceId: 'local',
    taskId: 'task-853',
    attemptId: 'attempt-853',
    provider: 'codex-cli',
    adapter: 'codex-cli',
    providerVersion: '0.145.0',
    providerRuntimeManifestDigest: SHA_A,
    taskEnvelopeDigest: SHA_B,
    runLaunchManifestDigest: SHA_C,
    worktreePath: '/tmp/veritas-task-853',
    worktreeManifestId: 'worktree-853',
    worktreeLeaseId: 'lease-853',
    recoveryOperations: ['status', 'stop', 'reattach'],
    ...overrides,
  };
}

function service(
  repository: RunSupervisorRepository,
  overrides: Partial<ConstructorParameters<typeof RunSupervisorService>[0]> = {}
): RunSupervisorService {
  const result = new RunSupervisorService({
    repository,
    hostId: HOST_A,
    ownerId: 'owner-a',
    processId: 101,
    heartbeatMs: 60_000,
    processProbe: (pid) => ({
      alive: pid === 202,
      startToken: pid === 202 ? 'process-start-202' : undefined,
    }),
    ...overrides,
  });
  services.push(result);
  return result;
}

function recoveryBindings() {
  return {
    provider: 'codex-cli' as const,
    adapter: 'codex-cli',
    providerRuntimeManifestDigest: SHA_A,
    taskEnvelopeDigest: SHA_B,
    runLaunchManifestDigest: SHA_C,
    worktreePath: '/tmp/veritas-task-853',
    worktreeManifestId: 'worktree-853',
    worktreeLeaseId: 'lease-853',
  };
}

describe('RunSupervisorService', () => {
  it('defers the default SQLite repository until storage bootstrap completes', () => {
    vi.stubEnv('VERITAS_STORAGE', 'sqlite');

    expect(() => {
      services.push(
        new RunSupervisorService({
          hostId: HOST_A,
          ownerId: 'bootstrap-owner',
          processId: 101,
          heartbeatMs: 60_000,
        })
      );
    }).not.toThrow();
  });

  it('persists exact bindings, process control, event cursor, budget, and an idempotent terminal state', async () => {
    const repository = new InMemoryRunSupervisorRepository();
    const supervisor = service(repository);
    const registered = await supervisor.register(registerInput());
    const running = await supervisor.attachLocalProcess(registered.id, 202, 202);
    expect(running).toMatchObject({
      state: 'running',
      control: {
        kind: 'local-process',
        pid: 202,
        processGroupId: 202,
        startToken: 'process-start-202',
      },
      bindings: {
        providerRuntimeManifestDigest: SHA_A,
        taskEnvelopeDigest: SHA_B,
        runLaunchManifestDigest: SHA_C,
      },
    });
    const checkpoint = await supervisor.checkpoint(registered.id, {
      lastEventSequence: 17,
      budget: {
        enabled: true,
        usage: {
          inputTokens: 1,
          outputTokens: 2,
          totalTokens: 3,
          costUsd: 0,
          toolCalls: 1,
          runtimeSeconds: 4,
          idleRuntimeSeconds: 0,
          retries: 0,
          fanOut: 1,
        },
        decision: 'allow',
        thresholdEvents: [],
        traceIds: [],
      },
    });
    expect(checkpoint).toMatchObject({
      lastEventSequence: 17,
      budget: { usage: { totalTokens: 3 } },
    });
    const terminal = await supervisor.markTerminal(
      registered.id,
      'completed',
      'Provider completed.',
      'completion-853'
    );
    await expect(
      supervisor.markTerminal(registered.id, 'completed', 'Provider completed.', 'completion-853')
    ).resolves.toEqual(terminal);
  });

  it('allows exactly one stale-owner recovery lease and reattaches a verified process', async () => {
    const repository = new InMemoryRunSupervisorRepository();
    const original = service(repository, {
      now: () => new Date('2026-07-24T08:00:00.000Z'),
    });
    const record = await original.register(registerInput());
    await original.attachLocalProcess(record.id, 202, 202);
    original.dispose();

    const probe = (pid: number) => ({
      alive: pid === 101 || pid === 202,
      startToken: pid === 202 ? 'process-start-202' : undefined,
    });
    const first = service(repository, {
      ownerId: 'owner-b',
      processId: 303,
      processProbe: probe,
      now: () => new Date('2026-07-24T08:00:16.000Z'),
    });
    const second = service(repository, {
      ownerId: 'owner-c',
      processId: 404,
      processProbe: probe,
      now: () => new Date('2026-07-24T08:00:16.000Z'),
    });
    const [left, right] = await Promise.all([
      first.recover(record.id, recoveryBindings()),
      second.recover(record.id, recoveryBindings()),
    ]);
    expect([left.outcome, right.outcome].sort()).toEqual(['lease-held', 'reattached']);
    await expect(original.heartbeat(record.id)).rejects.toThrow(
      'Run supervisor lease is owned by another process'
    );
  });

  it('fails closed on changed worktree bindings and process identity reuse', async () => {
    const repository = new InMemoryRunSupervisorRepository();
    const original = service(repository);
    const record = await original.register(registerInput());
    await original.attachLocalProcess(record.id, 202, 202);
    original.dispose();

    const recovering = service(repository, {
      ownerId: 'owner-b',
      processId: 303,
      processProbe: (pid) => ({
        alive: pid === 202,
        startToken: pid === 202 ? 'reused-process' : undefined,
      }),
    });
    const changedBinding = await recovering.recover(record.id, {
      provider: 'codex-cli',
      adapter: 'codex-cli',
      providerRuntimeManifestDigest: SHA_A,
      taskEnvelopeDigest: SHA_B,
      runLaunchManifestDigest: SHA_C,
      worktreePath: '/tmp/changed-worktree',
      worktreeManifestId: 'worktree-853',
      worktreeLeaseId: 'lease-853',
    });
    expect(changedBinding).toMatchObject({
      outcome: 'recovery-required',
      record: { recovery: { code: 'binding-mismatch' } },
    });
  });

  it('probes resumable remote sessions and records unsupported adapters actionably', async () => {
    const repository = new InMemoryRunSupervisorRepository();
    const resumable = service(repository, {
      sessionProbe: async () => true,
    });
    const remote = await resumable.register(
      registerInput({
        attemptId: 'attempt-remote',
        controlKind: 'remote-session',
        sessionId: 'session-853',
        recoveryOperations: ['status', 'reattach'],
      })
    );
    await expect(
      resumable.recover(remote.id, {
        provider: 'codex-cli',
        adapter: 'codex-cli',
        providerRuntimeManifestDigest: SHA_A,
        taskEnvelopeDigest: SHA_B,
        runLaunchManifestDigest: SHA_C,
        worktreePath: '/tmp/veritas-task-853',
        worktreeManifestId: 'worktree-853',
        worktreeLeaseId: 'lease-853',
      })
    ).resolves.toMatchObject({ outcome: 'reattached' });

    const unsupported = await resumable.register(
      registerInput({
        attemptId: 'attempt-unsupported',
        controlKind: 'remote-session',
        sessionId: 'session-unsupported',
        recoveryOperations: ['status'],
      })
    );
    await expect(
      resumable.recover(unsupported.id, {
        provider: 'codex-cli',
        adapter: 'codex-cli',
        providerRuntimeManifestDigest: SHA_A,
        taskEnvelopeDigest: SHA_B,
        runLaunchManifestDigest: SHA_C,
        worktreePath: '/tmp/veritas-task-853',
        worktreeManifestId: 'worktree-853',
        worktreeLeaseId: 'lease-853',
      })
    ).resolves.toMatchObject({
      outcome: 'recovery-required',
      record: { recovery: { code: 'adapter-reattach-unsupported' } },
    });
  });

  it('signals the persisted process group and never an unverified reused PID', async () => {
    const repository = new InMemoryRunSupervisorRepository();
    let alive = true;
    const signals: Array<[number, number | undefined, NodeJS.Signals]> = [];
    const supervisor = service(repository, {
      processProbe: (pid) => ({
        alive: pid === 202 && alive,
        startToken: pid === 202 ? 'process-start-202' : undefined,
      }),
      signalProcess: (pid, processGroupId, signal) => {
        signals.push([pid, processGroupId, signal]);
        alive = false;
      },
    });
    const record = await supervisor.register(registerInput());
    await supervisor.attachLocalProcess(record.id, 202, 202);
    await supervisor.stopLocalProcess(record.id);
    expect(signals).toEqual([[202, 202, 'SIGTERM']]);
  });

  it('keeps terminal ownership authoritative when restart recovery races completion', async () => {
    const repository = new InMemoryRunSupervisorRepository();
    const original = service(repository);
    const record = await original.register(registerInput());
    const terminal = await original.markTerminal(
      record.id,
      'completed',
      'Provider completed.',
      'completion-853'
    );
    original.dispose();

    const recovering = service(repository, {
      ownerId: 'owner-b',
      processId: 303,
    });
    await expect(recovering.recover(record.id, recoveryBindings())).resolves.toEqual({
      outcome: 'terminal',
      record: terminal,
    });
  });

  it('reconciles the run journal strictly after the durable cursor', async () => {
    const repository = new InMemoryRunSupervisorRepository();
    const durable = service(repository);
    const registered = await durable.register(registerInput());
    const supervisor = await durable.checkpoint(registered.id, { lastEventSequence: 17 });
    const list = vi.fn().mockResolvedValue({
      events: [{ sequence: 18 }],
      cursor: 18,
      hasMore: false,
    });
    const checkpoint = vi.fn().mockResolvedValue(supervisor);
    const orchestration = new ClawdbotAgentService(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { list } as unknown as RunEventJournalService,
      undefined,
      { checkpoint } as unknown as RunSupervisorService
    ) as unknown as {
      reconcileRecoveredRunCursor(
        taskId: string,
        attemptId: string,
        record: RunSupervisorRecord
      ): Promise<void>;
    };

    await orchestration.reconcileRecoveredRunCursor(
      supervisor.taskId,
      supervisor.attemptId,
      supervisor
    );

    expect(list).toHaveBeenCalledWith({
      taskId: supervisor.taskId,
      attemptId: supervisor.attemptId,
      afterSequence: 17,
      limit: 500,
    });
    expect(checkpoint).toHaveBeenCalledWith(supervisor.id, { lastEventSequence: 18 });
  });
});

describe.each(['file', 'sqlite'] as const)('%s run supervisor repository', (backend) => {
  it('applies exactly one compare-and-set update and preserves queryable state', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), `veritas-supervisor-${backend}-`));
    roots.push(root);
    let sqlite: SqliteDatabase | undefined;
    const repository: RunSupervisorRepository =
      backend === 'file'
        ? new FileRunSupervisorRepository(path.join(root, 'supervisors.jsonl'))
        : (() => {
            sqlite = new SqliteDatabase({ databasePath: path.join(root, 'veritas.db') });
            sqlite.open();
            return new SqliteRunSupervisorRepository(sqlite);
          })();
    const supervisor = service(repository);
    const record = await supervisor.register(registerInput({ attemptId: `attempt-${backend}` }));
    const next: RunSupervisorRecord = {
      ...record,
      state: 'running',
      revision: record.revision + 1,
      updatedAt: '2026-07-24T08:00:01.000Z',
    };
    const [first, second] = await Promise.all([
      repository.compareAndSet({
        id: record.id,
        expectedRevision: record.revision,
        next,
      }),
      repository.compareAndSet({
        id: record.id,
        expectedRevision: record.revision,
        next,
      }),
    ]);
    expect([first.updated, second.updated].sort()).toEqual([false, true]);
    await expect(
      repository.list({ workspaceId: 'local', states: ['running'] })
    ).resolves.toMatchObject([{ id: record.id, revision: 2 }]);
    sqlite?.close();
  });
});
