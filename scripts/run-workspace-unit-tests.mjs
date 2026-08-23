#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pnpmExecutable = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';

export const UNIT_TEST_STAGES = Object.freeze([
  {
    id: 'shared-build',
    label: 'shared prerequisite',
    directory: 'shared',
    packageName: '@veritas-kanban/shared',
    requiredScript: 'build',
  },
  {
    id: 'server',
    label: 'server unit tests',
    directory: 'server',
    packageName: '@veritas-kanban/server',
    requiredScript: 'test',
  },
  {
    id: 'web',
    label: 'web unit tests',
    directory: 'web',
    packageName: '@veritas-kanban/web',
    requiredScript: 'test',
  },
  {
    id: 'cli',
    label: 'CLI unit tests',
    directory: 'cli',
    packageName: '@veritas-kanban/cli',
    requiredScript: 'test',
  },
  {
    id: 'mcp',
    label: 'MCP unit tests',
    directory: 'mcp',
    packageName: '@veritas-kanban/mcp',
    requiredScript: 'test',
  },
]);

function readWorkspacePackage(stage) {
  const packagePath = path.join(repositoryRoot, stage.directory, 'package.json');
  return JSON.parse(readFileSync(packagePath, 'utf8'));
}

export function validateStage(stage, { readPackageJson = readWorkspacePackage } = {}) {
  let packageJson;
  try {
    packageJson = readPackageJson(stage);
  } catch (error) {
    return `Cannot read ${stage.directory}/package.json: ${error.message}`;
  }
  if (packageJson.name !== stage.packageName) {
    return `${stage.directory}/package.json must declare name ${stage.packageName}`;
  }
  if (
    typeof packageJson.scripts?.[stage.requiredScript] !== 'string' ||
    packageJson.scripts[stage.requiredScript].trim() === ''
  ) {
    return `${stage.packageName} must define a non-empty ${stage.requiredScript} script`;
  }
  return undefined;
}

function executeStage(stage) {
  const result = spawnSync(pnpmExecutable, ['--filter', stage.packageName, stage.requiredScript], {
    cwd: repositoryRoot,
    env: process.env,
    stdio: 'inherit',
  });

  if (result.error) {
    console.error(`Could not start ${stage.label}: ${result.error.message}`);
    return 1;
  }
  return result.status ?? 1;
}

export function runWorkspaceUnitTests({
  run = executeStage,
  validate = validateStage,
  log = console.log,
} = {}) {
  const results = new Map(UNIT_TEST_STAGES.map((stage) => [stage.id, 'NOT RUN']));
  let exitCode = 0;

  for (const stage of UNIT_TEST_STAGES) {
    log(`\n==> ${stage.label}`);
    const validationError = validate(stage);
    if (validationError) {
      log(`Configuration error: ${validationError}`);
      results.set(stage.id, 'FAIL');
      exitCode = 1;
      break;
    }
    const status = run(stage);
    results.set(stage.id, status === 0 ? 'PASS' : 'FAIL');
    if (status !== 0) {
      exitCode = status > 0 ? status : 1;
      break;
    }
  }

  const workspaceSummary = UNIT_TEST_STAGES.filter((stage) => stage.id !== 'shared-build')
    .map((stage) => `${stage.id}: ${results.get(stage.id)}`)
    .join(' | ');
  log(`\nWorkspace unit-test summary: ${workspaceSummary}`);
  return exitCode;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = runWorkspaceUnitTests();
}
