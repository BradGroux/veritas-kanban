import type {
  CreatePromptTemplateInput,
  PromptStats,
  PromptTemplate,
  PromptUsage,
  PromptVersion,
  RenderPreviewRequest,
  RenderPreviewResponse,
  UpdatePromptTemplateInput,
} from '@veritas-kanban/shared';
import type { PromptRegistryRepository } from '../interfaces.js';
import type { SqliteDatabase } from './database.js';

interface PromptTemplateRow {
  template_json: string;
}

interface PromptVersionRow {
  version_json: string;
}

interface PromptUsageRow {
  usage_json: string;
}

export class SqlitePromptRegistryRepository implements PromptRegistryRepository {
  constructor(private readonly database: SqliteDatabase) {}

  async getTemplates(): Promise<PromptTemplate[]> {
    const rows = this.database
      .getConnection()
      .prepare(
        `
          SELECT template_json
          FROM prompt_templates
          ORDER BY name COLLATE NOCASE ASC
        `
      )
      .all() as unknown as PromptTemplateRow[];

    return rows.map((row) => JSON.parse(row.template_json) as PromptTemplate);
  }

  async getTemplate(id: string): Promise<PromptTemplate | null> {
    const row = this.database
      .getConnection()
      .prepare('SELECT template_json FROM prompt_templates WHERE id = ?')
      .get(id) as PromptTemplateRow | undefined;

    return row ? (JSON.parse(row.template_json) as PromptTemplate) : null;
  }

  async createTemplate(input: CreatePromptTemplateInput): Promise<PromptTemplate> {
    const id = `prompt_${this.slugify(input.name)}_${Date.now()}`;
    const now = new Date().toISOString();
    const variables = this.extractVariables(input.content);

    const template: PromptTemplate = {
      id,
      name: input.name,
      description: input.description,
      category: input.category,
      content: input.content,
      variables,
      created: now,
      updated: now,
      currentVersionId: `${id}_v1`,
    };

    const version: PromptVersion = {
      id: `${id}_v1`,
      templateId: id,
      versionNumber: 1,
      content: input.content,
      changelog: 'Initial version',
      createdAt: now,
    };

    this.transaction(() => {
      this.upsertTemplate(template);
      this.insertVersion(version);
    });

    return template;
  }

  async updateTemplate(
    id: string,
    input: UpdatePromptTemplateInput
  ): Promise<PromptTemplate | null> {
    const existing = await this.getTemplate(id);
    if (!existing) return null;

    const now = new Date().toISOString();
    const contentChanged = input.content !== undefined && input.content !== existing.content;
    if (contentChanged && !input.changelog) {
      throw new Error('changelog is required when updating template content');
    }

    const variables = contentChanged
      ? this.extractVariables(input.content ?? '')
      : existing.variables;

    let updated: PromptTemplate | null = null;

    this.transaction(() => {
      let newVersionId = existing.currentVersionId;

      if (contentChanged) {
        const row = this.database
          .getConnection()
          .prepare(
            `
              SELECT MAX(version_number) AS maxVersion
              FROM prompt_versions
              WHERE template_id = ?
            `
          )
          .get(id) as { maxVersion: number | null };

        const nextVersionNumber = (row.maxVersion ?? 0) + 1;
        const newVersion: PromptVersion = {
          id: `${id}_v${nextVersionNumber}`,
          templateId: id,
          versionNumber: nextVersionNumber,
          content: input.content ?? existing.content,
          changelog: input.changelog ?? '',
          createdAt: now,
        };

        this.insertVersion(newVersion);
        newVersionId = newVersion.id;
      }

      updated = {
        ...existing,
        name: input.name ?? existing.name,
        description: input.description ?? existing.description,
        category: input.category ?? existing.category,
        content: input.content ?? existing.content,
        variables,
        updated: now,
        currentVersionId: newVersionId,
      };

      this.upsertTemplate(updated);
    });

    return updated;
  }

  async deleteTemplate(id: string): Promise<boolean> {
    const existing = await this.getTemplate(id);
    if (!existing) return false;

    this.transaction(() => {
      const db = this.database.getConnection();
      db.prepare('DELETE FROM prompt_usage WHERE template_id = ?').run(id);
      db.prepare('DELETE FROM prompt_versions WHERE template_id = ?').run(id);
      db.prepare('DELETE FROM prompt_templates WHERE id = ?').run(id);
    });

    return true;
  }

  async getVersionHistory(templateId: string): Promise<PromptVersion[]> {
    const rows = this.database
      .getConnection()
      .prepare(
        `
          SELECT version_json
          FROM prompt_versions
          WHERE template_id = ?
          ORDER BY version_number DESC
        `
      )
      .all(templateId) as unknown as PromptVersionRow[];

    return rows.map((row) => JSON.parse(row.version_json) as PromptVersion);
  }

