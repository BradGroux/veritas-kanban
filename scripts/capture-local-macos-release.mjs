#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  access,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  realpath,
  rm,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getNotarytoolCredentials } from './finalize-macos-release-assets.mjs';
import {
  createLocalCandidate,
  distributionNames,
  localCandidateFile,
} from './local-macos-candidate.mjs';
import { fileDigest, packageDigest } from './native-ui/contract.mjs';

const root = path.resolve(import.meta.dirname, '..');
const baselineKeys = [
  'PATH',
  'HOME',
  'TMPDIR',
  'TMP',
  'TEMP',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'USER',
  'LOGNAME',
  'SHELL',
  'NODE_EXTRA_CA_CERTS',
  'SSL_CERT_FILE',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
];
const signingKeys = [
  'CSC_LINK',
  'CSC_KEY_PASSWORD',
  'APPLE_API_KEY',
  'APPLE_API_KEY_ID',
  'APPLE_API_ISSUER',
  'APPLE_ID',
  'APPLE_APP_SPECIFIC_PASSWORD',
  'APPLE_TEAM_ID',
];

export function releaseEnvironment(source, commit, channel, signing = false) {
  return {
    ...Object.fromEntries(
      [...baselineKeys, ...(signing ? signingKeys : [])]
        .filter((key) => typeof source[key] === 'string')
        .map((key) => [key, source[key]])
    ),
    CI: 'true',
    VERITAS_BUILD_SHA: commit,
    VERITAS_UPDATE_CHANNEL: channel,
  };
}

export function validateSigningEnvironment(env) {
  assert(
    env.CSC_LINK && env.CSC_KEY_PASSWORD,
    'CSC_LINK and CSC_KEY_PASSWORD are required for signed capture'
  );
  const credentials = getNotarytoolCredentials(env);
  return credentials[0] === '--key' ? 'api-key' : 'apple-id';
}

export function assertRestorableProtocol(current, original, candidatePath) {
  assert.equal(current.scheme, 'veritas', 'Wrong protocol inspection result');
  assert.equal(original.scheme, 'veritas', 'Wrong protocol backup');
  assert(
    typeof original.applicationPath === 'string' && original.applicationPath.endsWith('.app'),
    'No recoverable original protocol handler; capture must not launch'
  );
  assert(
    current.applicationPath === original.applicationPath ||
      (typeof candidatePath === 'string' && current.applicationPath === candidatePath),
    'Another application changed the protocol handler; preserve that choice and recover explicitly'
  );
}

export async function restoreProtocolHandler({ original, candidatePath, inspect, restore }) {
  const current = await inspect();
  assertRestorableProtocol(current, original, candidatePath);
  if (current.applicationPath !== original.applicationPath) await restore(original.applicationPath);
  const restored = await inspect();
  assert.equal(restored.scheme, original.scheme, 'Protocol restoration scheme differs');
  assert.equal(
    restored.applicationPath,
    original.applicationPath,
    'Protocol restoration readback differs'
  );
  return restored;
}

function result(command, args, env, inherit = false) {
  const child = spawnSync(command, args, {
    cwd: root,
    env,
    encoding: 'utf8',
    shell: false,
    ...(inherit ? { stdio: 'inherit' } : {}),
    maxBuffer: 8 * 1024 * 1024,
  });
  assert.ifError(child.error);
  assert.equal(
    child.status,
    0,
    `${path.basename(command)} failed (exit ${child.status ?? child.signal})`
  );
  return child.stdout?.trim() ?? '';
}

function git(...args) {
  return result('git', args, process.env);
}

async function writeNew(file, value) {
  const handle = await open(file, 'wx', 0o600);
  try {
    await handle.writeFile(JSON.stringify(value, null, 2) + '\n');
    await handle.sync();
  } finally {
    await handle.close();
  }
  const parent = await open(path.dirname(file), 'r');
  try {
    await parent.sync();
  } finally {
    await parent.close();
  }
}

async function inspectProtocol(env) {
  return JSON.parse(result('swift', ['scripts/native-ui/protocol-handler.swift', 'inspect'], env));
}

