import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  CreateWorkProductInput,
  UpdateWorkProductInput,
  WorkProduct,
  WorkProductListOptions,
  WorkProductPreview,
  WorkProductRedaction,
  WorkProductRender,
  WorkProductVersion,
} from '@veritas-kanban/shared';
import { SqliteDatabase, type SqliteConnectionOptions } from '../storage/sqlite/database.js';
import { SqliteWorkProductRepository } from '../storage/sqlite/work-product-repository.js';

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), '..', '.veritas-kanban');
const DEFAULT_VERSION_LIMIT = 25;

interface WorkProductFileState {
  products: WorkProduct[];
  versions: WorkProductVersion[];
}

export interface WorkProductServiceOptions {
  dataDir?: string;
  filePath?: string;
  storageType?: 'file' | 'sqlite';
  sqliteDatabase?: SqliteDatabase;
  sqliteConnectionOptions?: SqliteConnectionOptions;
  versionLimit?: number;
}

export class WorkProductService {
  private readonly filePath: string;
  private readonly versionLimit: number;
  private readonly repository: SqliteWorkProductRepository | null = null;
  private readonly sqliteDatabase: SqliteDatabase | null = null;
  private readonly ownsSqliteDatabase: boolean = false;
  private loaded = false;
  private fileState: WorkProductFileState = { products: [], versions: [] };

  constructor(options: WorkProductServiceOptions = {}) {
    const dataDir = options.dataDir ?? DATA_DIR;
    this.filePath = options.filePath ?? path.join(dataDir, 'work-products.json');
    this.versionLimit = options.versionLimit ?? DEFAULT_VERSION_LIMIT;
    const storageType =
      options.storageType ?? (process.env.VERITAS_STORAGE === 'sqlite' ? 'sqlite' : 'file');

    if (storageType === 'sqlite') {
      this.sqliteDatabase =
        options.sqliteDatabase ?? new SqliteDatabase(options.sqliteConnectionOptions);
      this.ownsSqliteDatabase = !options.sqliteDatabase;
      this.sqliteDatabase.open();
      this.repository = new SqliteWorkProductRepository(this.sqliteDatabase, {
        versionLimit: this.versionLimit,
      });
    }
  }

  async create(input: CreateWorkProductInput): Promise<WorkProduct> {
    this.assertRenderKind(input.kind, input.render);

    const now = new Date().toISOString();
    const product: WorkProduct = {
      id: `wp_${randomUUID()}`,
      workspaceId: input.workspaceId ?? 'local',
      kind: input.kind,
      title: input.title,
      status: 'active',
      render: input.render,
      version: 1,
      taskId: input.taskId,
      sourceRunId: input.sourceRunId,
      agent: input.agent,
      model: input.model,
      redaction: input.redaction,
      sourceLinks: input.sourceLinks,
      metadata: input.metadata,
      createdAt: now,
      updatedAt: now,
    };

    if (this.repository) {
      return this.repository.save(product, this.extractSearchText(product), input.changeSummary);
    }

    await this.ensureLoaded();
    this.fileState.products.push(product);
    this.fileState.versions.push(this.createVersion(product, 'create', input.changeSummary));
    this.pruneFileVersions(product.id);
    await this.saveFileState();
    return product;
  }

