import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createLogger } from '../lib/logger.js';

const log = createLogger('search-service');

export type SearchBackend = 'auto' | 'qmd' | 'keyword';
export type SearchCollection = 'tasks-active' | 'tasks-archive' | 'docs';

export interface SearchRequest {
  query: string;
  limit?: number;
  collections?: SearchCollection[];
  backend?: SearchBackend;
  minScore?: number;
}

export interface SearchResult {
  id: string;
  title: string;
  path: string;
  collection: SearchCollection | string;
  snippet: string;
  score: number;
  metadata?: Record<string, unknown>;
}

export interface SearchResponse {
  query: string;
  backend: 'qmd' | 'keyword';
  degraded: boolean;
  reason?: string;
  elapsedMs: number;
  results: SearchResult[];
}

export interface SearchIndexRefreshResponse {
  backend: 'qmd';
  updated: boolean;
  embedded: boolean;
  elapsedMs: number;
  commands: string[];
}

interface SearchSource {
  collection: SearchCollection;
  dir: string;
}

const PROJECT_ROOT = path.resolve(process.cwd(), '..');
const DEFAULT_COLLECTIONS: SearchCollection[] = ['tasks-active', 'tasks-archive', 'docs'];
const MAX_LIMIT = 50;

class SearchService {
  async search(request: SearchRequest): Promise<SearchResponse> {
    const started = Date.now();
    const query = request.query.trim();
    const limit = Math.min(Math.max(request.limit ?? 10, 1), MAX_LIMIT);
    const backend = request.backend ?? this.defaultBackend();

    if (!query) {
      return {
        query,
        backend: 'keyword',
        degraded: backend === 'qmd',
        reason: 'Empty query',
        elapsedMs: Date.now() - started,
        results: [],
      };
    }

    if (backend === 'qmd' || backend === 'auto') {
      try {
        const results = await this.searchWithQmd(query, {
          limit,
          collections: this.normalizeCollections(request.collections),
          minScore: request.minScore,
        });
        return {
          query,
          backend: 'qmd',
          degraded: false,
          elapsedMs: Date.now() - started,
          results,
        };
      } catch (err) {
        const reason = err instanceof Error ? err.message : 'QMD search failed';
        log.warn({ err }, 'QMD search unavailable; falling back to keyword search');
        const results = await this.searchKeyword(query, {
          limit,
          collections: request.collections,
        });
        return {
          query,
          backend: 'keyword',
          degraded: true,
          reason,
          elapsedMs: Date.now() - started,
          results,
        };
      }
    }

    const results = await this.searchKeyword(query, {
      limit,
      collections: request.collections,
    });
    return {
      query,
      backend: 'keyword',
      degraded: false,
      elapsedMs: Date.now() - started,
      results,
    };
  }

  async refreshIndex(options: { embed?: boolean } = {}): Promise<SearchIndexRefreshResponse> {
    const started = Date.now();
    const embed = options.embed ?? true;
    const commands = ['update'];

    await this.runQmdCommand(
      ['update'],
      Number(process.env.VERITAS_QMD_REFRESH_TIMEOUT_MS || 60_000)
    );

    if (embed) {
      commands.push('embed');
      await this.runQmdCommand(
        ['embed'],
        Number(process.env.VERITAS_QMD_REFRESH_TIMEOUT_MS || 60_000)
      );
    }

    return {
      backend: 'qmd',
      updated: true,
      embedded: embed,
      elapsedMs: Date.now() - started,
      commands,
    };
  }

  private defaultBackend(): SearchBackend {
    const configured = process.env.VERITAS_SEARCH_BACKEND;
    if (configured === 'qmd' || configured === 'auto' || configured === 'keyword') {
      return configured;
    }
    return 'keyword';
  }

  private async searchWithQmd(
    query: string,
    options: { limit: number; collections: SearchCollection[]; minScore?: number }
  ): Promise<SearchResult[]> {
    const args = ['query', query, '--json', '-n', String(options.limit)];

    if (options.minScore !== undefined) {
      args.push('--min-score', String(options.minScore));
    }

    if (options.collections.length > 0) {
      args.push('--collections', options.collections.join(','));
    }

    const stdout = await this.runQmdCommand(
      args,
      Number(process.env.VERITAS_QMD_TIMEOUT_MS || 10_000)
    );

    return this.normalizeQmdResults(stdout, options.limit);
  }

  private async runQmdCommand(args: string[], timeout: number): Promise<string> {
    const bin = process.env.VERITAS_QMD_BIN || 'qmd';
    return new Promise<string>((resolve, reject) => {
      execFile(
        bin,
        args,
        {
          cwd: this.projectRoot(),
          timeout,
          maxBuffer: 2 * 1024 * 1024,
        },
        (error, stdoutValue) => {
          if (error) {
            reject(error);
            return;
          }
          resolve(String(stdoutValue ?? ''));
        }
      );
    });
  }

  private normalizeQmdResults(stdout: string, limit: number): SearchResult[] {
    const parsed = JSON.parse(stdout || '[]') as unknown;
    const rawResults = this.extractQmdResultArray(parsed);

    return rawResults.slice(0, limit).map((raw, index) => {
      const item = raw as Record<string, unknown>;
      const filePath = this.firstString(item.path, item.file, item.filename, item.id) ?? '';
      const title =
        (this.firstString(item.title, item.name) ?? path.basename(filePath)) || 'Result';
      const snippet =
        this.firstString(item.snippet, item.context, item.text, item.content, item.body) ?? '';
      const collection =
        this.firstString(item.collection, item.source) ?? this.inferCollection(filePath);
      const score =
        this.firstNumber(item.score, item.relevance, item.rankScore) ?? 1 - index / limit;

      return {
        id: this.firstString(item.id, item.docid, item.docId) ?? `${filePath || 'result'}:${index}`,
        title,
        path: filePath,
        collection,
        snippet: snippet.slice(0, 500),
        score,
        metadata: item,
      };
    });
  }

