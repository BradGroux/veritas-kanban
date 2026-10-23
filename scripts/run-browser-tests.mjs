#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { createBrowserEnvironment } from './browser-test-environment.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);

try {
  const { environment, env } = await createBrowserEnvironment(repoRoot);
  const args = process.argv.slice(2);
  if (args[0] === '--') args.shift();
  const child = spawn(
    process.execPath,
    [require.resolve('@playwright/test/cli'), 'test', ...args],
    {
      cwd: repoRoot,
      env,
      stdio: 'inherit',
    }
  );
  const interrupt = () => child.kill('SIGINT');
  const terminate = () => child.kill('SIGTERM');
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', terminate);
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (status) => resolve(status ?? 1));
  });
  process.removeListener('SIGINT', interrupt);
  process.removeListener('SIGTERM', terminate);
  if (code === 0) await rm(environment.root, { recursive: true });
  else console.error(`Browser test data retained for diagnosis: ${environment.root}`);
  process.exitCode = code;
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
