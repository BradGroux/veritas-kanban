#!/usr/bin/env node

import {
  copyFileSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const binary = process.env.GITLEAKS_BIN || 'gitleaks';

function runGitleaks(args, cwd) {
  return spawnSync(binary, args, { cwd, encoding: 'utf8', env: process.env });
}

function fail(message, result) {
  console.error(message);
  if (result?.error?.code === 'ENOENT') {
    console.error(`Gitleaks binary not found at ${binary}. Install gitleaks or set GITLEAKS_BIN.`);
  } else if (result?.stderr) {
    console.error(result.stderr.trim());
  }
  process.exit(1);
}

function stageScannableSource() {
  const repositoryRoot = process.cwd();
  const listing = spawnSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    { cwd: repositoryRoot, encoding: 'utf8' }
  );
  if (listing.status !== 0) fail('Could not inventory Git-managed source files.', listing);

  const stagingDirectory = mkdtempSync(join(tmpdir(), 'veritas-gitleaks-source-'));
  for (const relativePath of listing.stdout.split('\0').filter(Boolean)) {
    const source = resolve(repositoryRoot, relativePath);
    const destination = resolve(stagingDirectory, relativePath);
    mkdirSync(dirname(destination), { recursive: true });
    const stats = lstatSync(source);
    if (stats.isSymbolicLink()) {
      writeFileSync(destination, readlinkSync(source));
    } else if (stats.isFile()) {
      copyFileSync(source, destination);
    }
  }
  return stagingDirectory;
}

const sourceDirectory = stageScannableSource();
const fixtureDirectory = mkdtempSync(join(tmpdir(), 'veritas-gitleaks-regression-'));
try {
  const repositoryScan = runGitleaks(
    ['dir', '.', '--no-banner', '--redact=100', '--gitleaks-ignore-path', '.gitleaksignore'],
    sourceDirectory
  );
  if (repositoryScan.status !== 0) {
    fail('Gitleaks found a secret outside the reviewed fingerprint baseline.', repositoryScan);
  }

  const syntheticToken = ['sk', '_live_', '51Z9Y8X7W6V5U4T3S2Q1P0N9'].join('');
  writeFileSync(join(fixtureDirectory, 'new-secret.env'), `payment_token=${syntheticToken}\n`);
  const regressionScan = runGitleaks(
    ['dir', '.', '--no-banner', '--redact=100', '--gitleaks-ignore-path', '/dev/null'],
    fixtureDirectory
  );
  if (regressionScan.status !== 1) {
    fail(
      `Gitleaks regression fixture was not rejected (expected exit 1, got ${String(regressionScan.status)}).`,
      regressionScan
    );
  }
} finally {
  rmSync(sourceDirectory, { recursive: true, force: true });
  rmSync(fixtureDirectory, { recursive: true, force: true });
}

console.log('Gitleaks accepted the reviewed baseline and rejected a newly introduced test secret.');
