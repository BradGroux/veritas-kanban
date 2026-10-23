import { Command } from 'commander';
import chalk from 'chalk';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { API_BASE, buildApiHeaders, buildApiRequestOptions } from '../utils/api.js';
import type {
  CreatePromptTemplateInput,
  PromptCategory,
  PromptTemplate,
  UpdatePromptTemplateInput,
} from '@veritas-kanban/shared';

const VALID_CATEGORIES = new Set<PromptCategory>(['system', 'agent', 'tool', 'evaluation']);

interface PromptImportOptions {
  sourceDir: string;
  apiBase: string;
  timeoutMs: number;
  dryRun: boolean;
  force: boolean;
  includeReadme: boolean;
}

interface PromptImportDependencies {
  fetch: typeof fetch;
  env: NodeJS.ProcessEnv;
}

export interface FilePromptTemplate {
  id: string;
  name: string;
  description?: string;
  category: PromptCategory;
  content: string;
  filePath: string;
  relativePath: string;
}

export type PromptImportStatus = 'created' | 'updated' | 'unchanged' | 'conflict' | 'malformed';

export interface PromptImportItem {
  status: PromptImportStatus;
  file: string;
  id?: string;
  name?: string;
  reason?: string;
  changedFields?: string[];
}

export interface PromptImportReport {
  dryRun: boolean;
  force: boolean;
  sourceDirectory: string;
  counts: Record<PromptImportStatus, number> & { total: number };
  items: PromptImportItem[];
}

interface ParsedPromptFile {
  template?: FilePromptTemplate;
  item?: PromptImportItem;
}

interface FrontmatterParseResult {
  data: Record<string, unknown>;
  content: string;
  error?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function unwrapData<T>(body: unknown): T {
  if (isRecord(body) && body.success === true && 'data' in body) {
    return body.data as T;
  }
  return body as T;
}

function normalizeApiBase(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, '');
  try {
    return new URL(trimmed).origin;
  } catch {
    return trimmed;
  }
}

function normalizeContent(value: string): string {
  return value.replace(/\r\n/g, '\n').trim();
}

function normalizeOptional(value: string | undefined): string {
  return value?.trim() ?? '';
}

function slugifyId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function isValidTemplateId(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value);
}

