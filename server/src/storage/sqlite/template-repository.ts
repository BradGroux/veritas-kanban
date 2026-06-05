import type {
  CreateTemplateInput,
  TaskTemplate,
  UpdateTemplateInput,
} from '@veritas-kanban/shared';
import type { TemplateRepository } from '../interfaces.js';
import type { SqliteDatabase } from './database.js';

interface TemplateRow {
  template_json: string;
}

export class SqliteTemplateRepository implements TemplateRepository {
  constructor(private readonly database: SqliteDatabase) {}

  async getTemplates(): Promise<TaskTemplate[]> {
    const rows = this.database
      .getConnection()
      .prepare(
        `
          SELECT template_json
          FROM task_templates
          ORDER BY name COLLATE NOCASE ASC
        `
      )
      .all() as unknown as TemplateRow[];

    return rows.map((row) => this.migrateTemplate(JSON.parse(row.template_json)));
  }

  async getTemplate(id: string): Promise<TaskTemplate | null> {
    const row = this.database
      .getConnection()
      .prepare('SELECT template_json FROM task_templates WHERE id = ?')
      .get(id) as TemplateRow | undefined;

    return row ? this.migrateTemplate(JSON.parse(row.template_json)) : null;
  }

  async createTemplate(input: CreateTemplateInput): Promise<TaskTemplate> {
    const id = `template_${this.slugify(input.name)}_${Date.now()}`;
    const now = new Date().toISOString();

    const template: TaskTemplate = {
      id,
      name: input.name,
      description: input.description,
      category: input.category,
      version: 1,
      taskDefaults: input.taskDefaults,
      subtaskTemplates: input.subtaskTemplates,
      blueprint: input.blueprint,
      launch: input.launch,
      created: now,
      updated: now,
    };

    this.upsertTemplate(template);
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
      version: existing.version,
      taskDefaults: {
        ...existing.taskDefaults,
        ...input.taskDefaults,
      },
      subtaskTemplates: input.subtaskTemplates ?? existing.subtaskTemplates,
      blueprint: input.blueprint ?? existing.blueprint,
      launch: input.launch ?? existing.launch,
      updated: new Date().toISOString(),
    };

    this.upsertTemplate(updated);
    return updated;
  }

  async deleteTemplate(id: string): Promise<boolean> {
    const result = this.database
      .getConnection()
      .prepare('DELETE FROM task_templates WHERE id = ?')
      .run(id);

    return result.changes > 0;
  }

  private upsertTemplate(template: TaskTemplate): void {
    this.database
      .getConnection()
      .prepare(
        `
          INSERT INTO task_templates (
            id,
            name,
            category,
            template_json,
            created_at,
            updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            category = excluded.category,
            template_json = excluded.template_json,
            updated_at = excluded.updated_at
        `
      )
      .run(
        template.id,
        template.name,
        template.category ?? null,
        JSON.stringify(template),
        template.created,
        template.updated
      );
  }

  private migrateTemplate(data: unknown): TaskTemplate {
    const template = data as TaskTemplate;
    if (template.version === 1) {
      return template;
    }

    return {
      id: template.id,
      name: template.name,
      description: template.description,
      version: 1,
      taskDefaults: {
        type: template.taskDefaults?.type,
        priority: template.taskDefaults?.priority,
        project: template.taskDefaults?.project,
        descriptionTemplate: template.taskDefaults?.descriptionTemplate,
        agent: undefined,
      },
      category: undefined,
      subtaskTemplates: undefined,
      blueprint: undefined,
      launch: undefined,
      created: template.created,
      updated: template.updated,
    };
  }

  private slugify(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  }
}
