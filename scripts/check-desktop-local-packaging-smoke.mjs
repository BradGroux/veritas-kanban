#!/usr/bin/env node
import { constants } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const desktopDir = path.join(rootDir, 'desktop');
const stagingDir = path.join(desktopDir, '.desktop-release');

async function assertExists(label, targetPath) {
  try {
    await access(targetPath, constants.F_OK);
  } catch {
    throw new Error(`${label} is missing: ${path.relative(rootDir, targetPath)}`);
  }
}

async function snapshotPath(label, targetPath) {
  await assertExists(label, targetPath);
  const info = await stat(targetPath);
  return { label, targetPath, mtimeMs: info.mtimeMs };
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    env: {
      ...process.env,
      CI: 'true',
      npm_config_confirm_modules_purge: 'false',
      npm_config_confirmModulesPurge: 'false',
      NPM_CONFIG_CONFIRM_MODULES_PURGE: 'false',
    },
    stdio: 'inherit',
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}`);
  }
}

async function assertRootDevToolingStillPresent(beforeSnapshots) {
  for (const snapshot of beforeSnapshots) {
    await assertExists(snapshot.label, snapshot.targetPath);
  }
}

async function main() {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') {
    throw new Error(
      'desktop:smoke:mac:local must run on Apple Silicon macOS because it exercises macOS arm64 packaging.'
    );
  }

  const beforeSnapshots = await Promise.all([
    snapshotPath('Root node_modules', path.join(rootDir, 'node_modules')),
    snapshotPath('Root prettier binary', path.join(rootDir, 'node_modules/.bin/prettier')),
    snapshotPath('Root eslint binary', path.join(rootDir, 'node_modules/.bin/eslint')),
    snapshotPath(
      'Desktop electron-builder package',
      path.join(desktopDir, 'node_modules/electron-builder/package.json')
    ),
  ]);

  run('pnpm', ['build']);
  run('pnpm', ['--filter', '@veritas-kanban/desktop', 'package:mac:dir']);

  await assertRootDevToolingStillPresent(beforeSnapshots);
  await assertExists('Desktop staging server entry', path.join(stagingDir, 'server/dist/index.js'));
  await assertExists(
    'Desktop staging server dependencies',
    path.join(stagingDir, 'server/node_modules')
  );
  await assertExists('Desktop staging web app', path.join(stagingDir, 'web/dist/index.html'));
  await assertExists(
    'Unpacked macOS app',
    path.join(desktopDir, 'release/mac-arm64/Veritas Kanban.app')
  );

  console.log(
    'Desktop local packaging smoke passed: root dev tooling survived isolated production staging.'
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
