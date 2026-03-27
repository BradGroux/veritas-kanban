import { readdir, readFile, writeFile, unlink, mkdir } from 'fs/promises';
import { fileExists } from '../storage/fs-helpers.js';
import { join } from 'path';
import matter from 'gray-matter';
import type {
  PromptTemplate,
  PromptVersion,
  PromptUsage,
  PromptStats,
  CreatePromptTemplateInput,
  UpdatePromptTemplateInput,
  RenderPreviewRequest,
  RenderPreviewResponse,
  PromptCategory,
} from '@veritas-kanban/shared';
import { createLogger } from '../lib/logger.js';
import { validatePathSegment, ensureWithinBase } from '../utils/sanitize.js';
import { getRuntimeDir } from '../utils/paths.js';

const log = createLogger('prompt-registry-service');

export class PromptRegistryService {
  private templatesDir: string;
  private versionsDir: string;
  private usageDir: string;

  constructor() {
    const runtimeDir = getRuntimeDir();
    this.templatesDir = join(runtimeDir, 'prompt-templates');
    this.versionsDir = join(runtimeDir, 'prompt-versions');
    this.usageDir = join(runtimeDir, 'prompt-usage');
    this.ensureDirs();
  }

  private async ensureDirs() {
    await mkdir(this.templatesDir, { recursive: true });
    await mkdir(this.versionsDir, { recursive: true });
    await mkdir(this.usageDir, { recursive: true });
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

  /**
   * Extract variable names from template content
   * Looks for {{variable_name}} patterns
   */
  private extractVariables(content: string): string[] {
    const regex = /\{\{([^}]+)\}\}/g;
    const variables = new Set<string>();
    let match;

    while ((match = regex.exec(content)) !== null) {
      variables.add(match[1].trim());
    }

    return Array.from(variables).sort();
  }

