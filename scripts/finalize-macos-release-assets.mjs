#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { access, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const desktopDir = path.join(rootDir, 'desktop');
const releaseDir = path.join(desktopDir, 'release');
const requireFromScript = createRequire(import.meta.url);

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

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }

  return value;
}

async function assertFile(file) {
  await access(file);
}

async function hashFile(file, algorithm, encoding) {
  return createHash(algorithm).update(await readFile(file)).digest(encoding);
}

function resolveAppBuilderPath() {
  const resolutionRoots = [
    path.join(rootDir, 'node_modules/.pnpm/node_modules'),
    path.join(desktopDir, 'node_modules/.pnpm/node_modules'),
    path.join(desktopDir, 'node_modules/electron-builder'),
    desktopDir,
    rootDir,
  ];

  for (const resolutionRoot of resolutionRoots) {
    try {
      const appBuilderBin = requireFromScript.resolve('app-builder-bin', {
        paths: [resolutionRoot],
      });

      return createRequire(appBuilderBin)('app-builder-bin').appBuilderPath;
    } catch {
      // Try the next pnpm resolution root.
    }
  }

  for (const storeRoot of [
    path.join(rootDir, 'node_modules/.pnpm'),
    path.join(desktopDir, 'node_modules/.pnpm'),
  ]) {
    if (!existsSync(storeRoot)) {
      continue;
    }

    for (const entry of readdirSync(storeRoot)) {
      if (!entry.startsWith('app-builder-bin@')) {
        continue;
      }

      const appBuilderBin = path.join(storeRoot, entry, 'node_modules/app-builder-bin/index.js');
      if (existsSync(appBuilderBin)) {
        return createRequire(appBuilderBin)('app-builder-bin').appBuilderPath;
      }
    }
  }

  throw new Error('Unable to resolve app-builder-bin for DMG blockmap regeneration');
}

async function writeLatestMacYml(version, zip, dmg) {
  const [zipSha512, dmgSha512, zipStats, dmgStats] = await Promise.all([
    hashFile(zip, 'sha512', 'base64'),
    hashFile(dmg, 'sha512', 'base64'),
    stat(zip),
    stat(dmg),
  ]);
  const zipName = path.basename(zip);
  const dmgName = path.basename(dmg);
  const releaseDate = new Date().toISOString();
  const latestMac = `version: ${version}
files:
  - url: ${zipName}
    sha512: ${zipSha512}
    size: ${zipStats.size}
  - url: ${dmgName}
    sha512: ${dmgSha512}
    size: ${dmgStats.size}
path: ${zipName}
sha512: ${zipSha512}
releaseDate: '${releaseDate}'
`;

  await writeFile(path.join(releaseDir, 'latest-mac.yml'), latestMac);
}

async function main() {
  const packageJson = JSON.parse(await readFile(path.join(desktopDir, 'package.json'), 'utf8'));
  const version = packageJson.version;
  const dmg = path.join(releaseDir, `Veritas-Kanban-${version}-mac-arm64.dmg`);
  const zip = path.join(releaseDir, `Veritas-Kanban-${version}-mac-arm64.zip`);
  const dmgBlockmap = `${dmg}.blockmap`;
  const zipBlockmap = `${zip}.blockmap`;

  await Promise.all([assertFile(dmg), assertFile(zip), assertFile(dmgBlockmap), assertFile(zipBlockmap)]);

  run('codesign', ['--verify', '--verbose=2', dmg]);
  run('xcrun', [
    'notarytool',
    'submit',
    dmg,
    '--key',
    requireEnv('APPLE_API_KEY'),
    '--key-id',
    requireEnv('APPLE_API_KEY_ID'),
    '--issuer',
    requireEnv('APPLE_API_ISSUER'),
    '--wait',
  ]);
  run('xcrun', ['stapler', 'staple', dmg]);
  run('xcrun', ['stapler', 'validate', dmg]);
  run('spctl', ['-a', '-vvv', '-t', 'open', '--context', 'context:primary-signature', dmg]);

  run(resolveAppBuilderPath(), ['blockmap', '--input', dmg, '--output', dmgBlockmap]);
  await writeLatestMacYml(version, zip, dmg);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
