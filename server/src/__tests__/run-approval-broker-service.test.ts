import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  RunApprovalListQuery,
  RunApprovalRequest,
  RunApprovalTransitionInput,
  RunApprovalTransitionResult,
} from '@veritas-kanban/shared';
import type { RunApprovalRepository } from '../storage/interfaces.js';
import { FileRunApprovalRepository } from '../storage/run-approval-repository.js';
import { SqliteDatabase } from '../storage/sqlite/database.js';
import { SqliteRunApprovalRepository } from '../storage/sqlite/run-approval-repository.js';
import {
  RunApprovalBrokerService,
  type CreateRunApprovalRequestInput,
} from '../services/run-approval-broker-service.js';
import type { RunEventJournalService } from '../services/run-event-journal-service.js';

class InMemoryRunApprovalRepository implements RunApprovalRepository {
  readonly requests = new Map<string, RunApprovalRequest>();

  async create(request: RunApprovalRequest): Promise<RunApprovalRequest> {
    if (this.requests.has(request.id)) throw new Error('duplicate');
    this.requests.set(request.id, structuredClone(request));
    return structuredClone(request);
  }

  async get(id: string): Promise<RunApprovalRequest | null> {
    const request = this.requests.get(id);
    return request ? structuredClone(request) : null;
  }

  async list(query: RunApprovalListQuery): Promise<RunApprovalRequest[]> {
    return [...this.requests.values()]
      .filter((request) => request.workspaceId === query.workspaceId)
      .filter((request) => !query.status || request.status === query.status)
      .filter((request) => !query.taskId || request.taskId === query.taskId)
      .filter((request) => !query.attemptId || request.attemptId === query.attemptId)
      .filter((request) => !query.agentId || request.agentId === query.agentId)
      .map((request) => structuredClone(request));
  }

  async transition(input: RunApprovalTransitionInput): Promise<RunApprovalTransitionResult> {
    const current = this.requests.get(input.id);
    if (!current) return { transitioned: false, reason: 'not-found' };
    if (current.status !== 'pending') {
      return {
        request: structuredClone(current),
        transitioned: false,
        reason: 'already-resolved',
      };
    }
    if (current.revision !== input.expectedRevision) {
      return {
        request: structuredClone(current),
        transitioned: false,
        reason: 'stale-revision',
      };
    }
    if (current.actionHash !== input.expectedActionHash) {
      return {
        request: structuredClone(current),
        transitioned: false,
        reason: 'action-changed',
      };
    }
    const next: RunApprovalRequest = {
      ...current,
      status: input.status,
      revision: current.revision + 1,
      updatedAt: input.resolution.decidedAt,
      resolution: input.resolution,
    };
    this.requests.set(next.id, structuredClone(next));
    return { request: structuredClone(next), transitioned: true };
  }
}

const testRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    testRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))
  );
});

function requestInput(
  overrides: Partial<CreateRunApprovalRequestInput> = {}
): CreateRunApprovalRequestInput {
  return {
    workspaceId: 'local',
    taskId: 'task_approval_fixture',
    attemptId: 'attempt_approval_fixture',
    provider: 'codex-app-server',
    agentId: 'codex-app-server',
    requestKind: 'approval',
    actionClass: 'shell',
    action: 'Run pnpm test',
    exactAction: {
      command: ['pnpm', 'test'],
      cwd: '/tmp/worktree',
    },
    details: 'Execute the test suite.',
    resourceScope: ['/tmp/worktree'],
    workingDirectory: '/tmp/worktree',
    riskClass: 'medium',
    policyReason: 'Provider requested command execution.',
    evidenceRevision: 'provider-runtime-probe/v5',
    providerRequestId: 'provider-request-1',
    threadId: 'thread-1',
    turnId: 'turn-1',
    itemId: 'item-1',
    ttlMs: 60_000,
    ...overrides,
  };
}

function service(repository = new InMemoryRunApprovalRepository(), now?: () => Date) {
  const append = vi.fn(async () => ({ appended: true, event: {} }));
  const broadcast = vi.fn();
  return {
    repository,
    append,
    broadcast,
    broker: new RunApprovalBrokerService({
      repository,
      now,
      journal: { append } as unknown as RunEventJournalService,
      broadcast,
    }),
  };
}

