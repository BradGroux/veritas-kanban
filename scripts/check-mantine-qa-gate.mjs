#!/usr/bin/env node
import { gzipSync } from 'node:zlib';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const primitiveWrappers = [
  'alert',
  'alert-dialog',
  'badge',
  'button',
  'card',
  'checkbox',
  'dialog',
  'input',
  'label',
  'number-input',
  'popover',
  'progress',
  'scroll-area',
  'select',
  'sheet',
  'skeleton',
  'slider',
  'switch',
  'tabs',
  'textarea',
  'tooltip',
];

const allowedCompatibilityInternals = new Set([
  'web/src/components/ui/alert-dialog.tsx',
  'web/src/components/ui/dialog.tsx',
  'web/src/components/ui/sheet.tsx',
]);

const maxInitialJsGzipBytes = 250 * 1024;
const maxInitialCssGzipBytes = 64 * 1024;
const maxLazyChunkGzipBytes = 150 * 1024;
const maxLazyChunkRawBytes = 550 * 1024;

const checks = [];

function record(status, name, detail = '') {
  checks.push({ status, name, detail });
}

function pass(name, detail = '') {
  record('pass', name, detail);
}

function fail(name, detail = '') {
  record('fail', name, detail);
}

function rel(file) {
  return path.relative(rootDir, file).split(path.sep).join('/');
}

async function readJson(relativePath) {
  return JSON.parse(await readFile(path.join(rootDir, relativePath), 'utf8'));
}

async function collectFiles(dir, predicate, files = []) {
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await collectFiles(fullPath, predicate, files);
    } else if (predicate(fullPath)) {
      files.push(fullPath);
    }
  }

  return files;
}

async function checkPackageSurface() {
  const packageFiles = ['package.json', 'web/package.json'];
  const bannedPackages = [/^shadcn$/, /^@radix-ui\/react-/];
  const offenders = [];

  for (const packageFile of packageFiles) {
    const manifest = await readJson(packageFile);
    const dependencyGroups = ['dependencies', 'devDependencies', 'peerDependencies'];

    for (const group of dependencyGroups) {
      const deps = manifest[group] ?? {};
      for (const name of Object.keys(deps)) {
        if (bannedPackages.some((pattern) => pattern.test(name))) {
          offenders.push(`${packageFile}:${group}:${name}`);
        }
      }
    }
  }

  if (offenders.length > 0) {
    fail('dependency cleanup', offenders.join('\n'));
    return;
  }

  pass('dependency cleanup', 'No shadcn or direct @radix-ui/react-* packages remain.');
}

async function checkFeatureWrapperImports() {
  const componentFiles = await collectFiles(path.join(rootDir, 'web/src/components'), (file) =>
    file.endsWith('.tsx')
  );
  const wrapperAlternation = primitiveWrappers
    .map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');
  const importPattern = new RegExp(
    `from\\s+['"](?:@/components/ui/(${wrapperAlternation})|(?:\\.{1,2}/)+ui/(${wrapperAlternation}))['"]`,
    'g'
  );
  const offenders = [];

  for (const file of componentFiles) {
    const relative = rel(file);
    const source = await readFile(file, 'utf8');
    const matches = Array.from(source.matchAll(importPattern));

    if (matches.length === 0) continue;
    if (allowedCompatibilityInternals.has(relative)) continue;

    offenders.push(`${relative}: ${matches.map((match) => match[0]).join(', ')}`);
  }

  if (offenders.length > 0) {
    fail('active feature wrapper imports', offenders.join('\n'));
    return;
  }

  pass(
    'active feature wrapper imports',
    'No enabled feature component imports legacy primitive compatibility wrappers.'
  );
}

async function checkDocsLinks() {
  const readme = await readFile(path.join(rootDir, 'README.md'), 'utf8');
  const checklist = await readFile(path.join(rootDir, 'docs/V5-GA-CHECKLIST.md'), 'utf8');
  const requiredChecklistMarkers = [
    'Mantine component-system cleanup gate',
    'pnpm qa:mantine',
    'pnpm test:e2e -- e2e/mantine-qa-gate.spec.ts',
    'visual and accessibility evidence',
    'temporary holdouts',
  ];
  const missingMarkers = requiredChecklistMarkers.filter((marker) => !checklist.includes(marker));

  if (!readme.includes('docs/V5-GA-CHECKLIST.md')) {
    fail('v5 GA checklist link', 'README.md does not link docs/V5-GA-CHECKLIST.md.');
    return;
  }

  if (missingMarkers.length > 0) {
    fail('v5 GA checklist content', missingMarkers.join('\n'));
    return;
  }

  pass('v5 GA checklist content', 'Mantine cleanup gate is represented in the v5 GA checklist.');
}

