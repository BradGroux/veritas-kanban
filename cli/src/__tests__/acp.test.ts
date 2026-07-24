import { Buffer } from 'node:buffer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  RunApprovalRequest,
  RunEventEnvelope,
  RunEventPage,
  Task,
} from '@veritas-kanban/shared';
import { AcpServerView, readAcpStatus, type AcpApiClient } from '../commands/acp.js';

function request(id: number, method: string, params: unknown): string {
  return JSON.stringify({ jsonrpc: '2.0', id, method, params });
}

function event(
  sequence: number,
  kind: string,
  payload: Record<string, unknown> = {}
): RunEventEnvelope {
  return {
    schemaVersion: 'run-event/v1',
    eventId: `event_${sequence}`,
    taskId: 'task_1',
    runId: 'attempt_1',
    attemptId: 'attempt_1',
    sequence,
    receivedAt: '2026-07-24T12:00:00.000Z',
    kind,
    source: { provider: 'codex-cli', adapter: 'codex-cli', agent: 'codex' },
    redaction: { status: 'none', fields: [], originalBytes: 1, persistedBytes: 1 },
    payload,
    payloadHash: `sha256:${'a'.repeat(64)}`,
  } as RunEventEnvelope;
}

function task(attempt?: Task['attempt']): Task {
  return {
    id: 'task_1',
    title: 'ACP task',
    description: 'Use the ACP view',
    type: 'code',
    status: 'in-progress',
    priority: 'high',
    project: 'veritas-kanban',
    created: '2026-07-24T12:00:00.000Z',
    updated: '2026-07-24T12:00:00.000Z',
    git: {
      repo: 'veritas-kanban',
      branch: 'feat/acp',
      baseBranch: 'main',
      worktreePath: '/tmp/task_1',
    },
    ...(attempt ? { attempt, attempts: [attempt] } : {}),
  } as Task;
}

const approval: RunApprovalRequest = {
  schemaVersion: 'run-approval/v1',
  id: 'runapproval_123456789012',
  workspaceId: 'local',
  taskId: 'task_1',
  attemptId: 'attempt_1',
  provider: 'codex-cli',
  agentId: 'codex',
  requestKind: 'approval',
  actionClass: 'shell',
  action: 'Run tests',
  actionHash: `sha256:${'b'.repeat(64)}`,
  details: 'pnpm test',
  resourceScope: ['/tmp/task_1'],
  riskClass: 'medium',
  evidenceRevision: `sha256:${'c'.repeat(64)}`,
  providerRequestId: 'provider_approval_1',
  mobileSafe: true,
  status: 'pending',
  revision: 1,
  createdAt: '2026-07-24T12:00:00.000Z',
  updatedAt: '2026-07-24T12:00:00.000Z',
  expiresAt: '2026-07-24T12:30:00.000Z',
};

