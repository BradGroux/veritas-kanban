/**
 * Enforcement test: all first-party API modules must use apiFetch, not raw fetch().
 *
 * This test catches regressions where a developer adds a direct `await fetch(` call
 * in web/src/lib/api/ that bypasses credential handling and base-URL resolution.
 *
 * Documented exceptions (text/stream responses that cannot use apiFetch):
 *   - agent.ts      — getLog() returns plain-text log file via response.text()
 *   - decisions.ts  — reviews.export() returns markdown export via response.text()
 *   - work-products.ts — export() returns markdown export via response.text()
 *
 * Any new exception must be added to the allowlist below with a justification comment.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const API_DIR = resolve(__dirname, '../lib/api');

/** Files that may contain raw fetch() calls with documented justification. */
const ALLOWLISTED: Record<string, number> = {
  // text() responses — cannot use apiFetch (which only handles JSON envelopes)
  'agent.ts': 1, // getLog() — plain-text agent log
  'decisions.ts': 1, // reviews.export() — markdown export
  'work-products.ts': 1, // export() — markdown export
  // helpers.ts implements apiFetch itself
  'helpers.ts': 1,
};

describe('API module raw fetch policy', () => {
  const files = readdirSync(API_DIR).filter((f) => f.endsWith('.ts'));

  for (const file of files) {
    it(`${file} does not contain unapproved raw fetch() calls`, () => {
      const content = readFileSync(join(API_DIR, file), 'utf-8');
      const matches = [...content.matchAll(/\bawait fetch\(/g)];
      const allowed = ALLOWLISTED[file] ?? 0;
      expect(matches.length).toBeLessThanOrEqual(
        allowed,
        `${file} has ${matches.length} raw fetch() call(s) but only ${allowed} are allowed. ` +
          `Use apiFetch() from ./helpers instead, or add a justified allowlist entry.`
      );
    });
  }
});