function assetStats(buffer) {
  return {
    gzipBytes: gzipSync(buffer).length,
    rawBytes: buffer.length,
  };
}

async function checkBundleOutput() {
  const distDir = path.join(rootDir, 'web/dist');
  const assetsDir = path.join(distDir, 'assets');
  const indexHtml = await readFile(path.join(distDir, 'index.html'), 'utf8').catch(() => null);

  if (!indexHtml) {
    fail(
      'bundle output',
      'web/dist/index.html is missing. Run pnpm --filter @veritas-kanban/web build first.'
    );
    return;
  }

  const assets = await readdir(assetsDir).catch(() => null);
  if (!assets) {
    fail(
      'bundle output',
      'web/dist/assets is missing. Run pnpm --filter @veritas-kanban/web build first.'
    );
    return;
  }

  const radixAssets = assets.filter((asset) => /vendor-radix|radix/i.test(asset));
  if (radixAssets.length > 0) {
    fail('bundle Radix cleanup', radixAssets.join('\n'));
    return;
  }

  const initialAssetRefs = Array.from(
    indexHtml.matchAll(/(?:src|href)="\/assets\/([^"]+\.(?:js|css))"/g)
  ).map((match) => match[1]);
  const initial = {
    cssGzipBytes: 0,
    jsGzipBytes: 0,
  };
  const oversizedLazyChunks = [];

  for (const asset of assets.filter((name) => /\.(js|css)$/.test(name))) {
    const file = path.join(assetsDir, asset);
    const fileStat = await stat(file);
    if (!fileStat.isFile()) continue;

    const buffer = await readFile(file);
    const stats = assetStats(buffer);
    const isInitial = initialAssetRefs.includes(asset);

    if (isInitial && asset.endsWith('.js')) {
      initial.jsGzipBytes += stats.gzipBytes;
    } else if (isInitial && asset.endsWith('.css')) {
      initial.cssGzipBytes += stats.gzipBytes;
    } else if (
      asset.endsWith('.js') &&
      (stats.gzipBytes > maxLazyChunkGzipBytes || stats.rawBytes > maxLazyChunkRawBytes)
    ) {
      oversizedLazyChunks.push(
        `${asset}: ${(stats.rawBytes / 1024).toFixed(1)} KiB raw, ${(stats.gzipBytes / 1024).toFixed(1)} KiB gzip`
      );
    }
  }

  if (initial.jsGzipBytes > maxInitialJsGzipBytes) {
    fail(
      'initial JS budget',
      `${(initial.jsGzipBytes / 1024).toFixed(1)} KiB gzip exceeds ${maxInitialJsGzipBytes / 1024} KiB.`
    );
    return;
  }

  if (initial.cssGzipBytes > maxInitialCssGzipBytes) {
    fail(
      'initial CSS budget',
      `${(initial.cssGzipBytes / 1024).toFixed(1)} KiB gzip exceeds ${maxInitialCssGzipBytes / 1024} KiB.`
    );
    return;
  }

  if (oversizedLazyChunks.length > 0) {
    fail('lazy route chunk budget', oversizedLazyChunks.join('\n'));
    return;
  }

  pass(
    'bundle budgets',
    `Initial JS ${(initial.jsGzipBytes / 1024).toFixed(1)} KiB gzip, initial CSS ${(initial.cssGzipBytes / 1024).toFixed(1)} KiB gzip.`
  );
}

async function main() {
  await checkPackageSurface();
  await checkFeatureWrapperImports();
  await checkDocsLinks();
  await checkBundleOutput();

  for (const check of checks) {
    const prefix = check.status === 'pass' ? 'PASS' : 'FAIL';
    console.log(`${prefix} ${check.name}${check.detail ? `\n${check.detail}` : ''}`);
  }

  if (checks.some((check) => check.status === 'fail')) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
