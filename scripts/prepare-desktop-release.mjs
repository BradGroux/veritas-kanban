#!/usr/bin/env node
import { constants } from 'node:fs';
import { access, cp, mkdir, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const desktopDir = path.join(rootDir, 'desktop');
const stagingDir = path.join(desktopDir, '.desktop-release');
const serverStage = path.join(stagingDir, 'server');
const webStage = path.join(stagingDir, 'web');

function pnpmCommand() {
  return process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    encoding: 'utf8',
    stdio: 'inherit',
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}`);
  }
}

async function assertExists(label, targetPath) {
  try {
    await access(targetPath, constants.F_OK);
  } catch {
    throw new Error(`${label} is missing: ${path.relative(rootDir, targetPath)}`);
  }
}

async function pruneServerDeploy() {
  await Promise.all([
    rm(path.join(serverStage, 'src'), { recursive: true, force: true }),
    rm(path.join(serverStage, '.veritas-kanban'), { recursive: true, force: true }),
    rm(path.join(serverStage, 'tsconfig.json'), { force: true }),
    rm(path.join(serverStage, 'vitest.config.ts'), { force: true }),
  ]);
}

async function main() {
  await assertExists('Server build output', path.join(rootDir, 'server/dist/index.js'));
  await assertExists('Web build output', path.join(rootDir, 'web/dist/index.html'));

  await rm(stagingDir, { recursive: true, force: true });
  await mkdir(stagingDir, { recursive: true });

  run(pnpmCommand(), [
    '--filter',
    '@veritas-kanban/server',
    'deploy',
    '--prod',
    serverStage,
  ]);
  await pruneServerDeploy();

  await mkdir(webStage, { recursive: true });
  await cp(path.join(rootDir, 'web/dist'), path.join(webStage, 'dist'), {
    recursive: true,
  });

  await assertExists('Packaged server entry', path.join(serverStage, 'dist/index.js'));
  await assertExists('Packaged server dependencies', path.join(serverStage, 'node_modules'));
  await assertExists('Packaged web app', path.join(webStage, 'dist/index.html'));

  console.log(`Prepared desktop release staging at ${path.relative(rootDir, stagingDir)}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
