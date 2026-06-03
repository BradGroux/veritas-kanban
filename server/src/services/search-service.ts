import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createLogger } from '../lib/logger.js';
import { getNotificationService, NotificationService } from './notification-service.js';
import {
  getScheduledDeliverablesService,
  ScheduledDeliverablesService,
} from './scheduled-deliverables-service.js';
import { getWorkProductService, WorkProductService } from './work-product-service.js';
import { getWorkflowService, WorkflowService } from './workflow-service.js';
import { getWorkflowRunService, WorkflowRunService } from './workflow-run-service.js';

const log = createLogger('search-service');

export type SearchBackend = 'auto' | 'qmd' | 'keyword';

export const SEARCH_COLLECTIONS = [
  'tasks-active',
  'tasks-archive',
  'tasks-backlog',
  'docs',
  'prompts',
  'work-products',
  'workflows',
  'workflow-runs',
  'policies',
  'decisions',
  'settings',
  'logs-diagnostics',
  'agent-runs',
  'notifications',
  'maintenance',
  'scheduled-runs',
] as const;

export type SearchCollection = (typeof SEARCH_COLLECTIONS)[number];

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
  extensions: readonly string[];
}

interface SearchFile {
  path: string;
  mtimeMs: number;
}

interface ScoreDetails {
  score: number;
  textScore: number;
  recencyBoost: number;
}

