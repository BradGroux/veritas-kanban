#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evidenceFailures, fileDigest, packageDigest } from './contract.mjs';
import { screenshotSize } from './png.mjs';

export async function verifyNativeEvidence({ evidencePath, appPath, commit, version }) {
  const report = JSON.parse(await readFile(evidencePath, 'utf8'));
  const errors = evidenceFailures(report, {
    commit,
    version,
    packageDigest: await packageDigest(appPath),
  });
  const directory = await realpath(path.dirname(evidencePath));
  for (const entry of report.entries ?? []) {
    const name = entry.screenshot?.path;
    if (
      typeof name !== 'string' ||
      name !== `${entry.id.replaceAll('/', '--')}.png` ||
      name !== path.basename(name)
    ) {
      errors.push(`${entry.id}: invalid screenshot path`);
      continue;
    }
    try {
      const file = await realpath(path.join(directory, name));
      if (path.dirname(file) !== directory)
        throw new Error('screenshot escaped evidence directory');
      if ((await fileDigest(file)) !== entry.screenshot.sha256)
        throw new Error('screenshot digest mismatch');
      const png = await readFile(file);
      const size = screenshotSize(png);
      if (
        size.width !==
          Math.round(entry.nativeWindow.contentBounds.width * entry.nativeWindow.scaleFactor) ||
        size.height !==
          Math.round(entry.nativeWindow.contentBounds.height * entry.nativeWindow.scaleFactor)
      )
        throw new Error('cropped screenshot');
    } catch (error) {
      errors.push(`${entry.id}: ${error.message}`);
    }
  }
  return errors;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [evidencePath, appPath] = process.argv.slice(2);
    if (!evidencePath || !appPath)
      throw new Error('Usage: node scripts/native-ui/verify.mjs <evidence.json> <candidate.app>');
    const root = path.resolve(import.meta.dirname, '../..');
    const git = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' });
    if (git.status !== 0) throw new Error('Cannot resolve candidate commit');
    const version = JSON.parse(
      await readFile(path.join(root, 'desktop/package.json'), 'utf8')
    ).version;
    const errors = await verifyNativeEvidence({
      evidencePath,
      appPath,
      commit: git.stdout.trim(),
      version,
    });
    if (errors.length) throw new Error(errors.join('\n'));
    console.log(
      'Packaged macOS matrix verified. This does not certify signing, installation, documentation media, or publication.'
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
