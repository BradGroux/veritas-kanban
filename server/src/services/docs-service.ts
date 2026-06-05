/**
 * Docs Service
 *
 * Manages markdown documents stored in the VK docs directory.
 * Provides CRUD operations, search, and file system watching.
 *
 * Inspired by @nateherk's Klouse dashboard docs tab.
 */

import { createLogger } from '../lib/logger.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), '..', '.veritas-kanban');

const log = createLogger('docs');

// ─── Types ───────────────────────────────────────────────────────

export interface DocFile {
  /** Relative path from docs root */
  path: string;
  /** Filename without directory */
  name: string;
  /** File content (markdown) */
  content?: string;
  /** File size in bytes */
  size: number;
  /** Last modified ISO timestamp */
  modified: string;
  /** Created ISO timestamp */
  created: string;
  /** File extension */
  extension: string;
  /** Directory containing the file */
  directory: string;
}

export interface DocSearchResult {
  file: DocFile;
  /** Matching lines with context */
  matches: Array<{
    line: number;
    text: string;
    highlight: string;
  }>;
}

export interface DocsStats {
  totalFiles: number;
  totalSize: number;
  byExtension: Record<string, number>;
  byDirectory: Record<string, number>;
  lastModified?: DocFile;
}

// ─── Service ─────────────────────────────────────────────────────

export class DocsService {
  private docsRoot: string;

  constructor(docsRoot?: string) {
    // Default to <storage>/../docs, configurable via VK_DOCS_DIR
    this.docsRoot = path.resolve(
      docsRoot || process.env.VK_DOCS_DIR || path.join(DATA_DIR, '..', 'docs')
    );
  }

  /**
   * List all markdown files in the docs directory.
   */
  async listFiles(options?: {
    directory?: string;
    extension?: string;
    sortBy?: 'name' | 'modified' | 'size';
    sortOrder?: 'asc' | 'desc';
  }): Promise<DocFile[]> {
    const files: DocFile[] = [];
    const root = options?.directory
      ? await this.resolveDocsDirectory(options.directory)
      : this.docsRoot;

    if (!root) return [];

    try {
      await this.scanDirectory(root, files);
    } catch (err) {
      log.warn({ err, root }, 'Failed to scan docs directory');
      return [];
    }

    // Filter by extension
    if (options?.extension) {
      const ext = options.extension.startsWith('.') ? options.extension : `.${options.extension}`;
      return files.filter((f) => f.extension === ext);
    }

    // Sort
    const sortBy = options?.sortBy || 'modified';
    const sortOrder = options?.sortOrder || 'desc';
    files.sort((a, b) => {
      let cmp = 0;
      switch (sortBy) {
        case 'name':
          cmp = a.name.localeCompare(b.name);
          break;
        case 'modified':
          cmp = new Date(a.modified).getTime() - new Date(b.modified).getTime();
          break;
        case 'size':
          cmp = a.size - b.size;
          break;
      }
      return sortOrder === 'asc' ? cmp : -cmp;
    });

    return files;
  }

  /**
   * Get a specific file with content.
   */
  async getFile(filePath: string): Promise<DocFile | null> {
    const fullPath = await this.resolveExistingFilePath(filePath);
    if (!fullPath) return null;

    try {
      const stat = await fs.stat(fullPath);
      const content = await fs.readFile(fullPath, 'utf-8');

      return {
        path: filePath,
        name: path.basename(filePath),
        content,
        size: stat.size,
        modified: stat.mtime.toISOString(),
        created: stat.birthtime.toISOString(),
        extension: path.extname(filePath),
        directory: path.dirname(filePath),
      };
    } catch {
      return null;
    }
  }

  /**
   * Create or update a file.
   */
  async saveFile(filePath: string, content: string): Promise<DocFile> {
    const fullPath = await this.resolveWritableFilePath(filePath);
    if (!fullPath) {
      throw new Error('Invalid file path');
    }

    // Ensure directory exists
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, content, 'utf-8');

    const stat = await fs.stat(fullPath);
    log.info({ filePath }, 'Doc saved');

