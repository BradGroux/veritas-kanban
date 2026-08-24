import path from 'node:path';
import { readFile, readdir } from './fs-helpers.js';

export interface MarkdownSourceFile {
  absolutePath: string;
  filename: string;
  content: string;
}

export class TaskIdentityFileRepository {
  async readMarkdownFiles(directory: string): Promise<MarkdownSourceFile[]> {
    let files: string[];
    try {
      files = await readdir(directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }

    const results: MarkdownSourceFile[] = [];
    for (const filename of files.filter((entry) => entry.endsWith('.md')).sort()) {
      const absolutePath = path.join(directory, filename);
      results.push({
        absolutePath,
        filename,
        content: await readFile(absolutePath, 'utf8'),
      });
    }
    return results;
  }
}
