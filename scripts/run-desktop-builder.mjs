#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const desktopDir = path.join(rootDir, 'desktop');
const requireFromDesktop = createRequire(path.join(desktopDir, 'package.json'));

function resolveElectronBuilderCli() {
  try {
    return requireFromDesktop.resolve('electron-builder/cli.js');
  } catch (error) {
    throw new Error(
      [
        'Unable to resolve electron-builder from the desktop package dependency graph.',
        'Run `CI=true pnpm install --frozen-lockfile` from the repository root, then retry the desktop packaging command.',
        error instanceof Error ? error.message : String(error),
      ].join('\n')
    );
  }
}

const cli = resolveElectronBuilderCli();
const result = spawnSync(process.execPath, [cli, ...process.argv.slice(2)], {
  cwd: desktopDir,
  env: process.env,
  stdio: 'inherit',
});

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);
