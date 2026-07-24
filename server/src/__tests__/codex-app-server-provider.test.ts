import { describe, expect, it, vi } from 'vitest';
import {
  CODEX_APP_SERVER_CERTIFIED_BUILD,
  CODEX_APP_SERVER_CERTIFIED_VERSION,
  CODEX_APP_SERVER_MAX_RECORD_BYTES,
  CODEX_APP_SERVER_OUTBOUND_METHODS,
  CodexAppServerRpcClient,
  buildCodexAppServerArgs,
  buildSafeCodexAppServerEnv,
  classifyCodexAppServerNotification,
  isCodexAppServerOutboundMethod,
  parseCodexAppServerLine,
} from '../services/codex-app-server-adapter.js';
import { normalizeHarnessSupportProfile } from '../services/harness-support-profile-registry.js';
import { getProviderRuntimeAdapterDefinition } from '../services/provider-runtime-adapter-registry.js';

const THREAD_ID = '019f8f31-b3e2-7240-8108-1e389af04f0e';
const TURN_ID = '019f8f31-b3e2-7240-8108-1e389af04f0f';

function initializeResult() {
  return {
    codexHome: '/tmp/codex-home',
    platformFamily: 'unix',
    platformOs: 'macos',
    userAgent: CODEX_APP_SERVER_CERTIFIED_VERSION,
  };
}

function threadStartResult() {
  return {
    approvalPolicy: 'never',
    approvalsReviewer: 'user',
    cwd: '/tmp/worktree',
    model: 'gpt-5.6',
    modelProvider: 'openai',
    sandbox: { type: 'workspaceWrite', networkAccess: false, writableRoots: [] },
    thread: {
      cliVersion: '0.145.0',
      createdAt: 1,
      cwd: '/tmp/worktree',
      ephemeral: false,
      id: THREAD_ID,
      modelProvider: 'openai',
      preview: 'test prompt',
      sessionId: THREAD_ID,
      source: 'appServer',
      status: { type: 'idle' },
      turns: [],
      updatedAt: 1,
    },
  };
}

function turnStartResult() {
  return {
    turn: {
      id: TURN_ID,
      items: [],
      status: 'inProgress',
    },
  };
}

async function initializeClient(
  writes: string[],
  options: {
    sleep?: (delayMs: number) => Promise<void>;
    random?: () => number;
    onOverloadRetry?: (attempt: number, delayMs: number) => void;
  } = {}
): Promise<CodexAppServerRpcClient> {
  const client = new CodexAppServerRpcClient({
    write: (line) => writes.push(line),
    requestTimeoutMs: 1_000,
    sleep: options.sleep,
    random: options.random,
    onOverloadRetry: (_method, attempt, delayMs) => options.onOverloadRetry?.(attempt, delayMs),
  });
  const initialized = client.initialize();
  await client.acceptRecord({ id: 1, result: initializeResult() });
  await initialized;
  return client;
}

