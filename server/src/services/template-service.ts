import { readdir, readFile, writeFile, unlink, mkdir } from 'fs/promises';
import { fileExists } from '../storage/fs-helpers.js';
import { join } from 'path';
import matter from 'gray-matter';
import type {
  TaskTemplate,
  CreateTemplateInput,
  UpdateTemplateInput,
} from '@veritas-kanban/shared';
import { createLogger } from '../lib/logger.js';
import { validatePathSegment, ensureWithinBase } from '../utils/sanitize.js';
import { getTemplatesDir } from '../utils/paths.js';
const log = createLogger('template-service');

export class TemplateService {
  private templatesDir: string;

  constructor() {
    this.templatesDir = getTemplatesDir();
    this.ensureDir();
  }

  private async ensureDir() {
    await mkdir(this.templatesDir, { recursive: true });
  }

  /**
   * Recursively remove undefined values from an object for YAML serialization
   */
  private cleanForYaml(obj: any): any {
    if (obj === null || obj === undefined) {
      return undefined;
    }
    if (Array.isArray(obj)) {
      return obj.map((item) => this.cleanForYaml(item)).filter((item) => item !== undefined);
    }
    if (typeof obj === 'object') {
      const cleaned: Record<string, any> = {};
      for (const [key, value] of Object.entries(obj)) {
        const cleanedValue = this.cleanForYaml(value);
        if (cleanedValue !== undefined) {
          cleaned[key] = cleanedValue;
        }
      }
      return Object.keys(cleaned).length > 0 ? cleaned : undefined;
    }
    return obj;
  }

  private slugify(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  }

  private templatePath(id: string): string {
    validatePathSegment(id);
    const filepath = join(this.templatesDir, `${id}.md`);
    ensureWithinBase(this.templatesDir, filepath);
    return filepath;
  }

  /**
   * Migrate v0 (legacy) templates to v1 (enhanced) format
   * v0 templates don't have a version field
   */
  private migrateTemplate(data: any): TaskTemplate {
    // If version is already 1, no migration needed
    if (data.version === 1) {
      return data as TaskTemplate;
    }

    // Migrate v0 to v1
    const migrated: TaskTemplate = {
      id: data.id,
      name: data.name,
      description: data.description,
      version: 1,
      taskDefaults: {
        type: data.taskDefaults?.type,
        priority: data.taskDefaults?.priority,
        project: data.taskDefaults?.project,
        descriptionTemplate: data.taskDefaults?.descriptionTemplate,
        // New v1 fields initialized as undefined
        agent: undefined,
      },
      // New v1 fields
      category: undefined,
      subtaskTemplates: undefined,
      blueprint: undefined,
      created: data.created,
      updated: data.updated,
    };

    return migrated;
  }

  async getTemplates(): Promise<TaskTemplate[]> {
    await this.ensureDir();

    const files = await readdir(this.templatesDir);
    const templates: TaskTemplate[] = [];

    for (const file of files) {
      if (!file.endsWith('.md')) continue;

      try {
        const content = await readFile(join(this.templatesDir, file), 'utf-8');
        const { data } = matter(content);
        const migrated = this.migrateTemplate(data);
        templates.push(migrated);
      } catch (err) {
        log.error({ err: err }, `Error reading template ${file}`);
      }
    }

    return templates.sort((a, b) => a.name.localeCompare(b.name));
  }

  async getTemplate(id: string): Promise<TaskTemplate | null> {
    const path = this.templatePath(id);

    if (!(await fileExists(path))) {
      return null;
    }

    try {
      const content = await readFile(path, 'utf-8');
      const { data } = matter(content);
      return this.migrateTemplate(data);
    } catch (err) {
      log.error({ err: err }, `Error reading template ${id}`);
      return null;
    }
  }

  async createTemplate(input: CreateTemplateInput): Promise<TaskTemplate> {
    await this.ensureDir();

    const id = `template_${this.slugify(input.name)}_${Date.now()}`;
    const now = new Date().toISOString();

    const template: TaskTemplate = {
      id,
      name: input.name,
      description: input.description,
      category: input.category,
      version: 1, // All new templates are v1
      taskDefaults: input.taskDefaults,
      subtaskTemplates: input.subtaskTemplates,
      blueprint: input.blueprint,
      created: now,
      updated: now,
    };

    // Recursively filter out undefined values for YAML serialization
    const cleanTemplate = this.cleanForYaml(template);

    const content = matter.stringify('', cleanTemplate);
    await writeFile(this.templatePath(id), content, 'utf-8');

    return template;
  }

  async updateTemplate(id: string, input: UpdateTemplateInput): Promise<TaskTemplate | null> {
    const existing = await this.getTemplate(id);
    if (!existing) return null;

    const updated: TaskTemplate = {
      ...existing,
      name: input.name ?? existing.name,
      description: input.description ?? existing.description,
      category: input.category ?? existing.category,
      version: existing.version, // Preserve version
      taskDefaults: {
        ...existing.taskDefaults,
        ...input.taskDefaults,
      },
      subtaskTemplates: input.subtaskTemplates ?? existing.subtaskTemplates,
      blueprint: input.blueprint ?? existing.blueprint,
      updated: new Date().toISOString(),
    };

    // Recursively filter out undefined values for YAML serialization
    const cleanTemplate = this.cleanForYaml(updated);

    const content = matter.stringify('', cleanTemplate);
    await writeFile(this.templatePath(id), content, 'utf-8');

    return updated;
  }

  async deleteTemplate(id: string): Promise<boolean> {
    const path = this.templatePath(id);

    if (!(await fileExists(path))) {
      return false;
    }

    await unlink(path);
    return true;
  }
}
