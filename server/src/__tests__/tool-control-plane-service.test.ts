import fs from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  CredentialDefinition,
  CredentialDefinitionInput,
  RunEventEnvelope,
  ToolServerDefinition,
  ToolServerDefinitionInput,
} from '@veritas-kanban/shared';
import { ToolControlPlaneService } from '../services/tool-control-plane-service.js';
import {
  CredentialBrokerService,
  EnvironmentCredentialSecretSource,
} from '../services/credential-broker-service.js';
import type { RunApprovalBrokerService } from '../services/run-approval-broker-service.js';
import { RunEventJournalService } from '../services/run-event-journal-service.js';
import { FileRunEventRepository } from '../storage/run-event-repository.js';
import { InMemoryCredentialBrokerRepository } from '../storage/credential-broker-repository.js';
import {
  FileToolControlPlaneRepository,
  InMemoryToolControlPlaneRepository,
} from '../storage/tool-control-plane-repository.js';
import { SqliteDatabase } from '../storage/sqlite/database.js';
import { SqliteToolControlPlaneRepository } from '../storage/sqlite/tool-control-plane-repository.js';
import { calculateCredentialDefinitionDigest } from '../utils/credential-broker-digest.js';

const DIGEST = `sha256:${'a'.repeat(64)}`;
const MANIFEST_DIGEST = `sha256:${'f'.repeat(64)}`;
const CREDENTIAL_SECRET = 'credential-sensitive-value';
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