describe('Codex app-server v2 provider', () => {
  it('owns the launch surface and disables inherited extension paths', () => {
    expect(buildCodexAppServerArgs()).toEqual([
      'app-server',
      '--stdio',
      '--strict-config',
      '-c',
      'mcp_servers={}',
      '-c',
      'hooks={}',
      '--disable',
      'plugins',
      '--disable',
      'apps',
      '--disable',
      'in_app_browser',
      '--disable',
      'computer_use',
      '--disable',
      'tool_call_mcp_elicitation',
    ]);
    expect(() => buildCodexAppServerArgs(['thread/shellCommand'])).toThrow(
      'launch arguments are system-owned'
    );
    expect(CODEX_APP_SERVER_OUTBOUND_METHODS).toEqual([
      'initialize',
      'thread/start',
      'turn/start',
      'turn/interrupt',
    ]);
    expect(isCodexAppServerOutboundMethod('thread/shellCommand')).toBe(false);
  });

  it('preserves safe authentication inputs while forcing remote control off', () => {
    const env = buildSafeCodexAppServerEnv(
      {
        PATH: '/usr/bin',
        HOME: '/tmp/home',
        OPENAI_API_KEY: 'allowed-auth',
        CODEX_HOME: '/tmp/codex-home',
        CUSTOM_SAFE: 'custom',
        DATABASE_URL: 'must-not-pass',
        CODEX_INTERNAL_APP_SERVER_REMOTE_CONTROL_DISABLED: '0',
      },
      ['CUSTOM_SAFE', 'DATABASE_URL']
    );

    expect(env).toMatchObject({
      PATH: '/usr/bin',
      HOME: '/tmp/home',
      OPENAI_API_KEY: 'allowed-auth',
      CODEX_HOME: '/tmp/codex-home',
      CUSTOM_SAFE: 'custom',
      CODEX_INTERNAL_APP_SERVER_REMOTE_CONTROL_DISABLED: '1',
    });
    expect(env).not.toHaveProperty('DATABASE_URL');
  });

  it('rejects malformed, non-object, and oversized protocol records', () => {
    expect(parseCodexAppServerLine('{"method":"initialized","params":{}}')).toEqual({
      method: 'initialized',
      params: {},
    });
    expect(() => parseCodexAppServerLine('')).toThrow('empty');
    expect(() => parseCodexAppServerLine('not-json')).toThrow('not valid JSON');
    expect(() => parseCodexAppServerLine('[]')).toThrow('JSON object');
    expect(() =>
      parseCodexAppServerLine(`{"value":"${'x'.repeat(CODEX_APP_SERVER_MAX_RECORD_BYTES)}"}`)
    ).toThrow('4 MiB');
  });

  it('validates the pinned handshake, thread, turn, and interrupt response shapes', async () => {
    const writes: string[] = [];
    const client = await initializeClient(writes);
    expect(JSON.parse(writes[0]!)).toMatchObject({
      id: 1,
      method: 'initialize',
      params: {
        clientInfo: { name: 'veritas_kanban' },
        capabilities: { experimentalApi: false },
      },
    });
    expect(JSON.parse(writes[1]!)).toEqual({ method: 'initialized', params: {} });
    await expect(client.initialize()).rejects.toThrow('already initialized');

    const threadPromise = client.startThread({
      cwd: '/tmp/worktree',
      model: 'gpt-5.6',
      sandboxMode: 'workspace-write',
    });
    expect(JSON.parse(writes[2]!)).toMatchObject({
      id: 2,
      method: 'thread/start',
      params: {
        cwd: '/tmp/worktree',
        model: 'gpt-5.6',
        sandbox: 'workspace-write',
        approvalPolicy: 'never',
      },
    });
    await client.acceptRecord({ id: 2, result: threadStartResult() });
    await expect(threadPromise).resolves.toBe(THREAD_ID);

    const turnPromise = client.startTurn({
      threadId: THREAD_ID,
      prompt: 'Return only: ready',
      cwd: '/tmp/worktree',
    });
    expect(JSON.parse(writes[3]!)).toMatchObject({
      id: 3,
      method: 'turn/start',
      params: {
        threadId: THREAD_ID,
        input: [{ type: 'text', text: 'Return only: ready' }],
        approvalPolicy: 'never',
      },
    });
    await client.acceptRecord({ id: 3, result: turnStartResult() });
    await expect(turnPromise).resolves.toBe(TURN_ID);

    const interruptPromise = client.interrupt(THREAD_ID, TURN_ID);
    expect(JSON.parse(writes[4]!)).toEqual({
      id: 4,
      method: 'turn/interrupt',
      params: { threadId: THREAD_ID, turnId: TURN_ID },
    });
    await client.acceptRecord({ id: 4, result: {} });
    await expect(interruptPromise).resolves.toBeUndefined();
  });

  it('fails closed on uncorrelated and method-invalid responses', async () => {
    const writes: string[] = [];
    const client = await initializeClient(writes);
    await expect(client.acceptRecord({ id: 999, result: {} })).rejects.toThrow(
      'uncorrelated response'
    );

    const threadPromise = client.startThread({
      cwd: '/tmp/worktree',
      sandboxMode: 'read-only',
    });
    const rejectedThread = expect(threadPromise).rejects.toThrow('pinned v0.145.0 schema');
    await expect(
      client.acceptRecord({ id: 2, result: { thread: { id: THREAD_ID } } })
    ).rejects.toThrow('pinned v0.145.0 schema');
    await rejectedThread;
  });

  it('retries overload responses with a bounded deterministic budget', async () => {
    const writes: string[] = [];
    const sleep = vi.fn(async () => {});
    const retry = vi.fn();
    const client = new CodexAppServerRpcClient({
      write: (line) => writes.push(line),
      requestTimeoutMs: 1_000,
      overloadAttempts: 3,
      sleep,
      random: () => 0,
      onOverloadRetry: (_method, attempt, delayMs) => retry(attempt, delayMs),
    });

    const initialized = client.initialize();
    await client.acceptRecord({
      id: 1,
      error: { code: -32_001, message: 'server overloaded' },
    });
    await vi.waitFor(() => expect(writes).toHaveLength(2));
    await client.acceptRecord({
      id: 2,
      error: { code: -32_001, message: 'server overloaded' },
    });
    await vi.waitFor(() => expect(writes).toHaveLength(3));
    await client.acceptRecord({ id: 3, result: initializeResult() });
    await initialized;

    expect(retry).toHaveBeenNthCalledWith(1, 1, 100);
    expect(retry).toHaveBeenNthCalledWith(2, 2, 200);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('denies provider approval and elicitation requests deterministically', async () => {
    const writes: string[] = [];
    const client = await initializeClient(writes);
    const inbound = await client.acceptRecord({
      id: 'approval-1',
      method: 'item/commandExecution/requestApproval',
      params: {
        threadId: THREAD_ID,
        turnId: TURN_ID,
        itemId: 'item-1',
        startedAtMs: 1,
        command: 'echo blocked',
      },
    });

    expect(inbound).toMatchObject({
      kind: 'server-request',
      method: 'item/commandExecution/requestApproval',
      denied: true,
    });
    expect(JSON.parse(writes.at(-1)!)).toEqual({
      id: 'approval-1',
      result: { decision: 'decline' },
    });
  });

  it('classifies streaming, file, usage, and terminal notifications', () => {
    expect(
      classifyCodexAppServerNotification({
        method: 'item/agentMessage/delta',
        params: {
          threadId: THREAD_ID,
          turnId: TURN_ID,
          itemId: 'item-1',
          delta: 'ready',
        },
      })
    ).toMatchObject({
      providerType: 'item/agentMessage/delta',
      summary: 'ready',
      sessionId: THREAD_ID,
      turnId: TURN_ID,
      itemId: 'item-1',
    });

    expect(
      classifyCodexAppServerNotification({
        method: 'item/completed',
        params: {
          threadId: THREAD_ID,
          turnId: TURN_ID,
          completedAtMs: 1,
          item: {
            id: 'item-2',
            type: 'fileChange',
            status: 'completed',
            changes: [
              { path: 'server/src/a.ts', kind: { type: 'update' }, diff: '+change' },
              { path: 'server/src/a.ts', kind: { type: 'update' }, diff: '+change' },
            ],
          },
        },
      })
    ).toMatchObject({ files: ['server/src/a.ts'], itemId: 'item-2' });

    const tokenBreakdown = {
      cachedInputTokens: 2,
      inputTokens: 10,
      outputTokens: 5,
      reasoningOutputTokens: 1,
      totalTokens: 15,
    };
    expect(
      classifyCodexAppServerNotification({
        method: 'thread/tokenUsage/updated',
        params: {
          threadId: THREAD_ID,
          turnId: TURN_ID,
          tokenUsage: { last: tokenBreakdown, total: tokenBreakdown },
        },
      })
    ).toMatchObject({
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    });

    expect(
      classifyCodexAppServerNotification({
        method: 'turn/completed',
        params: {
          threadId: THREAD_ID,
          turn: { id: TURN_ID, items: [], status: 'completed' },
        },
      })
    ).toMatchObject({
      turnId: TURN_ID,
      terminal: { success: true, status: 'completed' },
    });
  });

  it('publishes only the implemented runtime capabilities', () => {
    const adapter = getProviderRuntimeAdapterDefinition('codex-app-server');
    expect(adapter).toMatchObject({
      id: 'codex-app-server',
      protocolVersion: 'codex-app-server-jsonrpc/v2',
    });
    expect(CODEX_APP_SERVER_CERTIFIED_BUILD).toContain(
      'openai/codex@25af12f7e61572b0bc18ddb1008be543b91519b0'
    );
    expect(adapter.capabilities.find(({ id }) => id === 'run.start')?.state).toBe('supported');
    expect(adapter.capabilities.find(({ id }) => id === 'run.interrupt')?.state).toBe('supported');
    expect(adapter.capabilities.find(({ id }) => id === 'run.resume')?.state).toBe('unsupported');
    expect(adapter.capabilities.find(({ id }) => id === 'run.approvals')?.state).toBe(
      'unsupported'
    );
    expect(adapter.capabilities.find(({ id }) => id === 'tool.mcp')?.state).toBe('unsupported');
  });

  it('publishes the same safe environment baseline used by the app-server process', () => {
    const profile = normalizeHarnessSupportProfile({
      type: 'codex-app-server',
      name: 'OpenAI Codex app-server',
      command: 'codex',
      args: [],
      enabled: true,
      provider: 'codex-app-server',
    });

    expect(profile.launch.environmentAllowlist).toEqual(
      expect.arrayContaining(['PATH', 'HOME', 'CODEX_HOME', 'OPENAI_BASE_URL'])
    );
    expect(profile.launch.credentialAllowlist).toEqual(['CODEX_API_KEY', 'OPENAI_API_KEY']);
  });
});
