import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout, clearTimeout } from 'node:timers';
import { readFile, writeFile, rm } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApiClient } from '../shared/dist/index.js';
import { createBrowserEnvironment } from '../scripts/browser-test-environment.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
async function ports() {
  const servers = [createNetServer(), createNetServer()];
  try {
    for (const server of servers)
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
      });
    return servers.map((server) => server.address().port);
  } finally {
    await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))));
  }
}
async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null || !child.pid) return;
  const closed = once(child, 'close');
  const timer = setTimeout(() => {
    if (child.pid && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }, 10_000);
  try {
    child.kill('SIGTERM');
    await closed;
  } finally {
    clearTimeout(timer);
  }
}
async function fixture(t, body) {
  const [apiPort, webPort] = await ports();
  const owned = await createBrowserEnvironment(root, {
    PATH: process.env.PATH,
    PLAYWRIGHT_API_PORT: String(apiPort),
    PLAYWRIGHT_WEB_PORT: String(webPort),
  });
  const env = {
    ...owned.env,
    HOST: '127.0.0.1',
    PORT: String(apiPort),
    LOG_LEVEL: 'error',
    VERITAS_AUTH_ENABLED: 'true',
    VERITAS_AUTH_LOCALHOST_BYPASS: 'false',
    VERITAS_JWT_SECRET: `fixture-${randomBytes(40).toString('hex')}`,
  };
  const server = spawn(process.execPath, [path.join(root, 'demo/seed-api-fixture.mjs')], {
    cwd: owned.environment.serverCwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  const bound = new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      server.off('message', message);
      server.off('exit', exited);
      server.off('error', failed);
    };
    const message = (value) => {
      if (
        value?.type !== 'demo-fixture-bound' ||
        value.pid !== server.pid ||
        value.port !== apiPort
      )
        return;
      cleanup();
      resolve();
    };
    const exited = () => {
      cleanup();
      reject(new Error('Owned API exited before binding'));
    };
    const failed = (error) => {
      cleanup();
      reject(error);
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('Owned API bind deadline'));
    }, 30_000);
    server.on('message', message);
    server.once('exit', exited);
    server.once('error', failed);
  });
  let log = '';
  server.stdout.on('data', (chunk) => {
    log += chunk;
  });
  server.stderr.on('data', (chunk) => {
    log += chunk;
  });
  let proxy;
  let passed = false;
  try {
    await bound;
    const api = createApiClient(env.API_BASE_URL, env.VERITAS_ADMIN_KEY, { timeoutMs: 2_000 });
    const until = Date.now() + 30_000;
    let ready = false;
    while (Date.now() < until) {
      if (server.exitCode !== null) throw new Error('Disposable API exited before readiness');
      try {
        await api('/api/health', { timeoutMs: 500 });
        ready = true;
        break;
      } catch {
        // Bootstrap can refuse connections until this owned listener is ready.
      }
      await delay(100);
    }
    assert(ready, 'Disposable API readiness deadline');
    let writes = 0;
    let fault;
    proxy = createServer(async (req, res) => {
      try {
        assert(
          server.pid && server.exitCode === null && server.signalCode === null,
          'Owned API process is no longer live'
        );
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const write = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method);
        if (write) writes += 1;
        const selectedFault = write && writes === fault?.at ? fault.mode : undefined;
        if (selectedFault === 'reject') {
          res.writeHead(503, { 'content-type': 'application/json' });
          res.end('{"error":"Injected disposable write failure"}');
          return;
        }
        const upstream = await fetch(`${env.API_BASE_URL}${req.url}`, {
          method: req.method,
          headers: {
            'x-api-key': req.headers['x-api-key'] ?? '',
            'content-type': 'application/json',
          },
          ...(write ? { body: Buffer.concat(chunks) } : {}),
          redirect: 'error',
          signal: globalThis.AbortSignal.timeout(5_000),
        });
        const result = Buffer.from(await upstream.arrayBuffer());
        if (selectedFault === 'lost-ack') {
          res.destroy();
          return;
        }
        res.writeHead(upstream.status, { 'content-type': 'application/json' });
        res.end(result);
      } catch {
        res.writeHead(502);
        res.end();
      }
    });
    await new Promise((resolve, reject) => {
      proxy.once('error', reject);
      proxy.listen(0, '127.0.0.1', resolve);
    });
    const url = `http://127.0.0.1:${proxy.address().port}`;
    const run = async () => {
      const child = spawn(process.execPath, [path.join(root, 'demo/seed.mjs')], {
        cwd: owned.environment.root,
        env: {
          PATH: process.env.PATH,
          API_URL: url,
          ADMIN_KEY: env.VERITAS_ADMIN_KEY,
          VK_API_TIMEOUT_MS: '2000',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk) => {
        stdout += chunk;
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk;
      });
      const [code] = await once(child, 'close');
      assert(
        !stdout.includes(env.VERITAS_ADMIN_KEY) && !stderr.includes(env.VERITAS_ADMIN_KEY),
        'Fixture credential must remain private'
      );
      return { code, stdout, stderr };
    };
    await body({
      run,
      api,
      fault: (value) => {
        fault = value;
      },
      writes: () => writes,
      stateFile: path.join(owned.environment.root, 'demo-seed-state.json'),
    });
    passed = true;
  } finally {
    if (proxy) {
      proxy.closeAllConnections();
      await new Promise((resolve) => proxy.close(resolve));
    }
    await stop(server);
    if (passed) await rm(owned.environment.root, { recursive: true, force: true });
    else {
      await writeFile(path.join(owned.environment.root, 'api.log'), log, { mode: 0o600 });
      t.diagnostic(`Disposable fixture retained at ${owned.environment.root}`);
    }
  }
}
async function readback(api) {
  const tasks = await api('/api/tasks');
  const agents = await api('/api/agents/register');
  const sprints = await api('/api/sprints');
  const chat = await api('/api/chat/squad?limit=10000');
  const allTelemetry = await api('/api/telemetry/events?limit=10000');
  const telemetry = allTelemetry.filter((event) => event.type.startsWith('run.'));
  assert.equal(allTelemetry.length, 17);
  assert.equal(allTelemetry.filter((event) => event.type === 'task.created').length, 10);
  assert.equal(tasks.length, 10);
  assert.equal(agents.length, 4);
  assert.equal(sprints.length, 2);
  assert.equal(chat.length, 6);
  assert.equal(telemetry.length, 7);
  const ids = new Set(tasks.map((task) => task.id));
  const sprintIds = new Set(sprints.map((sprint) => sprint.id));
  assert.equal(new Set(tasks.map((task) => task.title)).size, 10);
  assert.equal(tasks.filter((task) => task.sprint).length, 7);
  for (const task of tasks) {
    if (task.sprint) assert(sprintIds.has(task.sprint));
    for (const subtask of task.subtasks ?? []) assert.equal(typeof subtask.completed, 'boolean');
  }
  for (const event of telemetry) assert(ids.has(event.taskId));
  for (const message of chat)
    for (const link of message.links ?? []) if (link.taskId) assert(ids.has(link.taskId));
  assert.equal(chat.filter((message) => message.links?.length).length, 5);
  return { tasks, agents, sprints, chat, telemetry };
}
test(
  'auth-enabled empty API receives all fixtures and second CLI run adds no records',
  { timeout: 60_000 },
  async (t) =>
    fixture(t, async ({ run, api, writes }) => {
      const first = await run();
      assert.equal(first.code, 0, first.stderr);
      assert.match(first.stdout, /Demo verified: 10 tasks, 4 registry entries, 2 sprint groupings/);
      await readback(api);
      const before = writes();
      const second = await run();
      assert.equal(second.code, 0, second.stderr);
      assert.match(second.stdout, /\(0 new records\)/);
      assert.equal(writes(), before);
      await readback(api);
    })
);
for (const { mode, at } of [
  { mode: 'reject', at: 7 },
  { mode: 'lost-ack', at: 7 },
  { mode: 'lost-ack', at: 18 },
  { mode: 'lost-ack', at: 24 },
])
  test(
    `failed ${mode} at write ${at} exits nonzero and resumes without duplicates`,
    { timeout: 60_000 },
    async (t) =>
      fixture(t, async ({ run, api, fault }) => {
        fault({ at, mode });
        const first = await run();
        assert.notEqual(first.code, 0);
        assert.match(first.stderr, /Demo seed incomplete/);
        fault(undefined);
        const resumed = await run();
        assert.equal(resumed.code, 0, resumed.stderr);
        await readback(api);
      })
  );
test(
  'invalid retained state fails without writes or replacing the saved bytes',
  { timeout: 60_000 },
  async (t) =>
    fixture(t, async ({ run, stateFile, writes }) => {
      const original = '{broken retained state';
      await writeFile(stateFile, original);
      const result = await run();
      assert.notEqual(result.code, 0);
      assert.equal(writes(), 0);
      assert.equal(await readFile(stateFile, 'utf8'), original);
    })
);
