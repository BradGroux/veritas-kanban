#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const forbiddenShimPatterns = [
  /Downloading Electron binary/,
  /Electron failed to install correctly/,
  /(?:^|[\\/])install\.js/,
];

const artifacts = [
  {
    file: 'desktop/out/main/index.js',
    requiredSymbols: ['app', 'BrowserWindow'],
  },
  {
    file: 'desktop/out/preload/index.cjs',
    requiredSymbols: ['contextBridge', 'ipcRenderer'],
  },
];

function parseBindings(bindings) {
  return new Set(
    bindings
      .split(',')
      .map((binding) =>
        binding
          .trim()
          .split(/\s+as\s+/)[0]
          ?.trim()
      )
      .filter(Boolean)
  );
}

function electronBindings(source) {
  const namedImport = source.match(/\bimport\s*{([^}]+)}\s*from\s*["']electron["']/s);
  const destructuredRequire = source.match(
    /\b(?:const|let|var)\s*{([^}]+)}\s*=\s*require\(\s*["']electron["']\s*\)/s
  );
  const namespaceRequire = source.match(
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*require\(\s*["']electron["']\s*\)/
  );

  return {
    named: namedImport
      ? parseBindings(namedImport[1])
      : destructuredRequire
        ? parseBindings(destructuredRequire[1])
        : new Set(),
    namespace: namespaceRequire?.[1],
  };
}

export function validateElectronArtifact(source, requiredSymbols) {
  const errors = [];

  for (const pattern of forbiddenShimPatterns) {
    if (pattern.test(source)) {
      errors.push(`contains bundled Electron installer shim pattern ${pattern}`);
    }
  }

  const bindings = electronBindings(source);
  if (bindings.named.size === 0 && !bindings.namespace) {
    errors.push('does not import the runtime-provided Electron module');
  }

  for (const symbol of requiredSymbols) {
    const namedBinding = bindings.named.has(symbol);
    const namespaceBinding =
      bindings.namespace && new RegExp(`\\b${bindings.namespace}\\.${symbol}\\b`).test(source);
    if (!namedBinding && !namespaceBinding) {
      errors.push(`does not bind required Electron API symbol ${symbol} from Electron`);
    }
  }

  return errors;
}

async function main() {
  let failed = false;

  for (const artifact of artifacts) {
    const absolutePath = path.join(rootDir, artifact.file);
    let source;

    try {
      source = await readFile(absolutePath, 'utf8');
    } catch {
      failed = true;
      console.error(`Desktop Electron artifact check failed: ${artifact.file} is missing.`);
      continue;
    }

    const errors = validateElectronArtifact(source, artifact.requiredSymbols);
    if (errors.length > 0) {
      failed = true;
      for (const error of errors) {
        console.error(`Desktop Electron artifact check failed: ${artifact.file} ${error}.`);
      }
    } else {
      console.log(`Desktop Electron artifact check passed: ${artifact.file}`);
    }
  }

  if (failed) {
    process.exitCode = 1;
  }
}

if (path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  await main();
}
