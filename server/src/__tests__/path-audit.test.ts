/**
 * Path-audit test for issue #774:
 * Service files must not construct .veritas-kanban paths directly from
 * process.cwd() or PROJECT_ROOT; they must use the centralized helpers
 * in server/src/utils/paths.ts.
 *
 * The KNOWN_VIOLATIONS set tracks pre-existing issues (tracked in issue #774
 * for follow-up cleanup).  New violations added after this PR will fail the test.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Resolve from __tests__/ up to src/
const SRC_DIR = path.resolve(__dirname, '..');
const SERVICE_DIR = path.join(SRC_DIR, 'services');
const ROUTE_DIR = path.join(SRC_DIR, 'routes');

/**
 * Returns all TypeScript files in a directory (non-recursive).
 */
function tsFiles(dir: string): string[] {
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts'))
    .map((f) => path.join(dir, f));
}

/**
 * Patterns that indicate a hardcoded .veritas-kanban path that bypasses the
 * centralized path helpers.
 */
const FORBIDDEN_PATTERNS = [
  /join\(\s*process\.cwd\(\)[^)]*,\s*['"]\.veritas-kanban['"]/,
  /PROJECT_ROOT[^;]*\.veritas-kanban/,
  /path\.resolve\(\s*process\.cwd\(\)[^)]*,\s*['"]\.{0,2}\.veritas-kanban['"]/,
];

/**
 * Files allowed to reference .veritas-kanban directly (centralized helper
 * itself, one-time migration helpers that intentionally build the legacy path).
 */
const ALLOWED_FILES = new Set(['paths.ts', 'migration-service.ts']);

/**
 * Pre-existing violations tracked in issue #774.
 * Do NOT add new entries here — fix the file instead.
 * Files listed here will be skipped by this test to avoid blocking unrelated work.
 */
const KNOWN_VIOLATION_FILES = new Set([
  'agent-permission-service.ts',
  'agent-registry-service.ts', // legacy migration path (intentional)
  'broadcast-storage-service.ts',
  'delegation-service.ts',
  'docs-service.ts',
  'error-learning-service.ts',
  'github-sync-service.ts',
  'lifecycle-hooks-service.ts',
  'notification-service.ts',
  'pdf-report-service.ts',
  'progress-service.ts',
  'prompt-registry-service.ts',
  'scheduled-deliverables-service.ts',
  'status-history-service.ts',
  'template-service.ts',
  'transition-hooks-service.ts',
  'work-product-service.ts',
  'worktree-service.ts',
]);

function fileContainsForbiddenPattern(filePath: string): string[] {
  const name = path.basename(filePath);
  if (ALLOWED_FILES.has(name) || KNOWN_VIOLATION_FILES.has(name)) return [];

  const content = fs.readFileSync(filePath, 'utf-8');
  const hits: string[] = [];

  for (const pattern of FORBIDDEN_PATTERNS) {
    if (pattern.test(content)) {
      hits.push(pattern.toString());
    }
  }
  return hits;
}

describe('Path audit — no hardcoded .veritas-kanban paths (issue #774)', () => {
  it('service files do not construct .veritas-kanban paths from process.cwd()/PROJECT_ROOT', () => {
    const violations: string[] = [];

    for (const file of tsFiles(SERVICE_DIR)) {
      const hits = fileContainsForbiddenPattern(file);
      if (hits.length > 0) {
        violations.push(`${path.basename(file)}: ${hits.join(', ')}`);
      }
    }

    if (violations.length > 0) {
      throw new Error(
        `New hardcoded .veritas-kanban paths found — use getRuntimeDir() from utils/paths.ts:\n` +
          violations.map((v) => `  - ${v}`).join('\n') +
          '\n\nTo add this to KNOWN_VIOLATION_FILES, file a follow-up issue first.'
      );
    }

    expect(violations).toHaveLength(0);
  });

  it('route files do not construct .veritas-kanban paths from process.cwd()/PROJECT_ROOT', () => {
    const violations: string[] = [];

    for (const file of tsFiles(ROUTE_DIR)) {
      const hits = fileContainsForbiddenPattern(file);
      if (hits.length > 0) {
        violations.push(`${path.basename(file)}: ${hits.join(', ')}`);
      }
    }

    if (violations.length > 0) {
      throw new Error(
        `New hardcoded .veritas-kanban paths found — use getRuntimeDir() from utils/paths.ts:\n` +
          violations.map((v) => `  - ${v}`).join('\n') +
          '\n\nTo add this to KNOWN_VIOLATION_FILES, file a follow-up issue first.'
      );
    }

    expect(violations).toHaveLength(0);
  });
});