  async list(options: WorkProductListOptions = {}): Promise<WorkProduct[]> {
    if (this.repository) {
      return this.repository.list(options);
    }

    await this.ensureLoaded();
    const limit = Math.min(Math.max(options.limit ?? 100, 1), 200);
    const query = options.query?.toLowerCase();
    return this.fileState.products
      .filter((product) => {
        if (!options.includeArchived && product.status !== 'active') return false;
        if (options.status && product.status !== options.status) return false;
        if (options.taskId && product.taskId !== options.taskId) return false;
        if (options.sourceRunId && product.sourceRunId !== options.sourceRunId) return false;
        if (options.agent && product.agent !== options.agent) return false;
        if (options.kind && product.kind !== options.kind) return false;
        if (query) {
          const haystack = `${product.title}\n${this.extractSearchText(product)}`.toLowerCase();
          if (!haystack.includes(query)) return false;
        }
        return true;
      })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id))
      .slice(0, limit);
  }

  async get(id: string): Promise<WorkProduct | null> {
    if (this.repository) {
      return this.repository.get(id);
    }

    await this.ensureLoaded();
    return this.fileState.products.find((product) => product.id === id) ?? null;
  }

  async update(id: string, input: UpdateWorkProductInput): Promise<WorkProduct | null> {
    const current = await this.get(id);
    if (!current) return null;

    if (input.render) {
      this.assertRenderKind(input.render.kind, input.render);
    }

    const now = new Date().toISOString();
    const { changeType: requestedChangeType, changeSummary, ...productPatch } = input;
    const next: WorkProduct = {
      ...current,
      ...productPatch,
      kind: input.render?.kind ?? current.kind,
      render: input.render ?? current.render,
      version: current.version + 1,
      updatedAt: now,
      archivedAt: input.status === 'archived' ? (current.archivedAt ?? now) : undefined,
    };
    const changeType = requestedChangeType ?? (input.render ? 'refine' : 'manual');

    if (this.repository) {
      return this.repository.update(next, this.extractSearchText(next), changeType, changeSummary);
    }

    await this.ensureLoaded();
    const index = this.fileState.products.findIndex((product) => product.id === id);
    if (index === -1) return null;

    this.fileState.products[index] = next;
    this.fileState.versions.push(this.createVersion(next, changeType, changeSummary));
    this.pruneFileVersions(id);
    await this.saveFileState();
    return next;
  }

  async archive(id: string): Promise<WorkProduct | null> {
    if (this.repository) {
      return this.repository.archive(id, new Date().toISOString());
    }
    return this.update(id, {
      status: 'archived',
      changeType: 'manual',
      changeSummary: 'Archived work product',
    });
  }

  async listVersions(productId: string): Promise<WorkProductVersion[]> {
    if (this.repository) {
      return this.repository.listVersions(productId);
    }

    await this.ensureLoaded();
    return this.fileState.versions
      .filter((version) => version.productId === productId)
      .sort((a, b) => b.version - a.version);
  }

  async restoreVersion(productId: string, versionNumber: number): Promise<WorkProduct | null> {
    const product = await this.get(productId);
    if (!product) return null;

    const version = this.repository
      ? this.repository.getVersion(productId, versionNumber)
      : ((await this.listVersions(productId)).find(
          (candidate) => candidate.version === versionNumber
        ) ?? null);
    if (!version) return null;

    return this.update(productId, {
      title: version.title,
      render: version.render,
      agent: version.agent,
      model: version.model,
      redaction: version.redaction,
      changeType: 'restore',
      changeSummary: `Restored version ${versionNumber}`,
    });
  }

  async search(query: string, limit = 20): Promise<WorkProduct[]> {
    if (this.repository) {
      return this.repository.search(query, limit);
    }
    return this.list({ query, limit });
  }

  toPreview(product: WorkProduct): WorkProductPreview {
    const rawText = this.extractSearchText(product);
    const redactedText = this.redactText(rawText, product.redaction);
    const fullyRedacted = this.shouldFullyRedact(product.redaction);
    return {
      id: product.id,
      workspaceId: product.workspaceId,
      kind: product.kind,
      title: product.title,
      status: product.status,
      version: product.version,
      taskId: product.taskId,
      sourceRunId: product.sourceRunId,
      agent: product.agent,
      model: product.model,
      sourceLinks: product.sourceLinks,
      redacted: fullyRedacted || redactedText !== rawText,
      snippet: (fullyRedacted ? '[redacted work product preview]' : redactedText).slice(0, 500),
      createdAt: product.createdAt,
      updatedAt: product.updatedAt,
    };
  }

  exportProduct(
    product: WorkProduct,
    options: { format?: 'markdown' | 'json'; redacted?: boolean } = {}
  ): string {
    const redacted = options.redacted ?? product.redaction?.exportDefault !== 'full';
    if (options.format === 'json') {
      const exported = redacted ? this.redactProduct(product) : product;
      return JSON.stringify(exported, null, 2);
    }

    const body = redacted
      ? this.redactText(this.extractSearchText(product), product.redaction)
      : this.extractSearchText(product);
    const lines = [
      `# ${product.title}`,
      '',
      `Kind: ${product.kind}`,
      `Version: ${product.version}`,
      product.taskId ? `Task: ${product.taskId}` : null,
      product.sourceRunId ? `Run: ${product.sourceRunId}` : null,
      product.agent ? `Agent: ${product.agent}` : null,
      product.model ? `Model: ${product.model}` : null,
      `Updated: ${product.updatedAt}`,
      '',
      body,
    ].filter((line): line is string => line !== null);
    return `${lines.join('\n')}\n`;
  }

  dispose(): void {
    if (this.ownsSqliteDatabase) {
      this.sqliteDatabase?.close();
    }
    this.loaded = false;
    this.fileState = { products: [], versions: [] };
  }

  extractSearchText(product: WorkProduct): string {
    return renderToText(product.render);
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;

    try {
      const raw = await fs.readFile(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw) as WorkProductFileState | WorkProduct[];
      this.fileState = Array.isArray(parsed) ? { products: parsed, versions: [] } : parsed;
    } catch {
      this.fileState = { products: [], versions: [] };
    }

    this.loaded = true;
  }

  private async saveFileState(): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify(this.fileState, null, 2));
  }

  private createVersion(
    product: WorkProduct,
    changeType: WorkProductVersion['changeType'],
    changeSummary?: string
  ): WorkProductVersion {
    return {
      id: `wpv_${randomUUID()}`,
      productId: product.id,
      workspaceId: product.workspaceId,
      version: product.version,
      changeType,
      changeSummary,
      render: product.render,
      title: product.title,
      kind: product.kind,
      agent: product.agent,
      model: product.model,
      redaction: product.redaction,
      createdAt: product.updatedAt,
    };
  }

  private pruneFileVersions(productId: string): void {
    const versions = this.fileState.versions
      .filter((version) => version.productId === productId)
      .sort((a, b) => b.version - a.version);
    const keep = new Set(versions.slice(0, this.versionLimit).map((version) => version.id));
    this.fileState.versions = this.fileState.versions.filter(
      (version) => version.productId !== productId || keep.has(version.id)
    );
  }

  private assertRenderKind(kind: string, render: WorkProductRender): void {
    if (kind !== render.kind) {
      throw new Error('Work product kind must match render.kind');
    }
  }

  private shouldFullyRedact(redaction?: WorkProductRedaction): boolean {
    return redaction?.level === 'strict' || redaction?.containsSensitiveContent === true;
  }

  private redactProduct(product: WorkProduct): WorkProduct {
    if (this.shouldFullyRedact(product.redaction)) {
      return {
        ...product,
        render: redactRender(product.render, '[redacted work product content]'),
      };
    }

    return {
      ...product,
      render: redactRender(
        product.render,
        this.redactText(this.extractSearchText(product), product.redaction)
      ),
    };
  }

  private redactText(text: string, redaction?: WorkProductRedaction): string {
    if (this.shouldFullyRedact(redaction)) {
      return '[redacted work product content]';
    }

    return text
      .replace(
        /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
        '[redacted-private-key]'
      )
      .replace(
        /\b(?:sk|rk|ghp|gho|github_pat|xoxb|xoxp)_[A-Za-z0-9_:-]{12,}\b/g,
        '[redacted-token]'
      )
      .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [redacted-token]')
      .replace(/(api[_-]?key|token|secret|password)\s*[:=]\s*['"]?[^'"\s]+/gi, '$1=[redacted]')
      .replace(/\/Users\/[^/\s]+\/[^\s)]+/g, '[redacted-local-path]')
      .replace(/[A-Z]:\\Users\\[^\\\s]+\\[^\s)]+/g, '[redacted-local-path]');
  }
}

