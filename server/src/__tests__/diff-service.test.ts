/**
 * DiffService Tests
 * Tests parseable/utility methods. Git-dependent methods are not tested here.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DiffService } from '../services/diff-service.js';

// Mock task-service since DiffService creates one in constructor
vi.mock('../services/task-service.js', () => {
  return {
    TaskService: class MockTaskService {
      getTask = vi.fn();
      listTasks = vi.fn().mockResolvedValue([]);
    },
  };
});

describe('DiffService', () => {
  let service: DiffService;

  beforeEach(() => {
    service = new DiffService();
  });

  describe('getLanguageFromPath (private)', () => {
    // Access private method for testing
    const getLanguage = (filePath: string) => {
      return (service as any).getLanguageFromPath(filePath);
    };

    it('should detect TypeScript', () => {
      expect(getLanguage('src/index.ts')).toBe('typescript');
    });

    it('should detect TSX', () => {
      expect(getLanguage('src/App.tsx')).toBe('tsx');
    });

    it('should detect JavaScript', () => {
      expect(getLanguage('src/index.js')).toBe('javascript');
    });

    it('should detect JSX', () => {
      expect(getLanguage('src/App.jsx')).toBe('jsx');
    });

    it('should detect JSON', () => {
      expect(getLanguage('package.json')).toBe('json');
    });

    it('should detect Markdown', () => {
      expect(getLanguage('README.md')).toBe('markdown');
    });

    it('should detect CSS', () => {
      expect(getLanguage('styles.css')).toBe('css');
    });

    it('should detect SCSS', () => {
      expect(getLanguage('styles.scss')).toBe('scss');
    });

    it('should detect HTML', () => {
      expect(getLanguage('index.html')).toBe('html');
    });

    it('should detect Python', () => {
      expect(getLanguage('script.py')).toBe('python');
    });

    it('should detect Rust', () => {
      expect(getLanguage('main.rs')).toBe('rust');
    });

    it('should detect Go', () => {
      expect(getLanguage('main.go')).toBe('go');
    });

    it('should detect Ruby', () => {
      expect(getLanguage('app.rb')).toBe('ruby');
    });

    it('should detect Java', () => {
      expect(getLanguage('Main.java')).toBe('java');
    });

    it('should detect Shell', () => {
      expect(getLanguage('script.sh')).toBe('bash');
    });

    it('should detect YAML', () => {
      expect(getLanguage('config.yaml')).toBe('yaml');
      expect(getLanguage('config.yml')).toBe('yaml');
    });

    it('should detect TOML', () => {
      expect(getLanguage('Cargo.toml')).toBe('toml');
    });

    it('should detect SQL', () => {
      expect(getLanguage('query.sql')).toBe('sql');
    });

    it('should return plaintext for unknown extensions', () => {
      expect(getLanguage('file.xyz')).toBe('plaintext');
      expect(getLanguage('Makefile')).toBe('plaintext');
    });
  });

  describe('parseStatusCode (private)', () => {
    const parseStatus = (code: string) => {
      return (service as any).parseStatusCode(code);
    };

    it('should parse Added status', () => {
      expect(parseStatus('A')).toBe('added');
    });

    it('should parse Modified status', () => {
      expect(parseStatus('M')).toBe('modified');
    });

    it('should parse Deleted status', () => {
      expect(parseStatus('D')).toBe('deleted');
    });

    it('should parse Renamed status', () => {
      expect(parseStatus('R100')).toBe('renamed');
    });

    it('should default to modified for unknown', () => {
      expect(parseStatus('X')).toBe('modified');
    });
  });

  describe('parseUnifiedDiff (private)', () => {
    const parseDiff = (output: string) => {
      return (service as any).parseUnifiedDiff(output);
    };

    it('should return empty array for empty diff', () => {
      expect(parseDiff('')).toEqual([]);
    });

    it('should parse a simple hunk with additions', () => {
      const diff = `diff --git a/file.ts b/file.ts
index abc123..def456 100644
--- a/file.ts
+++ b/file.ts
@@ -1,3 +1,4 @@
 line 1
 line 2
+new line
 line 3`;

      const hunks = parseDiff(diff);
      expect(hunks).toHaveLength(1);
      expect(hunks[0].oldStart).toBe(1);
      expect(hunks[0].oldLines).toBe(3);
      expect(hunks[0].newStart).toBe(1);
      expect(hunks[0].newLines).toBe(4);

      const addedLines = hunks[0].lines.filter((l: any) => l.type === 'add');
      expect(addedLines).toHaveLength(1);
      expect(addedLines[0].content).toBe('new line');
    });

    it('should parse a hunk with deletions', () => {
      const diff = `@@ -1,4 +1,3 @@
 line 1
-removed line
 line 2
 line 3`;

      const hunks = parseDiff(diff);
      expect(hunks).toHaveLength(1);

      const deletedLines = hunks[0].lines.filter((l: any) => l.type === 'delete');
      expect(deletedLines).toHaveLength(1);
      expect(deletedLines[0].content).toBe('removed line');
    });

    it('should parse multiple hunks', () => {
      const diff = `@@ -1,3 +1,4 @@
 line 1
+added 1
 line 2
 line 3
@@ -10,3 +11,4 @@
 line 10
+added 2
 line 11
 line 12`;

      const hunks = parseDiff(diff);
      expect(hunks).toHaveLength(2);
      expect(hunks[0].oldStart).toBe(1);
      expect(hunks[1].oldStart).toBe(10);
    });

    it('should track line numbers correctly', () => {
      const diff = `@@ -5,4 +5,5 @@
 context
+added
 context2
-deleted
 context3`;

      const hunks = parseDiff(diff);
      const lines = hunks[0].lines;

      // Context line at old:5, new:5
      expect(lines[0].type).toBe('context');
      expect(lines[0].oldNumber).toBe(5);
      expect(lines[0].newNumber).toBe(5);

      // Added line at new:6
      expect(lines[1].type).toBe('add');
      expect(lines[1].newNumber).toBe(6);

      // Context line at old:6, new:7
      expect(lines[2].type).toBe('context');
      expect(lines[2].oldNumber).toBe(6);
      expect(lines[2].newNumber).toBe(7);

      // Deleted line at old:7
      expect(lines[3].type).toBe('delete');
      expect(lines[3].oldNumber).toBe(7);
    });
  });
});