export async function preflightCapture({ version, channel, output }) {
  const blockers = [];
  const check = async (label, operation) => {
    try {
      return await operation();
    } catch {
      blockers.push(label);
      return undefined;
    }
  };
  await check('Capture requires macOS Apple Silicon', () =>
    assert(process.platform === 'darwin' && process.arch === 'arm64')
  );
  await check('Invalid target version or channel', () => {
    distributionNames(version);
    assert(['stable', 'beta', 'dev'].includes(channel));
  });
  const commit = await check('Cannot read build commit', () => git('rev-parse', 'HEAD'));
  const tree = await check('Cannot read source tree', () => git('rev-parse', 'HEAD^{tree}'));
  await check('Capture requires a clean checkout', () =>
    assert.equal(git('status', '--porcelain'), '')
  );
  for (const file of [
    'package.json',
    'shared/package.json',
    'server/package.json',
    'web/package.json',
    'cli/package.json',
    'mcp/package.json',
    'desktop/package.json',
  ]) {
    await check(`${file} does not match the target version`, async () =>
      assert.equal(JSON.parse(await readFile(path.join(root, file), 'utf8')).version, version)
    );
  }
  await check('Signed/notarized capture credentials are incomplete or ambiguous', () =>
    validateSigningEnvironment(process.env)
  );
  if (process.env.APPLE_API_KEY)
    await check('APPLE_API_KEY must name an existing absolute private-key file', async () => {
      assert(path.isAbsolute(process.env.APPLE_API_KEY));
      assert((await lstat(process.env.APPLE_API_KEY)).isFile());
      assert((await readFile(process.env.APPLE_API_KEY, 'utf8')).includes('BEGIN PRIVATE KEY'));
    });
  let directory;
  await check('Output must be a new external directory with an existing parent', async () => {
    assert(output && path.basename(path.resolve(output)) !== '.');
    const parent = await realpath(path.dirname(path.resolve(output)));
    directory = path.join(parent, path.basename(path.resolve(output)));
    const canonicalRoot = await realpath(root);
    assert(directory !== canonicalRoot && !directory.startsWith(canonicalRoot + path.sep));
    await assert.rejects(lstat(directory), { code: 'ENOENT' });
  });
  for (const name of ['desktop/release', 'desktop/.desktop-release']) {
    await check(
      `${name} retains earlier generated artifacts; use a fresh capture checkout`,
      async () => {
        try {
          assert.equal((await readdir(path.join(root, name))).length, 0);
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
        }
      }
    );
  }
  const env = releaseEnvironment(process.env, commit, channel);
  await check('Capture requires macOS 14 or later', () =>
    assert(Number(result('sw_vers', ['-productVersion'], env).split('.')[0]) >= 14)
  );
  for (const tool of ['pnpm', 'swift', 'codesign', 'spctl', 'xcrun', 'ditto', 'ffmpeg']) {
    await check(`Required local tool is unavailable: ${tool}`, () => result('which', [tool], env));
  }
  await check('pnpm does not match the declared package-manager pin', async () => {
    const packageManager = JSON.parse(
      await readFile(path.join(root, 'package.json'), 'utf8')
    ).packageManager;
    assert.equal(`pnpm@${result('pnpm', ['--version'], env)}`, packageManager);
  });
  const [major, minor, patch] = process.versions.node.split('.').map(Number);
  await check('Node must satisfy the repository minimum 22.22.1', () =>
    assert(major > 22 || (major === 22 && (minor > 22 || (minor === 22 && patch >= 1))))
  );
  let original;
  if (!blockers.length) {
    await check('Native display does not meet the existing capture contract', () =>
      result('swift', ['scripts/native-ui/hosted-display.swift', '--check'], env)
    );
    original = await check('Cannot inspect a recoverable existing protocol handler', async () => {
      const metadata = await inspectProtocol(env);
      assertRestorableProtocol(metadata, metadata, metadata.applicationPath);
      assert((await lstat(metadata.applicationPath)).isDirectory());
      return metadata;
    });
  }
  return {
    ready: blockers.length === 0,
    blockers,
    commit,
    tree,
    version,
    channel,
    directory,
    original,
  };
}

