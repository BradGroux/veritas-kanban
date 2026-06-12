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
const sensitiveArgumentFlags = new Set([
  '--apple-id',
  '--issuer',
  '--key',
  '--key-id',
  '--password',
  '--team-id',
]);

function sanitizeArgsForError(args) {
  return args.map((arg, index) =>
    index > 0 && sensitiveArgumentFlags.has(args[index - 1]) ? '<redacted>' : arg
  );
}

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
    throw new Error(
      `${command} ${sanitizeArgsForError(args).join(' ')} failed with exit code ${result.status}`
    );
  }
}

function getNotarytoolCredentials() {
  const apiKey = process.env.APPLE_API_KEY;
  const apiKeyId = process.env.APPLE_API_KEY_ID;
  const apiIssuer = process.env.APPLE_API_ISSUER;
  const appleId = process.env.APPLE_ID;
  const applePassword = process.env.APPLE_APP_SPECIFIC_PASSWORD;
  const appleTeamId = process.env.APPLE_TEAM_ID;

  const apiKeyValues = [apiKey, apiKeyId, apiIssuer].filter(Boolean).length;
  const appleIdValues = [appleId, applePassword, appleTeamId].filter(Boolean).length;

  if (apiKeyValues > 0 && apiKeyValues < 3) {
    throw new Error(
      'APPLE_API_KEY, APPLE_API_KEY_ID, and APPLE_API_ISSUER must be provided together for API-key notarization'
    );
  }

  if (appleIdValues > 0 && appleIdValues < 3) {
    throw new Error(
      'APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, and APPLE_TEAM_ID must be provided together for Apple ID notarization'
    );
  }

  if (apiKeyValues === 3 && appleIdValues === 3) {
    throw new Error(
      'Provide exactly one notarization credential set, not both API-key and Apple ID credentials'
    );
  }

  if (apiKeyValues === 3) {
    return ['--key', apiKey, '--key-id', apiKeyId, '--issuer', apiIssuer];
  }

  if (appleIdValues === 3) {
    return ['--apple-id', appleId, '--password', applePassword, '--team-id', appleTeamId];
  }

  throw new Error(
    'Notarization credentials are required: provide App Store Connect API-key credentials or Apple ID credentials'
  );
}

async function assertFile(file) {
  await access(file);
}

async function hashFile(file, algorithm, encoding) {
  return createHash(algorithm)
    .update(await readFile(file))
    .digest(encoding);
}

function resolvePackageModule(moduleName, packageName) {
  const resolutionRoots = [
    path.join(rootDir, 'node_modules/.pnpm/node_modules'),
    path.join(desktopDir, 'node_modules/.pnpm/node_modules'),
    desktopDir,
    rootDir,
  ];

  for (const resolutionRoot of resolutionRoots) {
    try {
      return requireFromScript.resolve(moduleName, {
        paths: [resolutionRoot],
      });
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
      if (!entry.startsWith(`${packageName}@`)) {
        continue;
      }

      const modulePath = path.join(storeRoot, entry, 'node_modules', moduleName);
      if (existsSync(modulePath)) {
        return modulePath;
      }
    }
  }

  throw new Error(`Unable to resolve ${moduleName} for DMG blockmap regeneration`);
}

async function writeDmgBlockmap(dmg, dmgBlockmap) {
  const blockmapModule = resolvePackageModule(
    'app-builder-lib/out/targets/blockmap/blockmap.js',
    'app-builder-lib'
  );
  const { buildBlockMap } = createRequire(blockmapModule)(blockmapModule);

  if (typeof buildBlockMap !== 'function') {
    throw new Error('Electron Builder blockmap module did not expose buildBlockMap');
  }

  await buildBlockMap(dmg, 'gzip', dmgBlockmap);
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

  await Promise.all([
    assertFile(dmg),
    assertFile(zip),
    assertFile(dmgBlockmap),
    assertFile(zipBlockmap),
  ]);

  run('codesign', ['--verify', '--verbose=2', dmg]);
  run('xcrun', ['notarytool', 'submit', dmg, ...getNotarytoolCredentials(), '--wait']);
  run('xcrun', ['stapler', 'staple', dmg]);
  run('xcrun', ['stapler', 'validate', dmg]);
  run('spctl', ['-a', '-vvv', '-t', 'open', '--context', 'context:primary-signature', dmg]);

  await writeDmgBlockmap(dmg, dmgBlockmap);
  await writeLatestMacYml(version, zip, dmg);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
