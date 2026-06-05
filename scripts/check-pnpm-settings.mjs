#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const packagePaths = [
  'package.json',
  'server/package.json',
  'web/package.json',
  'shared/package.json',
  'cli/package.json',
  'mcp/package.json',
  'desktop/package.json',
];

const failures = [];

for (const packagePath of packagePaths) {
  const manifestPath = join(process.cwd(), packagePath);
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

  if (Object.hasOwn(manifest, 'pnpm')) {
    failures.push(packagePath);
  }
}

if (failures.length > 0) {
  for (const packagePath of failures) {
    console.error(
      `::error file=${packagePath}::Move pnpm settings out of package.json and into pnpm-workspace.yaml. Current pnpm ignores package.json#pnpm.`
    );
  }
  process.exit(1);
}

console.log('pnpm settings are declared in supported workspace configuration.');
