#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { readFile, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { clearTimeout, setTimeout } from 'node:timers';
import { URL, fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cliBin = path.join(rootDir, 'cli/dist/index.js');
const mcpBin = path.join(rootDir, 'mcp/dist/index.js');
const requestTimeoutMs = 20_000;

const checks = [];
let cliTaskId;
let mcpTaskId;

function usage() {
  console.log(`Usage: pnpm smoke:cli-mcp -- [options]

Runs v5 release-candidate CLI and MCP compatibility checks. Local version/build
checks always run. Live read/write smoke runs when a write-capable scoped API
key is available.

Options:
  --api-url <url>           API origin. Defaults to VK_API_URL or http://localhost:3001.
  --api-key <key>           Scoped API key. Defaults to VK_API_KEY.
  --expected-version <ver>  Expected root/CLI/MCP/server version. Defaults to package.json.
  --allow-version-skew      Report version skew but continue the smoke.
  --help                    Show this help text.
`);
}

function parseArgs(argv) {
  const options = {
    allowVersionSkew: false,
    apiKey: process.env.VK_API_KEY,
    apiUrl: process.env.VK_API_URL ?? 'http://localhost:3001',
    expectedVersion: undefined,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--') continue;
    if (arg === '--help' || arg === '-h') {
      usage();
      process.exit(0);
    }
    if (arg === '--allow-version-skew') {
      options.allowVersionSkew = true;
      continue;
    }
    if (arg === '--api-url') {
      options.apiUrl = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith('--api-url=')) {
      options.apiUrl = arg.slice('--api-url='.length);
      continue;
    }
    if (arg === '--api-key') {
      options.apiKey = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith('--api-key=')) {
      options.apiKey = arg.slice('--api-key='.length);
      continue;
    }
    if (arg === '--expected-version') {
      options.expectedVersion = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith('--expected-version=')) {
      options.expectedVersion = arg.slice('--expected-version='.length);
      continue;
    }

    fail('CLI options', `Unknown option: ${arg}`);
  }

  return options;
}

function record(status, name, detail = '') {
  checks.push({ status, name, detail });
}

function pass(name, detail = '') {
  record('pass', name, detail);
}

function fail(name, detail = '') {
  record('fail', name, detail);
}

function warn(name, detail = '') {
  record('warn', name, detail);
}

function skip(name, detail = '') {
  record('skip', name, detail);
}

function check(name, condition, detail = '') {
  if (condition) pass(name, detail);
  else fail(name, detail);
}

function printableDetail(detail) {
  return detail ? ` - ${detail}` : '';
}

function sanitizeError(value) {
  return String(value)
    .replace(/(x-api-key|authorization|api[_-]?key|token)\s*[:=]\s*[^\s"',}]+/gi, '$1=[redacted]')
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [redacted]');
}

async function readJson(file) {
  return JSON.parse(await readFile(path.join(rootDir, file), 'utf8'));
}

async function assertFile(file, label) {
  try {
    await access(file, constants.F_OK);
    pass(label, path.relative(rootDir, file));
  } catch {
    fail(label, `${path.relative(rootDir, file)} missing. Run pnpm build first.`);
  }
}

function envFor(options) {
  return {
    ...process.env,
    VK_API_URL: options.apiUrl,
    VK_API_KEY: options.apiKey,
  };
}

async function runCommand(command, args, options) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: rootDir,
      env: envFor(options),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
    }, requestTimeoutMs);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ ok: false, status: 1, stdout, stderr: error.message });
    });
    child.on('close', (status, signal) => {
      clearTimeout(timer);
      resolve({
        ok: status === 0,
        status: status ?? 1,
        signal,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
      });
    });
  });
}

async function requestJson(url, options) {
  const response = await globalThis.fetch(url, {
    headers: {
      'content-type': 'application/json',
      'x-api-key': options.apiKey,
    },
  });
  const body = await response.json().catch(() => ({}));
  return {
    ok: response.ok,
    status: response.status,
    apiVersion: response.headers.get('x-api-version') ?? '',
    body,
  };
}

async function mcpRequest(payload, options) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [mcpBin], {
      cwd: rootDir,
      env: envFor(options),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
    }, requestTimeoutMs);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ ok: false, error: error.message, stdout, stderr });
    });
    child.on('close', (status, signal) => {
      clearTimeout(timer);
      const firstJsonLine = stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => line.startsWith('{'));
      if (!firstJsonLine) {
        resolve({
          ok: false,
          error: `No JSON-RPC response. stderr: ${sanitizeError(stderr)}`,
          stdout,
          stderr,
          status,
          signal,
        });
        return;
      }
      try {
        const parsed = JSON.parse(firstJsonLine);
        resolve({
          ok: status === 0 && !parsed.error,
          response: parsed,
          stdout,
          stderr,
          status,
          signal,
        });
      } catch (error) {
        resolve({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
          stdout,
          stderr,
          status,
          signal,
        });
      }
    });

    child.stdin.end(`${JSON.stringify(payload)}\n`);
  });
}