const PROJECT_ROOT = path.resolve(process.cwd(), '..');
const DEFAULT_COLLECTIONS: SearchCollection[] = [...SEARCH_COLLECTIONS];
const QMD_COLLECTIONS = new Set<SearchCollection>(['tasks-active', 'tasks-archive', 'docs']);
const MAX_LIMIT = 50;
const DEFAULT_FILE_EXTENSIONS = ['.md', '.mdx', '.txt'] as const;
const DATA_FILE_EXTENSIONS = [
  '.md',
  '.mdx',
  '.txt',
  '.json',
  '.jsonl',
  '.ndjson',
  '.yaml',
  '.yml',
  '.log',
] as const;
const SKIPPED_DIRECTORIES = new Set(['.git', 'node_modules', 'backups', 'worktrees']);
const MAX_FILES_PER_SOURCE = Number(process.env.VERITAS_SEARCH_MAX_FILES_PER_SOURCE || 1_500);

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
          minScore: request.minScore,
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
      minScore: request.minScore,
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
    const qmdCollections = options.collections.filter((collection) =>
      QMD_COLLECTIONS.has(collection)
    );
    const keywordCollections = options.collections.filter(
      (collection) => !QMD_COLLECTIONS.has(collection)
    );
    const results: SearchResult[] = [];

    if (keywordCollections.length > 0) {
      results.push(
        ...(await this.searchKeyword(query, {
          limit: options.limit,
          collections: keywordCollections,
          minScore: options.minScore,
        }))
      );
    }

    if (qmdCollections.length === 0) {
      return this.rankResults(results).slice(0, options.limit);
    }

    const args = ['query', query, '--json', '-n', String(options.limit)];

    if (options.minScore !== undefined) {
      args.push('--min-score', String(options.minScore));
    }

    args.push('--collections', qmdCollections.join(','));

    const stdout = await this.runQmdCommand(
      args,
      Number(process.env.VERITAS_QMD_TIMEOUT_MS || 10_000)
    );

    results.push(...this.normalizeQmdResults(stdout, options.limit));
    return this.rankResults(results).slice(0, options.limit);
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
        this.asSearchCollection(this.firstString(item.collection, item.source)) ??
        this.inferCollection(filePath);
      const score =
        this.firstNumber(item.score, item.relevance, item.rankScore) ?? 1 - index / limit;
      const relativePath = this.relativeDisplayPath(filePath);
      const target = this.targetForPath(collection, relativePath, item);

      return {
        id: this.firstString(item.id, item.docid, item.docId) ?? `${filePath || 'result'}:${index}`,
        title,
        path: relativePath,
        collection,
        snippet: this.redactSnippet(snippet).slice(0, 500),
        score,
        metadata: {
          ...item,
          source: 'qmd',
          target,
          actions: this.actionsForTarget(target, collection),
          ranking: {
            textScore: score,
            recencyBoost: 0,
            usageFrequency: 0,
          },
        },
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
    options: { limit: number; collections?: SearchCollection[]; minScore?: number }
  ): Promise<SearchResult[]> {
    const terms = this.queryTerms(query);
    if (terms.length === 0) return [];

    const selected = this.normalizeCollections(options.collections);
    const results: SearchResult[] = [];

    results.push(
      ...(await this.searchStructuredCollections(query, terms, options.limit, selected))
    );

    for (const source of this.sources(selected)) {
      const files = await this.listSearchFiles(source.dir, source.extensions);
      for (const file of files) {
        const result = await this.scoreFile(file, source, terms, query);
        if (result) results.push(result);
      }
    }

    const minScore = options.minScore;
    return this.rankResults(results)
      .filter((result) => minScore === undefined || result.score >= minScore)
      .slice(0, options.limit);
  }

  private async searchStructuredCollections(
    query: string,
    terms: string[],
    limit: number,
    selected: SearchCollection[]
  ): Promise<SearchResult[]> {
    const results: SearchResult[] = [];
    const collections = new Set(selected);

    if (collections.has('work-products')) {
      results.push(...(await this.searchWorkProducts(query, limit)));
    }

    if (collections.has('workflows')) {
      results.push(...(await this.searchWorkflows(query, terms, limit)));
    }

    if (collections.has('workflow-runs')) {
      results.push(...(await this.searchWorkflowRuns(query, terms, limit)));
    }

    if (collections.has('notifications')) {
      results.push(...(await this.searchNotifications(query, terms, limit)));
    }

    if (collections.has('maintenance')) {
      results.push(...(await this.searchMaintenance(query, terms, limit)));
    }

    if (collections.has('scheduled-runs')) {
      results.push(...(await this.searchScheduledRuns(query, terms, limit)));
    }

    if (collections.has('settings')) {
      results.push(...this.searchSettings(query, terms));
    }

    return results;
  }

  private async scoreFile(
    file: SearchFile,
    source: SearchSource,
    terms: string[],
    query: string
  ): Promise<SearchResult | null> {
    let content: string;
    try {
      content = await fs.readFile(file.path, 'utf-8');
    } catch {
      return null;
    }

    const relativePath = this.relativeDisplayPath(file.path);
    const parsed = this.parseJsonObject(content);
    const title = this.extractTitle(content, file.path, parsed);
    const score = this.scoreText({ title, pathValue: relativePath, content, terms, query });

    if (score.textScore === 0) return null;

    const timestamp =
      this.extractTimestamp(parsed, content) ?? new Date(file.mtimeMs).toISOString();
    const target = this.targetForPath(source.collection, relativePath, parsed);
    const snippet = this.extractSnippet(content, terms);

    return {
      id: relativePath,
      title,
      path: relativePath,
      collection: source.collection,
      snippet: this.redactSnippet(snippet),
      score: score.score,
      metadata: {
        source: 'file',
        updatedAt: timestamp,
        target,
        actions: this.actionsForTarget(target, source.collection),
        ranking: {
          textScore: score.textScore,
          recencyBoost: score.recencyBoost,
          usageFrequency: 0,
        },
      },
    };
  }

  private sources(collections?: SearchCollection[]): SearchSource[] {
    const selected = new Set(this.normalizeCollections(collections));
    const root = this.projectRoot();
    const runtime = this.runtimeDir();
    const candidates: SearchSource[] = [
      {
        collection: 'tasks-active',
        dir: process.env.VERITAS_SEARCH_TASKS_ACTIVE_DIR || path.join(root, 'tasks', 'active'),
        extensions: DEFAULT_FILE_EXTENSIONS,
      },
      {
        collection: 'tasks-archive',
        dir: process.env.VERITAS_SEARCH_TASKS_ARCHIVE_DIR || path.join(root, 'tasks', 'archive'),
        extensions: DEFAULT_FILE_EXTENSIONS,
      },
      {
        collection: 'tasks-backlog',
        dir: process.env.VERITAS_SEARCH_TASKS_BACKLOG_DIR || path.join(root, 'tasks', 'backlog'),
        extensions: DEFAULT_FILE_EXTENSIONS,
      },
      {
        collection: 'docs',
        dir: process.env.VERITAS_SEARCH_DOCS_DIR || path.join(root, 'docs'),
        extensions: DEFAULT_FILE_EXTENSIONS,
      },
      {
        collection: 'prompts',
        dir: path.join(root, 'prompt-registry'),
        extensions: DEFAULT_FILE_EXTENSIONS,
      },
      {
        collection: 'prompts',
        dir: path.join(runtime, 'prompt-templates'),
        extensions: DATA_FILE_EXTENSIONS,
      },
      {
        collection: 'prompts',
        dir: path.join(runtime, 'templates'),
        extensions: DATA_FILE_EXTENSIONS,
      },
      {
        collection: 'policies',
        dir: path.join(runtime, 'storage', 'policies'),
        extensions: DATA_FILE_EXTENSIONS,
      },
      {
        collection: 'policies',
        dir: path.join(runtime, 'tool-policies'),
        extensions: DATA_FILE_EXTENSIONS,
      },
      {
        collection: 'decisions',
        dir: path.join(root, 'storage', 'decisions'),
        extensions: DATA_FILE_EXTENSIONS,
      },
      {
        collection: 'logs-diagnostics',
        dir: path.join(runtime, 'logs'),
        extensions: DATA_FILE_EXTENSIONS,
      },
      {
        collection: 'logs-diagnostics',
        dir: path.join(runtime, 'audit'),
        extensions: DATA_FILE_EXTENSIONS,
      },
      {
        collection: 'agent-runs',
        dir: path.join(runtime, 'traces'),
        extensions: DATA_FILE_EXTENSIONS,
      },
      {
        collection: 'agent-runs',
        dir: path.join(runtime, 'telemetry'),
        extensions: ['.ndjson', '.jsonl', '.json', '.log'],
      },
    ];

    return candidates.filter((source) => selected.has(source.collection));
  }

  private async searchWorkProducts(query: string, limit: number): Promise<SearchResult[]> {
    const service = this.workProductService();
    const products = await service.search(query, limit);
    return products.map((product, index) => {
      const preview = service.toPreview(product);
      const score = limit - index + this.recencyBoost(product.updatedAt);
      const target = product.taskId
        ? {
            type: 'task',
            taskId: product.taskId,
            tab: 'work-products',
            href: `veritas://task/${encodeURIComponent(product.taskId)}?tab=work-products`,
          }
        : {
            type: 'none',
            disabledReason: 'This work product is not linked to an in-app task yet.',
          };

      return {
        id: product.id,
        title: product.title,
        path: `/work-products/${product.id}`,
        collection: 'work-products',
        snippet: this.redactSnippet(preview.snippet),
        score,
        metadata: {
          kind: product.kind,
          taskId: product.taskId,
          sourceRunId: product.sourceRunId,
          agent: product.agent,
          model: product.model,
          version: product.version,
          updatedAt: product.updatedAt,
          redacted: preview.redacted,
          target,
          actions: this.actionsForTarget(target, 'work-products'),
          ranking: {
            textScore: limit - index,
            recencyBoost: this.recencyBoost(product.updatedAt),
            usageFrequency: 0,
          },
        },
      };
    });
  }

  private async searchWorkflows(
    query: string,
    terms: string[],
    limit: number
  ): Promise<SearchResult[]> {
    const workflows = await this.workflowService().listWorkflowsMetadata();
    const results: SearchResult[] = [];

    for (const workflow of workflows) {
      const content = `${workflow.id}\n${workflow.name}\n${workflow.description ?? ''}\n${
        workflow.version
      }`;
      const score = this.scoreText({
        title: workflow.name,
        pathValue: `/workflows/${workflow.id}`,
        content,
        terms,
        query,
      });
      if (score.textScore === 0) continue;

      const target = { type: 'view', view: 'workflows', href: '/workflows' };
      results.push({
        id: workflow.id,
        title: workflow.name,
        path: `/workflows/${workflow.id}`,
        collection: 'workflows',
        snippet: this.redactSnippet(workflow.description ?? `Workflow ${workflow.id}`),
        score: score.score,
        metadata: {
          workflowId: workflow.id,
          version: workflow.version,
          target,
          actions: this.actionsForTarget(target, 'workflows'),
          ranking: {
            textScore: score.textScore,
            recencyBoost: score.recencyBoost,
            usageFrequency: 0,
          },
        },
      });
    }

    return this.rankResults(results).slice(0, limit);
  }

  private async searchWorkflowRuns(
    query: string,
    terms: string[],
    limit: number
  ): Promise<SearchResult[]> {
    const runs = await this.workflowRunService().listRunsMetadata({});
    const results: SearchResult[] = [];

    for (const run of runs.slice(0, Math.max(limit * 5, 50))) {
      const content = `${run.id}\n${run.workflowId}\n${run.taskId}\n${run.status}\n${
        run.error ?? ''
      }`;
      const score = this.scoreText({
        title: `${run.workflowId} ${run.status}`,
        pathValue: `/workflows/runs/${run.id}`,
        content,
        terms,
        query,
        timestamp: run.completedAt ?? run.startedAt,
      });
      if (score.textScore === 0) continue;

      const target = run.taskId
        ? {
            type: 'task',
            taskId: run.taskId,
            tab: 'timeline',
            timelineAttemptId: run.id,
            href: `veritas://task/${encodeURIComponent(run.taskId)}?tab=timeline&attempt=${encodeURIComponent(
              run.id
            )}`,
          }
        : { type: 'view', view: 'workflows', href: '/workflows' };

      results.push({
        id: run.id,
        title: `${run.workflowId} run`,
        path: `/workflows/runs/${run.id}`,
        collection: 'workflow-runs',
        snippet: this.redactSnippet(
          [run.status, run.startedAt, run.error].filter(Boolean).join(' - ')
        ),
        score: score.score,
        metadata: {
          workflowId: run.workflowId,
          workflowVersion: run.workflowVersion,
          taskId: run.taskId,
          status: run.status,
          startedAt: run.startedAt,
          completedAt: run.completedAt,
          target,
          actions: this.actionsForTarget(target, 'workflow-runs'),
          ranking: {
            textScore: score.textScore,
            recencyBoost: score.recencyBoost,
            usageFrequency: 0,
          },
        },
      });
    }

    return this.rankResults(results).slice(0, limit);
  }

  private async searchNotifications(
    query: string,
    terms: string[],
    limit: number
  ): Promise<SearchResult[]> {
    const notifications = await this.notificationService().getAllNotifications({ limit: 200 });
    const results: SearchResult[] = [];

    for (const notification of notifications) {
      const title =
        notification.title ?? notification.taskTitle ?? `${notification.type} notification`;
      const content = `${title}\n${notification.content}\n${notification.taskId}\n${notification.targetAgent}\n${notification.fromAgent}\n${notification.type}`;
      const score = this.scoreText({
        title,
        pathValue: notification.targetUrl ?? `/notifications/${notification.id}`,
        content,
        terms,
        query,
        timestamp: notification.createdAt,
      });
      if (score.textScore === 0) continue;

      const target =
        notification.taskId && notification.taskId !== 'system'
          ? {
              type: 'task',
              taskId: notification.taskId,
              tab: 'observations',
              href: `veritas://task/${encodeURIComponent(notification.taskId)}?tab=observations`,
            }
          : { type: 'view', view: 'activity', href: '/activity' };

      results.push({
        id: notification.id,
        title,
        path: notification.targetUrl ?? `/notifications/${notification.id}`,
        collection: 'notifications',
        snippet: this.redactSnippet(notification.content),
        score: score.score,
        metadata: {
          taskId: notification.taskId,
          targetAgent: notification.targetAgent,
          fromAgent: notification.fromAgent,
          type: notification.type,
          delivered: notification.delivered,
          createdAt: notification.createdAt,
          target,
          actions: this.actionsForTarget(target, 'notifications'),
          ranking: {
            textScore: score.textScore,
            recencyBoost: score.recencyBoost,
            usageFrequency: 0,
          },
        },
      });
    }

    return this.rankResults(results).slice(0, limit);
  }

  private async searchMaintenance(
    query: string,
    terms: string[],
    limit: number
  ): Promise<SearchResult[]> {
    const preview = await this.workProductService().maintenancePreview();
    const items = [...preview.cleanupCandidates, ...preview.retained];
    const results: SearchResult[] = [];

    for (const item of items) {
      const title = `${item.title} maintenance`;
      const content = `${title}\n${item.kind}\n${item.status}\n${item.id}\n${
        item.cleanupEligible ? 'cleanup candidate' : 'retained'
      }`;
      const score = this.scoreText({
        title,
        pathValue: `/work-products/${item.id}/maintenance`,
        content,
        terms,
        query,
        timestamp: item.updatedAt,
      });
      if (score.textScore === 0) continue;

      const target = item.taskId
        ? {
            type: 'task',
            taskId: item.taskId,
            tab: 'work-products',
            href: `veritas://task/${encodeURIComponent(item.taskId)}?tab=work-products`,
          }
        : { type: 'view', view: 'activity', href: '/activity' };

      results.push({
        id: `maintenance:${item.id}`,
        title,
        path: `/work-products/${item.id}/maintenance`,
        collection: 'maintenance',
        snippet: `${item.cleanupEligible ? 'Cleanup candidate' : 'Retained'} - ${
          item.versionCount
        } versions, ${item.estimatedBytes} estimated bytes`,
        score: score.score,
        metadata: {
          productId: item.id,
          kind: item.kind,
          status: item.status,
          taskId: item.taskId,
          cleanupEligible: item.cleanupEligible,
          versionCount: item.versionCount,
          estimatedBytes: item.estimatedBytes,
          updatedAt: item.updatedAt,
          target,
          actions: this.actionsForTarget(target, 'maintenance'),
          ranking: {
            textScore: score.textScore,
            recencyBoost: score.recencyBoost,
            usageFrequency: 0,
          },
        },
      });
    }

    return this.rankResults(results).slice(0, limit);
  }

  private async searchScheduledRuns(
    query: string,
    terms: string[],
    limit: number
  ): Promise<SearchResult[]> {
    const service = this.scheduledDeliverablesService();
    const deliverables = await service.list();
    const results: SearchResult[] = [];

    for (const deliverable of deliverables) {
      const content = `${deliverable.name}\n${deliverable.description}\n${deliverable.schedule}\n${deliverable.scheduleDescription}\n${deliverable.agent ?? ''}\n${deliverable.tags.join(' ')}`;
      const score = this.scoreText({
        title: deliverable.name,
        pathValue: `/scheduled-runs/${deliverable.id}`,
        content,
        terms,
        query,
        timestamp: deliverable.lastRunAt ?? deliverable.createdAt,
      });

      if (score.textScore > 0) {
        const target = { type: 'view', view: 'workflows', href: '/workflows' };
        results.push({
          id: deliverable.id,
          title: deliverable.name,
          path: `/scheduled-runs/${deliverable.id}`,
          collection: 'scheduled-runs',
          snippet: this.redactSnippet(
            `${deliverable.scheduleDescription} - ${deliverable.description}`
          ),
          score: score.score,
          metadata: {
            schedule: deliverable.schedule,
            enabled: deliverable.enabled,
            agent: deliverable.agent,
            lastRunAt: deliverable.lastRunAt,
            nextRunAt: deliverable.nextRunAt,
            totalRuns: deliverable.totalRuns,
            target,
            actions: this.actionsForTarget(target, 'scheduled-runs'),
            ranking: {
              textScore: score.textScore,
              recencyBoost: score.recencyBoost,
              usageFrequency: 0,
            },
          },
        });
      }

      const runs = await service.getRuns(deliverable.id, 20);
      for (const run of runs) {
        const runContent = `${deliverable.name}\n${run.id}\n${run.status}\n${run.summary ?? ''}\n${run.error ?? ''}\n${run.workflowId ?? ''}\n${run.sourceRunId ?? ''}`;
        const runScore = this.scoreText({
          title: `${deliverable.name} ${run.status}`,
          pathValue: `/scheduled-runs/${deliverable.id}/${run.id}`,
          content: runContent,
          terms,
          query,
          timestamp: run.runAt,
        });
        if (runScore.textScore === 0) continue;

        const target = { type: 'view', view: 'workflows', href: '/workflows' };
        results.push({
          id: run.id,
          title: `${deliverable.name} run`,
          path: `/scheduled-runs/${deliverable.id}/${run.id}`,
          collection: 'scheduled-runs',
          snippet: this.redactSnippet(
            [run.status, run.summary, run.error].filter(Boolean).join(' - ')
          ),
          score: runScore.score,
          metadata: {
            deliverableId: deliverable.id,
            status: run.status,
            workflowId: run.workflowId,
            sourceRunId: run.sourceRunId,
            runAt: run.runAt,
            target,
            actions: this.actionsForTarget(target, 'scheduled-runs'),
            ranking: {
              textScore: runScore.textScore,
              recencyBoost: runScore.recencyBoost,
              usageFrequency: 0,
            },
          },
        });
      }
    }

    return this.rankResults(results).slice(0, limit);
  }

  private searchSettings(query: string, terms: string[]): SearchResult[] {
    const settings = [
      {
        id: 'settings-features',
        title: 'Feature Settings',
        section: 'features',
        snippet: 'Board, task behavior, agents, notifications, archive, budget, and telemetry.',
        keywords: 'features board tasks agents notifications archive budget telemetry settings',
      },
      {
        id: 'settings-security',
        title: 'Security Settings',
        section: 'security',
        snippet: 'API access, permissions, authentication, and local mode controls.',
        keywords: 'security api token permissions authentication local remote mode settings',
      },
      {
        id: 'settings-identity',
        title: 'Identity and Workspace Settings',
        section: 'multi-user',
        snippet: 'Workspace members, invitations, roles, and multi-user access.',
        keywords: 'identity workspace members invitations roles multi user access settings',
      },
      {
        id: 'settings-codex-health',
        title: 'Codex Health Diagnostics',
        section: 'codex',
        snippet: 'CLI, SDK, cloud provider, and agent readiness diagnostics.',
        keywords: 'codex health diagnostics cli sdk cloud agents settings',
      },
    ];

    const results: SearchResult[] = [];

    for (const setting of settings) {
      const score = this.scoreText({
        title: setting.title,
        pathValue: `/settings/${setting.section}`,
        content: `${setting.snippet}\n${setting.keywords}`,
        terms,
        query,
      });
      if (score.textScore === 0) continue;

      const target = {
        type: 'settings',
        section: setting.section,
        href: `/settings/${setting.section}`,
      };
      results.push({
        id: setting.id,
        title: setting.title,
        path: `/settings/${setting.section}`,
        collection: 'settings',
        snippet: setting.snippet,
        score: score.score,
        metadata: {
          section: setting.section,
          target,
          actions: this.actionsForTarget(target, 'settings'),
          ranking: {
            textScore: score.textScore,
            recencyBoost: score.recencyBoost,
            usageFrequency: 0,
          },
        },
      });
    }

    return results;
  }

  private normalizeCollections(collections?: SearchCollection[]): SearchCollection[] {
    if (!collections || collections.length === 0) return DEFAULT_COLLECTIONS;
    const allowed = new Set<SearchCollection>(SEARCH_COLLECTIONS);
    return collections.filter((collection) => allowed.has(collection));
  }

  private async listSearchFiles(
    dir: string,
    extensions: readonly string[] = DEFAULT_FILE_EXTENSIONS
  ): Promise<SearchFile[]> {
    const files: SearchFile[] = [];
    const allowedExtensions = new Set(extensions.map((extension) => extension.toLowerCase()));

    const visit = async (currentDir: string): Promise<void> => {
      if (files.length >= MAX_FILES_PER_SOURCE) return;

      let entries;
      try {
        entries = await fs.readdir(currentDir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        if (files.length >= MAX_FILES_PER_SOURCE) return;
        if (SKIPPED_DIRECTORIES.has(entry.name)) continue;

        const fullPath = path.join(currentDir, entry.name);
        if (entry.isDirectory()) {
          await visit(fullPath);
          continue;
        }

        if (!entry.isFile()) continue;

        const extension = path.extname(entry.name).toLowerCase();
        if (!allowedExtensions.has(extension)) continue;

        try {
          const stats = await fs.stat(fullPath);
          files.push({ path: fullPath, mtimeMs: stats.mtimeMs });
        } catch {
          continue;
        }
      }
    };

    await visit(dir);
    return files.sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, MAX_FILES_PER_SOURCE);
  }

  private extractTitle(
    content: string,
    filePath: string,
    parsed?: Record<string, unknown> | null
  ): string {
    if (parsed) {
      const title = this.firstString(
        parsed.title,
        parsed.name,
        parsed.taskTitle,
        parsed.workflowId,
        parsed.id
      );
      if (title) return title;
    }

    const heading = content.match(/^#\s+(.+)$/m)?.[1]?.trim();
    if (heading) return heading;

    const titleField = content.match(/^title:\s*['"]?(.+?)['"]?\s*$/m)?.[1]?.trim();
    if (titleField) return titleField;

    return path.basename(filePath).replace(/\.(md|mdx|txt|json|jsonl|ndjson|yaml|yml|log)$/i, '');
  }

  private extractSnippet(content: string, terms: string[]): string {
    const lines = content.split('\n');
    const match = lines.find((line) => {
      const lower = line.toLowerCase();
      return terms.some((term) => lower.includes(term));
    });
    return (match || lines.find((line) => line.trim()) || '').trim().slice(0, 500);
  }

  private targetForPath(
    collection: SearchCollection,
    relativePath: string,
    parsed?: Record<string, unknown> | null
  ): Record<string, unknown> {
    const taskId =
      this.firstString(parsed?.taskId, parsed?.task_id) ?? this.extractTaskId(relativePath);
    const attemptId = this.firstString(
      parsed?.attemptId,
      parsed?.traceId,
      parsed?.runId,
      parsed?.id
    );

    if (collection.startsWith('tasks') && taskId) {
      return {
        type: 'task',
        taskId,
        href: `veritas://task/${encodeURIComponent(taskId)}`,
      };
    }

    if ((collection === 'workflow-runs' || collection === 'agent-runs') && taskId) {
      return {
        type: 'task',
        taskId,
        tab: 'timeline',
        timelineAttemptId: attemptId,
        href: `veritas://task/${encodeURIComponent(taskId)}?tab=timeline${
          attemptId ? `&attempt=${encodeURIComponent(attemptId)}` : ''
        }`,
      };
    }

    if (collection === 'workflows') {
      return { type: 'view', view: 'workflows', href: '/workflows' };
    }

    if (collection === 'policies') {
      return { type: 'view', view: 'policies', href: '/policies' };
    }

    if (collection === 'decisions') {
      return { type: 'view', view: 'decisions', href: '/decisions' };
    }

    if (collection === 'logs-diagnostics' || collection === 'agent-runs') {
      return { type: 'diagnostics', href: '/diagnostics' };
    }

    if (collection === 'prompts') {
      return { type: 'view', view: 'templates', href: '/templates' };
    }

    return {
      type: 'none',
      disabledReason: 'This result does not have an in-app destination yet.',
    };
  }

  private actionsForTarget(
    target: Record<string, unknown>,
    collection: SearchCollection
  ): Array<Record<string, unknown>> {
    if (target.type === 'none') {
      return [
        {
          id: 'unavailable',
          label: 'No action available',
          disabledReason: this.firstString(target.disabledReason) ?? 'No destination is available.',
        },
      ];
    }

    const labelByType: Record<string, string> = {
      task: target.tab === 'timeline' ? 'Open timeline' : 'Open task',
      view: 'Open view',
      settings: 'Open settings',
      diagnostics: 'Open diagnostics',
      url: 'Open link',
    };

    return [
      {
        id: `open-${collection}`,
        label: labelByType[String(target.type)] ?? 'Open',
        target,
      },
    ];
  }

  private rankResults(results: SearchResult[]): SearchResult[] {
    return [...results].sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  }

  private scoreText(input: {
    title: string;
    pathValue: string;
    content: string;
    terms: string[];
    query: string;
    timestamp?: string;
  }): ScoreDetails {
    const title = input.title.toLowerCase();
    const pathValue = input.pathValue.toLowerCase();
    const haystack = input.content.toLowerCase();
    const exactQuery = input.query.trim().toLowerCase();
    let textScore = 0;

    if (exactQuery) {
      if (title.includes(exactQuery)) textScore += 10;
      if (pathValue.includes(exactQuery)) textScore += 5;
      if (haystack.includes(exactQuery)) textScore += 4;
    }

    for (const term of input.terms) {
      if (title.includes(term)) textScore += 6;
      if (pathValue.includes(term)) textScore += 3;
      const matches = haystack.match(new RegExp(this.escapeRegExp(term), 'g'))?.length ?? 0;
      textScore += Math.min(matches, 10);
    }

    const recencyBoost = this.recencyBoost(input.timestamp);
    return {
      score: textScore > 0 ? textScore + recencyBoost : 0,
      textScore,
      recencyBoost,
    };
  }

  private recencyBoost(timestamp?: string): number {
    if (!timestamp) return 0;
    const time = new Date(timestamp).getTime();
    if (!Number.isFinite(time)) return 0;

    const ageDays = (Date.now() - time) / 86_400_000;
    if (ageDays <= 7) return 3;
    if (ageDays <= 30) return 1.5;
    if (ageDays <= 90) return 0.5;
    return 0;
  }

  private queryTerms(query: string): string[] {
    return query
      .toLowerCase()
      .split(/\s+/)
      .map((term) => term.trim())
      .filter(Boolean);
  }

  private parseJsonObject(content: string): Record<string, unknown> | null {
    const trimmed = content.trim();
    if (!trimmed.startsWith('{')) return null;

    try {
      const parsed = JSON.parse(trimmed) as unknown;
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }

  private extractTimestamp(
    parsed: Record<string, unknown> | null | undefined,
    content?: string
  ): string | undefined {
    const value = this.firstString(
      parsed?.updatedAt,
      parsed?.createdAt,
      parsed?.startedAt,
      parsed?.completedAt,
      parsed?.runAt,
      parsed?.timestamp
    );
    if (value) return value;

    const match = content?.match(/\b20\d{2}-\d{2}-\d{2}T[^\s"']+/);
    return match?.[0];
  }

  private extractTaskId(value: string): string | undefined {
    const fileName = value.split('/').pop() ?? value;
    const fileMatch = fileName.match(/^(task_[^./]+?)(?:-[^/]*)?\.(?:md|mdx|txt)$/i);
    if (fileMatch?.[1]) return fileMatch[1];

    return value.match(/task_\d{8}_[A-Za-z0-9_]+/)?.[0];
  }

  private projectRoot(): string {
    const configured =
      process.env.VERITAS_SEARCH_ROOT || process.env.DATA_DIR || process.env.VERITAS_DATA_DIR;
    return configured ? path.resolve(configured) : PROJECT_ROOT;
  }

  private runtimeDir(): string {
    return path.join(this.projectRoot(), '.veritas-kanban');
  }

  private relativeDisplayPath(filePath: string): string {
    if (!path.isAbsolute(filePath)) return filePath;
    return path.relative(this.projectRoot(), filePath);
  }

  private inferCollection(filePath: string): SearchCollection {
    if (filePath.includes('tasks/archive')) return 'tasks-archive';
    if (filePath.includes('tasks/backlog')) return 'tasks-backlog';
    if (filePath.includes('tasks/active')) return 'tasks-active';
    return 'docs';
  }

  private asSearchCollection(value?: string): SearchCollection | undefined {
    return SEARCH_COLLECTIONS.find((collection) => collection === value);
  }

  private workProductService(): WorkProductService {
    if (process.env.VERITAS_SEARCH_ROOT) {
      return new WorkProductService({ dataDir: this.runtimeDir(), storageType: 'file' });
    }
    return getWorkProductService();
  }

  private notificationService(): NotificationService {
    if (process.env.VERITAS_SEARCH_ROOT) {
      return new NotificationService({ dataDir: this.runtimeDir(), storageType: 'file' });
    }
    return getNotificationService();
  }

  private scheduledDeliverablesService(): ScheduledDeliverablesService {
    if (process.env.VERITAS_SEARCH_ROOT) {
      return new ScheduledDeliverablesService({ dataDir: this.runtimeDir(), storageType: 'file' });
    }
    return getScheduledDeliverablesService();
  }

  private workflowService(): WorkflowService {
    if (process.env.VERITAS_SEARCH_ROOT) {
      return new WorkflowService({
        workflowsDir: path.join(this.runtimeDir(), 'workflows'),
        storageType: 'file',
      });
    }
    return getWorkflowService();
  }

  private workflowRunService(): WorkflowRunService {
    if (process.env.VERITAS_SEARCH_ROOT) {
      return new WorkflowRunService({
        runsDir: path.join(this.runtimeDir(), 'workflow-runs'),
        storageType: 'file',
      });
    }
    return getWorkflowRunService();
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

  private redactSnippet(value: string): string {
    return value
      .replace(
        /\b(api[_-]?key|token|secret|password|authorization|cookie)\b\s*[:=]\s*["']?[^"',\s]+/gi,
        '$1: [redacted]'
      )
      .replace(/\b(sk-[A-Za-z0-9_-]{10,})\b/g, '[redacted]')
      .replace(/\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g, '[redacted]')
      .slice(0, 500);
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
