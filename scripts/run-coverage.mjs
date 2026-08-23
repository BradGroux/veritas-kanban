#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const POLICY_PATH = 'docs/testing/critical-path-coverage.json';
const SMOKE_ENV_KEYS = [
  'HERMES_SMOKE_TEST',
  'VERITAS_CLAUDE_CODE_SMOKE',
  'VERITAS_CODEX_APP_SERVER_SMOKE',
  'VERITAS_RUN_NATIVE_SANDBOX_SMOKE',
  'VK_MCP_INTEGRATION_TEST',
];

export function parsePackageSelection(args, available) {
  const valueIndex = args.findIndex((arg) => arg === '--packages');
  const inline = args.find((arg) => arg.startsWith('--packages='));
  const raw =
    inline?.slice('--packages='.length) ?? (valueIndex >= 0 ? args[valueIndex + 1] : undefined);
  const selected = raw
    ? [
        ...new Set(
          raw
            .split(',')
            .map((value) => value.trim())
            .filter(Boolean)
        ),
      ]
    : [...available];
  const known = new Set(available);
  const unknown = selected.filter((id) => !known.has(id));

  if (unknown.length > 0) {
    throw new Error(`Unknown coverage package(s): ${unknown.join(', ')}`);
  }
  if (selected.length === 0) {
    throw new Error('At least one coverage package is required.');
  }

  return selected;
}

export function coverageCommands(policy, selected) {
  const commands = [['--filter', '@veritas-kanban/shared', 'build']];

  for (const definition of policy.packages) {
    if (!selected.includes(definition.id)) continue;
    const runner = definition.runner ?? {};
    commands.push([
      '--filter',
      `@veritas-kanban/${definition.id}`,
      'exec',
      'vitest',
      'run',
      '--coverage',
      `--maxWorkers=${runner.maxWorkers ?? 4}`,
      '--reporter=dot',
      '--coverage.reporter=json-summary',
      '--coverage.reporter=html',
      '--coverage.reporter=text-summary',
      `--coverage.reportsDirectory=../coverage/${definition.id}`,
      ...(runner.extraArgs ?? []),
      ...(runner.testFiles ?? []),
    ]);
  }

  return commands;
}

export function coverageEnvironment(environment = process.env) {
  const sanitized = { ...environment };
  for (const key of SMOKE_ENV_KEYS) delete sanitized[key];
  return {
    ...sanitized,
    LOG_LEVEL: 'silent',
    NODE_ENV: 'test',
    VERITAS_DISABLE_WATCHERS: '1',
  };
}

function run(command, args, env = process.env) {
  const executable = process.platform === 'win32' && command === 'pnpm' ? 'pnpm.cmd' : command;
  const result = spawnSync(executable, args, {
    env,
    stdio: 'inherit',
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}`);
  }
}

async function main() {
  const repoRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
  const policy = JSON.parse(await readFile(path.join(repoRoot, POLICY_PATH), 'utf8'));
  const selected = parsePackageSelection(
    process.argv.slice(2),
    policy.packages.map(({ id }) => id)
  );
  const env = coverageEnvironment();

  for (const args of coverageCommands(policy, selected)) run('pnpm', args, env);
  run('node', ['scripts/check-coverage-ratchets.mjs', '--packages', selected.join(',')], env);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
