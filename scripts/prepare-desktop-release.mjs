#!/usr/bin/env node
import { constants } from 'node:fs';
import { access, cp, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const desktopDir = path.join(rootDir, 'desktop');
const stagingDir = path.join(desktopDir, '.desktop-release');
const serverStage = path.join(stagingDir, 'server');
const webStage = path.join(stagingDir, 'web');

function releaseChildEnv() {
  const env = { ...process.env };

  for (const key of Object.keys(env)) {
    if (
      key === 'INIT_CWD' ||
      key.startsWith('npm_') ||
      key.startsWith('NPM_') ||
      key.startsWith('PNPM_')
    ) {
      delete env[key];
    }
  }

  return {
    ...env,
    CI: 'true',
    npm_config_confirm_modules_purge: 'false',
    npm_config_confirmModulesPurge: 'false',
    NPM_CONFIG_CONFIRM_MODULES_PURGE: 'false',
  };
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? rootDir,
    encoding: 'utf8',
    env: releaseChildEnv(),
    shell: process.platform === 'win32',
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

async function materializeServerSelfReference() {
  const selfReference = path.join(
    serverStage,
    'node_modules/.pnpm/node_modules/@veritas-kanban/server'
  );

  await rm(selfReference, { recursive: true, force: true });
  await mkdir(selfReference, { recursive: true });
  await cp(path.join(serverStage, 'package.json'), path.join(selfReference, 'package.json'));
  await cp(path.join(serverStage, 'dist'), path.join(selfReference, 'dist'), {
    recursive: true,
  });
}

async function copyWorkspaceForDeploy(tempRoot) {
  const entries = [
    'pnpm-lock.yaml',
    'pnpm-workspace.yaml',
    'package.json',
    'scripts/prepare-husky.mjs',
    'server/package.json',
    'server/dist',
    'shared/package.json',
    'shared/dist',
  ];

  for (const entry of entries) {
    const source = path.join(rootDir, entry);
    const target = path.join(tempRoot, entry);
    await mkdir(path.dirname(target), { recursive: true });
    await cp(source, target, { recursive: true });
  }
}

async function deployServerRuntime() {
  const deployRoot = await mkdtemp(path.join(os.tmpdir(), 'veritas-desktop-deploy-'));

  try {
    await copyWorkspaceForDeploy(deployRoot);
    run(
      'pnpm',
      ['--filter', '@veritas-kanban/server', 'deploy', '--legacy', '--prod', serverStage],
      { cwd: deployRoot }
    );
  } finally {
    await rm(deployRoot, { recursive: true, force: true });
  }
}

async function main() {
  await assertExists('Server build output', path.join(rootDir, 'server/dist/index.js'));
  await assertExists('Web build output', path.join(rootDir, 'web/dist/index.html'));

  await rm(stagingDir, { recursive: true, force: true });
  await mkdir(stagingDir, { recursive: true });

  await deployServerRuntime();
  await pruneServerDeploy();
  await materializeServerSelfReference();

  await mkdir(webStage, { recursive: true });
  await cp(path.join(rootDir, 'web/dist'), path.join(webStage, 'dist'), {
    recursive: true,
  });

  await assertExists('Packaged server entry', path.join(serverStage, 'dist/index.js'));
  await assertExists('Packaged server dependencies', path.join(serverStage, 'node_modules'));
  await assertExists(
    'Packaged server pnpm self-reference',
    path.join(serverStage, 'node_modules/.pnpm/node_modules/@veritas-kanban/server/package.json')
  );
  await assertExists('Packaged web app', path.join(webStage, 'dist/index.html'));

  console.log(`Prepared desktop release staging at ${path.relative(rootDir, stagingDir)}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