describe('RunApprovalBrokerService', () => {
  it('creates a deterministic, action-bound request and deduplicates provider retries', async () => {
    const fixture = service();
    const first = await fixture.broker.request(requestInput());
    const duplicate = await fixture.broker.request(
      requestInput({
        exactAction: { cwd: '/tmp/worktree', command: ['pnpm', 'test'] },
      })
    );

    expect(duplicate).toEqual(first);
    expect(first).toMatchObject({
      status: 'pending',
      revision: 1,
      actionClass: 'shell',
      mobileSafe: false,
    });
    expect(first.actionHash).toMatch(/^[a-f0-9]{64}$/);
    expect(fixture.append).toHaveBeenCalledTimes(1);
    expect(fixture.broadcast).toHaveBeenCalledWith(first);

    await expect(
      fixture.broker.request(
        requestInput({
          exactAction: { command: ['pnpm', 'lint'], cwd: '/tmp/worktree' },
        })
      )
    ).rejects.toMatchObject({ statusCode: 409, code: 'CONFLICT' });
  });

  it('deduplicates concurrent provider retries and binds authorization metadata', async () => {
    const fixture = service();
    const [first, duplicate] = await Promise.all([
      fixture.broker.request(requestInput()),
      fixture.broker.request(requestInput()),
    ]);

    expect(duplicate).toEqual(first);
    expect(fixture.repository.requests.size).toBe(1);
    expect(fixture.append).toHaveBeenCalledTimes(1);

    await expect(fixture.broker.request(requestInput({ mobileSafe: true }))).rejects.toMatchObject({
      statusCode: 409,
      code: 'CONFLICT',
    });
  });

  it('includes prototype-shaped JSON keys in the exact action hash', async () => {
    const fixture = service();
    await fixture.broker.request(
      requestInput({
        exactAction: JSON.parse('{"__proto__":{"path":"/approved"}}') as Record<string, unknown>,
      })
    );

    await expect(
      fixture.broker.request(
        requestInput({
          exactAction: JSON.parse('{"__proto__":{"path":"/changed"}}') as Record<string, unknown>,
        })
      )
    ).rejects.toMatchObject({ statusCode: 409, code: 'CONFLICT' });
  });

  it('uses authenticated actor identity, compare-and-set, and exact action hash guards', async () => {
    const fixture = service();
    const pending = await fixture.broker.request(requestInput());
    const waiting = fixture.broker.awaitDecision(pending.id, { pollIntervalMs: 5 });
    const responseData = {
      selected: 'once',
      password: 'must-not-persist',
    };
    const approved = await fixture.broker.decide(
      pending.id,
      {
        decision: 'approved',
        expectedRevision: pending.revision,
        expectedActionHash: pending.actionHash,
        responseData,
      },
      {
        id: 'reviewer-1',
        label: 'Reviewer One',
        type: 'user',
        authMethod: 'session',
        workspaceId: 'local',
      }
    );

    expect(approved).toMatchObject({
      status: 'approved',
      revision: 2,
      resolution: {
        actor: { id: 'reviewer-1', authMethod: 'session' },
        responseData: { _provided: true },
      },
    });
    await expect(waiting).resolves.toMatchObject({
      request: { id: pending.id, status: 'approved' },
      responseData,
    });
    const requestedEvent = fixture.append.mock.calls[0]?.[0];
    const resolvedEvent = fixture.append.mock.calls[1]?.[0];
    expect(requestedEvent).toMatchObject({
      kind: 'approval.requested',
      providerEventId: pending.providerRequestId,
      payload: { approvalId: pending.id, actionHash: pending.actionHash },
    });
    expect(resolvedEvent).toMatchObject({
      kind: 'approval.resolved',
      providerEventId: pending.providerRequestId,
      payload: { approvalId: pending.id, actionHash: pending.actionHash },
    });
    await expect(
      fixture.broker.decide(
        pending.id,
        {
          decision: 'rejected',
          expectedRevision: pending.revision,
          expectedActionHash: pending.actionHash,
        },
        {
          id: 'reviewer-2',
          type: 'user',
          authMethod: 'session',
          workspaceId: 'local',
        }
      )
    ).rejects.toMatchObject({ statusCode: 409, code: 'CONFLICT' });
  });

  it('blocks mobile decisions unless the exact request is explicitly mobile-safe', async () => {
    const fixture = service();
    const unsafe = await fixture.broker.request(requestInput());
    const mobileActor = {
      id: 'mobile-reviewer',
      type: 'device' as const,
      authMethod: 'device-session',
      clientMode: 'mobile-pwa',
      workspaceId: 'local',
    };

    await expect(
      fixture.broker.decide(
        unsafe.id,
        {
          decision: 'approved',
          expectedRevision: unsafe.revision,
          expectedActionHash: unsafe.actionHash,
        },
        mobileActor
      )
    ).rejects.toMatchObject({ statusCode: 403, code: 'FORBIDDEN' });

    const safe = await fixture.broker.request(
      requestInput({
        providerRequestId: 'provider-request-mobile-safe',
        actionClass: 'workflow',
        mobileSafe: true,
      })
    );
    await expect(
      fixture.broker.decide(
        safe.id,
        {
          decision: 'approved',
          expectedRevision: safe.revision,
          expectedActionHash: safe.actionHash,
        },
        mobileActor
      )
    ).resolves.toMatchObject({ status: 'approved' });
  });

  it('requires recent server-derived authentication for critical decisions', async () => {
    const now = new Date('2026-07-24T07:00:00.000Z');
    const fixture = service(new InMemoryRunApprovalRepository(), () => now);
    const pending = await fixture.broker.request(
      requestInput({
        riskClass: 'critical',
        actionClass: 'network',
        providerRequestId: 'provider-request-critical',
      })
    );
    const decision = {
      decision: 'approved' as const,
      expectedRevision: pending.revision,
      expectedActionHash: pending.actionHash,
    };

    await expect(
      fixture.broker.decide(pending.id, decision, {
        id: 'stale-reviewer',
        type: 'user',
        authMethod: 'session',
        authenticatedAt: '2026-07-24T06:54:59.000Z',
        workspaceId: 'local',
      })
    ).rejects.toMatchObject({ statusCode: 403, code: 'FORBIDDEN' });
    await expect(
      fixture.broker.decide(pending.id, decision, {
        id: 'fresh-reviewer',
        type: 'user',
        authMethod: 'session',
        authenticatedAt: '2026-07-24T06:59:30.000Z',
        workspaceId: 'local',
      })
    ).resolves.toMatchObject({
      status: 'approved',
      resolution: {
        actor: {
          id: 'fresh-reviewer',
          authenticatedAt: '2026-07-24T06:59:30.000Z',
        },
      },
    });
  });

  it('expires stale requests and cancels every pending request for an interrupted attempt', async () => {
    let now = new Date('2026-07-24T07:00:00.000Z');
    const fixture = service(new InMemoryRunApprovalRepository(), () => now);
    const expiring = await fixture.broker.request(requestInput({ ttlMs: 1_000 }));
    now = new Date('2026-07-24T07:00:02.000Z');
    await expect(fixture.broker.awaitDecision(expiring.id)).resolves.toMatchObject({
      request: { status: 'expired', revision: 2 },
    });

    now = new Date('2026-07-24T07:01:00.000Z');
    const pending = await fixture.broker.request(
      requestInput({ providerRequestId: 'provider-request-cancel' })
    );
    const cancelled = await fixture.broker.cancelAttempt(
      'local',
      pending.taskId,
      pending.attemptId,
      'Run interrupted by operator.'
    );
    expect(cancelled).toHaveLength(1);
    expect(cancelled[0]).toMatchObject({
      status: 'cancelled',
      resolution: { actor: { id: 'veritas-system' } },
    });
  });
});

