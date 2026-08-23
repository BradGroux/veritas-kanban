#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const PACKAGE_DEFINITIONS = [
  {
    id: 'server',
    filter: '@veritas-kanban/server',
    maxWorkers: 2,
    extraArgs: ['--hookTimeout=20000', '--testTimeout=30000'],
    testFilters: [
      'provider',
      'workflow-run-service',
      'workflow-step-executor',
      'run-launch-manifest',
      'run-recovery-policy',
      'run-supervisor',
      'admission-control',
      'credential-broker',
      'filesystem-sandbox',
      'middleware/auth',
      'routes/auth',
      'routes/admin-governance-auth',
      'enforcement',
      'schemas',
      'log-redaction',
      'codex-env',
      'path-audit',
      'storage/',
      'routes/sqlite-journal-maintenance',
      'sqlite-journal-ownership-policy',
      'sqlite-maintenance-bootstrap',
      'sqlite-portability-service',
      'task-service-sqlite',
    ],
  },
  {
    id: 'web',
    filter: '@veritas-kanban/web',
    extraArgs: ['--testTimeout=15000'],
    testFilters: [
      'api',
      'auth',
      'identity',
      'useWebSocket',
      'use-task-sync',
      'useTasks',
      'Backlog',
      'realtime',
    ],
  },
  { id: 'cli', filter: '@veritas-kanban/cli' },
  { id: 'mcp', filter: '@veritas-kanban/mcp' },
  { id: 'desktop', filter: '@veritas-kanban/desktop' },
];

export function parsePackageSelection(args) {
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
    : PACKAGE_DEFINITIONS.map(({ id }) => id);
  const known = new Set(PACKAGE_DEFINITIONS.map(({ id }) => id));
  const unknown = selected.filter((id) => !known.has(id));

  if (unknown.length > 0) {
    throw new Error(`Unknown coverage package(s): ${unknown.join(', ')}`);
  }
  if (selected.length === 0) {
    throw new Error('At least one coverage package is required.');
  }

  return selected;
}

export function coverageCommands(selected) {
  const commands = [['--filter', '@veritas-kanban/shared', 'build']];

  for (const definition of PACKAGE_DEFINITIONS) {
    if (!selected.includes(definition.id)) continue;
    commands.push([
      '--filter',
      definition.filter,
      'exec',
      'vitest',
      'run',
      '--coverage',
      `--maxWorkers=${definition.maxWorkers ?? 4}`,
      '--reporter=dot',
      '--coverage.reporter=json-summary',
      '--coverage.reporter=html',
      '--coverage.reporter=text-summary',
      `--coverage.reportsDirectory=../coverage/${definition.id}`,
      ...(definition.extraArgs ?? []),
      ...(definition.testFilters ?? []),
    ]);
  }

  return commands;
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
  const selected = parsePackageSelection(process.argv.slice(2));
  const env = {
    ...process.env,
    LOG_LEVEL: 'silent',
    NODE_ENV: 'test',
    VERITAS_DISABLE_WATCHERS: '1',
  };

  for (const args of coverageCommands(selected)) run('pnpm', args, env);
  run('node', ['scripts/check-coverage-ratchets.mjs', '--packages', selected.join(',')], env);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
