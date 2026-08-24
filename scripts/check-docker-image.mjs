#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';

const image = process.env.VERITAS_DOCKER_IMAGE || process.argv[2] || 'veritas-kanban:contract';
const maxBytes = Number(process.env.VERITAS_DOCKER_MAX_BYTES || '625000000');
const containerName = `veritas-kanban-contract-${process.pid}`;
const adminKey = randomBytes(24).toString('hex');

function run(args) {
  const result = spawnSync('docker', args, { encoding: 'utf8', stdio: 'pipe' });
  if (result.status !== 0) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    throw new Error(detail || `Docker command failed with status ${result.status}`);
  }
  return result.stdout?.trim() ?? '';
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function waitForHealthyContainer() {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const status = run([
      'inspect',
      '--format',
      '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}',
      containerName,
    ]);
    if (status === 'healthy') return;
    if (status === 'exited' || status === 'dead') {
      const logs = run(['logs', containerName]);
      throw new Error(`Container stopped before becoming healthy (${status})\n${logs}`);
    }
    await new Promise((resolve) => globalThis.setTimeout(resolve, 1_000));
  }
  const health = run(['inspect', '--format', '{{json .State.Health}}', containerName]);
  const logs = run(['logs', containerName]);
  throw new Error(`Container did not become healthy within 90 seconds\nHealth: ${health}\n${logs}`);
}

const runtimeProbe = String.raw`
  import bcrypt from 'bcrypt';

  const assert = (condition, message) => {
    if (!condition) throw new Error(message);
  };
  const response = async (path, init) => fetch('http://127.0.0.1:3001' + path, init);

  const health = await response('/health');
  assert(health.status === 200, 'GET /health did not return 200');

  const readiness = await response('/health/ready');
  const readinessBody = await readiness.json();
  assert(readiness.status === 200, 'GET /health/ready did not return 200');
  assert(readinessBody.checks?.sqlite === 'ok', 'SQLite readiness was not healthy');

  const index = await response('/');
  const html = await index.text();
  assert(index.status === 200 && html.includes('id="root"'), 'Built web app was not served');

  const unauthenticated = await response('/api/tasks');
  assert(unauthenticated.status === 401, 'Protected API did not reject an unauthenticated request');

  const authenticated = await response('/api/tasks', {
    headers: { 'X-API-Key': process.env.VERITAS_ADMIN_KEY },
  });
  assert(authenticated.status === 200, 'Admin API key did not authenticate');

  const deepHealth = await response('/api/health/deep', {
    headers: { 'X-API-Key': process.env.VERITAS_ADMIN_KEY },
  });
  const deepHealthBody = await deepHealth.json();
  assert(deepHealth.status === 200, 'Deep health endpoint did not return 200');
  assert(deepHealthBody.sqlite?.healthPosture === 'healthy', 'SQLite startup was not healthy');

  const hash = await bcrypt.hash('native-module-probe', 4);
  assert(await bcrypt.compare('native-module-probe', hash), 'bcrypt native module failed');
`;

let started = false;
try {
  assert(Number.isFinite(maxBytes) && maxBytes > 0, 'VERITAS_DOCKER_MAX_BYTES must be positive');

  const imageBytes = Number(run(['image', 'inspect', image, '--format', '{{.Size}}']));
  assert(Number.isFinite(imageBytes), `Could not read image size for ${image}`);
  if (imageBytes >= maxBytes) {
    const diagnostics = run([
      'run',
      '--rm',
      '--entrypoint',
      'sh',
      image,
      '-c',
      'du -ak /app /usr/local 2>/dev/null | sort -nr | head -25',
    ]);
    throw new Error(
      `Docker image is ${imageBytes.toLocaleString()} bytes; budget is below ${maxBytes.toLocaleString()} bytes\nLargest runtime paths (KiB):\n${diagnostics}`
    );
  }

  const configuredUser = run(['image', 'inspect', image, '--format', '{{.Config.User}}']);
  assert(configuredUser === 'veritas', `Expected image user veritas, found ${configuredUser || 'root'}`);

  run([
    'run',
    '--detach',
    '--name',
    containerName,
    '--env',
    `VERITAS_ADMIN_KEY=${adminKey}`,
    '--env',
    'VERITAS_STORAGE=sqlite',
    image,
  ]);
  started = true;

  await waitForHealthyContainer();

  run([
    'exec',
    containerName,
    'sh',
    '-c',
    'test "$(id -u)" = 1001 && test ! -e /app/cli && test ! -e /app/mcp && test ! -e /app/pnpm-lock.yaml && test -f /app/data/.veritas-kanban/veritas.db',
  ]);
  run(['exec', containerName, 'node', '--input-type=module', '--eval', runtimeProbe]);

  console.log(
    `Docker image contract passed: ${imageBytes.toLocaleString()} bytes (< ${maxBytes.toLocaleString()})`
  );
  console.log('Runtime smoke passed: non-root user, SQLite, auth, web assets, health, and bcrypt');
} finally {
  if (started) {
    spawnSync('docker', ['rm', '--force', containerName], { stdio: 'ignore' });
  }
}
