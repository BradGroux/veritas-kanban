import fs from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  RunEventEnvelope,
  ToolServerDefinition,
  ToolServerDefinitionInput,
} from '@veritas-kanban/shared';
import { ToolControlPlaneService } from '../services/tool-control-plane-service.js';
import type { RunApprovalBrokerService } from '../services/run-approval-broker-service.js';
import { RunEventJournalService } from '../services/run-event-journal-service.js';
import { FileRunEventRepository } from '../storage/run-event-repository.js';
import {
  FileToolControlPlaneRepository,
  InMemoryToolControlPlaneRepository,
} from '../storage/tool-control-plane-repository.js';
import { SqliteDatabase } from '../storage/sqlite/database.js';
import { SqliteToolControlPlaneRepository } from '../storage/sqlite/tool-control-plane-repository.js';

const DIGEST = `sha256:${'a'.repeat(64)}`;
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

function definition(overrides: Partial<ToolServerDefinitionInput> = {}): ToolServerDefinitionInput {
  return {
    id: 'fixture',
    version: '1.0.0',
    displayName: 'Fixture tools',
    enabled: true,
    transport: {
      kind: 'stdio',
      command: '/usr/bin/fixture',
      args: ['serve'],
      environmentKeys: [],
      credentialReferences: [],
    },
    requirement: 'required',
    startupTimeoutMs: 1_000,
    toolTimeoutMs: 1_000,
    allowedTools: ['*'],
    deniedTools: [],
    approvalRequiredTools: [],
    approvalMode: 'never',
    ...overrides,
  };
}

function fixture(
  options: {
    tools?: Array<Record<string, unknown>>;
    discoveryError?: Error;
    callResult?: unknown;
    approval?: 'pending' | 'approved';
    environment?: NodeJS.ProcessEnv;
    journal?: RunEventJournalService;
  } = {}
) {
  const requests: Array<{ method: string; params: Record<string, unknown> }> = [];
  const open = vi.fn(async (runtimeDefinition: ToolServerDefinition) => ({
    async request(method: string, params: Record<string, unknown>) {
      requests.push({ method, params });
      if (options.discoveryError && method === 'initialize') throw options.discoveryError;
      if (method === 'initialize') {
        return {
          protocolVersion: '2025-06-18',
          serverInfo: { name: 'fixture', version: runtimeDefinition.version },
        };
      }
      if (method === 'tools/list') {
        return {
          tools: options.tools ?? [
            {
              name: 'search',
              description: 'Search records',
              inputSchema: {
                type: 'object',
                properties: { query: { type: 'string' } },
                required: ['query'],
                additionalProperties: false,
              },
            },
          ],
        };
      }
      if (method === 'tools/call') {
        return options.callResult ?? { content: [{ type: 'text', text: 'found' }] };
      }
      throw new Error(`Unexpected ${method}`);
    },
    async notify() {},
    async close() {},
  }));
  const dedupeKeys = new Set<string>();
  let eventNumber = 0;
  const append = vi.fn(async (input: { dedupeKey?: string }) => {
    const appended = !input.dedupeKey || !dedupeKeys.has(input.dedupeKey);
    if (input.dedupeKey) dedupeKeys.add(input.dedupeKey);
    eventNumber += 1;
    return {
      appended,
      event: {
        eventId: `event-${eventNumber}`,
      } as RunEventEnvelope,
    };
  });
  const requestApproval = vi.fn(async () => ({
    id: 'runapproval_fixture001',
    status: options.approval ?? 'approved',
    revision: 1,
    actionHash: 'action-hash',
  }));
  const service = new ToolControlPlaneService({
    repository: new InMemoryToolControlPlaneRepository(),
    runtime: { open },
    journal: options.journal ?? ({ append } as unknown as RunEventJournalService),
    approvals: { request: requestApproval } as unknown as RunApprovalBrokerService,
    now: () => new Date('2026-07-24T12:00:00.000Z'),
    environment: options.environment ?? {},
  });
  return { service, open, requests, append, requestApproval };
}

function transportService() {
  let eventNumber = 0;
  return new ToolControlPlaneService({
    repository: new InMemoryToolControlPlaneRepository(),
    journal: {
      append: vi.fn(async () => ({
        appended: true,
        event: { eventId: `transport-event-${++eventNumber}` } as RunEventEnvelope,
      })),
    } as unknown as RunEventJournalService,
    now: () => new Date('2026-07-24T12:00:00.000Z'),
    environment: {},
  });
}

