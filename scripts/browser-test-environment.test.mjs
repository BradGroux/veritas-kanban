import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  BROWSER_ENVIRONMENT_KEY,
  createBrowserEnvironment,
  readBrowserEnvironment,
} from './browser-test-environment.mjs';

async function listener(t) {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return server;
}

async function unusedPorts(t) {
  const a = await listener(t);
  const b = await listener(t);
  const ports = [a.address().port, b.address().port];
  await Promise.all([a, b].map((server) => new Promise((resolve) => server.close(resolve))));
  return { PLAYWRIGHT_API_PORT: String(ports[0]), PLAYWRIGHT_WEB_PORT: String(ports[1]) };
}

for (const occupied of ['PLAYWRIGHT_API_PORT', 'PLAYWRIGHT_WEB_PORT']) {
  test(`refuses a foreign ${occupied} listener without contacting or stopping it`, async (t) => {
    const ports = await unusedPorts(t);
    const foreign = await listener(t);
    let connections = 0;
    foreign.on('connection', () => connections++);
    await assert.rejects(
      createBrowserEnvironment('/checkout', {
        ...ports,
        [occupied]: String(foreign.address().port),
      }),
      /unavailable.*No existing server will be reused/
    );
    assert.equal(foreign.listening, true);
    assert.equal(connections, 0);
  });
}

test('overrides retained data, endpoint and credentials with one disposable environment', async (t) => {
  const retained = await mkdtemp(path.join(tmpdir(), 'veritas-retained-fixture-'));
  t.after(() => rm(retained, { recursive: true, force: true }));
  const marker = path.join(retained, 'kept.json');
  await writeFile(marker, 'retained bytes');
  const ports = await unusedPorts(t);
  const { environment, env } = await createBrowserEnvironment('/checkout', {
    ...ports,
    DATA_DIR: retained,
    VERITAS_DATA_DIR: retained,
    VERITAS_SQLITE_PATH: path.join(retained, 'retained.db'),
    VERITAS_ADMIN_KEY: 'synthetic-retained-key',
    API_BASE_URL: 'http://unrelated.invalid:1234',
    DOTENV_CONFIG_PATH: path.join(retained, '.env'),
    UNRELATED_SETTING: 'preserved',
  });
  t.after(() => rm(environment.root, { recursive: true, force: true }));
  assert.notEqual(env.DATA_DIR, retained);
  assert.equal(env.DATA_DIR, env.VERITAS_DATA_DIR);
  assert.equal(env.API_BASE_URL, `http://127.0.0.1:${ports.PLAYWRIGHT_API_PORT}`);
  assert.notEqual(env.VERITAS_ADMIN_KEY, 'synthetic-retained-key');
  assert.equal(env.UNRELATED_SETTING, 'preserved');
  assert.equal(
    path.dirname(env.VERITAS_SQLITE_PATH),
    path.join(environment.root, '.veritas-kanban')
  );
  assert.equal(env.DOTENV_CONFIG_PATH, path.join(environment.root, '.env'));
  assert.deepEqual(readBrowserEnvironment('/checkout', env), environment);
  assert.equal(await readFile(marker, 'utf8'), 'retained bytes');
  assert.equal(
    await readFile(path.join(environment.serverCwd, 'pnpm-workspace.yaml'), 'utf8'),
    'packages: []\n'
  );
  const manifest = await readFile(env[BROWSER_ENVIRONMENT_KEY], 'utf8');
  assert(!manifest.includes(env.VERITAS_ADMIN_KEY), 'Synthetic credential is not persisted');
  for (const override of [
    { DATA_DIR: retained },
    { VERITAS_DATA_DIR: retained },
    { VERITAS_SQLITE_PATH: path.join(retained, 'retained.db') },
    { API_BASE_URL: 'http://unrelated.invalid' },
    { DOTENV_CONFIG_PATH: path.join(retained, '.env') },
  ])
    assert.throws(() => readBrowserEnvironment('/checkout', { ...env, ...override }));
  assert.throws(() => readBrowserEnvironment('/another-checkout', env), /another checkout/);
});

test('rejects invalid or identical ports before allocating a fixture', async () => {
  for (const port of ['0', '65536', '1.5', 'not-a-port']) {
    await assert.rejects(
      createBrowserEnvironment('/checkout', { PLAYWRIGHT_API_PORT: port }),
      /Invalid browser test port/
    );
  }
  await assert.rejects(
    createBrowserEnvironment('/checkout', {
      PLAYWRIGHT_API_PORT: '1234',
      PLAYWRIGHT_WEB_PORT: '1234',
    }),
    /must differ/
  );
  assert.throws(() => readBrowserEnvironment('/checkout', {}), /pnpm test:e2e/);
});