function credentialDefinition(
  overrides: Partial<CredentialDefinitionInput> = {}
): CredentialDefinition {
  const input: CredentialDefinitionInput = {
    id: 'github-token',
    name: 'GitHub token',
    enabled: true,
    source: {
      kind: 'environment',
      reference: 'FIXTURE_TOKEN',
    },
    scope: {
      dispatchTypes: ['mcp'],
      hosts: [],
      tools: ['search'],
      destinations: [],
      methods: [],
      actions: ['fixture.search'],
      pathPrefixes: [],
    },
    lease: {
      ttlSeconds: 60,
      maxUses: 1,
      renewable: false,
    },
    approval: 'not-required',
    ...overrides,
  };
  const payload = {
    ...input,
    schemaVersion: 'credential-definition/v1' as const,
    createdAt: '2026-07-24T12:00:00.000Z',
    updatedAt: '2026-07-24T12:00:00.000Z',
  };
  return {
    ...payload,
    digest: calculateCredentialDefinitionDigest(payload),
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
    credentialDefinitions?: CredentialDefinition[];
    credentialBroker?: Pick<
      CredentialBrokerService,
      'getDefinition' | 'issueLease' | 'withCredential'
    >;
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
    credentialBroker:
      options.credentialBroker ??
      ({
        getDefinition: vi.fn(async (id: string) => {
          const credential = options.credentialDefinitions?.find(
            (candidate) => candidate.id === id
          );
          return credential ? structuredClone(credential) : null;
        }),
        issueLease: vi.fn(async () => {
          throw new Error('Credential lease fixture was not configured.');
        }),
        withCredential: vi.fn(async () => {
          throw new Error('Credential use fixture was not configured.');
        }),
      } as unknown as Pick<
        CredentialBrokerService,
        'getDefinition' | 'issueLease' | 'withCredential'
      >),
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

  it('maps an all-allow run catalog to ACP session MCP configuration', async () => {
    const { service } = fixture();
    const runCatalog = await catalog(service);

    await expect(service.acpConfig(runCatalog)).resolves.toEqual([
      {
        name: 'Fixture tools',
        command: '/usr/bin/fixture',
        args: ['serve'],
        env: [],
      },
    ]);
  });

  it('fails ACP native MCP configuration closed when per-tool restrictions cannot be enforced', async () => {
    const { service } = fixture({
      tools: [
        { name: 'read', inputSchema: { type: 'object' } },
        { name: 'delete', inputSchema: { type: 'object' } },
      ],
    });
    const runCatalog = await catalog(service, { deniedTools: ['delete'] });

    await expect(service.acpConfig(runCatalog)).rejects.toThrow(
      'cannot enforce a partially restricted native MCP tool catalog'
    );
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

  it('compiles value-free credential evidence and omits brokered servers from native injection', async () => {
    const credential = credentialDefinition();
    const { service, open } = fixture({
      environment: { FIXTURE_TOKEN: 'credential-sensitive-value' },
      credentialDefinitions: [credential],
    });
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
    const runCatalog = await catalog(service, {
      transport: {
        kind: 'stdio',
        command: '/usr/bin/fixture',
        args: [],
        environmentKeys: ['FIXTURE_TOKEN'],
        credentialReferences: ['github-token'],
      },
    });
    if (!runCatalog) throw new Error('Expected a run tool catalog.');

    expect(open).toHaveBeenCalledWith(
      expect.objectContaining({
        transport: expect.objectContaining({ environmentKeys: [] }),
      }),
      '/tmp/worktree'
    );
    expect(runCatalog.entries[0].credentialBindings).toEqual([
      {
        credentialReference: 'github-token',
        credentialDefinitionDigest: credential.digest,
        scopeDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
        target: { kind: 'environment', name: 'FIXTURE_TOKEN' },
      },
    ]);
    expect(await service.providerConfig(runCatalog)).toEqual({});
    expect(await service.claudeConfig(runCatalog)).toEqual({
      config: { mcpServers: {} },
      allowedToolNames: [],
    });
    expect(await service.acpConfig(runCatalog)).toEqual([]);
    expect(await service.environmentKeys(runCatalog)).toEqual([]);
    expect(JSON.stringify({ runCatalog })).not.toContain('credential-sensitive-value');
    await expect(
      service.invoke(
        {
          taskId: 'task-tools',
          attemptId: 'attempt-tools',
          serverId: 'fixture',
          tool: 'search',
          arguments: { query: 'kanban' },
          operationId: 'brokered-before-lease-consumption',
        },
        'agent-a'
      )
    ).rejects.toThrow('server-owned launch manifest digest');
  });

  it('issues, consumes, dispatches, and revokes a credential lease inside one mediated call', async () => {
    const repository = new InMemoryCredentialBrokerRepository();
    let handleSequence = 0;
    const credentialEnvironment: NodeJS.ProcessEnv = {
      FIXTURE_TOKEN: CREDENTIAL_SECRET,
    };
    const broker = new CredentialBrokerService({
      repository,
      secretSources: [new EnvironmentCredentialSecretSource(credentialEnvironment)],
      runBindings: {
        read: vi.fn(async () => ({
          taskId: 'task-tools',
          attemptId: 'attempt-tools',
          status: 'running' as const,
          runLaunchManifestDigest: MANIFEST_DIGEST,
          credentialReferences: ['github-token'],
        })),
      },
      audit: vi.fn(async () => undefined),
      createHandle: () => `vkcred_tool_bridge_fixture_${++handleSequence}`,
      now: () => new Date('2026-07-24T12:00:00.000Z'),
    });
    const {
      schemaVersion: _schemaVersion,
      digest: _digest,
      createdAt: _createdAt,
      updatedAt: _updatedAt,
      ...credentialInput
    } = credentialDefinition({
      lease: { ttlSeconds: 60, maxUses: 2, renewable: false },
    });
    await broker.createDefinition(credentialInput);
    const { service, open, append } = fixture({ credentialBroker: broker });
    const runCatalog = await catalog(service, {
      transport: {
        kind: 'stdio',
        command: '/usr/bin/fixture',
        args: [],
        environmentKeys: ['FIXTURE_TOKEN'],
        credentialReferences: ['github-token'],
      },
    });
    if (!runCatalog) throw new Error('Expected a run tool catalog.');

    const result = await service.invoke(
      {
        taskId: 'task-tools',
        attemptId: 'attempt-tools',
        serverId: 'fixture',
        tool: 'search',
        arguments: { query: 'kanban' },
        operationId: 'brokered-operation',
      },
      'agent-a',
      '/tmp/worktree',
      MANIFEST_DIGEST
    );

    expect(result).toMatchObject({
      serverId: 'fixture',
      tool: 'search',
      isError: false,
    });
    expect(open.mock.calls.at(-1)?.[2]).toEqual({
      environment: { FIXTURE_TOKEN: CREDENTIAL_SECRET },
      headers: {},
    });
    expect(append).toHaveBeenCalledTimes(2);
    expect(JSON.stringify({ runCatalog, result })).not.toContain(CREDENTIAL_SECRET);
    expect(await broker.listLeases()).toEqual([
      expect.objectContaining({
        definitionId: 'github-token',
        state: 'active',
        uses: 1,
        runLaunchManifestDigest: MANIFEST_DIGEST,
      }),
    ]);
    await expect(
      service.invoke(
        {
          taskId: 'task-tools',
          attemptId: 'attempt-tools',
          serverId: 'fixture',
          tool: 'search',
          arguments: { query: 'changed' },
          operationId: 'brokered-operation',
        },
        'agent-a',
        '/tmp/worktree',
        MANIFEST_DIGEST
      )
    ).rejects.toThrow('already dispatched');
    await expect(
      service.invoke(
        {
          taskId: 'task-tools',
          attemptId: 'attempt-tools',
          serverId: 'fixture',
          tool: 'search',
          arguments: { query: 'kanban' },
          operationId: 'stale-manifest-operation',
        },
        'agent-a',
        '/tmp/worktree',
        `sha256:${'e'.repeat(64)}`
      )
    ).rejects.toThrow('run or launch manifest binding is stale');
    delete credentialEnvironment.FIXTURE_TOKEN;
    await expect(
      service.invoke(
        {
          taskId: 'task-tools',
          attemptId: 'attempt-tools',
          serverId: 'fixture',
          tool: 'search',
          arguments: { query: 'kanban' },
          operationId: 'source-unavailable-operation',
        },
        'agent-a',
        '/tmp/worktree',
        MANIFEST_DIGEST
      )
    ).rejects.toThrow('source is unavailable');

    await broker.revokeRun({
      taskId: 'task-tools',
      attemptId: 'attempt-tools',
      runLaunchManifestDigest: MANIFEST_DIGEST,
      reason: 'run-completed',
    });
    expect(await broker.listLeases()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ state: 'revoked', terminalReason: 'run-completed' }),
        expect.objectContaining({ state: 'blocked', terminalReason: 'source-unavailable' }),
      ])
    );
  });

  it('correlates credential approval with the exact durable tool action', async () => {
    const verifyApproval = vi.fn(
      async ({
        actionFingerprint,
        approvalId,
        operationId,
      }: {
        actionFingerprint: string;
        approvalId?: string;
        operationId?: string;
      }) => ({
        approved: approvalId === 'runapproval_fixture001' && operationId === 'approval-operation',
        approvalId,
        actionFingerprint,
      })
    );
    const broker = new CredentialBrokerService({
      repository: new InMemoryCredentialBrokerRepository(),
      secretSources: [
        new EnvironmentCredentialSecretSource({
          FIXTURE_TOKEN: CREDENTIAL_SECRET,
        }),
      ],
      runBindings: {
        read: vi.fn(async () => ({
          taskId: 'task-tools',
          attemptId: 'attempt-tools',
          status: 'running' as const,
          runLaunchManifestDigest: MANIFEST_DIGEST,
          credentialReferences: ['github-token'],
        })),
      },
      approvals: { verify: verifyApproval },
      audit: vi.fn(async () => undefined),
      createHandle: () => 'vkcred_tool_approval_fixture',
      now: () => new Date('2026-07-24T12:00:00.000Z'),
    });
    const {
      schemaVersion: _schemaVersion,
      digest: _digest,
      createdAt: _createdAt,
      updatedAt: _updatedAt,
      ...credentialInput
    } = credentialDefinition({ approval: 'required' });
    await broker.createDefinition(credentialInput);
    const { service } = fixture({ credentialBroker: broker, approval: 'approved' });
    await catalog(service, {
      transport: {
        kind: 'stdio',
        command: '/usr/bin/fixture',
        args: [],
        environmentKeys: ['FIXTURE_TOKEN'],
        credentialReferences: ['github-token'],
      },
    });
    const invocation = {
      taskId: 'task-tools',
      attemptId: 'attempt-tools',
      serverId: 'fixture',
      tool: 'search',
      arguments: { query: 'kanban' },
      operationId: 'approval-operation',
    };

    await expect(
      service.invoke(
        { ...invocation, approvalId: 'wrong-approval' },
        'agent-a',
        '/tmp/worktree',
        MANIFEST_DIGEST
      )
    ).rejects.toThrow('Approval identity does not match');
    await expect(
      service.invoke(
        { ...invocation, approvalId: 'runapproval_fixture001' },
        'agent-a',
        '/tmp/worktree',
        MANIFEST_DIGEST
      )
    ).resolves.toMatchObject({ isError: false });
    expect(verifyApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        approvalId: 'runapproval_fixture001',
        operationId: 'approval-operation',
        actionFingerprint: expect.stringMatching(/^sha256:/),
      })
    );
  });

  it('fails closed when credential evidence is missing, disabled, out of scope, or unmapped', async () => {
    const cases = [
      {
        name: 'missing',
        credentials: [],
        transport: {
          kind: 'stdio' as const,
          command: '/usr/bin/fixture',
          args: [],
          environmentKeys: ['FIXTURE_TOKEN'],
          credentialReferences: ['github-token'],
        },
      },
      {
        name: 'disabled',
        credentials: [credentialDefinition({ enabled: false })],
        transport: {
          kind: 'stdio' as const,
          command: '/usr/bin/fixture',
          args: [],
          environmentKeys: ['FIXTURE_TOKEN'],
          credentialReferences: ['github-token'],
        },
      },
      {
        name: 'out of scope',
        credentials: [
          credentialDefinition({
            scope: {
              ...credentialDefinition().scope,
              tools: ['other'],
              actions: ['fixture.other'],
            },
          }),
        ],
        transport: {
          kind: 'stdio' as const,
          command: '/usr/bin/fixture',
          args: [],
          environmentKeys: ['FIXTURE_TOKEN'],
          credentialReferences: ['github-token'],
        },
      },
      {
        name: 'unmapped',
        credentials: [credentialDefinition()],
        transport: {
          kind: 'stdio' as const,
          command: '/usr/bin/fixture',
          args: [],
          environmentKeys: [],
          credentialReferences: ['github-token'],
        },
      },
    ];

    for (const candidate of cases) {
      const { service } = fixture({ credentialDefinitions: candidate.credentials });
      await service.createDefinition(
        definition({
          transport: candidate.transport,
        })
      );
      await expect(
        service.prepareRunCatalog({
          taskId: 'task-tools',
          attemptId: `attempt-${candidate.name.replaceAll(' ', '-')}`,
          provider: 'codex-app-server',
          providerRuntimeManifestDigest: DIGEST,
          taskEnvelopeDigest: DIGEST,
          serverIds: ['fixture'],
        })
      ).rejects.toThrow();
    }
  });

  it('rejects credential definition drift after catalog compilation', async () => {
    const definitions = [credentialDefinition()];
    const { service } = fixture({ credentialDefinitions: definitions });
    const runCatalog = await catalog(service, {
      transport: {
        kind: 'stdio',
        command: '/usr/bin/fixture',
        args: [],
        environmentKeys: ['FIXTURE_TOKEN'],
        credentialReferences: ['github-token'],
      },
    });
    if (!runCatalog) throw new Error('Expected a run tool catalog.');
    definitions[0] = credentialDefinition({
      lease: { ttlSeconds: 120, maxUses: 1, renewable: false },
    });

    await expect(service.providerConfig(runCatalog)).rejects.toThrow('drifted');
  });

  it('keeps unbound credential-shaped environment keys fail closed', async () => {
    const { service } = fixture();
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
    await expect(service.discover('fixture')).rejects.toThrow('exact broker definitions');
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
