#!/usr/bin/env node
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readBrowserEnvironment } from './browser-test-environment.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..');
const { serverCwd } = readBrowserEnvironment(repoRoot);
const require = createRequire(path.join(repoRoot, 'server/package.json'));
const { register } = await import(pathToFileURL(require.resolve('tsx/esm/api')).href);

// Change cwd before importing any server module, including dotenv and migration.
process.chdir(serverCwd);
register({ tsconfig: path.join(repoRoot, 'server/tsconfig.json') });
await import(pathToFileURL(path.join(repoRoot, 'server/src/index.ts')).href);
