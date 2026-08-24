/**
 * Enforcement test: all first-party web code uses the credential-aware API transport.
 *
 * This test catches regressions where a developer adds a direct `fetch(` call
 * anywhere under web/src that bypasses credential handling and base-URL resolution.
 */
import { describe, it, expect } from 'vitest';

// Load production sources via Vite's import.meta.glob (no Node.js globals needed).
const apiSources = import.meta.glob(['../**/*.ts', '../**/*.tsx', '!../__tests__/**'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

describe('credential-aware API transport policy', () => {
  for (const [path, source] of Object.entries(apiSources)) {
    const filenameCandidate = path.split('/').pop();
    if (!filenameCandidate) {
      throw new Error(`Unable to derive filename from API source path: ${path}`);
    }
    const filename = filenameCandidate;

    it(`${filename} does not contain unapproved raw fetch() calls`, () => {
      const matches = [...source.matchAll(/\bfetch\s*\(/g)];
      const allowed = path.endsWith('/lib/api/helpers.ts') ? 2 : 0;
      if (matches.length > allowed) {
        throw new Error(
          `${filename} has ${matches.length} raw fetch() call(s) but only ${allowed} are allowed. ` +
            `Use apiFetch(), apiText(), or apiResponse() from lib/api/helpers.`
        );
      }
      expect(matches.length).toBeLessThanOrEqual(allowed);
    });
  }
});
