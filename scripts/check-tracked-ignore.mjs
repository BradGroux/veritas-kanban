#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function runGit(args, options = {}) {
  const result = spawnSync('git', args, {
    cwd: options.cwd,
    env: options.env,
    input: options.input,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  return result;
}

export function findIgnoredTrackedFiles(cwd = process.cwd(), env = process.env) {
  const tracked = runGit(['ls-files', '-z'], { cwd, env });
  if (tracked.status !== 0) {
    throw new Error(`git ls-files failed: ${tracked.stderr.toString('utf8').trim()}`);
  }

  const ignored = runGit(['check-ignore', '--no-index', '-z', '--stdin'], {
    cwd,
    env,
    input: tracked.stdout,
  });
  if (ignored.status === 1) return [];
  if (ignored.status !== 0) {
    throw new Error(`git check-ignore failed: ${ignored.stderr.toString('utf8').trim()}`);
  }

  return ignored.stdout.toString('utf8').split('\0').filter(Boolean).sort();
}

export function runTrackedIgnoreCheck(cwd = process.cwd()) {
  const ignored = findIgnoredTrackedFiles(cwd);
  if (ignored.length === 0) {
    console.log('Tracked-file ignore check passed.');
    return true;
  }

  console.error('Tracked-file ignore check failed. These tracked paths match ignore rules:');
  for (const file of ignored) console.error(`- ${file}`);
  process.exitCode = 1;
  return false;
}

function isDirectExecution() {
  return process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isDirectExecution()) runTrackedIgnoreCheck();