  async recordUsage(
    templateId: string,
    usedBy?: string,
    renderedPrompt?: string,
    model?: string,
    inputTokens?: number,
    outputTokens?: number
  ): Promise<PromptUsage> {
    const now = new Date().toISOString();
    const usage: PromptUsage = {
      id: `usage_${templateId}_${Date.now()}`,
      templateId,
      usedAt: now,
      usedBy,
      renderedPrompt,
      model,
      inputTokens,
      outputTokens,
    };

    this.database
      .getConnection()
      .prepare(
        `
          INSERT INTO prompt_usage (
            id,
            template_id,
            used_at,
            used_by,
            model,
            usage_json
          )
          VALUES (?, ?, ?, ?, ?, ?)
        `
      )
      .run(usage.id, templateId, now, usedBy ?? null, model ?? null, JSON.stringify(usage));

    return usage;
  }

  async getUsageRecords(templateId: string): Promise<PromptUsage[]> {
    const rows = this.database
      .getConnection()
      .prepare(
        `
          SELECT usage_json
          FROM prompt_usage
          WHERE template_id = ?
          ORDER BY used_at ASC
        `
      )
      .all(templateId) as unknown as PromptUsageRow[];

    return rows.map((row) => JSON.parse(row.usage_json) as PromptUsage);
  }

  async getStats(templateId: string): Promise<PromptStats | null> {
    const template = await this.getTemplate(templateId);
    if (!template) return null;

    const versions = await this.getVersionHistory(templateId);
    const usageRecords = await this.getUsageRecords(templateId);
    const lastUsedAt =
      usageRecords.length > 0 ? usageRecords[usageRecords.length - 1].usedAt : undefined;

    const userMap = new Map<string, number>();
    for (const record of usageRecords) {
      if (record.usedBy) {
        userMap.set(record.usedBy, (userMap.get(record.usedBy) || 0) + 1);
      }
    }
    const mostFrequentUser = Array.from(userMap.entries()).sort((a, b) => b[1] - a[1])[0]?.[0];

    const tokenRecords = usageRecords.filter(
      (record) => record.inputTokens !== undefined || record.outputTokens !== undefined
    );
    const averageTokensPerUsage =
      tokenRecords.length > 0
        ? tokenRecords.reduce(
            (sum, record) => sum + (record.inputTokens ?? 0) + (record.outputTokens ?? 0),
            0
          ) / tokenRecords.length
        : undefined;

    return {
      templateId,
      templateName: template.name,
      totalUsages: usageRecords.length,
      totalVersions: versions.length,
      lastUsedAt,
      mostFrequentUser,
      averageTokensPerUsage,
    };
  }

  async getAllStats(): Promise<PromptStats[]> {
    const templates = await this.getTemplates();
    const stats = await Promise.all(templates.map((template) => this.getStats(template.id)));

    return stats
      .filter((templateStats): templateStats is PromptStats => templateStats !== null)
      .sort((a, b) => b.totalUsages - a.totalUsages);
  }

  async renderPreview(request: RenderPreviewRequest): Promise<RenderPreviewResponse> {
    const template = await this.getTemplate(request.templateId);
    if (!template) {
      throw new Error(`Template ${request.templateId} not found`);
    }

    return this.renderTemplate(template.content, request.sampleVariables);
  }

  renderTemplate(content: string, variables: Record<string, string>): RenderPreviewResponse {
    let rendered = content;
    const unmatchedVariables = new Set<string>();

    for (const variableName of this.extractVariables(content)) {
      const value = variables[variableName];
      if (value !== undefined) {
        rendered = rendered.replace(new RegExp(`\\{\\{${variableName}\\}\\}`, 'g'), value);
      } else {
        unmatchedVariables.add(variableName);
      }
    }

    return {
      renderedPrompt: rendered,
      unmatchedVariables: Array.from(unmatchedVariables).sort(),
    };
  }

  private upsertTemplate(template: PromptTemplate): void {
    this.database
      .getConnection()
      .prepare(
        `
          INSERT INTO prompt_templates (
            id,
            name,
            category,
            current_version_id,
            template_json,
            created_at,
            updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            category = excluded.category,
            current_version_id = excluded.current_version_id,
            template_json = excluded.template_json,
            updated_at = excluded.updated_at
        `
      )
      .run(
        template.id,
        template.name,
        template.category,
        template.currentVersionId,
        JSON.stringify(template),
        template.created,
        template.updated
      );
  }

  private insertVersion(version: PromptVersion): void {
    this.database
      .getConnection()
      .prepare(
        `
          INSERT INTO prompt_versions (
            id,
            template_id,
            version_number,
            version_json,
            created_at
          )
          VALUES (?, ?, ?, ?, ?)
        `
      )
      .run(
        version.id,
        version.templateId,
        version.versionNumber,
        JSON.stringify(version),
        version.createdAt
      );
  }

  private extractVariables(content: string): string[] {
    const regex = /\{\{([^}]+)\}\}/g;
    const variables = new Set<string>();
    let match;

    while ((match = regex.exec(content)) !== null) {
      variables.add(match[1].trim());
    }

    return Array.from(variables).sort();
  }

  private slugify(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  }

  private transaction<T>(callback: () => T): T {
    const db = this.database.getConnection();

    try {
      db.exec('BEGIN IMMEDIATE;');
      const result = callback();
      db.exec('COMMIT;');
      return result;
    } catch (error) {
      try {
        db.exec('ROLLBACK;');
      } catch {
        // Preserve the original failure.
      }
      throw error;
    }
  }
}
