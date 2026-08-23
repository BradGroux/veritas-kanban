/**
 * Path-audit test for issue #774:
 * Service files must not construct .veritas-kanban paths directly from
 * process.cwd() or PROJECT_ROOT; they must use the centralized helpers
 * in server/src/utils/paths.ts.
 *
 * Legacy-path construction is permitted only in the centralized path and
 * migration helpers. Services and routes must use those helpers.
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
 * Returns all TypeScript files in a directory recursively.
 */
function tsFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return tsFiles(entryPath);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts') ? [entryPath] : [];
  });
}

/**
 * Patterns that indicate a hardcoded .veritas-kanban path that bypasses the
 * centralized path helpers.
 */
const FORBIDDEN_PATTERNS = [
  /join\(\s*process\.cwd\(\)[^)]*,\s*['"]\.veritas-kanban['"]/,
  /PROJECT_ROOT[^;]*\.veritas-kanban/,
  /path\.resolve\(\s*process\.cwd\(\)[^)]*,\s*['"]\.{0,2}\.veritas-kanban['"]/,
  /process\.env\.(?:DATA_DIR|VERITAS_DATA_DIR)/,
];

/**
 * Files allowed to reference .veritas-kanban directly (centralized helper
 * itself, one-time migration helpers that intentionally build the legacy path).
 */
const ALLOWED_FILES = new Set<string>();

function fileContainsForbiddenPattern(filePath: string): string[] {
  const name = path.basename(filePath);
  if (ALLOWED_FILES.has(name)) return [];

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
        `Hardcoded .veritas-kanban paths found — use getRuntimeDir() from utils/paths.ts:\n` +
          violations.map((v) => `  - ${v}`).join('\n') +
          '\n\nLegacy path construction belongs in the centralized migration helper.'
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
        `Hardcoded .veritas-kanban paths found — use getRuntimeDir() from utils/paths.ts:\n` +
          violations.map((v) => `  - ${v}`).join('\n') +
          '\n\nLegacy path construction belongs in the centralized migration helper.'
      );
    }

    expect(violations).toHaveLength(0);
  });
});
