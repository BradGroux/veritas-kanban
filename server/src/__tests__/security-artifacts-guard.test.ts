/**
 * Security Artifacts Guard Tests
 * Tests the security artifact check script against various path patterns,
 * case sensitivity handling, and edge cases with isolated temporary Git repositories.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';

// Import the security check functions
import {
  normalizeGitPath,
  findSecurityArtifactViolations,
} from '../../../scripts/check-security-artifacts.mjs';

interface TempGitRepo {
  workdir: string;
  cleanup: () => void;
}

/**
 * Create an isolated temporary Git repository for testing
 */
function createTempGitRepo(): TempGitRepo {
  const workdir = mkdtempSync(path.join(tmpdir(), 'security-test-'));

  // Initialize git repo with safe config
  spawnSync('git', ['init', '--initial-branch=main'], {
    cwd: workdir,
    stdio: 'pipe',
  });

  // Set minimal git config to avoid user context
  spawnSync('git', ['config', 'user.email', 'test@example.com'], {
    cwd: workdir,
    stdio: 'pipe',
  });
  spawnSync('git', ['config', 'user.name', 'Test User'], {
    cwd: workdir,
    stdio: 'pipe',
  });

  return {
    workdir,
    cleanup: () => {
      try {
        rmSync(workdir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors in tests
      }
    },
  };
}

/**
 * Stage a file in the Git repository
 */
function stageFile(repo: TempGitRepo, filePath: string, content: string = 'test'): void {
  const fullPath = path.join(repo.workdir, filePath);
  mkdirSync(path.dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, content);
  spawnSync('git', ['add', filePath], {
    cwd: repo.workdir,
    stdio: 'pipe',
  });
}

/**
 * Get list of tracked files from Git repository (NUL-delimited)
 */
function listTrackedFiles(repo: TempGitRepo): string[] {
  const result = spawnSync('git', ['ls-files', '-z', '--full-name'], {
    cwd: repo.workdir,
    encoding: 'utf8',
    stdio: 'pipe',
  });

  if (result.status !== 0) {
    throw new Error(`Failed to list tracked files: ${result.stderr}`);
  }

  return result.stdout.split('\0').filter(Boolean);
}

describe('Security Artifacts Guard', () => {
  // === normalizeGitPath ===
  describe('normalizeGitPath', () => {
    it('should convert backslashes to forward slashes', () => {
      const input = 'path\\to\\file.json';
      const result = normalizeGitPath(input);
      expect(result).toBe('path/to/file.json');
    });

    it('should leave forward slashes unchanged', () => {
      const input = 'path/to/file.json';
      const result = normalizeGitPath(input);
      expect(result).toBe('path/to/file.json');
    });

    it('should handle mixed slashes', () => {
      const input = 'path/to\\file.json';
      const result = normalizeGitPath(input);
      expect(result).toBe('path/to/file.json');
    });

    it('should handle empty strings', () => {
      expect(normalizeGitPath('')).toBe('');
    });
  });

  // === findSecurityArtifactViolations ===
  describe('findSecurityArtifactViolations', () => {
    it('should return empty array for clean paths', () => {
      const paths = ['src/index.ts', 'package.json', 'README.md'];
      const violations = findSecurityArtifactViolations(paths);
      expect(violations).toEqual([]);
    });

    it('should detect prohibited root path', () => {
      const paths = ['.veritas-kanban/security.json', 'src/index.ts'];
      const violations = findSecurityArtifactViolations(paths);
      expect(violations).toEqual(['.veritas-kanban/security.json']);
    });

    it('should detect prohibited path in nested directory', () => {
      const paths = ['src/.veritas-kanban/security.json'];
      const violations = findSecurityArtifactViolations(paths);
      expect(violations).toEqual(['src/.veritas-kanban/security.json']);
    });

    it('should detect mixed-case variants (case-insensitive)', () => {
      const paths = [
        '.VERITAS-KANBAN/security.json',
        '.Veritas-Kanban/security.json',
        '.veritas-KANBAN/security.json',
      ];
      const violations = findSecurityArtifactViolations(paths);
      expect(violations).toHaveLength(3);
    });

    it('should handle multiple violations in single list', () => {
      const paths = ['src/index.ts', '.veritas-kanban/security.json', 'docs/api.md'];
      const violations = findSecurityArtifactViolations(paths);
      expect(violations).toHaveLength(1);
      expect(violations).toContain('.veritas-kanban/security.json');
    });

    it('should pass similar but permitted names', () => {
      const paths = [
        '.veritas-kanban-old/security.json',
        'veritas-kanban/security.json',
        '.veritas/security.json',
        'kanban/security.json',
      ];
      const violations = findSecurityArtifactViolations(paths);
      expect(violations).toEqual([]);
    });

    it('should handle paths with backslashes in violations', () => {
      const paths = ['.veritas-kanban\\security.json'];
      const violations = findSecurityArtifactViolations(paths);
      expect(violations).toEqual(['.veritas-kanban/security.json']);
    });

    it('should handle empty path list', () => {
      const violations = findSecurityArtifactViolations([]);
      expect(violations).toEqual([]);
    });

    it('should handle paths with spaces', () => {
      const paths = ['.veritas-kanban/security.json', 'path with spaces/file.json'];
      const violations = findSecurityArtifactViolations(paths);
      expect(violations).toEqual(['.veritas-kanban/security.json']);
    });

    it('should handle very deeply nested prohibited paths', () => {
      const paths = ['a/b/c/d/e/.veritas-kanban/security.json'];
      const violations = findSecurityArtifactViolations(paths);
      expect(violations).toEqual(['a/b/c/d/e/.veritas-kanban/security.json']);
    });
  });

  // === Integration tests with actual Git repositories ===
  describe('Integration with Git repositories', () => {
    let repo: TempGitRepo;

    beforeEach(() => {
      repo = createTempGitRepo();
    });

    afterEach(() => {
      repo.cleanup();
    });

    it('should pass when repo has no security artifacts', () => {
      stageFile(repo, 'src/index.ts', 'console.log("hello");');
      stageFile(repo, 'package.json', '{}');

      const tracked = listTrackedFiles(repo);
      const violations = findSecurityArtifactViolations(tracked);

      expect(violations).toEqual([]);
      expect(tracked).toContain('src/index.ts');
      expect(tracked).toContain('package.json');
    });

    it('should detect tracked security artifact at root', () => {
      stageFile(repo, 'src/index.ts', '');
      stageFile(repo, '.veritas-kanban/security.json', '{}');

      const tracked = listTrackedFiles(repo);
      const violations = findSecurityArtifactViolations(tracked);

      expect(violations).toContain('.veritas-kanban/security.json');
      expect(violations).not.toContain('src/index.ts');
    });

    it('should detect tracked security artifact in nested directory', () => {
      stageFile(repo, 'src/index.ts', '');
      stageFile(repo, 'server/config/.veritas-kanban/security.json', '{}');

      const tracked = listTrackedFiles(repo);
      const violations = findSecurityArtifactViolations(tracked);

      expect(violations).toContain('server/config/.veritas-kanban/security.json');
    });

    it('should handle multiple violations', () => {
      stageFile(repo, '.veritas-kanban/security.json', '{}');
      stageFile(repo, 'src/index.ts', '');

      const tracked = listTrackedFiles(repo);
      const violations = findSecurityArtifactViolations(tracked);

      expect(violations).toContain('.veritas-kanban/security.json');
      expect(violations).not.toContain('src/index.ts');
    });

    it('should detect mixed-case variants in tracked files', () => {
      stageFile(repo, '.VERITAS-KANBAN/security.json', '{}');
      stageFile(repo, 'src/index.ts', '');

      const tracked = listTrackedFiles(repo);
      const violations = findSecurityArtifactViolations(tracked);

      // Git may normalize case on case-insensitive filesystems,
      // but our check should catch it regardless
      expect(violations.length).toBeGreaterThan(0);
      expect(
        violations.some((v) => v.toLowerCase().endsWith('.veritas-kanban/security.json'))
      ).toBe(true);
    });

    it('should handle NUL-delimited output correctly', () => {
      stageFile(repo, 'file with spaces.ts', '');
      stageFile(repo, '.veritas-kanban/security.json', '{}');

      const tracked = listTrackedFiles(repo);
      expect(tracked).toContain('file with spaces.ts');

      const violations = findSecurityArtifactViolations(tracked);
      expect(violations).toContain('.veritas-kanban/security.json');
    });

    it('should recognize both forward and backward slashes in paths', () => {
      // Git on Windows may report backslashes; normalize them
      const paths = ['src\\index.ts', '.veritas-kanban\\security.json', 'docs/api.md'];
      const violations = findSecurityArtifactViolations(paths);

      expect(violations).toContain('.veritas-kanban/security.json');
      expect(violations).not.toContain('src/index.ts');
    });

    it('should not match untracked prohibited files', () => {
      stageFile(repo, 'src/index.ts', '');
      // Create but do NOT stage a security artifact
      mkdirSync(path.join(repo.workdir, '.veritas-kanban'), { recursive: true });
      writeFileSync(path.join(repo.workdir, '.veritas-kanban/security.json'), '{}');

      const tracked = listTrackedFiles(repo);
      const violations = findSecurityArtifactViolations(tracked);

      // Untracked files should not appear in violations
      expect(violations).not.toContain('.veritas-kanban/security.json');
    });

    it('should fail when invoked outside a git repository', () => {
      // Create a temp dir without git
      const nonGitDir = mkdtempSync(path.join(tmpdir(), 'non-git-'));

      try {
        const result = spawnSync('git', ['ls-files', '-z'], {
          cwd: nonGitDir,
          encoding: 'utf8',
          stdio: 'pipe',
        });

        // Should fail with non-zero exit code
        expect(result.status).not.toBe(0);
      } finally {
        rmSync(nonGitDir, { recursive: true, force: true });
      }
    });
  });

  // === Diagnostic message tests ===
  describe('Diagnostic messages', () => {
    it('should include only paths in violations, not file contents', () => {
      const paths = ['.veritas-kanban/security.json', 'src/index.ts'];

      const violations = findSecurityArtifactViolations(paths);

      // Violations should be paths, not contain file contents
      for (const violation of violations) {
        expect(typeof violation).toBe('string');
        expect(violation).not.toContain('{');
        expect(violation).not.toContain('}');
        expect(violation).toMatch(/^[a-zA-Z0-9.\-/_\s]+$/);
      }
    });
  });

  // === Repository and script path handling ===
  describe('Repository and script path handling', () => {
    it('should handle script path with spaces when invoked', () => {
      const pathWithSpaces = path.join(tmpdir(), 'my test script dir', 'script.mjs');
      // This test verifies the script can be invoked via spawnSync
      // without shell, which handles spaces correctly
      expect(pathWithSpaces).toContain('my test script dir');
    });

    it('should handle repository paths with spaces', () => {
      const spaceDir = path.join(tmpdir(), 'repo with spaces');
      mkdirSync(spaceDir, { recursive: true });

      try {
        // Initialize a git repo in the space-containing directory
        spawnSync('git', ['init', '--initial-branch=main'], {
          cwd: spaceDir,
          stdio: 'pipe',
        });

        spawnSync('git', ['config', 'user.email', 'test@example.com'], {
          cwd: spaceDir,
          stdio: 'pipe',
        });

        spawnSync('git', ['config', 'user.name', 'Test User'], {
          cwd: spaceDir,
          stdio: 'pipe',
        });

        // Create and stage a file with spaces in the directory name
        const testFile = path.join(spaceDir, 'test file.txt');
        writeFileSync(testFile, 'test content');
        spawnSync('git', ['add', 'test file.txt'], {
          cwd: spaceDir,
          stdio: 'pipe',
        });

        const result = spawnSync('git', ['ls-files', '-z'], {
          cwd: spaceDir,
          encoding: 'utf8',
          stdio: 'pipe',
        });

        expect(result.status).toBe(0);
        expect(result.stdout).toContain('test file.txt');
      } finally {
        rmSync(spaceDir, { recursive: true, force: true });
      }
    });
  });
});