    return {
      path: filePath,
      name: path.basename(filePath),
      content,
      size: stat.size,
      modified: stat.mtime.toISOString(),
      created: stat.birthtime.toISOString(),
      extension: path.extname(filePath),
      directory: path.dirname(filePath),
    };
  }

  /**
   * Delete a file.
   */
  async deleteFile(filePath: string): Promise<boolean> {
    const fullPath = await this.resolveExistingFilePath(filePath);
    if (!fullPath) return false;

    try {
      await fs.unlink(fullPath);
      log.info({ filePath }, 'Doc deleted');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Search files by name and content.
   */
  async search(query: string, options?: { limit?: number }): Promise<DocSearchResult[]> {
    const files = await this.listFiles();
    const results: DocSearchResult[] = [];
    const queryLower = query.toLowerCase();
    const limit = options?.limit || 20;

    for (const file of files) {
      // Check filename match
      if (file.name.toLowerCase().includes(queryLower)) {
        results.push({ file, matches: [] });
        if (results.length >= limit) break;
        continue;
      }

      // Check content match
      try {
        const fullPath = await this.resolveExistingFilePath(file.path);
        if (!fullPath) continue;
        const content = await fs.readFile(fullPath, 'utf-8');
        const lines = content.split('\n');
        const matches: DocSearchResult['matches'] = [];

        for (let i = 0; i < lines.length; i++) {
          if (lines[i].toLowerCase().includes(queryLower)) {
            matches.push({
              line: i + 1,
              text: lines[i].slice(0, 200),
              highlight: query,
            });
            if (matches.length >= 3) break; // Max 3 matches per file
          }
        }

        if (matches.length > 0) {
          results.push({ file, matches });
          if (results.length >= limit) break;
        }
      } catch {
        // Skip unreadable files
      }
    }

    return results;
  }

  /**
   * Get docs directory statistics.
   */
  async getStats(): Promise<DocsStats> {
    const files = await this.listFiles();
    const byExtension: Record<string, number> = {};
    const byDirectory: Record<string, number> = {};
    let totalSize = 0;

    for (const file of files) {
      totalSize += file.size;
      byExtension[file.extension] = (byExtension[file.extension] || 0) + 1;
      byDirectory[file.directory || '.'] = (byDirectory[file.directory || '.'] || 0) + 1;
    }

    return {
      totalFiles: files.length,
      totalSize,
      byExtension,
      byDirectory,
      lastModified: files[0], // Already sorted by modified desc
    };
  }

  /**
   * List subdirectories.
   */
  async listDirectories(): Promise<string[]> {
    const dirs: string[] = [];
    try {
      await this.scanDirectories(this.docsRoot, '', dirs);
    } catch {
      // Root doesn't exist
    }
    return dirs.sort();
  }

  // ─── Private ─────────────────────────────────────────────────

  private isWithinDocsRoot(candidatePath: string, root = this.docsRoot): boolean {
    const relative = path.relative(root, candidatePath);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
  }

  private resolveLogicalDocsPath(filePath: string): string | null {
    const resolved = path.resolve(this.docsRoot, filePath);
    if (!this.isWithinDocsRoot(resolved)) {
      log.warn({ filePath }, 'Docs path traversal attempt blocked');
      return null;
    }
    return resolved;
  }

  private async realDocsRoot(): Promise<string> {
    try {
      return await fs.realpath(this.docsRoot);
    } catch {
      return this.docsRoot;
    }
  }

  private async resolveDocsDirectory(directory: string): Promise<string | null> {
    const resolved = this.resolveLogicalDocsPath(directory);
    if (!resolved) return null;

    try {
      const [realRoot, realDirectory] = await Promise.all([
        this.realDocsRoot(),
        fs.realpath(resolved),
      ]);
      if (!this.isWithinDocsRoot(realDirectory, realRoot)) {
        log.warn({ directory }, 'Docs directory symlink escape blocked');
        return null;
      }
    } catch {
      // Missing directories are handled by scanDirectory as an empty result.
    }

    return resolved;
  }

  private async resolveExistingFilePath(filePath: string): Promise<string | null> {
    const resolved = this.resolveLogicalDocsPath(filePath);
    if (!resolved) return null;

    try {
      const [realRoot, realFile] = await Promise.all([this.realDocsRoot(), fs.realpath(resolved)]);
      if (!this.isWithinDocsRoot(realFile, realRoot)) {
        log.warn({ filePath }, 'Docs file symlink escape blocked');
        return null;
      }
    } catch {
      return null;
    }

    return resolved;
  }

  private async resolveWritableFilePath(filePath: string): Promise<string | null> {
    const resolved = this.resolveLogicalDocsPath(filePath);
    if (!resolved) return null;

    try {
      await fs.mkdir(this.docsRoot, { recursive: true });
      const parent = path.dirname(resolved);
      const parentReady = await this.ensureWritableDirectory(parent, filePath);
      if (!parentReady) return null;

      const [realRoot, realParent] = await Promise.all([
        fs.realpath(this.docsRoot),
        fs.realpath(parent),
      ]);
      if (!this.isWithinDocsRoot(realParent, realRoot)) {
        log.warn({ filePath }, 'Docs write symlink escape blocked');
        return null;
      }

      try {
        const existing = await fs.lstat(resolved);
        if (existing.isSymbolicLink()) {
          log.warn({ filePath }, 'Docs write to symlink blocked');
          return null;
        }
      } catch {
        // New file; parent containment is enough.
      }
    } catch {
      return null;
    }

    return resolved;
  }

  private async ensureWritableDirectory(directory: string, filePath: string): Promise<boolean> {
    const relativeParent = path.relative(this.docsRoot, directory);
    const segments =
      relativeParent && relativeParent !== '.'
        ? relativeParent.split(path.sep).filter(Boolean)
        : [];
    let current = this.docsRoot;

    for (const segment of segments) {
      current = path.join(current, segment);
      try {
        const existing = await fs.lstat(current);
        if (existing.isSymbolicLink() || !existing.isDirectory()) {
          log.warn({ filePath }, 'Docs write through unsafe parent blocked');
          return false;
        }
      } catch {
        await fs.mkdir(current);
      }
    }

    return true;
  }

  private async scanDirectory(dir: string, files: DocFile[]): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        // Skip hidden directories
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
        await this.scanDirectory(fullPath, files);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name);
        // Only index markdown and text files
        if (!['.md', '.mdx', '.txt', '.json', '.yaml', '.yml'].includes(ext)) continue;

        try {
          const stat = await fs.stat(fullPath);
          const relativePath = path.relative(this.docsRoot, fullPath);
          files.push({
            path: relativePath,
            name: entry.name,
            size: stat.size,
            modified: stat.mtime.toISOString(),
            created: stat.birthtime.toISOString(),
            extension: ext,
            directory: path.dirname(relativePath),
          });
        } catch {
          // Skip inaccessible files
        }
      }
    }
  }

  private async scanDirectories(dir: string, prefix: string, dirs: string[]): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
        const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
        dirs.push(relative);
        await this.scanDirectories(path.join(dir, entry.name), relative, dirs);
      }
    }
  }
}

// Singleton
let instance: DocsService | null = null;

export function getDocsService(): DocsService {
  if (!instance) {
    instance = new DocsService();
  }
  return instance;
}
