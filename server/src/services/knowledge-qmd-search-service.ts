import { execFile } from 'node:child_process';
import path from 'node:path';
import type { KnowledgePage } from '@veritas-kanban/shared';
import { KnowledgeQmdProjectionStore } from '../storage/knowledge-qmd-projection-store.js';
import { withFileLock } from './file-lock.js';

export interface KnowledgeQmdSearchHit {
  pageId: string;
  score: number;
  snippet: string;
}

export interface KnowledgeQmdSearchAdapter {
  search(input: {
    workspaceId: string;
    collectionId: string;
    query: string;
    limit: number;
    pages: KnowledgePage[];
  }): Promise<KnowledgeQmdSearchHit[]>;
}

export class KnowledgeQmdSearchService implements KnowledgeQmdSearchAdapter {
  constructor(private readonly projections = new KnowledgeQmdProjectionStore()) {}

  async search(input: {
    workspaceId: string;
    collectionId: string;
    query: string;
    limit: number;
    pages: KnowledgePage[];
  }): Promise<KnowledgeQmdSearchHit[]> {
    const projection = await this.projections.sync(
      input.workspaceId,
      input.collectionId,
      input.pages
    );
    return withFileLock(path.join(projection.directory, 'qmd-index'), async () => {
      const env = {
        ...process.env,
        QMD_CONFIG_DIR: projection.configDir,
        INDEX_PATH: path.join(projection.configDir, 'index.sqlite'),
      };
      let added = false;
      try {
        await this.run(['collection', 'show', projection.collectionName], env);
      } catch {
        await this.run(
          [
            'collection',
            'add',
            projection.directory,
            '--name',
            projection.collectionName,
            '--mask',
            '**/*.md',
          ],
          env
        );
        await this.run(['collection', 'exclude', projection.collectionName], env);
        added = true;
      }
      if (projection.changed || added) {
        await this.run(
          ['update'],
          env,
          Number(process.env.VERITAS_QMD_REFRESH_TIMEOUT_MS || 60_000)
        );
        if (process.env.VERITAS_QMD_KNOWLEDGE_EMBED === 'true') {
          await this.run(
            ['embed', '-c', projection.collectionName],
            env,
            Number(process.env.VERITAS_QMD_REFRESH_TIMEOUT_MS || 60_000)
          );
        }
      }
      const stdout = await this.run(
        [
          'query',
          input.query,
          '--json',
          '-n',
          String(input.limit),
          '-c',
          projection.collectionName,
        ],
        env,
        Number(process.env.VERITAS_QMD_TIMEOUT_MS || 10_000)
      );
      return normalizeHits(stdout, new Set(input.pages.map((page) => page.id)), input.limit);
    });
  }

  private run(
    args: string[],
    env: NodeJS.ProcessEnv,
    timeout = Number(process.env.VERITAS_QMD_TIMEOUT_MS || 10_000)
  ): Promise<string> {
    const binary = process.env.VERITAS_QMD_BIN || 'qmd';
    return new Promise((resolve, reject) => {
      execFile(
        binary,
        args,
        {
          cwd: process.cwd(),
          env,
          timeout,
          maxBuffer: 2 * 1_024 * 1_024,
        },
        (error, stdout) => {
          if (error) {
            reject(error);
            return;
          }
          resolve(String(stdout ?? ''));
        }
      );
    });
  }
}

function normalizeHits(
  stdout: string,
  allowedPageIds: Set<string>,
  limit: number
): KnowledgeQmdSearchHit[] {
  const parsed = JSON.parse(stdout || '[]') as unknown;
  const values = Array.isArray(parsed)
    ? parsed
    : parsed &&
        typeof parsed === 'object' &&
        Array.isArray((parsed as { results?: unknown }).results)
      ? ((parsed as { results: unknown[] }).results ?? [])
      : [];
  const hits: KnowledgeQmdSearchHit[] = [];
  for (const [index, value] of values.entries()) {
    if (!value || typeof value !== 'object') continue;
    const item = value as Record<string, unknown>;
    const fileValue = firstString(item.file, item.path, item.filename);
    if (!fileValue) continue;
    const pageId = path.basename(fileValue).replace(/\.md$/i, '');
    if (!allowedPageIds.has(pageId)) continue;
    hits.push({
      pageId,
      score: firstNumber(item.score, item.relevance, item.rankScore) ?? 1 - index / limit,
      snippet: firstString(item.snippet, item.context, item.text, item.content) ?? '',
    });
  }
  return hits.slice(0, limit);
}

function firstString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === 'string' && value.length > 0);
}

function firstNumber(...values: unknown[]): number | undefined {
  return values.find(
    (value): value is number => typeof value === 'number' && Number.isFinite(value)
  );
}
