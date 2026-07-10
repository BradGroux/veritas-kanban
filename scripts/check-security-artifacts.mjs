#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const RUNTIME_SECURITY_CONFIG = /(?:^|\/)\.veritas-kanban\/security\.json$/;

export function normalizeGitPath(filePath) {
  return filePath.replaceAll('\\', '/');
}

export function findSecurityArtifactViolations(paths) {
  return paths
    .map(normalizeGitPath)
    .filter((filePath) => RUNTIME_SECURITY_CONFIG.test(filePath.toLowerCase()));
}

function listTrackedFiles() {
  const result = spawnSync('git', ['ls-files', '-z', '--full-name'], {
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  });

  if (result.error || result.status !== 0) {
    const detail = result.stderr?.trim() || result.error?.message || 'unknown error';
    throw new Error(`failed to list tracked files: ${detail}`);
  }

  return result.stdout.split('\0').filter(Boolean);
}

export function runSecurityArtifactCheck(paths = listTrackedFiles()) {
  const violations = findSecurityArtifactViolations(paths);

  if (violations.length > 0) {
    console.error('Security artifact check failed.');
    console.error('Runtime security configuration files must not be tracked:');
    for (const filePath of violations) {
      console.error(`- ${filePath}`);
    }
    process.exitCode = 1;
    return false;
  }

  console.log(`Security artifact check passed (${paths.length} tracked files scanned).`);
  return true;
}

function isDirectExecution() {
  return process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isDirectExecution()) {
  runSecurityArtifactCheck();
}