function renderToText(render: WorkProductRender): string {
  switch (render.kind) {
    case 'text':
      return render.text;
    case 'markdown':
      return render.markdown;
    case 'summary':
      return [
        render.summary,
        ...(render.keyPoints ?? []),
        ...(render.sections ?? []).flatMap((section) => [section.heading, section.body]),
      ].join('\n');
    case 'checklist':
      return render.items
        .map(
          (item) =>
            `${item.checked ? '[x]' : '[ ]'} ${item.label}${item.notes ? ` - ${item.notes}` : ''}`
        )
        .join('\n');
    case 'report':
      return [
        render.summary,
        ...render.sections.flatMap((section) => [section.heading, section.body]),
      ].join('\n');
    case 'table':
      return [
        render.columns.map((column) => column.label).join('\t'),
        ...render.rows.map((row) =>
          render.columns.map((column) => String(row[column.key] ?? '')).join('\t')
        ),
      ].join('\n');
    case 'dashboard':
      return render.widgets
        .map((widget) =>
          [
            widget.title,
            widget.value === undefined ? null : String(widget.value),
            widget.description,
          ]
            .filter((part): part is string => Boolean(part))
            .join(': ')
        )
        .join('\n');
  }
}

function redactRender(render: WorkProductRender, text: string): WorkProductRender {
  switch (render.kind) {
    case 'text':
      return { schemaVersion: 1, kind: 'text', text };
    case 'markdown':
      return { schemaVersion: 1, kind: 'markdown', markdown: text };
    case 'summary':
      return { schemaVersion: 1, kind: 'summary', summary: text };
    case 'checklist':
      return {
        schemaVersion: 1,
        kind: 'checklist',
        items: [{ id: 'redacted', label: text, checked: false }],
      };
    case 'report':
      return { schemaVersion: 1, kind: 'report', summary: text, sections: [] };
    case 'table':
      return {
        schemaVersion: 1,
        kind: 'table',
        columns: [{ key: 'redacted', label: 'Redacted' }],
        rows: [{ redacted: text }],
      };
    case 'dashboard':
      return {
        schemaVersion: 1,
        kind: 'dashboard',
        widgets: [{ id: 'redacted', title: 'Redacted', description: text }],
      };
  }
}

let workProductServiceInstance: WorkProductService | null = null;

export function getWorkProductService(): WorkProductService {
  if (!workProductServiceInstance) {
    workProductServiceInstance = new WorkProductService();
  }
  return workProductServiceInstance;
}

export function resetWorkProductServiceForTests(): void {
  workProductServiceInstance?.dispose();
  workProductServiceInstance = null;
}
