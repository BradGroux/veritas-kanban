import fs from 'fs/promises';
import path from 'path';
import { createLogger } from '../lib/logger.js';
import { getRuntimeDir } from '../utils/paths.js';

const log = createLogger('progress-service');

/**
 * Progress file storage for cross-session agent memory.
 * Stores markdown files in .veritas-kanban/progress/<task-id>.md
 */
export class ProgressService {
  private progressDir: string;

  constructor(progressDir?: string) {
    this.progressDir = progressDir || path.join(getRuntimeDir(), 'progress');
  }

  /**
   * Ensure the progress directory exists
   */
  private async ensureDirectory(): Promise<void> {
    await fs.mkdir(this.progressDir, { recursive: true });
  }

  /**
   * Get the file path for a task's progress file
   */
  private getProgressPath(taskId: string): string {
    return path.join(this.progressDir, `${taskId}.md`);
  }

  /**
   * Get progress content for a task
   * Returns null if no progress file exists
   */
  async getProgress(taskId: string): Promise<string | null> {
    try {
      const filepath = this.getProgressPath(taskId);
      const content = await fs.readFile(filepath, 'utf-8');
      log.debug({ taskId }, 'Progress file read');
      return content;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        // No progress file exists yet — that's fine
        return null;
      }
      log.error({ err: error, taskId }, 'Failed to read progress file');
      throw error;
    }
  }

  /**
   * Update (overwrite) progress content for a task
   */
  async updateProgress(taskId: string, content: string): Promise<void> {
    await this.ensureDirectory();
    const filepath = this.getProgressPath(taskId);

    try {
      await fs.writeFile(filepath, content, 'utf-8');
      log.debug({ taskId }, 'Progress file updated');
    } catch (error) {
      log.error({ err: error, taskId }, 'Failed to update progress file');
      throw error;
    }
  }

  /**
   * Append content to a specific section of the progress file.
   * If the section doesn't exist, it's created at the end.
   * Section format: ## Section Name
   */
  async appendProgress(taskId: string, section: string, content: string): Promise<void> {
    await this.ensureDirectory();

    const existingContent = (await this.getProgress(taskId)) || '';
    const sectionHeader = `## ${section}`;
    const appendText = `\n${content.trim()}\n`;

    let updatedContent: string;

    if (existingContent.includes(sectionHeader)) {
      // Section exists — find it and append after the header
      const lines = existingContent.split('\n');
      const sectionIndex = lines.findIndex((line) => line.trim() === sectionHeader);

      if (sectionIndex !== -1) {
        // Find the next section header or end of file
        let endIndex = lines.length;
        for (let i = sectionIndex + 1; i < lines.length; i++) {
          if (lines[i].startsWith('## ')) {
            endIndex = i;
            break;
          }
        }

        // Insert content before the next section
        lines.splice(endIndex, 0, appendText.trim());
        updatedContent = lines.join('\n');
      } else {
        // Shouldn't happen, but fallback to appending at end
        updatedContent = `${existingContent}\n${sectionHeader}${appendText}`;
      }
    } else {
      // Section doesn't exist — create it at the end
      updatedContent = existingContent
        ? `${existingContent.trim()}\n\n${sectionHeader}${appendText}`
        : `${sectionHeader}${appendText}`;
    }

    await this.updateProgress(taskId, updatedContent);
    log.debug({ taskId, section }, 'Progress appended to section');
  }

  /**
   * Delete progress file for a task (cleanup when archived)
   */
  async deleteProgress(taskId: string): Promise<void> {
    try {
      const filepath = this.getProgressPath(taskId);
      await fs.unlink(filepath);
      log.debug({ taskId }, 'Progress file deleted');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        // File doesn't exist — that's fine
        return;
      }
      log.error({ err: error, taskId }, 'Failed to delete progress file');
      throw error;
    }
  }
}

// Singleton instance
let progressServiceInstance: ProgressService | null = null;

export function getProgressService(): ProgressService {
  if (!progressServiceInstance) {
    progressServiceInstance = new ProgressService();
  }
  return progressServiceInstance;
}

/** Dispose and reset the singleton (useful for tests) */
export function disposeProgressService(): void {
  progressServiceInstance = null;
}