function humanizeId(value: string): string {
  return value
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function frontmatterString(data: Record<string, unknown>, key: string): string | undefined {
  const value = data[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function parseScalar(value: string): unknown {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    const rawItems = trimmed.slice(1, -1).trim();
    if (!rawItems) return [];
    return rawItems.split(',').map((item) => String(parseScalar(item)));
  }
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  return trimmed;
}

function parseFrontmatter(raw: string): FrontmatterParseResult {
  const normalized = raw.replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---\n')) {
    return { data: {}, content: normalized };
  }

  const lines = normalized.split('\n');
  const closingIndex = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
  if (closingIndex === -1) {
    return { data: {}, content: '', error: 'Missing closing frontmatter delimiter' };
  }

  const data: Record<string, unknown> = {};
  let currentListKey: string | null = null;

  for (const line of lines.slice(1, closingIndex)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;

    const listMatch = line.match(/^\s*-\s+(.+)$/);
    if (listMatch && currentListKey) {
      (data[currentListKey] as unknown[]).push(parseScalar(listMatch[1] ?? ''));
      continue;
    }

    const entryMatch = line.match(/^([A-Za-z][\w-]*):(?:\s*(.*))?$/);
    if (!entryMatch) {
      return { data: {}, content: '', error: `Malformed frontmatter line: ${line.trim()}` };
    }

    const key = entryMatch[1] as string;
    const rawValue = entryMatch[2] ?? '';
    if (!rawValue.trim()) {
      data[key] = [];
      currentListKey = key;
    } else {
      data[key] = parseScalar(rawValue);
      currentListKey = null;
    }
  }

  return {
    data,
    content: lines.slice(closingIndex + 1).join('\n'),
  };
}

function firstMarkdownHeading(content: string): string | undefined {
  const heading = content
    .split('\n')
    .map((line) => line.match(/^#\s+(.+)$/)?.[1]?.trim())
    .find((line): line is string => Boolean(line));
  return heading || undefined;
}

export async function discoverPromptTemplateFiles(
  sourceDir: string,
  options: { includeReadme?: boolean } = {}
): Promise<string[]> {
  const root = path.resolve(sourceDir);
  const results: string[] = [];

  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.md')) continue;
      if (!options.includeReadme && entry.name.toLowerCase() === 'readme.md') continue;
      results.push(fullPath);
    }
  }

  await walk(root);
  return results;
}

export async function parsePromptTemplateFile(
  filePath: string,
  rootDir: string
): Promise<ParsedPromptFile> {
  const relativePath = path.relative(path.resolve(rootDir), filePath).replace(/\\/g, '/');

  try {
    const raw = await readFile(filePath, 'utf-8');
    const parsed = parseFrontmatter(raw);
    if (parsed.error) {
      return { item: { status: 'malformed', file: relativePath, reason: parsed.error } };
    }

    const content = normalizeContent(parsed.content);
    if (!content) {
      return {
        item: { status: 'malformed', file: relativePath, reason: 'Template content is empty' },
      };
    }

    const basename = path.basename(filePath, path.extname(filePath));
    const frontmatterId = frontmatterString(parsed.data, 'id');
    const id = frontmatterId ?? slugifyId(basename);
    if (!id || !isValidTemplateId(id)) {
      return {
        item: {
          status: 'malformed',
          file: relativePath,
          id,
          reason: 'Template ID must contain only letters, numbers, dashes, and underscores',
        },
      };
    }

    const category = frontmatterString(parsed.data, 'category') ?? 'agent';
    if (!VALID_CATEGORIES.has(category as PromptCategory)) {
      return {
        item: {
          status: 'malformed',
          file: relativePath,
          id,
          reason: `Unsupported category: ${category}`,
        },
      };
    }

    const name =
      frontmatterString(parsed.data, 'name') ??
      frontmatterString(parsed.data, 'title') ??
      firstMarkdownHeading(content) ??
      humanizeId(id);
    const description = frontmatterString(parsed.data, 'description');

    return {
      template: {
        id,
        name,
        description,
        category: category as PromptCategory,
        content,
        filePath,
        relativePath,
      },
    };
  } catch (error) {
    return {
      item: {
        status: 'malformed',
        file: relativePath,
        reason: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

function changedFields(fileTemplate: FilePromptTemplate, existing: PromptTemplate): string[] {
  const fields: string[] = [];
  if (fileTemplate.name !== existing.name) fields.push('name');
  if (normalizeOptional(fileTemplate.description) !== normalizeOptional(existing.description)) {
    fields.push('description');
  }
  if (fileTemplate.category !== existing.category) fields.push('category');
  if (fileTemplate.content !== normalizeContent(existing.content)) fields.push('content');
  return fields;
}

function emptyCounts(): PromptImportReport['counts'] {
  return {
    total: 0,
    created: 0,
    updated: 0,
    unchanged: 0,
    conflict: 0,
    malformed: 0,
  };
}

function buildReport(
  items: PromptImportItem[],
  options: Pick<PromptImportOptions, 'dryRun' | 'force' | 'sourceDir'>
): PromptImportReport {
  const counts = emptyCounts();
  for (const item of items) {
    counts.total += 1;
    counts[item.status] += 1;
  }

  return {
    dryRun: options.dryRun,
    force: options.force,
    sourceDirectory: path.basename(path.resolve(options.sourceDir)),
    counts,
    items,
  };
}

export function hasPromptImportBlockers(report: PromptImportReport): boolean {
  return report.counts.conflict > 0 || report.counts.malformed > 0;
}

export function planPromptTemplateImport(
  parsedFiles: ParsedPromptFile[],
  existingTemplates: PromptTemplate[],
  options: Pick<PromptImportOptions, 'dryRun' | 'force' | 'sourceDir'>
): PromptImportReport {
  const existingById = new Map(existingTemplates.map((template) => [template.id, template]));
  const existingByName = new Map(
    existingTemplates.map((template) => [template.name.trim().toLowerCase(), template])
  );
  const seenIds = new Set<string>();
  const items: PromptImportItem[] = [];

  for (const parsed of parsedFiles) {
    if (parsed.item) {
      items.push(parsed.item);
      continue;
    }

    const fileTemplate = parsed.template;
    if (!fileTemplate) continue;
    if (seenIds.has(fileTemplate.id)) {
      items.push({
        status: 'conflict',
        file: fileTemplate.relativePath,
        id: fileTemplate.id,
        name: fileTemplate.name,
        reason: 'Multiple files resolve to the same template ID',
      });
      continue;
    }
    seenIds.add(fileTemplate.id);

    const existing = existingById.get(fileTemplate.id);
    if (existing) {
      const fields = changedFields(fileTemplate, existing);
      if (fields.length === 0) {
        items.push({
          status: 'unchanged',
          file: fileTemplate.relativePath,
          id: fileTemplate.id,
          name: fileTemplate.name,
        });
      } else if (options.force) {
        items.push({
          status: 'updated',
          file: fileTemplate.relativePath,
          id: fileTemplate.id,
          name: fileTemplate.name,
          changedFields: fields,
        });
      } else {
        items.push({
          status: 'conflict',
          file: fileTemplate.relativePath,
          id: fileTemplate.id,
          name: fileTemplate.name,
          changedFields: fields,
          reason: 'Runtime template differs; rerun with --force to update',
        });
      }
      continue;
    }

    const sameName = existingByName.get(fileTemplate.name.trim().toLowerCase());
    if (sameName) {
      items.push({
        status: 'conflict',
        file: fileTemplate.relativePath,
        id: fileTemplate.id,
        name: fileTemplate.name,
        reason: `Template name already exists with runtime ID ${sameName.id}`,
      });
      continue;
    }

    items.push({
      status: 'created',
      file: fileTemplate.relativePath,
      id: fileTemplate.id,
      name: fileTemplate.name,
    });
  }

  return buildReport(items, options);
}

async function requestJson<T>(
  deps: PromptImportDependencies,
  options: PromptImportOptions,
  pathName: string,
  init: RequestInit = {}
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs);

  try {
    const headers = new Headers(init.headers);
    headers.set('content-type', 'application/json');
    for (const [key, value] of Object.entries(buildApiHeaders(undefined, deps.env.VK_API_KEY))) {
      headers.set(key, value);
    }

    const response = await deps.fetch(
      `${options.apiBase}${pathName}`,
      buildApiRequestOptions({ ...init, headers, signal: controller.signal }, deps.env.VK_API_KEY)
    );
    const text = await response.text();
    const body = text ? JSON.parse(text) : null;
    if (!response.ok) {
      const message =
        isRecord(body) && typeof body.error === 'string'
          ? body.error
          : isRecord(body) && typeof body.message === 'string'
            ? body.message
            : response.statusText;
      throw new Error(`${response.status} ${message}`);
    }
    return unwrapData<T>(body);
  } finally {
    clearTimeout(timeout);
  }
}

async function loadExistingTemplates(
  deps: PromptImportDependencies,
  options: PromptImportOptions
): Promise<PromptTemplate[]> {
  return requestJson<PromptTemplate[]>(deps, options, '/api/prompt-registry');
}

async function applyPromptTemplateImport(
  report: PromptImportReport,
  parsedFiles: ParsedPromptFile[],
  deps: PromptImportDependencies,
  options: PromptImportOptions
): Promise<void> {
  const byRelativePath = new Map(
    parsedFiles
      .filter((parsed): parsed is ParsedPromptFile & { template: FilePromptTemplate } =>
        Boolean(parsed.template)
      )
      .map((parsed) => [parsed.template.relativePath, parsed.template])
  );

  for (const item of report.items) {
    const fileTemplate = byRelativePath.get(item.file);
    if (!fileTemplate) continue;

    if (item.status === 'created') {
      const body: CreatePromptTemplateInput = {
        id: fileTemplate.id,
        name: fileTemplate.name,
        description: fileTemplate.description,
        category: fileTemplate.category,
        content: fileTemplate.content,
      };
      await requestJson<PromptTemplate>(deps, options, '/api/prompt-registry', {
        method: 'POST',
        body: JSON.stringify(body),
      });
    }

    if (item.status === 'updated') {
      const body: UpdatePromptTemplateInput = {
        name: fileTemplate.name,
        description: fileTemplate.description,
        category: fileTemplate.category,
        content: fileTemplate.content,
        changelog: `Sync from ${fileTemplate.relativePath}`,
      };
      await requestJson<PromptTemplate>(deps, options, `/api/prompt-registry/${fileTemplate.id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
    }
  }
}

export async function runPromptTemplateImport(
  input: Partial<PromptImportOptions> & { sourceDir: string },
  depsInput: Partial<PromptImportDependencies> = {}
): Promise<PromptImportReport> {
  const options: PromptImportOptions = {
    sourceDir: input.sourceDir,
    apiBase: normalizeApiBase(input.apiBase ?? API_BASE),
    timeoutMs: input.timeoutMs ?? 5000,
    dryRun: input.dryRun ?? false,
    force: input.force ?? false,
    includeReadme: input.includeReadme ?? false,
  };
  const deps: PromptImportDependencies = {
    fetch: depsInput.fetch ?? globalThis.fetch.bind(globalThis),
    env: depsInput.env ?? process.env,
  };

  const files = await discoverPromptTemplateFiles(options.sourceDir, {
    includeReadme: options.includeReadme,
  });
  const parsedFiles = await Promise.all(
    files.map((file) => parsePromptTemplateFile(file, options.sourceDir))
  );
  const existingTemplates = await loadExistingTemplates(deps, options);
  const report = planPromptTemplateImport(parsedFiles, existingTemplates, options);

  if (!options.dryRun && !hasPromptImportBlockers(report)) {
    await applyPromptTemplateImport(report, parsedFiles, deps, options);
  }

  return report;
}

export function formatPromptImportReport(report: PromptImportReport): string {
  const lines = [
    `Prompt import ${report.dryRun ? 'dry run' : 'result'}`,
    `Source: ${report.sourceDirectory}`,
    `Counts: ${report.counts.created} created, ${report.counts.updated} updated, ${report.counts.unchanged} unchanged, ${report.counts.conflict} conflict, ${report.counts.malformed} malformed`,
    '',
  ];

  for (const item of report.items) {
    const changed = item.changedFields?.length ? ` (${item.changedFields.join(', ')})` : '';
    const reason = item.reason ? ` - ${item.reason}` : '';
    lines.push(
      `- ${item.status}: ${item.id ?? 'unknown'} ${item.file}${changed}${reason}`.trimEnd()
    );
  }

  return `${lines.join('\n')}\n`;
}

function parseTimeout(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 5000;
}

export function registerPromptCommands(program: Command): void {
  const prompts = program.command('prompts').description('Prompt registry commands');

  prompts
    .command('import <dir>')
    .description('Import file-based prompt templates into the runtime registry')
    .option('--dry-run', 'Report changes without writing to the runtime registry')
    .option('--force', 'Update existing runtime templates when file content or metadata differs')
    .option('--json', 'Output as JSON')
    .option('--include-readme', 'Include README.md files as templates')
    .option('--api <url>', 'API base URL', API_BASE)
    .option('--timeout <ms>', 'Per-request timeout in milliseconds', '5000')
    .action(async (dir, options) => {
      try {
        const report = await runPromptTemplateImport({
          sourceDir: dir,
          apiBase: options.api,
          timeoutMs: parseTimeout(options.timeout),
          dryRun: Boolean(options.dryRun),
          force: Boolean(options.force),
          includeReadme: Boolean(options.includeReadme),
        });

        if (options.json) {
          console.log(JSON.stringify(report, null, 2));
        } else {
          process.stdout.write(formatPromptImportReport(report));
        }

        if (hasPromptImportBlockers(report)) {
          process.exit(1);
        }

        if (!report.dryRun) {
          const changed = report.counts.created + report.counts.updated;
          console.log(chalk.green(`Prompt registry import applied: ${changed} changed`));
        }
      } catch (error) {
        console.error(
          chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`)
        );
        process.exit(1);
      }
    });
}