  /**
   * Render template with provided variables
   */
  renderTemplate(content: string, variables: Record<string, string>): RenderPreviewResponse {
    let rendered = content;
    const foundVariables = new Set<string>();
    const unmatchedVariables = new Set<string>();

    // Extract all variables from template
    const allVariables = this.extractVariables(content);

    // Replace each variable
    for (const varName of allVariables) {
      const value = variables[varName];
      if (value !== undefined) {
        rendered = rendered.replace(new RegExp(`\\{\\{${varName}\\}\\}`, 'g'), value);
        foundVariables.add(varName);
      } else {
        unmatchedVariables.add(varName);
      }
    }

    return {
      renderedPrompt: rendered,
      unmatchedVariables: Array.from(unmatchedVariables).sort(),
    };
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

  private versionPath(templateId: string, versionNumber: number): string {
    validatePathSegment(templateId);
    const filename = `${templateId}_v${versionNumber}.md`;
    const filepath = join(this.versionsDir, filename);
    ensureWithinBase(this.versionsDir, filepath);
    return filepath;
  }

  private usagePath(id: string): string {
    validatePathSegment(id);
    const filepath = join(this.usageDir, `${id}.json`);
    ensureWithinBase(this.usageDir, filepath);
    return filepath;
  }

  /**
   * Get all templates
   */
  async getTemplates(): Promise<PromptTemplate[]> {
    await this.ensureDirs();

    const files = await readdir(this.templatesDir);
    const templates: PromptTemplate[] = [];

    for (const file of files) {
      if (!file.endsWith('.md')) continue;

      try {
        const content = await readFile(join(this.templatesDir, file), 'utf-8');
        const { data } = matter(content);
        templates.push(data as PromptTemplate);
      } catch (err) {
        log.error({ err: err }, `Error reading template ${file}`);
      }
    }

    return templates.sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Get single template by ID
   */
  async getTemplate(id: string): Promise<PromptTemplate | null> {
    const path = this.templatePath(id);

    if (!(await fileExists(path))) {
      return null;
    }

    try {
      const content = await readFile(path, 'utf-8');
      const { data } = matter(content);
      return data as PromptTemplate;
    } catch (err) {
      log.error({ err: err }, `Error reading template ${id}`);
      return null;
    }
  }

  /**
   * Create a new prompt template
   */
  async createTemplate(input: CreatePromptTemplateInput): Promise<PromptTemplate> {
    await this.ensureDirs();

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

    // Create initial version
    const version: PromptVersion = {
      id: `${id}_v1`,
      templateId: id,
      versionNumber: 1,
      content: input.content,
      changelog: 'Initial version',
      createdAt: now,
    };

    // Save template
    const cleanTemplate = this.cleanForYaml(template);
    const templateContent = matter.stringify('', cleanTemplate);
    await writeFile(this.templatePath(id), templateContent, 'utf-8');

    // Save version
    const cleanVersion = this.cleanForYaml(version);
    const versionContent = matter.stringify('', cleanVersion);
    await writeFile(this.versionPath(id, 1), versionContent, 'utf-8');

    return template;
  }

  /**
   * Update a prompt template
   */
  async updateTemplate(
    id: string,
    input: UpdatePromptTemplateInput
  ): Promise<PromptTemplate | null> {
    const existing = await this.getTemplate(id);
    if (!existing) return null;

    const now = new Date().toISOString();
    const contentChanged = input.content !== undefined && input.content !== existing.content;
    let newVersionId = existing.currentVersionId;

    // If content changed, create new version
    if (contentChanged) {
      if (!input.changelog) {
        throw new Error('changelog is required when updating template content');
      }

      // Get latest version number
      const versions = await this.getVersionHistory(id);
      const nextVersionNumber = Math.max(...versions.map((v) => v.versionNumber), 0) + 1;

      const newVersion: PromptVersion = {
        id: `${id}_v${nextVersionNumber}`,
        templateId: id,
        versionNumber: nextVersionNumber,
        content: input.content ?? existing.content,
        changelog: input.changelog ?? '',
        createdAt: now,
      };

      // Save new version
      const cleanVersion = this.cleanForYaml(newVersion);
      const versionContent = matter.stringify('', cleanVersion);
      await writeFile(this.versionPath(id, nextVersionNumber), versionContent, 'utf-8');

      newVersionId = newVersion.id;
    }

    const variables = contentChanged ? this.extractVariables(input.content!) : existing.variables;

    const updated: PromptTemplate = {
      ...existing,
      name: input.name ?? existing.name,
      description: input.description ?? existing.description,
      category: input.category ?? existing.category,
      content: input.content ?? existing.content,
      variables,
      updated: now,
      currentVersionId: newVersionId,
    };

    // Save updated template
    const cleanTemplate = this.cleanForYaml(updated);
    const templateContent = matter.stringify('', cleanTemplate);
    await writeFile(this.templatePath(id), templateContent, 'utf-8');

    return updated;
  }

  /**
   * Delete a prompt template
   */
  async deleteTemplate(id: string): Promise<boolean> {
    const path = this.templatePath(id);

    if (!(await fileExists(path))) {
      return false;
    }

    // Also delete versions
    const versions = await this.getVersionHistory(id);
    for (const version of versions) {
      const versionPath = this.versionPath(id, version.versionNumber);
      if (await fileExists(versionPath)) {
        await unlink(versionPath);
      }
    }

    // Also delete usage records
    const usagePath = this.usagePath(id);
    if (await fileExists(usagePath)) {
      await unlink(usagePath);
    }

    await unlink(path);
    return true;
  }

  /**
   * Get version history for a template
   */
  async getVersionHistory(templateId: string): Promise<PromptVersion[]> {
    await this.ensureDirs();

    const files = await readdir(this.versionsDir);
    const versions: PromptVersion[] = [];

    for (const file of files) {
      if (!file.startsWith(templateId) || !file.endsWith('.md')) continue;

      try {
        const content = await readFile(join(this.versionsDir, file), 'utf-8');
        const { data } = matter(content);
        versions.push(data as PromptVersion);
      } catch (err) {
        log.error({ err: err }, `Error reading version ${file}`);
      }
    }

    return versions.sort((a, b) => b.versionNumber - a.versionNumber);
  }

  /**
   * Track usage of a template
   */
  async recordUsage(
    templateId: string,
    usedBy?: string,
    renderedPrompt?: string,
    model?: string,
    inputTokens?: number,
    outputTokens?: number
  ): Promise<PromptUsage> {
    await this.ensureDirs();

    const now = new Date().toISOString();
    const usageId = `usage_${templateId}_${Date.now()}`;

    const usage: PromptUsage = {
      id: usageId,
      templateId,
      usedAt: now,
      usedBy,
      renderedPrompt,
      model,
      inputTokens,
      outputTokens,
    };

    // Append to usage file (we'll use JSON lines format for simplicity)
    const usageFile = this.usagePath(templateId);
    let usageData: PromptUsage[] = [];

    try {
      if (await fileExists(usageFile)) {
        const content = await readFile(usageFile, 'utf-8');
        usageData = JSON.parse(content);
      }
    } catch (err) {
      log.warn({ err: err }, `Error reading usage file for ${templateId}`);
    }

    usageData.push(usage);
    await writeFile(usageFile, JSON.stringify(usageData, null, 2), 'utf-8');

    return usage;
  }

  /**
   * Get usage records for a template
   */
  async getUsageRecords(templateId: string): Promise<PromptUsage[]> {
    const usageFile = this.usagePath(templateId);

    if (!(await fileExists(usageFile))) {
      return [];
    }

    try {
      const content = await readFile(usageFile, 'utf-8');
      return JSON.parse(content);
    } catch (err) {
      log.error({ err: err }, `Error reading usage file for ${templateId}`);
      return [];
    }
  }

  /**
   * Get statistics for a template
   */
  async getStats(templateId: string): Promise<PromptStats | null> {
    const template = await this.getTemplate(templateId);
    if (!template) return null;

    const versions = await this.getVersionHistory(templateId);
    const usageRecords = await this.getUsageRecords(templateId);

    // Calculate stats
    const totalUsages = usageRecords.length;
    const totalVersions = versions.length;
    const lastUsedAt =
      usageRecords.length > 0 ? usageRecords[usageRecords.length - 1].usedAt : undefined;

    // Find most frequent user
    const userMap = new Map<string, number>();
    for (const record of usageRecords) {
      if (record.usedBy) {
        userMap.set(record.usedBy, (userMap.get(record.usedBy) || 0) + 1);
      }
    }
    const mostFrequentUser = Array.from(userMap.entries()).sort((a, b) => b[1] - a[1])[0]?.[0];

    // Calculate average tokens
    const tokensRecords = usageRecords.filter(
      (r) => r.inputTokens !== undefined || r.outputTokens !== undefined
    );
    const averageTokensPerUsage =
      tokensRecords.length > 0
        ? tokensRecords.reduce(
            (sum, r) => sum + ((r.inputTokens ?? 0) + (r.outputTokens ?? 0)),
            0
          ) / tokensRecords.length
        : undefined;

    return {
      templateId,
      templateName: template.name,
      totalUsages,
      totalVersions,
      lastUsedAt,
      mostFrequentUser,
      averageTokensPerUsage,
    };
  }

  /**
   * Get statistics for all templates
   */
  async getAllStats(): Promise<PromptStats[]> {
    const templates = await this.getTemplates();
    const stats: PromptStats[] = [];

    for (const template of templates) {
      const templateStats = await this.getStats(template.id);
      if (templateStats) {
        stats.push(templateStats);
      }
    }

    return stats.sort((a, b) => b.totalUsages - a.totalUsages);
  }

  /**
   * Render preview with sample variables
   */
  async renderPreview(request: RenderPreviewRequest): Promise<RenderPreviewResponse> {
    const template = await this.getTemplate(request.templateId);
    if (!template) {
      throw new Error(`Template ${request.templateId} not found`);
    }

    return this.renderTemplate(template.content, request.sampleVariables);
  }
}
