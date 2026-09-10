import { expect, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { HttpOpenClawTaskAdapter } from '../../services/openclaw-workflow-adapter.js';

export async function startOpenClawCompletionFixture(spawnGateway: typeof spawn = spawn) {
  let root: string;
  let modelServer: Server;
  let gatewayProcess: ChildProcess;
  let adapter: HttpOpenClawTaskAdapter;
  let gatewayLog = '';
  let modelCalls = 0;
  async function close() {
    if (gatewayProcess && gatewayProcess.exitCode === null && gatewayProcess.signalCode === null) {
      const exited = once(gatewayProcess, 'exit');
      gatewayProcess.kill('SIGTERM');
      const timer = setTimeout(() => gatewayProcess.kill('SIGKILL'), 5_000);
      timer.unref();
      try {
        await exited;
      } finally {
        clearTimeout(timer);
      }
    }
    if (modelServer) await new Promise<void>((resolve) => modelServer.close(() => resolve()));
    if (root) await rm(root, { recursive: true, force: true });
  }
  root = await mkdtemp(path.join(tmpdir(), 'vk-openclaw-completion-'));
  const workspace = path.join(root, 'workspace');
  await mkdir(workspace);
  // No real provider credential, external channel, or user gateway configuration is loaded.
  modelServer = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = Buffer.concat(chunks).toString();
    if (request.url === '/v1/models') {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ data: [{ id: 'completion-fixture' }] }));
      return;
    }
    modelCalls++;
    const report = JSON.stringify({
      schemaVersion: 'veritas-openclaw-completion/v1',
      status: body.includes('FIXTURE_OUTCOME_FAILED') ? 'failed' : 'success',
      summary: 'Isolated native child completed',
      ...(body.includes('FIXTURE_OUTCOME_FAILED') ? { error: 'Deliberate fixture failure' } : {}),
    });
    const parsed = JSON.parse(body || '{}');
    if (parsed.stream) {
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.write(
        `data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', model: 'completion-fixture', choices: [{ index: 0, delta: { role: 'assistant', content: report }, finish_reason: null }] })}\n\n`
      );
      response.write(
        `data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', model: 'completion-fixture', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 } })}\n\n`
      );
      response.end('data: [DONE]\n\n');
    } else {
      response.setHeader('content-type', 'application/json');
      response.end(
        JSON.stringify({
          id: 'fixture',
          object: 'chat.completion',
          model: 'completion-fixture',
          choices: [
            { index: 0, message: { role: 'assistant', content: report }, finish_reason: 'stop' },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
        })
      );
    }
  });
  modelServer.listen(0, '127.0.0.1');
  await once(modelServer, 'listening');
  const modelAddress = modelServer.address();
  if (!modelAddress || typeof modelAddress === 'string') throw new Error('model address missing');
  const portReservation = createServer();
  portReservation.listen(0, '127.0.0.1');
  await once(portReservation, 'listening');
  const gatewayAddress = portReservation.address();
  if (!gatewayAddress || typeof gatewayAddress === 'string')
    throw new Error('gateway address missing');
  await new Promise<void>((resolve) => portReservation.close(() => resolve()));
  const token = randomUUID();
  const configPath = path.join(root, 'openclaw.json');
  await writeFile(
    configPath,
    JSON.stringify({
      gateway: {
        mode: 'local',
        bind: 'loopback',
        port: gatewayAddress.port,
        auth: { mode: 'token', token },
        tools: { allow: ['sessions_spawn'] },
      },
      agents: {
        defaults: {
          workspace,
          model: { primary: 'fixture/completion-fixture' },
          heartbeat: { every: '0m' },
        },
        list: [{ id: 'openclaw', default: true, workspace }],
      },
      models: {
        mode: 'replace',
        providers: {
          fixture: {
            baseUrl: `http://127.0.0.1:${modelAddress.port}/v1`,
            api: 'openai-completions',
            apiKey: 'fixture-only',
            models: [
              {
                id: 'completion-fixture',
                name: 'Completion fixture',
                reasoning: false,
                input: ['text'],
                contextWindow: 131072,
                maxTokens: 512,
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
              },
            ],
          },
        },
      },
      tools: { profile: 'coding' },
      plugins: { enabled: true },
    }),
    { mode: 0o600 }
  );
  gatewayProcess = spawnGateway(
    process.env.OPENCLAW_EXECUTABLE || 'openclaw',
    ['gateway', 'run', '--port', String(gatewayAddress.port), '--bind', 'loopback'],
    {
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        TMPDIR: process.env.TMPDIR,
        OPENCLAW_CONFIG_PATH: configPath,
        OPENCLAW_STATE_DIR: root,
        OPENCLAW_NO_RESPAWN: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );
  gatewayProcess.stdout?.on('data', (chunk) => {
    gatewayLog = (gatewayLog + chunk.toString()).slice(-12_000);
  });
  gatewayProcess.stderr?.on('data', (chunk) => {
    gatewayLog = (gatewayLog + chunk.toString()).slice(-12_000);
  });
  adapter = new HttpOpenClawTaskAdapter({
    gatewayUrl: `http://127.0.0.1:${gatewayAddress.port}`,
    token,
  });
  try {
    await vi.waitFor(
      async () => expect((await adapter.probeCompletion()).version).toMatch(/^2026\.9\.2/),
      { timeout: 45_000, interval: 500 }
    );
  } catch (error) {
    await close();
    throw new Error(`${String(error)}\n${gatewayLog.replaceAll(token, '[REDACTED]')}`, {
      cause: error,
    });
  }

  return {
    adapter,
    gatewayUrl: `http://127.0.0.1:${gatewayAddress.port}`,
    token,
    get modelCalls() {
      return modelCalls;
    },
    close,
  };
}
