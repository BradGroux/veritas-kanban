import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';

export const BROWSER_ENVIRONMENT_KEY = 'VK_PLAYWRIGHT_ENVIRONMENT';

function parsePort(value, fallback) {
  const port = Number(value ?? fallback);
  assert(Number.isInteger(port) && port > 0 && port <= 65535, 'Invalid browser test port');
  return port;
}

export async function assertBrowserPortsAvailable(ports) {
  const reservations = [];
  try {
    for (const port of ports) {
      const server = createServer();
      await new Promise((resolve, reject) => {
        server.once('error', () =>
          reject(
            new Error(
              `Browser test port ${port} is unavailable; stop its owner or select unused PLAYWRIGHT_API_PORT and PLAYWRIGHT_WEB_PORT values. No existing server will be reused.`
            )
          )
        );
        server.listen({ port, exclusive: true }, resolve);
      });
      reservations.push(server);
    }
  } finally {
    await Promise.all(
      reservations.map((server) => new Promise((resolve) => server.close(resolve)))
    );
  }
}

export async function createBrowserEnvironment(repoRoot, inherited = process.env) {
  const apiPort = parsePort(inherited.PLAYWRIGHT_API_PORT, 3001);
  const webPort = parsePort(inherited.PLAYWRIGHT_WEB_PORT, 3000);
  assert.notEqual(apiPort, webPort, 'Browser API and web ports must differ');
  // Check both ports before creating data or starting either managed server.
  await assertBrowserPortsAvailable([apiPort, webPort]);
  const root = await mkdtemp(path.join(tmpdir(), 'veritas-kanban-e2e-'));
  const serverCwd = path.join(root, 'workspace');
  await mkdir(serverCwd);
  // getProjectRoot and legacy migration must resolve only inside this owned tree.
  await writeFile(path.join(serverCwd, 'pnpm-workspace.yaml'), 'packages: []\n');
  const environment = {
    schema: 'browser-test-environment/v1',
    repoRoot: path.resolve(repoRoot),
    root,
    serverCwd,
    apiPort,
    webPort,
  };
  const manifest = path.join(root, 'environment.json');
  await writeFile(manifest, JSON.stringify(environment), { mode: 0o600 });
  return {
    environment,
    env: {
      ...inherited,
      [BROWSER_ENVIRONMENT_KEY]: manifest,
      DATA_DIR: root,
      VERITAS_DATA_DIR: root,
      VERITAS_SQLITE_PATH: path.join(root, '.veritas-kanban', 'veritas.db'),
      VERITAS_STORAGE: 'file',
      VERITAS_ADMIN_KEY: `e2e-${randomBytes(24).toString('hex')}`,
      API_BASE_URL: `http://127.0.0.1:${apiPort}`,
      PLAYWRIGHT_API_PORT: String(apiPort),
      PLAYWRIGHT_WEB_PORT: String(webPort),
      DOTENV_CONFIG_PATH: path.join(root, '.env'),
    },
  };
}

export function readBrowserEnvironment(repoRoot, env = process.env) {
  const manifest = env[BROWSER_ENVIRONMENT_KEY];
  assert(
    manifest,
    'Run browser tests through pnpm test:e2e to create an owned disposable environment.'
  );
  const environment = JSON.parse(readFileSync(manifest, 'utf8'));
  const { root, serverCwd, apiPort, webPort } = environment;
  assert.equal(environment.schema, 'browser-test-environment/v1');
  assert.equal(
    environment.repoRoot,
    path.resolve(repoRoot),
    'Browser environment belongs to another checkout'
  );
  assert.equal(path.dirname(manifest), root);
  assert.equal(path.dirname(root), path.resolve(tmpdir()));
  assert(path.basename(root).startsWith('veritas-kanban-e2e-'));
  assert.equal(serverCwd, path.join(root, 'workspace'));
  assert.equal(env.DATA_DIR, root);
  assert.equal(env.VERITAS_DATA_DIR, root);
  assert.equal(env.VERITAS_SQLITE_PATH, path.join(root, '.veritas-kanban', 'veritas.db'));
  assert.equal(env.VERITAS_STORAGE, 'file');
  assert.equal(env.DOTENV_CONFIG_PATH, path.join(root, '.env'));
  assert.match(env.VERITAS_ADMIN_KEY ?? '', /^e2e-[a-f0-9]{48}$/);
  assert.equal(env.API_BASE_URL, `http://127.0.0.1:${apiPort}`);
  assert.equal(env.PLAYWRIGHT_API_PORT, String(parsePort(apiPort)));
  assert.equal(env.PLAYWRIGHT_WEB_PORT, String(parsePort(webPort)));
  return environment;
}
