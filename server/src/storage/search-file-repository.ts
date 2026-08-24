import path from 'node:path';
import { readFile, readdir, lstat } from './fs-helpers.js';

export interface SearchFileDescriptor {
  path: string;
  mtimeMs: number;
}

export interface SearchFileListOptions {
  extensions: readonly string[];
  maxFiles: number;
  skippedDirectories: ReadonlySet<string>;
}

export class SearchFileRepository {
  readText(filePath: string): Promise<string> {
    return readFile(filePath, 'utf8');
  }

  async listFiles(dir: string, options: SearchFileListOptions): Promise<SearchFileDescriptor[]> {
    const files: SearchFileDescriptor[] = [];
    const allowedExtensions = new Set(
      options.extensions.map((extension) => extension.toLowerCase())
    );

    const visit = async (currentDir: string): Promise<void> => {
      if (files.length >= options.maxFiles) return;

      let entries;
      try {
        entries = await readdir(currentDir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        if (files.length >= options.maxFiles) return;
        if (options.skippedDirectories.has(entry.name)) continue;

        const fullPath = path.join(currentDir, entry.name);
        if (entry.isDirectory()) {
          await visit(fullPath);
          continue;
        }
        if (!entry.isFile() || !allowedExtensions.has(path.extname(entry.name).toLowerCase())) {
          continue;
        }

        try {
          const stats = await lstat(fullPath);
          files.push({ path: fullPath, mtimeMs: stats.mtimeMs });
        } catch {
          // File may disappear while the index is being refreshed.
        }
      }
    };

    await visit(dir);
    return files.sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, options.maxFiles);
  }
}
