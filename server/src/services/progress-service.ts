import { createLogger } from '../lib/logger.js';
import { FileProgressRepository, type ProgressRepository } from '../storage/progress-repository.js';

const log = createLogger('progress-service');

/**
 * Progress file storage for cross-session agent memory.
 * Stores markdown files in .veritas-kanban/progress/<task-id>.md
 */
export class ProgressService {
  private readonly repository: ProgressRepository;

  constructor(progressDir?: string, repository?: ProgressRepository) {
    this.repository = repository ?? new FileProgressRepository(progressDir || undefined);
  }

  /**
   * Get progress content for a task
   * Returns null if no progress file exists
   */
  async getProgress(taskId: string): Promise<string | null> {
    try {
      const content = await this.repository.get(taskId);
      if (content !== null) log.debug({ taskId }, 'Progress file read');
      return content;
    } catch (error) {
      log.error({ err: error, taskId }, 'Failed to read progress file');
      throw error;
    }
  }

  /**
   * Update (overwrite) progress content for a task
   */
  async updateProgress(taskId: string, content: string): Promise<void> {
    try {
      await this.repository.set(taskId, content);
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
    try {
      await this.repository.update(taskId, (existingContent) =>
        this.appendToSection(existingContent ?? '', section, content)
      );
      log.debug({ taskId, section }, 'Progress appended to section');
    } catch (error) {
      log.error({ err: error, taskId, section }, 'Failed to append progress');
      throw error;
    }
  }

  /**
   * Delete progress file for a task (cleanup when archived)
   */
  async deleteProgress(taskId: string): Promise<void> {
    try {
      await this.repository.delete(taskId);
      log.debug({ taskId }, 'Progress file deleted');
    } catch (error) {
      log.error({ err: error, taskId }, 'Failed to delete progress file');
      throw error;
    }
  }

  private appendToSection(existingContent: string, section: string, content: string): string {
    const sectionHeader = `## ${section}`;
    const appendText = `\n${content.trim()}\n`;

    if (!existingContent.includes(sectionHeader)) {
      return existingContent
        ? `${existingContent.trim()}\n\n${sectionHeader}${appendText}`
        : `${sectionHeader}${appendText}`;
    }

    const lines = existingContent.split('\n');
    const sectionIndex = lines.findIndex((line) => line.trim() === sectionHeader);
    if (sectionIndex === -1) return `${existingContent}\n${sectionHeader}${appendText}`;

    let endIndex = lines.length;
    for (let index = sectionIndex + 1; index < lines.length; index += 1) {
      if (lines[index].startsWith('## ')) {
        endIndex = index;
        break;
      }
    }
    lines.splice(endIndex, 0, appendText.trim());
    return lines.join('\n');
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
