#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import path from 'node:path';

const rootDir = process.cwd();
const huskyBin = path.join(
  rootDir,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'husky.cmd' : 'husky'
);

function shouldSkipHusky() {
  return (
    process.env.CI === 'true' ||
    process.env.HUSKY === '0' ||
    process.env.NODE_ENV === 'production' ||
    process.env.npm_config_production === 'true'
  );
}

async function main() {
  if (shouldSkipHusky()) {
    return;
  }

  try {
    await access(huskyBin, constants.X_OK);
  } catch {
    return;
  }

  const result = spawnSync(huskyBin, {
    cwd: rootDir,
    shell: process.platform === 'win32',
    stdio: 'inherit',
  });

  if (result.error) {
    throw result.error;
  }

  process.exit(result.status ?? 0);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
