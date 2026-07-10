/**
 * Enforcement test: all first-party API modules must use apiFetch, not raw fetch().
 *
 * This test catches regressions where a developer adds a direct `fetch(` call
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

// Load raw source of every API module via Vite's import.meta.glob (no Node.js globals needed)
const apiSources = import.meta.glob('../lib/api/*.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

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
  for (const [path, source] of Object.entries(apiSources)) {
    const filenameCandidate = path.split('/').pop();
    if (!filenameCandidate) {
      throw new Error(`Unable to derive filename from API source path: ${path}`);
    }
    const filename = filenameCandidate;

    it(`${filename} does not contain unapproved raw fetch() calls`, () => {
      const matches = [...source.matchAll(/\bfetch\s*\(/g)];
      const allowed = ALLOWLISTED[filename] ?? 0;
      if (matches.length > allowed) {
        throw new Error(
          `${filename} has ${matches.length} raw fetch() call(s) but only ${allowed} are allowed. ` +
            `Use apiFetch() from ./helpers instead, or add a justified allowlist entry.`
        );
      }
      expect(matches.length).toBeLessThanOrEqual(allowed);
    });
  }
});