function assertJsonRpcResult(result, label) {
  if (!result.ok) {
    fail(label, sanitizeError(result.error ?? result.stderr ?? 'MCP request failed'));
    return undefined;
  }
  pass(label);
  return result.response.result;
}

function parseJson(text, label) {
  try {
    return JSON.parse(text);
  } catch (error) {
    fail(label, error instanceof Error ? error.message : String(error));
    return undefined;
  }
}

function extractMcpTaskId(text) {
  const match = text.match(/^Task created: ([^\n]+)/);
  return match?.[1];
}

async function runCliSmoke(options) {
  const version = await runCommand(process.execPath, [cliBin, '--version'], options);
  check('CLI version command', version.ok, sanitizeError(version.stderr));

  const list = await runCommand(process.execPath, [cliBin, 'list', '--json'], options);
  check('CLI read smoke: vk list --json', list.ok, sanitizeError(list.stderr));
  const listBody = parseJson(list.stdout || '[]', 'CLI read smoke returned JSON');
  check('CLI read smoke returned an array', Array.isArray(listBody));

  const title = `v5 CLI compatibility smoke ${Date.now()}`;
  const create = await runCommand(
    process.execPath,
    [
      cliBin,
      'create',
      title,
      '--type',
      'automation',
      '--priority',
      'low',
      '--description',
      'Temporary task created by v5 CLI compatibility smoke.',
      '--json',
    ],
    options
  );
  check('CLI write smoke: vk create', create.ok, sanitizeError(create.stderr));
  const created = parseJson(create.stdout || '{}', 'CLI create returned JSON');
  cliTaskId = typeof created?.id === 'string' ? created.id : undefined;
  check('CLI write smoke captured task id', Boolean(cliTaskId), cliTaskId ?? 'missing id');

  if (cliTaskId) {
    const show = await runCommand(process.execPath, [cliBin, 'show', cliTaskId, '--json'], options);
    check('CLI read-after-write smoke: vk show', show.ok, sanitizeError(show.stderr));
    const shown = parseJson(show.stdout || '{}', 'CLI show returned JSON');
    check('CLI read-after-write returned created task', shown?.id === cliTaskId, shown?.id ?? '');

    const deleted = await cleanupCliTask(options);
    check('CLI cleanup: vk delete', deleted, cliTaskId);
    if (deleted) cliTaskId = undefined;
  }
}

async function cleanupCliTask(options) {
  if (!cliTaskId) return true;
  const result = await runCommand(
    process.execPath,
    [cliBin, 'delete', cliTaskId, '--json'],
    options
  );
  return result.ok;
}