  private extractQmdResultArray(parsed: unknown): unknown[] {
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === 'object') {
      const obj = parsed as Record<string, unknown>;
      for (const key of ['results', 'documents', 'matches', 'data']) {
        const value = obj[key];
        if (Array.isArray(value)) return value;
      }
    }
    return [];
  }

  private async searchKeyword(
    query: string,
    options: { limit: number; collections?: SearchCollection[] }
  ): Promise<SearchResult[]> {
    const terms = query
      .toLowerCase()
      .split(/\s+/)
      .map((term) => term.trim())
      .filter(Boolean);

    if (terms.length === 0) return [];

    const results: SearchResult[] = [];
    const sources = this.sources(options.collections);

    for (const source of sources) {
      const files = await this.listMarkdownFiles(source.dir);
      for (const file of files) {
        const result = await this.scoreFile(file, source, terms);
        if (result) results.push(result);
      }
    }

    return results
      .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
      .slice(0, options.limit);
  }

  private async scoreFile(
    filePath: string,
    source: SearchSource,
    terms: string[]
  ): Promise<SearchResult | null> {
    let content: string;
    try {
      content = await fs.readFile(filePath, 'utf-8');
    } catch {
      return null;
    }

    const haystack = content.toLowerCase();
    const relativePath = path.relative(this.projectRoot(), filePath);
    const pathHaystack = relativePath.toLowerCase();
    let score = 0;

    for (const term of terms) {
      if (pathHaystack.includes(term)) score += 3;
      const matches = haystack.match(new RegExp(this.escapeRegExp(term), 'g'))?.length ?? 0;
      score += matches;
    }

    if (score === 0) return null;

    return {
      id: relativePath,
      title: this.extractTitle(content, filePath),
      path: relativePath,
      collection: source.collection,
      snippet: this.extractSnippet(content, terms),
      score,
    };
  }

  private sources(collections?: SearchCollection[]): SearchSource[] {
    const selected = new Set(this.normalizeCollections(collections));
    const root = this.projectRoot();
    const candidates: SearchSource[] = [
      {
        collection: 'tasks-active',
        dir: process.env.VERITAS_SEARCH_TASKS_ACTIVE_DIR || path.join(root, 'tasks', 'active'),
      },
      {
        collection: 'tasks-archive',
        dir: process.env.VERITAS_SEARCH_TASKS_ARCHIVE_DIR || path.join(root, 'tasks', 'archive'),
      },
      {
        collection: 'docs',
        dir: process.env.VERITAS_SEARCH_DOCS_DIR || path.join(root, 'docs'),
      },
    ];

    return candidates.filter((source) => selected.has(source.collection));
  }

  private normalizeCollections(collections?: SearchCollection[]): SearchCollection[] {
    if (!collections || collections.length === 0) return DEFAULT_COLLECTIONS;
    const allowed = new Set<SearchCollection>(DEFAULT_COLLECTIONS);
    return collections.filter((collection) => allowed.has(collection));
  }

  private async listMarkdownFiles(dir: string): Promise<string[]> {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return [];
    }

    const files: string[] = [];
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...(await this.listMarkdownFiles(fullPath)));
      } else if (entry.isFile() && /\.(md|mdx|txt)$/i.test(entry.name)) {
        files.push(fullPath);
      }
    }
    return files;
  }

  private extractTitle(content: string, filePath: string): string {
    const heading = content.match(/^#\s+(.+)$/m)?.[1]?.trim();
    if (heading) return heading;

    const titleField = content.match(/^title:\s*['"]?(.+?)['"]?\s*$/m)?.[1]?.trim();
    if (titleField) return titleField;

    return path.basename(filePath).replace(/\.(md|mdx|txt)$/i, '');
  }

  private extractSnippet(content: string, terms: string[]): string {
    const lines = content.split('\n');
    const match = lines.find((line) => {
      const lower = line.toLowerCase();
      return terms.some((term) => lower.includes(term));
    });
    return (match || lines.find((line) => line.trim()) || '').trim().slice(0, 500);
  }

  private projectRoot(): string {
    return process.env.VERITAS_SEARCH_ROOT || PROJECT_ROOT;
  }

  private inferCollection(filePath: string): SearchCollection {
    if (filePath.includes('tasks/archive')) return 'tasks-archive';
    if (filePath.includes('tasks/active')) return 'tasks-active';
    return 'docs';
  }

  private firstString(...values: unknown[]): string | undefined {
    const found = values.find((value) => typeof value === 'string' && value.length > 0);
    return found as string | undefined;
  }

  private firstNumber(...values: unknown[]): number | undefined {
    const found = values.find((value) => typeof value === 'number' && Number.isFinite(value));
    return found as number | undefined;
  }

  private escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}

let instance: SearchService | null = null;

export function getSearchService(): SearchService {
  if (!instance) {
    instance = new SearchService();
  }
  return instance;
}

export { SearchService };