async function catalog(
  service: ToolControlPlaneService,
  overrides: Partial<ToolServerDefinitionInput> = {}
) {
  await service.createDefinition(definition(overrides));
  return service.prepareRunCatalog({
    taskId: 'task-tools',
    attemptId: 'attempt-tools',
    provider: 'codex-app-server',
    providerRuntimeManifestDigest: DIGEST,
    taskEnvelopeDigest: DIGEST,
    serverIds: ['fixture'],
    cwd: '/tmp/worktree',
  });
}

describe('ToolControlPlaneService', () => {
  it('verifies runtime health before reusing cached schemas and invalidates on definition change', async () => {
    const { service, open, requests } = fixture();
    const created = await service.createDefinition(definition());
    const first = await service.discover(created.id);
    const cached = await service.discover(created.id);
    expect(cached.digest).toBe(first.digest);
    expect(open).toHaveBeenCalledTimes(2);
    expect(requests.filter((request) => request.method === 'tools/list')).toHaveLength(1);

    await service.updateDefinition(created.id, definition({ version: '1.1.0' }));
    const refreshed = await service.discover(created.id);
    expect(refreshed.definitionDigest).not.toBe(first.definitionDigest);
    expect(open).toHaveBeenCalledTimes(3);
    expect(requests.filter((request) => request.method === 'tools/list')).toHaveLength(2);
  });

  it('supervises a real stdio MCP lifecycle without a shell', async () => {
    const service = transportService();
    const serverScript = [
      "process.stdin.setEncoding('utf8');",
      "let buffer = '';",
      "process.stdin.on('data', chunk => {",
      'buffer += chunk;',
      "const lines = buffer.split(/\\r?\\n/); buffer = lines.pop() || '';",
      'for (const line of lines) {',
      'if (!line.trim()) continue;',
      'const request = JSON.parse(line);',
      'if (request.id == null) continue;',
      "const result = request.method === 'initialize'",
      "? { protocolVersion: '2025-06-18', serverInfo: { name: 'fixture', version: '1.0.0' } }",
      ": request.method === 'tools/list'",
      "? { tools: [{ name: 'echo', inputSchema: { type: 'object' } }] }",
      ": { content: [{ type: 'text', text: 'echoed' }] };",
      "process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) + '\\n');",
      '}',
      '});',
    ].join('');
    await service.createDefinition(
      definition({
        transport: {
          kind: 'stdio',
          command: process.execPath,
          args: ['-e', serverScript],
          environmentKeys: [],
          credentialReferences: [],
        },
      })
    );
    await service.prepareRunCatalog({
      taskId: 'task-stdio',
      attemptId: 'attempt-stdio',
      provider: 'codex-app-server',
      providerRuntimeManifestDigest: DIGEST,
      taskEnvelopeDigest: DIGEST,
      serverIds: ['fixture'],
    });
    await expect(
      service.invoke(
        {
          taskId: 'task-stdio',
          attemptId: 'attempt-stdio',
          serverId: 'fixture',
          tool: 'echo',
          arguments: {},
          operationId: 'stdio-call',
        },
        'agent-a'
      )
    ).resolves.toMatchObject({ content: [{ type: 'text', text: 'echoed' }] });
    await service.closeRun('task-stdio', 'attempt-stdio');
  });

  it('uses Streamable HTTP session identity and closes the run session', async () => {
    const requests: Array<{ method: string; session?: string; protocol?: string }> = [];
    const server = createServer(async (request, response) => {
      requests.push({
        method: request.method ?? '',
        session: request.headers['mcp-session-id'] as string | undefined,
        protocol: request.headers['mcp-protocol-version'] as string | undefined,
      });
      if (request.method === 'DELETE') {
        response.writeHead(204).end();
        return;
      }
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const record = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
        id?: number;
        method: string;
      };
      if (record.id == null) {
        response.writeHead(202, { 'mcp-session-id': 'session-http' }).end();
        return;
      }
      const result =
        record.method === 'initialize'
          ? {
              protocolVersion: '2025-06-18',
              serverInfo: { name: 'fixture', version: '1.0.0' },
            }
          : record.method === 'tools/list'
            ? { tools: [{ name: 'echo', inputSchema: { type: 'object' } }] }
            : { content: [{ type: 'text', text: 'http-echoed' }] };
      response
        .writeHead(200, {
          'content-type': 'application/json',
          'mcp-session-id': 'session-http',
        })
        .end(JSON.stringify({ jsonrpc: '2.0', id: record.id, result }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address() as AddressInfo;
      const service = transportService();
      await service.createDefinition(
        definition({
          transport: {
            kind: 'http',
            url: `http://127.0.0.1:${address.port}/mcp`,
            headers: [],
            credentialReferences: [],
          },
        })
      );
      await service.prepareRunCatalog({
        taskId: 'task-http',
        attemptId: 'attempt-http',
        provider: 'claude-code',
        providerRuntimeManifestDigest: DIGEST,
        taskEnvelopeDigest: DIGEST,
        serverIds: ['fixture'],
      });
      await expect(
        service.invoke(
          {
            taskId: 'task-http',
            attemptId: 'attempt-http',
            serverId: 'fixture',
            tool: 'echo',
            arguments: {},
            operationId: 'http-call',
          },
          'agent-a'
        )
      ).resolves.toMatchObject({
        content: [{ type: 'text', text: 'http-echoed' }],
      });
      await service.closeRun('task-http', 'attempt-http');
      expect(requests.at(-1)).toEqual({
        method: 'DELETE',
        session: 'session-http',
        protocol: '2025-06-18',
      });
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    }
  });

  it('compiles an immutable catalog with deny and approval policy decisions', async () => {
    const { service } = fixture({
      tools: [
        { name: 'read', inputSchema: { type: 'object' } },
        { name: 'write', inputSchema: { type: 'object' } },
        { name: 'delete', inputSchema: { type: 'object' } },
      ],
    });
    await service.createDefinition(
      definition({
        deniedTools: ['delete'],
        approvalRequiredTools: ['write'],
      })
    );
    const runCatalog = await service.prepareRunCatalog({
      taskId: 'task-tools',
      attemptId: 'attempt-tools',
      provider: 'codex-app-server',
      providerRuntimeManifestDigest: DIGEST,
      taskEnvelopeDigest: DIGEST,
      serverIds: ['fixture'],
    });
    expect(runCatalog?.entries[0]?.tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'read', decision: 'allow' }),
        expect.objectContaining({ name: 'write', decision: 'approval' }),
        expect.objectContaining({ name: 'delete', decision: 'deny' }),
      ])
    );
    expect(await service.getRunCatalog('task-tools', 'attempt-tools')).toEqual(runCatalog);
  });

  it('blocks required discovery failures and records optional failures as degraded', async () => {
    const required = fixture({ discoveryError: new Error('offline') });
    await required.service.createDefinition(definition());
    await expect(
      required.service.prepareRunCatalog({
        taskId: 'task-tools',
        attemptId: 'attempt-tools',
        provider: 'claude-code',
        providerRuntimeManifestDigest: DIGEST,
        taskEnvelopeDigest: DIGEST,
        serverIds: ['fixture'],
      })
    ).rejects.toThrow('failed discovery');

    const optional = fixture({ discoveryError: new Error('offline') });
    await optional.service.createDefinition(definition({ requirement: 'optional' }));
    const runCatalog = await optional.service.prepareRunCatalog({
      taskId: 'task-tools',
      attemptId: 'attempt-tools',
      provider: 'claude-code',
      providerRuntimeManifestDigest: DIGEST,
      taskEnvelopeDigest: DIGEST,
      serverIds: ['fixture'],
    });
    expect(runCatalog?.entries[0]).toMatchObject({ status: 'degraded', error: 'offline' });
    expect(optional.append).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'run.error',
        payload: expect.objectContaining({
          serverId: 'fixture',
          optional: true,
          phase: 'tool-discovery',
        }),
      })
    );

    for (const inputSchema of [
      { type: 'not-a-json-schema-type' },
      {
        type: 'object',
        properties: {
          apiKey: { type: 'string', default: 'sk_abcdefgh' },
        },
      },
    ]) {
      const invalidSchema = fixture({
        tools: [{ name: 'unsafe', inputSchema }],
      });
      await invalidSchema.service.createDefinition(definition());
      await expect(
        invalidSchema.service.prepareRunCatalog({
          taskId: 'task-schema',
          attemptId: `attempt-${String(inputSchema.type)}`,
          provider: 'codex-app-server',
          providerRuntimeManifestDigest: DIGEST,
          taskEnvelopeDigest: DIGEST,
          serverIds: ['fixture'],
        })
      ).rejects.toThrow('failed discovery');
    }
  });

  it('fails closed on credential references until brokered launch handles are active', async () => {
    const { service } = fixture();
    await expect(
      service.createDefinition(
        definition({
          transport: {
            kind: 'stdio',
            command: '/usr/bin/fixture',
            args: ['--api-key', 'literal-value'],
            environmentKeys: [],
            credentialReferences: [],
          },
        })
      )
    ).rejects.toThrow('Credential-shaped tool server arguments');
    await service.createDefinition(
      definition({
        transport: {
          kind: 'stdio',
          command: '/usr/bin/fixture',
          args: [],
          environmentKeys: ['FIXTURE_TOKEN'],
          credentialReferences: [],
        },
      })
    );
    await expect(service.discover('fixture')).rejects.toThrow('brokered provider launch handles');

    const optional = fixture();
    await optional.service.createDefinition(
      definition({
        requirement: 'optional',
        transport: {
          kind: 'stdio',
          command: '/usr/bin/fixture',
          args: [],
          environmentKeys: [],
          credentialReferences: ['github-token'],
        },
      })
    );
    await expect(
      optional.service.prepareRunCatalog({
        taskId: 'task-tools',
        attemptId: 'attempt-tools',
        provider: 'codex-app-server',
        providerRuntimeManifestDigest: DIGEST,
        taskEnvelopeDigest: DIGEST,
        serverIds: ['fixture'],
      })
    ).resolves.toMatchObject({
      entries: [
        expect.objectContaining({
          status: 'degraded',
          error: expect.stringContaining('brokered provider launch handles'),
        }),
      ],
    });
  });

  it('validates, dispatches, journals, and rejects replay of an allowed tool call', async () => {
    const { service, requests, append, open } = fixture();
    await catalog(service);
    const request = {
      taskId: 'task-tools',
      attemptId: 'attempt-tools',
      serverId: 'fixture',
      tool: 'search',
      arguments: { query: 'kanban' },
      operationId: 'operation-1',
    };
    await expect(
      Promise.all([
        service.invoke(request, 'agent-a'),
        service.invoke({ ...request, operationId: 'operation-2' }, 'agent-a'),
      ])
    ).resolves.toEqual([
      expect.objectContaining({ isError: false, eventId: expect.any(String) }),
      expect.objectContaining({ isError: false, eventId: expect.any(String) }),
    ]);
    expect(requests).toContainEqual({
      method: 'tools/call',
      params: { name: 'search', arguments: { query: 'kanban' } },
    });
    expect(requests.filter((entry) => entry.method === 'tools/call')).toHaveLength(2);
    expect(open).toHaveBeenCalledTimes(2);
    expect(append).toHaveBeenCalledTimes(4);
    await expect(service.invoke(request, 'agent-a')).rejects.toThrow('already dispatched');
  });

  it('redacts credential-shaped tool inputs and results in replayable events', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vk-tool-events-'));
    roots.push(root);
    const journal = new RunEventJournalService(new FileRunEventRepository(root));
    const { service } = fixture({
      journal,
      tools: [
        {
          name: 'lookup',
          inputSchema: {
            type: 'object',
            properties: { apiKey: { type: 'string' } },
            required: ['apiKey'],
          },
        },
      ],
      callResult: { content: [{ type: 'text', text: 'found' }], token: 'result-secret' },
    });
    await catalog(service);
    await service.invoke(
      {
        taskId: 'task-tools',
        attemptId: 'attempt-tools',
        serverId: 'fixture',
        tool: 'lookup',
        arguments: { apiKey: 'input-secret' },
        operationId: 'redaction-call',
      },
      'agent-a'
    );
    const page = await journal.list({
      taskId: 'task-tools',
      attemptId: 'attempt-tools',
      limit: 10,
    });
    expect(JSON.stringify(page.events)).not.toContain('input-secret');
    expect(JSON.stringify(page.events)).not.toContain('result-secret');
    expect(page.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ redaction: expect.objectContaining({ status: 'redacted' }) }),
      ])
    );
  });

  it('fails before dispatch on invalid input, denied policy, or pending approval', async () => {
    const invalid = fixture();
    await catalog(invalid.service);
    await expect(
      invalid.service.invoke(
        {
          taskId: 'task-tools',
          attemptId: 'attempt-tools',
          serverId: 'fixture',
          tool: 'search',
          arguments: {},
          operationId: 'operation-invalid',
        },
        'agent-a'
      )
    ).rejects.toThrow('discovered input schema');

    const denied = fixture();
    await catalog(denied.service, { deniedTools: ['search'] });
    await expect(
      denied.service.invoke(
        {
          taskId: 'task-tools',
          attemptId: 'attempt-tools',
          serverId: 'fixture',
          tool: 'search',
          arguments: { query: 'kanban' },
          operationId: 'operation-denied',
        },
        'agent-a'
      )
    ).rejects.toThrow('denies');

    const pending = fixture({ approval: 'pending' });
    await catalog(pending.service, { approvalRequiredTools: ['search'] });
    await expect(
      pending.service.invoke(
        {
          taskId: 'task-tools',
          attemptId: 'attempt-tools',
          serverId: 'fixture',
          tool: 'search',
          arguments: { query: 'kanban' },
          operationId: 'operation-approval',
        },
        'agent-a'
      )
    ).rejects.toMatchObject({
      details: expect.objectContaining({ approvalId: 'runapproval_fixture001' }),
    });

    const drifted = fixture();
    await catalog(drifted.service);
    await drifted.service.updateDefinition('fixture', definition({ version: '2.0.0' }));
    await expect(
      drifted.service.invoke(
        {
          taskId: 'task-tools',
          attemptId: 'attempt-tools',
          serverId: 'fixture',
          tool: 'search',
          arguments: { query: 'kanban' },
          operationId: 'operation-drifted',
        },
        'agent-a'
      )
    ).rejects.toThrow('drifted');
    expect(drifted.append).not.toHaveBeenCalled();
  });

  it('exposes only directly allowed tools to native providers without persisting values', async () => {
    const { service } = fixture({
      environment: { FIXTURE_REGION: 'secret-value' },
      tools: [
        { name: 'search', inputSchema: { type: 'object' } },
        { name: 'read', inputSchema: { type: 'object' } },
      ],
    });
    const runCatalog = await catalog(service, {
      approvalRequiredTools: ['search'],
      transport: {
        kind: 'stdio',
        command: '/usr/bin/fixture',
        args: ['serve'],
        environmentKeys: ['FIXTURE_REGION'],
        credentialReferences: [],
      },
    });
    if (!runCatalog) throw new Error('Expected a run tool catalog.');
    const provider = await service.providerConfig(runCatalog);
    const claude = await service.claudeConfig(runCatalog);
    expect(provider).toMatchObject({
      fixture: {
        command: '/usr/bin/fixture',
        args: ['serve'],
        enabled_tools: ['read'],
        disabled_tools: ['search'],
      },
    });
    expect(claude).toEqual({
      config: {
        mcpServers: {
          fixture: { command: '/usr/bin/fixture', args: ['serve'] },
        },
      },
      allowedToolNames: ['mcp__fixture__read'],
    });
    expect(JSON.stringify({ provider, claude, runCatalog })).not.toContain('secret-value');
  });
});