async function runMcpSmoke(options) {
  const toolsResult = assertJsonRpcResult(
    await mcpRequest({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, options),
    'MCP tools/list'
  );
  const toolNames = Array.isArray(toolsResult?.tools)
    ? toolsResult.tools.map((tool) => tool.name)
    : [];
  check(
    'MCP tools/list exposes task tools',
    ['list_tasks', 'create_task', 'delete_task'].every((tool) => toolNames.includes(tool)),
    toolNames.join(', ')
  );

  const resourcesResult = assertJsonRpcResult(
    await mcpRequest({ jsonrpc: '2.0', id: 2, method: 'resources/list' }, options),
    'MCP resources/list'
  );
  const resources = Array.isArray(resourcesResult?.resources) ? resourcesResult.resources : [];
  check(
    'MCP resources/list exposes kanban://tasks',
    resources.some((resource) => resource.uri === 'kanban://tasks')
  );

  const readResult = assertJsonRpcResult(
    await mcpRequest(
      {
        jsonrpc: '2.0',
        id: 3,
        method: 'resources/read',
        params: { uri: 'kanban://tasks' },
      },
      options
    ),
    'MCP resources/read kanban://tasks'
  );
  const readText = readResult?.contents?.[0]?.text;
  const readTasks = parseJson(
    typeof readText === 'string' ? readText : '[]',
    'MCP resource read JSON'
  );
  check('MCP resource read returned an array', Array.isArray(readTasks));

  const listResult = assertJsonRpcResult(
    await mcpRequest(
      {
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: { name: 'list_tasks', arguments: {} },
      },
      options
    ),
    'MCP tool read smoke: list_tasks'
  );
  const listText = listResult?.content?.[0]?.text;
  const listTasks = parseJson(
    typeof listText === 'string' ? listText : '[]',
    'MCP list_tasks JSON'
  );
  check('MCP list_tasks returned an array', Array.isArray(listTasks));

  const title = `v5 MCP compatibility smoke ${Date.now()}`;
  const createResult = assertJsonRpcResult(
    await mcpRequest(
      {
        jsonrpc: '2.0',
        id: 5,
        method: 'tools/call',
        params: {
          name: 'create_task',
          arguments: {
            title,
            type: 'automation',
            priority: 'low',
            description: 'Temporary task created by v5 MCP compatibility smoke.',
          },
        },
      },
      options
    ),
    'MCP tool write smoke: create_task'
  );
  const createText = createResult?.content?.[0]?.text;
  mcpTaskId = typeof createText === 'string' ? extractMcpTaskId(createText) : undefined;
  check('MCP write smoke captured task id', Boolean(mcpTaskId), mcpTaskId ?? 'missing id');

  if (mcpTaskId) {
    const deleteResult = assertJsonRpcResult(
      await mcpRequest(
        {
          jsonrpc: '2.0',
          id: 6,
          method: 'tools/call',
          params: { name: 'delete_task', arguments: { id: mcpTaskId } },
        },
        options
      ),
      'MCP cleanup: delete_task'
    );
    const deleteText = deleteResult?.content?.[0]?.text;
    check(
      'MCP cleanup deleted created task',
      typeof deleteText === 'string' && deleteText.startsWith(`Task deleted: ${mcpTaskId}`),
      typeof deleteText === 'string' ? deleteText : ''
    );
    if (typeof deleteText === 'string' && deleteText.startsWith(`Task deleted: ${mcpTaskId}`)) {
      mcpTaskId = undefined;
    }
  }
}

async function cleanupMcpTask(options) {
  if (!mcpTaskId) return true;
  const result = await mcpRequest(
    {
      jsonrpc: '2.0',
      id: 99,
      method: 'tools/call',
      params: { name: 'delete_task', arguments: { id: mcpTaskId } },
    },
    options
  );
  return result.ok;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const rootPackage = await readJson('package.json');
  const cliPackage = await readJson('cli/package.json');
  const mcpPackage = await readJson('mcp/package.json');
  const expectedVersion = options.expectedVersion ?? rootPackage.version;

  check('VK_API_URL is configured', Boolean(options.apiUrl), options.apiUrl);
  if (options.apiKey) {
    pass('VK_API_KEY is configured for write-capable CLI/MCP smoke', 'set');
  } else {
    skip(
      'VK_API_KEY is configured for write-capable CLI/MCP smoke',
      'missing; set VK_API_KEY or pass --api-key to run the live read/write smoke'
    );
  }
  check(
    'Root package version matches expected',
    rootPackage.version === expectedVersion,
    rootPackage.version
  );
  check(
    'CLI package version matches expected',
    cliPackage.version === expectedVersion,
    cliPackage.version
  );
  check(
    'MCP package version matches expected',
    mcpPackage.version === expectedVersion,
    mcpPackage.version
  );
  await assertFile(cliBin, 'CLI build output exists');
  await assertFile(mcpBin, 'MCP build output exists');

  if (!options.apiUrl) {
    printAndExit();
  }

  if (!options.apiKey) {
    skip('CLI/MCP live read/write smoke', 'skipped because VK_API_KEY is missing');
    printAndExit();
  }

  const healthUrl = new URL('/api/health', options.apiUrl).toString();
  const health = await requestJson(healthUrl, options);
  check('Server health is reachable', health.ok, `${health.status} ${healthUrl}`);
  const serverVersion = health.body?.version;
  if (serverVersion === expectedVersion) {
    pass('Server version matches expected', serverVersion);
  } else if (options.allowVersionSkew) {
    warn(
      'Server version skew accepted by operator',
      `server=${serverVersion ?? 'unknown'} expected=${expectedVersion}`
    );
  } else {
    fail(
      'Server version matches expected',
      `server=${serverVersion ?? 'unknown'} expected=${expectedVersion}. Re-run with --allow-version-skew only for explicit unsupported-skew evidence.`
    );
  }

  const apiProbeUrl = new URL('/api/tasks', options.apiUrl).toString();
  const apiProbe = await requestJson(apiProbeUrl, options);
  check('API v1 probe is reachable', apiProbe.ok, `${apiProbe.status} ${apiProbeUrl}`);
  check(
    'API resource response uses v1',
    apiProbe.apiVersion === 'v1',
    apiProbe.apiVersion || 'missing'
  );

  await runCliSmoke(options);
  await runMcpSmoke(options);
  await cleanupCliTask(options);
  await cleanupMcpTask(options);
  printAndExit();
}

function printAndExit() {
  let failures = 0;
  let warnings = 0;
  let skips = 0;
  for (const entry of checks) {
    if (entry.status === 'fail') failures += 1;
    if (entry.status === 'warn') warnings += 1;
    if (entry.status === 'skip') skips += 1;
    const icon =
      entry.status === 'pass'
        ? 'PASS'
        : entry.status === 'warn'
          ? 'WARN'
          : entry.status === 'skip'
            ? 'SKIP'
            : 'FAIL';
    console.log(`${icon} ${entry.name}${printableDetail(entry.detail)}`);
  }
  console.log(
    `\nCLI/MCP compatibility smoke: ${failures} failure(s), ${warnings} warning(s), ${skips} skip(s)`
  );
  process.exit(failures > 0 ? 1 : 0);
}

main().catch(async (error) => {
  fail(
    'Unhandled smoke error',
    sanitizeError(error instanceof Error ? error.message : String(error))
  );
  await cleanupCliTask(parseArgs(process.argv.slice(2))).catch(() => undefined);
  await cleanupMcpTask(parseArgs(process.argv.slice(2))).catch(() => undefined);
  printAndExit();
});
