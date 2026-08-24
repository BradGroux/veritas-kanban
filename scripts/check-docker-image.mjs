#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';

const image = process.env.VERITAS_DOCKER_IMAGE || process.argv[2] || 'veritas-kanban:contract';
const configuredMaxBytes = process.env.VERITAS_DOCKER_MAX_BYTES;
const defaultMaxBytesByArchitecture = {
  arm64: 200_000_000,
  amd64: 600_000_000,
};
const containerName = `veritas-kanban-contract-${process.pid}`;
const volumeName = `${containerName}-data`;
const adminKey = randomBytes(24).toString('hex');
const expectedVersion = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8')
).version;

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

function containerLogs() {
  const result = spawnSync('docker', ['logs', containerName], {
    encoding: 'utf8',
    stdio: 'pipe',
  });
  return [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
}

async function waitForHealthyContainer() {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const state = JSON.parse(
      run(['inspect', '--format', '{{json .State}}', containerName])
    );
    if (state.Health?.Status === 'healthy') return;
    if (state.Status === 'exited' || state.Status === 'dead') {
      throw new Error(
        `Container stopped before becoming healthy (${state.Status})\n${containerLogs()}`
      );
    }
    await new Promise((resolve) => globalThis.setTimeout(resolve, 1_000));
  }
  const health = run(['inspect', '--format', '{{json .State.Health}}', containerName]);
  throw new Error(
    `Container did not become healthy within 90 seconds\nHealth: ${health}\n${containerLogs()}`
  );
}

const runtimeProbe = String.raw`
  import bcrypt from 'bcrypt';
  import { access } from 'node:fs/promises';

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
  assert(deepHealthBody.status === 'ok', 'Deep health reported a degraded runtime');
  assert(
    deepHealthBody.version === ${JSON.stringify(expectedVersion)},
    'Deep health did not report release version ${expectedVersion}'
  );
  assert(deepHealthBody.checks?.storage === 'ok', 'Storage integrity check was not healthy');
  assert(deepHealthBody.sqlite?.healthPosture === 'healthy', 'SQLite startup was not healthy');
  assert(
    deepHealthBody.dataDirectory?.path === '/app/data/.veritas-kanban',
    'Runtime state did not resolve beneath the mounted DATA_DIR'
  );

  const backup = await response('/api/v1/sqlite/export', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': process.env.VERITAS_ADMIN_KEY,
    },
    body: JSON.stringify({
      sqlitePath: '/app/data/.veritas-kanban/veritas.db',
      outputDir: '/app/data/backups/docker-contract',
    }),
  });
  const backupBody = await backup.json();
  assert(backup.status === 200, 'SQLite backup export did not return 200');
  assert(
    backupBody.success === true &&
      backupBody.data?.bundlePath === '/app/data/backups/docker-contract',
    'SQLite backup export escaped the mounted DATA_DIR'
  );
  await access('/app/data/backups/docker-contract/manifest.json');

  const hash = await bcrypt.hash('native-module-probe', 4);
  assert(await bcrypt.compare('native-module-probe', hash), 'bcrypt native module failed');
`;

let started = false;
let volumeCreated = false;
try {
  const architecture = run(['image', 'inspect', image, '--format', '{{.Architecture}}']);
  const maxBytes = configuredMaxBytes
    ? Number(configuredMaxBytes)
    : defaultMaxBytesByArchitecture[architecture];
  assert(
    maxBytes !== undefined,
    `No Docker image size budget is defined for architecture ${architecture}; set VERITAS_DOCKER_MAX_BYTES explicitly`
  );
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

  run(['volume', 'create', volumeName]);
  volumeCreated = true;
  run([
    'run',
    '--detach',
    '--name',
    containerName,
    '--mount',
    `type=volume,source=${volumeName},target=/app/data`,
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

  run(['stop', '--time', '15', containerName]);
  const stoppedState = JSON.parse(
    run(['inspect', '--format', '{{json .State}}', containerName])
  );
  assert(stoppedState.Status === 'exited', 'Container did not stop cleanly');
  assert(stoppedState.ExitCode === 0, `Container exited with code ${stoppedState.ExitCode}`);
  run(['rm', containerName]);
  started = false;

  console.log(
    `Docker image contract passed on ${architecture}: ${imageBytes.toLocaleString()} bytes (< ${maxBytes.toLocaleString()})`
  );
  console.log(
    'Runtime smoke passed: non-root user, version, mounted paths, SQLite, backup, auth, web assets, health, bcrypt, and clean shutdown'
  );
} finally {
  if (started) {
    spawnSync('docker', ['rm', '--force', containerName], { stdio: 'ignore' });
  }
  if (volumeCreated) {
    spawnSync('docker', ['volume', 'rm', volumeName], { stdio: 'ignore' });
  }
}