describe('tool control plane repositories', () => {
  it('round-trips definitions and catalogs through file storage', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vk-tool-file-'));
    roots.push(root);
    const repository = new FileToolControlPlaneRepository(path.join(root, 'state.json'));
    const { service } = fixture();
    const runCatalog = await catalog(service);
    if (!runCatalog) throw new Error('Expected a run tool catalog.');
    const created = await service.getDefinition('fixture');
    await repository.saveDefinition(created);
    await repository.saveRunCatalog(runCatalog);
    expect(await repository.getDefinition(created.id)).toEqual(created);
    expect(await repository.getRunCatalog('task-tools', 'attempt-tools')).toEqual(runCatalog);
  });

  it('round-trips definitions and immutable catalogs through SQLite migration 21', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vk-tool-sqlite-'));
    roots.push(root);
    const database = new SqliteDatabase({ filename: path.join(root, 'veritas.db') });
    database.open();
    try {
      const repository = new SqliteToolControlPlaneRepository(database);
      const { service } = fixture();
      const runCatalog = await catalog(service);
      if (!runCatalog) throw new Error('Expected a run tool catalog.');
      const created = await service.getDefinition('fixture');
      await repository.saveDefinition(created);
      await repository.saveRunCatalog(runCatalog);
      expect(await repository.getDefinition(created.id)).toEqual(created);
      expect(await repository.getRunCatalog('task-tools', 'attempt-tools')).toEqual(runCatalog);
      await expect(
        repository.saveRunCatalog({
          ...runCatalog,
          digest: `sha256:${'b'.repeat(64)}`,
        })
      ).rejects.toThrow('identity was reused');
    } finally {
      database.close();
    }
  });
});