export async function captureLocalRelease(options) {
  const context = await preflightCapture(options);
  assert(context.ready, `Local capture preflight failed: ${context.blockers.join('; ')}`);
  const { directory, commit, tree, version, channel, original } = context;
  await mkdir(directory, { mode: 0o700 });
  const parent = await open(path.dirname(directory), 'r');
  try {
    await parent.sync();
  } finally {
    await parent.close();
  }
  const env = releaseEnvironment(process.env, commit, channel);
  const signingEnv = releaseEnvironment(process.env, commit, channel, true);
  const backup = path.join(directory, 'protocol-before.json');
  await writeNew(backup, original);
  const backupDigest = await fileDigest(backup);
  const state = { status: 'running', commit, phases: [], startedAt: new Date().toISOString() };
  const statePath = path.join(directory, 'capture-state.json');
  const persist = async () => {
    const handle = await open(statePath, 'w', 0o600);
    try {
      await handle.writeFile(JSON.stringify(state, null, 2) + '\n');
      await handle.sync();
    } finally {
      await handle.close();
    }
  };
  const phase = async (name, operation) => {
    state.currentPhase = name;
    await persist();
    const value = await operation();
    state.phases.push({ name, status: 'passed', completedAt: new Date().toISOString() });
    await persist();
    return value;
  };
  const command = (name, executable, args, signing = false) =>
    phase(name, () => result(executable, args, signing ? signingEnv : env, true));
  let extracted, appPath, originalPackageDigest, failure;
  try {
    await command('install', 'pnpm', ['install', '--frozen-lockfile']);
    const { chromium } = await import('@playwright/test');
    await access(chromium.executablePath()); // Provision explicitly before capture; never install tools here.
    await command('source-preflight', process.execPath, [
      'scripts/validate-release.mjs',
      '--source-only',
      '--skip-build-output',
      '--version',
      version,
    ]);
    await command('build', 'pnpm', ['build']);
    await command('prepare', 'pnpm', ['--filter', '@veritas-kanban/desktop', 'package:prepare']);
    await command(
      'signed-package',
      process.execPath,
      ['scripts/run-desktop-builder.mjs', '--mac', 'dmg', 'zip', '--publish', 'never'],
      true
    );
    await command(
      'finalize-notarized-assets',
      process.execPath,
      ['scripts/finalize-macos-release-assets.mjs'],
      true
    );
    const release = path.join(directory, 'release');
    await mkdir(release);
    const checksums = [];
    for (const name of distributionNames(version)) {
      const source = path.join(root, 'desktop/release', name);
      assert(
        (await lstat(source)).isFile() && !(await lstat(source)).isSymbolicLink(),
        'Distribution must be a regular file'
      );
      const destination = path.join(release, name);
      await copyFile(source, destination);
      checksums.push(`${await fileDigest(destination)}  ${name}`);
    }
    const checksumHandle = await open(
      path.join(directory, 'native-distribution.sha256'),
      'wx',
      0o600
    );
    try {
      await checksumHandle.writeFile(checksums.join('\n') + '\n');
      await checksumHandle.sync();
    } finally {
      await checksumHandle.close();
    }
    extracted = await realpath(await mkdtemp(path.join(os.tmpdir(), 'vk-local-release-app-')));
    appPath = path.join(extracted, 'veritas-kanban.app');
    state.extractedApp = appPath;
    await persist();
    await command('extract-retained-zip', 'ditto', [
      '-x',
      '-k',
      path.join(release, `Veritas-Kanban-${version}-mac-arm64.zip`),
      extracted,
    ]);
    await command('app-signature', 'codesign', ['--verify', '--deep', '--strict', appPath]);
    await command('app-gatekeeper', 'spctl', ['--assess', '--type', 'execute', appPath]);
    originalPackageDigest = await packageDigest(appPath);
    await command('native-matrix', process.execPath, [
      'scripts/native-ui/run.mjs',
      appPath,
      path.join(directory, 'native-ui-evidence'),
    ]);
    await command('native-verification', process.execPath, [
      'scripts/native-ui/verify.mjs',
      path.join(directory, 'native-ui-evidence/evidence.json'),
      appPath,
    ]);
    await command('large-board', 'pnpm', [
      '--dir',
      'server',
      'exec',
      'node',
      '--import',
      'tsx',
      '../scripts/native-ui/board-performance.mjs',
      appPath,
      path.join(directory, 'large-board-evidence'),
    ]);
    await command('documentation-media', process.execPath, [
      'scripts/docs-media/run.mjs',
      appPath,
      path.join(directory, 'documentation-media'),
      'capture',
      path.join(directory, 'large-board-evidence/report.json'),
    ]);
    assert.equal(
      await packageDigest(appPath),
      originalPackageDigest,
      'Distribution app changed during capture'
    );
    assert.equal(git('rev-parse', 'HEAD'), commit, 'Source commit changed during capture');
    assert.equal(git('rev-parse', 'HEAD^{tree}'), tree, 'Source tree changed during capture');
    assert.equal(git('status', '--porcelain'), '', 'Capture source became dirty');
  } catch (error) {
    failure = error;
  }
  try {
    assert.equal(await fileDigest(backup), backupDigest, 'Protocol backup changed');
    const restored = await restoreProtocolHandler({
      original,
      candidatePath: appPath,
      inspect: () => inspectProtocol(env),
      restore: (applicationPath) =>
        result(
          'swift',
          ['scripts/native-ui/protocol-handler.swift', 'restore', applicationPath],
          env
        ),
    });
    await writeNew(path.join(directory, 'protocol-after.json'), restored);
    if (extracted) await rm(extracted, { recursive: true, force: true });
  } catch (error) {
    failure = new AggregateError(
      [failure, error].filter(Boolean),
      'Capture failed to restore protocol ownership; retain the backup and extracted app for explicit recovery'
    );
  }
  if (failure) {
    state.status = 'failed';
    state.completedAt = new Date().toISOString();
    await persist();
    throw failure;
  }
  try {
    state.status = 'captured';
    state.currentPhase = 'seal-candidate';
    state.completedAt = new Date().toISOString();
    await persist();
    const manifest = await createLocalCandidate({
      directory,
      commit,
      tree,
      version,
      channel,
      packageDigest: originalPackageDigest,
    });
    const manifestPath = path.join(directory, localCandidateFile);
    await writeNew(manifestPath, manifest);
    const manifestDigest = createHash('sha256')
      .update(await readFile(manifestPath))
      .digest('hex');
    console.log(`Retained local candidate: ${directory}\nManifest SHA-256: ${manifestDigest}`);
    console.log(
      'No publication occurred. Workspace integration, installed-app acceptance and media visual/playback review remain separate.'
    );
    return { directory, manifestDigest };
  } catch (error) {
    state.status = 'failed';
    await persist();
    throw error;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [mode, ...args] = process.argv.slice(2);
    assert(
      ['preflight', 'capture'].includes(mode),
      'Usage: capture-local-macos-release.mjs preflight|capture --version X.Y.Z --channel stable|beta|dev --output <new-external-directory>'
    );
    const options = {};
    for (let index = 0; index < args.length; index += 2) {
      assert(
        ['--version', '--channel', '--output'].includes(args[index]) &&
          args[index + 1] &&
          !args[index + 1].startsWith('--'),
        'Invalid local capture arguments'
      );
      const key = args[index].slice(2);
      assert(!(key in options), 'Duplicate local capture argument');
      options[key] = args[index + 1];
    }
    assert(
      options.version && options.channel && options.output,
      'Version, channel and output are required'
    );
    if (mode === 'capture') await captureLocalRelease(options);
    else {
      const value = await preflightCapture(options);
      console.log(JSON.stringify(value, null, 2));
      process.exitCode = value.ready ? 0 : 1;
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
