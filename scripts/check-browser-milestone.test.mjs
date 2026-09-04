import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workflow = readFileSync(
  new URL('../.github/workflows/scheduled-qa.yml', import.meta.url),
  'utf8'
);
const browser = workflow.slice(workflow.indexOf('  playwright:'), workflow.indexOf('\n  k6:'));
const config = readFileSync(new URL('../playwright.config.ts', import.meta.url), 'utf8');

test('browser milestone uses two independent bounded shards without dropping failure evidence', () => {
  assert.match(browser, /timeout-minutes: 25/);
  assert.match(browser, /fail-fast: false/);
  assert.match(browser, /shard: \[1, 2\]/);
  assert.match(browser, /pnpm test:e2e --shard=\$\{\{ matrix\.shard \}\}\/2/);
  assert.match(browser, /VERITAS_DATA_DIR=\$RUNNER_TEMP\/veritas-playwright-data/);
  assert.match(browser, /name: playwright-artifacts-\$\{\{ matrix\.shard \}\}/);
  assert.match(browser, /if: always\(\)/);
  assert.doesNotMatch(browser, /continue-on-error: true|--retries|--workers|--grep|--max-failures/);
  assert.match(config, /fullyParallel: false/);
  assert.match(config, /retries: 0/);
  assert.match(config, /workers: 1/);
});