describe('vk ACP server view', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it('streams one provider-neutral turn through events and the durable approval broker', async () => {
    const writes: Record<string, unknown>[] = [];
    const decisions: unknown[] = [];
    let eventRead = 0;
    const fakeApi = vi.fn(async (requestPath: string, options?: RequestInit) => {
      if (requestPath === '/api/auth/context') {
        return { role: 'admin', workspaceId: 'local', permissions: ['*'] };
      }
      if (requestPath === '/api/tasks') return [task()];
      if (requestPath.endsWith('/status')) return { running: false };
      if (requestPath.endsWith('/conversation/fresh')) {
        expect(JSON.parse(String(options?.body))).toMatchObject({
          message: 'Implement the scoped task',
          agent: 'codex',
        });
        return { attemptId: 'attempt_1' };
      }
      if (requestPath.includes('/attempts/attempt_1/events?')) {
        eventRead += 1;
        return eventRead === 1
          ? page([
              event(1, 'message.delta', { summary: 'Working on it.' }),
              event(2, 'tool.started', { summary: 'Run tests' }),
              event(3, 'approval.requested', { approvalId: approval.id }),
            ])
          : page([
              event(4, 'tool.completed', { summary: 'Tests passed', success: true }),
              event(5, 'run.completed'),
            ]);
      }
      if (requestPath === `/api/run-approvals/${approval.id}`) return approval;
      if (requestPath === `/api/run-approvals/${approval.id}/decision`) {
        decisions.push(JSON.parse(String(options?.body)));
        return { ...approval, status: 'approved' };
      }
      throw new Error(`Unexpected API request: ${requestPath}`);
    }) as AcpApiClient;
    const server = new AcpServerView({
      api: fakeApi,
      agent: 'codex',
      pollIntervalMs: 1,
      now: () => Date.parse('2026-07-24T12:00:00.000Z'),
      write: (record) => writes.push(record as unknown as Record<string, unknown>),
    });

    await server.acceptLine(
      request(1, 'initialize', {
        protocolVersion: 1,
        clientCapabilities: {},
        clientInfo: { name: 'fixture', version: '1.0.0' },
      })
    );
    await server.acceptLine(
      request(2, 'session/new', {
        cwd: '/tmp/task_1',
        mcpServers: [],
        _meta: { 'veritas/taskId': 'task_1' },
      })
    );
    const sessionId = String((writes.at(-1)?.result as Record<string, unknown>).sessionId);
    const prompt = server.acceptLine(
      request(3, 'session/prompt', {
        sessionId,
        prompt: [{ type: 'text', text: 'Implement the scoped task' }],
      })
    );

    await vi.waitFor(() => {
      expect(writes.some((record) => record.method === 'session/request_permission')).toBe(true);
    });
    const permission = writes.find((record) => record.method === 'session/request_permission');
    await server.acceptLine(
      JSON.stringify({
        jsonrpc: '2.0',
        id: permission?.id,
        result: { outcome: { outcome: 'selected', optionId: 'allow_once' } },
      })
    );
    await prompt;

    expect(decisions).toEqual([
      {
        decision: 'approved',
        expectedRevision: 1,
        expectedActionHash: approval.actionHash,
        note: 'ACP client selected allow once.',
      },
    ]);
    expect(
      writes.filter((record) => record.method === 'session/update').map((record) => record.params)
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sessionId,
          update: expect.objectContaining({ sessionUpdate: 'agent_message_chunk' }),
        }),
        expect.objectContaining({
          sessionId,
          update: expect.objectContaining({ sessionUpdate: 'tool_call' }),
        }),
        expect.objectContaining({
          sessionId,
          update: expect.objectContaining({ sessionUpdate: 'tool_call_update' }),
        }),
      ])
    );
    expect(writes.at(-1)).toMatchObject({
      jsonrpc: '2.0',
      id: 3,
      result: { stopReason: 'end_turn' },
    });
  });

  it('loads and replays a durable attempt, then cancels it without a stop fallback', async () => {
    const writes: Record<string, unknown>[] = [];
    const calls: Array<{ path: string; body?: unknown }> = [];
    const attempt = {
      id: 'attempt_1',
      agent: 'codex',
      status: 'running',
      started: '2026-07-24T12:00:00.000Z',
      conversation: {
        schemaVersion: 'conversation-lifecycle/v1',
        mode: 'fresh',
        intent: 'fresh',
        state: 'active',
        contextWindow: {
          posture: 'healthy',
          measuredAt: '2026-07-24T12:00:00.000Z',
        },
        createdAt: '2026-07-24T12:00:00.000Z',
        updatedAt: '2026-07-24T12:00:00.000Z',
      },
    } as Task['attempt'];
    const fakeApi = vi.fn(async (requestPath: string, options?: RequestInit) => {
      calls.push({
        path: requestPath,
        ...(options?.body ? { body: JSON.parse(String(options.body)) } : {}),
      });
      if (requestPath === '/api/tasks') return [task(attempt)];
      if (requestPath.includes('/events?')) {
        return page([event(2, 'message.delta', { summary: 'replayed' })]);
      }
      if (requestPath.endsWith('/conversation/interrupt')) {
        return { delivered: true };
      }
      throw new Error(`Unexpected API request: ${requestPath}`);
    }) as AcpApiClient;
    const server = new AcpServerView({
      api: fakeApi,
      boundTaskId: 'task_1',
      write: (record) => writes.push(record as unknown as Record<string, unknown>),
    });
    const sessionId = `vkacp_${Buffer.from('task_1').toString('base64url')}`;

    await server.acceptLine(
      request(1, 'session/load', {
        sessionId,
        cwd: '/tmp/task_1',
        mcpServers: [],
        _meta: { 'veritas/afterSequence': 1 },
      })
    );
    await vi.waitFor(() => {
      expect(writes.some((record) => record.method === 'session/update')).toBe(true);
    });
    await server.acceptLine(
      JSON.stringify({
        jsonrpc: '2.0',
        method: 'session/cancel',
        params: { sessionId },
      })
    );

    expect(calls).toContainEqual({
      path: '/api/agents/task_1/conversation/interrupt',
      body: { attemptId: 'attempt_1' },
    });
    expect(calls.some((call) => call.path.endsWith('/stop'))).toBe(false);
  });

  it('disconnects the protocol view without stopping or interrupting the durable run', async () => {
    const calls: string[] = [];
    const fakeApi = vi.fn(async (requestPath: string) => {
      calls.push(requestPath);
      if (requestPath === '/api/tasks') return [task()];
      if (requestPath.endsWith('/status')) return { running: false };
      if (requestPath.endsWith('/conversation/fresh')) return { attemptId: 'attempt_1' };
      if (requestPath.includes('/events?')) return page([]);
      throw new Error(`Unexpected API request: ${requestPath}`);
    }) as AcpApiClient;
    const server = new AcpServerView({
      api: fakeApi,
      boundTaskId: 'task_1',
      pollIntervalMs: 1,
      write: vi.fn(),
    });
    const sessionId = `vkacp_${Buffer.from('task_1').toString('base64url')}`;

    await server.acceptLine(request(1, 'session/new', { cwd: '/tmp/task_1', mcpServers: [] }));
    const prompt = server.acceptLine(
      request(2, 'session/prompt', {
        sessionId,
        prompt: [{ type: 'text', text: 'Keep the durable run alive' }],
      })
    );
    await vi.waitFor(() => {
      expect(calls.some((call) => call.includes('/events?'))).toBe(true);
    });
    server.disconnect();
    await prompt;

    expect(calls.some((call) => call.endsWith('/stop'))).toBe(false);
    expect(calls.some((call) => call.endsWith('/conversation/interrupt'))).toBe(false);
  });

  it('uses the same ACP client contract for two configured providers', async () => {
    const launchedAgents: unknown[] = [];

    for (const agent of ['codex', 'claude']) {
      const writes: Record<string, unknown>[] = [];
      const fakeApi = vi.fn(async (requestPath: string, options?: RequestInit) => {
        if (requestPath === '/api/tasks') return [task()];
        if (requestPath.endsWith('/status')) return { running: false };
        if (requestPath.endsWith('/conversation/fresh')) {
          launchedAgents.push(JSON.parse(String(options?.body)).agent);
          return { attemptId: 'attempt_1' };
        }
        if (requestPath.includes('/events?')) return page([event(1, 'run.completed')]);
        throw new Error(`Unexpected API request: ${requestPath}`);
      }) as AcpApiClient;
      const server = new AcpServerView({
        api: fakeApi,
        agent,
        boundTaskId: 'task_1',
        write: (record) => writes.push(record as unknown as Record<string, unknown>),
      });

      await server.acceptLine(request(1, 'session/new', { cwd: '/tmp/task_1', mcpServers: [] }));
      const sessionId = String((writes.at(-1)?.result as Record<string, unknown>).sessionId);
      await server.acceptLine(
        request(2, 'session/prompt', {
          sessionId,
          prompt: [{ type: 'text', text: 'Use the selected provider' }],
        })
      );
      expect(writes.at(-1)).toMatchObject({
        id: 2,
        result: { stopReason: 'end_turn' },
      });
    }

    expect(launchedAgents).toEqual(['codex', 'claude']);
  });

  it('fails malformed, unsupported, and client-owned tool-catalog requests closed', async () => {
    const writes: Record<string, unknown>[] = [];
    const fakeApi = vi.fn(async (requestPath: string) => {
      if (requestPath === '/api/tasks') return [task()];
      throw new Error(`Unexpected API request: ${requestPath}`);
    }) as AcpApiClient;
    const server = new AcpServerView({
      api: fakeApi,
      boundTaskId: 'task_1',
      write: (record) => writes.push(record as unknown as Record<string, unknown>),
    });

    await server.acceptLine('{bad');
    await server.acceptLine(request(2, 'unknown/method', {}));
    await server.acceptLine(
      request(3, 'session/new', {
        cwd: '/tmp/task_1',
        mcpServers: [{ name: 'unowned', command: 'node', args: [], env: [] }],
      })
    );

    expect(writes.map((record) => (record.error as Record<string, unknown>)?.code)).toEqual([
      -32700, -32601, -32003,
    ]);
  });

  it('reports API-backed readiness without claiming provider capabilities', async () => {
    const ready = await readAcpStatus(
      vi.fn(async () => ({ role: 'admin', workspaceId: 'local' })) as AcpApiClient
    );
    expect(ready).toMatchObject({
      protocolVersion: 1,
      transport: 'stdio',
      ready: true,
      providerNeutral: true,
      durableRuns: true,
      role: 'admin',
      workspaceId: 'local',
    });

    const blocked = await readAcpStatus(
      vi.fn(async () => {
        throw new Error('API unavailable');
      }) as AcpApiClient
    );
    expect(blocked).toMatchObject({ ready: false, error: 'API unavailable' });
  });
});

function page(events: RunEventEnvelope[]): RunEventPage {
  return {
    schemaVersion: 'run-event/v1',
    taskId: 'task_1',
    attemptId: 'attempt_1',
    events,
    nextCursor: events.at(-1)?.sequence ?? 0,
    hasMore: false,
  };
}
