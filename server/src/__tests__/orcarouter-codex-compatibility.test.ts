import { describe, it, expect } from 'vitest';
/** @smoke Codex CLI 0.155.1 against synthetic localhost Responses only. */
import { createServer } from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { zstdDecompressSync, gunzipSync } from 'node:zlib';
import { buildOrcaRouterCodexArgs, ORCAROUTER_CODEX_VERSION } from '../utils/orcarouter-codex.js';

type Scenario = 'success' | 'unauthenticated' | 'rate-limited' | 'interrupted' | 'cancelled';

interface ResponsesRequest {
  model: string;
  tools?: Array<{ name?: string }>;
  input?: unknown;
}

async function main(scenario: Scenario) {
  const executablePath = process.env.PATH;
  if (!executablePath) throw Error('PATH is required to locate the pinned CLI');
  const version = execFileSync('codex', ['--version'], { encoding: 'utf8' }).trim();
  if (version !== ORCAROUTER_CODEX_VERSION) throw Error('Unexpected CLI version: ' + version);
  const root = await mkdtemp(join(tmpdir(), 'vk-orca-cli-'));
  const home = join(root, 'home');
  await mkdir(home);
  await mkdir(join(home, '.codex'));
  const work = join(root, 'work');
  await mkdir(work);
  let requests = 0,
    sawToolOutput = false;
  let failure = '';
  let cancel = () => {};
  const server = createServer(async (req, res) => {
    try {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(Buffer.from(c));
      let bytes = Buffer.concat(chunks);
      const enc = req.headers['content-encoding'];
      if (enc === 'zstd') bytes = zstdDecompressSync(bytes);
      if (enc === 'gzip') bytes = gunzipSync(bytes);
      if (!req.url?.endsWith('/responses')) {
        res.writeHead(404).end();
        return;
      }
      const body = JSON.parse(bytes.toString()) as ResponsesRequest;
      requests++;
      if (body.model !== 'openai/gpt-5') throw Error('Model routing mismatch');
      if (req.headers.authorization !== 'Bearer fixture-orca')
        throw Error('Credential reference mismatch');
      if (scenario === 'unauthenticated' || scenario === 'rate-limited') {
        const status = scenario === 'unauthenticated' ? 401 : 429;
        res.writeHead(status, { 'content-type': 'application/json' }).end(
          JSON.stringify({
            error: {
              message:
                scenario === 'unauthenticated'
                  ? 'fixture unauthorized gateway key'
                  : 'fixture rate limited',
              type: scenario === 'unauthenticated' ? 'authentication_error' : 'rate_limit_error',
            },
          })
        );
        return;
      }
      if (scenario === 'cancelled') {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.flushHeaders();
        cancel();
        return;
      }
      const tool = (body.tools ?? []).find((t) => t.name === 'exec_command');
      const input = JSON.stringify(body.input);
      sawToolOutput ||= input.includes('function_call_output');
      if (requests === 1 && !tool) throw Error('CLI did not advertise exec_command');
      const item =
        requests === 1
          ? {
              id: 'fc_local',
              type: 'function_call',
              call_id: 'call_local',
              name: 'exec_command',
              arguments: JSON.stringify({ cmd: 'pwd', max_output_tokens: 100 }),
              status: 'completed',
            }
          : {
              id: 'msg_local',
              type: 'message',
              role: 'assistant',
              status: 'completed',
              content: [{ type: 'output_text', text: 'ORCA_LOCAL_COMPAT_OK', annotations: [] }],
            };
      const response = {
        id: 'resp_local_' + requests,
        object: 'response',
        created_at: Math.floor(Date.now() / 1000),
        status: 'completed',
        model: body.model,
        output: [item],
        usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
      };
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      const send = (type: string, value: Record<string, unknown>) =>
        res.write('event: ' + type + '\ndata: ' + JSON.stringify({ type, ...value }) + '\n\n');
      send('response.created', { response: { ...response, status: 'in_progress', output: [] } });
      if (scenario === 'interrupted') {
        res.end();
        return;
      }
      send('response.output_item.added', { output_index: 0, item });
      send('response.output_item.done', { output_index: 0, item });
      send('response.completed', { response });
      res.end();
    } catch (e) {
      failure = String(e);
      res.writeHead(500).end('synthetic fixture failure');
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('Missing local listener');
  const agent = {
    type: 'orcarouter-codex',
    name: 'Synthetic',
    provider: 'codex-cli' as const,
    command: 'codex',
    args: ['exec'],
    enabled: true,
    model: 'openai/gpt-5',
  };
  const args = buildOrcaRouterCodexArgs(agent);
  args.push(
    '-c',
    'model_providers.veritas_orcarouter.base_url=' +
      JSON.stringify('http://127.0.0.1:' + address.port + '/v1'),
    '-c',
    'analytics.enabled=false',
    '-c',
    'model_providers.veritas_orcarouter.request_max_retries=0',
    '-c',
    'approval_policy="never"',
    '--sandbox',
    'read-only',
    '--skip-git-repo-check',
    '--json',
    'Call exec_command with pwd once, then return the final marker from the synthetic provider.'
  );
  const child = spawn('codex', args, {
    cwd: work,
    env: {
      PATH: executablePath,
      HOME: home,
      CODEX_HOME: join(home, '.codex'),
      SHELL: '/bin/sh',
      ORCAROUTER_API_KEY: 'fixture-orca',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  cancel = () => {
    child.kill('SIGTERM');
  };
  let output = '',
    diagnostics = '';
  child.stdout.on('data', (c) => (output += c));
  child.stderr.on('data', (c) => (diagnostics += c));
  const timeout = setTimeout(() => {
    failure ||= 'CLI fixture timed out';
    child.kill('SIGTERM');
  }, 20000);
  try {
    const code = await new Promise<number | null>((resolve, reject) => {
      child.once('close', resolve);
      child.once('error', reject);
    });
    if (failure) throw Error(failure);
    expect(output + diagnostics).not.toContain('fixture-orca');
    if (scenario !== 'success') {
      expect(code).not.toBe(0);
      expect(requests).toBe(1);
      expect(output).not.toContain('ORCA_LOCAL_COMPAT_OK');
      if (scenario === 'unauthenticated')
        expect(output + diagnostics).toMatch(/401|unauthorized|authentication/i);
      if (scenario === 'rate-limited') expect(output + diagnostics).toMatch(/429|rate.limit/i);
      return;
    }
    const rows = output
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    const commandCompleted = rows.some(
      (row) =>
        row.type === 'item.completed' &&
        row.item?.type === 'command_execution' &&
        row.item.exit_code === 0 &&
        row.item.aggregated_output?.includes(work)
    );
    if (
      code !== 0 ||
      failure ||
      !sawToolOutput ||
      !commandCompleted ||
      !output.includes('ORCA_LOCAL_COMPAT_OK')
    )
      throw Error(
        JSON.stringify({
          code,
          failure,
          requests,
          sawToolOutput,
          output: output.slice(-1600),
          diagnostics: diagnostics.slice(-1200),
        })
      );
    console.log(
      JSON.stringify({
        version,
        requests,
        toolRoundTrip: sawToolOutput,
        commandCompleted,
        finalMarker: true,
        scope:
          'synthetic localhost CLI protocol only; no live gateway or managed server acceptance',
      })
    );
  } finally {
    clearTimeout(timeout);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
}
describe.skipIf(process.env.VK_ORCAROUTER_CODEX_COMPATIBILITY !== '1')(
  'Codex CLI 0.155.1 gateway protocol compatibility',
  () => {
    it.each(['success', 'unauthenticated', 'rate-limited', 'interrupted', 'cancelled'] as const)(
      'handles %s through the pinned executable',
      { timeout: 30_000 },
      main
    );
  }
);