describe.each(['file', 'sqlite'] as const)('%s run approval repository', (backend) => {
  it('applies exactly one compare-and-set transition and preserves queryable state', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), `veritas-approval-${backend}-`));
    testRoots.push(root);
    let sqlite: SqliteDatabase | undefined;
    const repository: RunApprovalRepository =
      backend === 'file'
        ? new FileRunApprovalRepository(path.join(root, 'approvals.jsonl'))
        : (() => {
            sqlite = new SqliteDatabase({ databasePath: path.join(root, 'veritas.db') });
            sqlite.open();
            return new SqliteRunApprovalRepository(sqlite);
          })();
    const fixture = service(repository);
    const pending = await fixture.broker.request(requestInput());
    const actor = {
      id: 'reviewer-1',
      type: 'user' as const,
      authMethod: 'session',
      workspaceId: 'local',
    };
    const transition = {
      id: pending.id,
      expectedRevision: pending.revision,
      expectedActionHash: pending.actionHash,
      status: 'approved' as const,
      resolution: {
        decision: 'approved' as const,
        actor,
        decidedAt: '2026-07-24T07:00:00.000Z',
      },
    };

    const [first, second] = await Promise.all([
      repository.transition(transition),
      repository.transition(transition),
    ]);
    expect([first.transitioned, second.transitioned].sort()).toEqual([false, true]);
    await expect(
      repository.list({ workspaceId: 'local', status: 'approved' })
    ).resolves.toMatchObject([{ id: pending.id, revision: 2, status: 'approved' }]);
    sqlite?.close();
  });
});
