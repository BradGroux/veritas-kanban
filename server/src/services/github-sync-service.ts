/**
 * GitHub Issues ↔ Kanban bidirectional sync service.
 *
 * Inbound:  Poll GitHub Issues (filtered by label) and import as kanban tasks.
 * Outbound: Push status changes and comments from kanban back to GitHub.
 *
 * Uses the `gh` CLI for all GitHub API access (same pattern as github-service.ts).
 * Persists config to `.veritas-kanban/integrations.json` and sync state to
 * `.veritas-kanban/github-sync.json`.
 */
import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { fileExists } from '../storage/fs-helpers.js';
import { getBreaker } from './circuit-registry.js';
import { getTaskService, type TaskService } from './task-service.js';
import { createLogger } from '../lib/logger.js';
import type { Task, TaskStatus, TaskPriority } from '@veritas-kanban/shared';

const execFileAsync = promisify(execFile);
const log = createLogger('github-sync');

// ─── Types ───────────────────────────────────────────────────

export interface GitHubSyncConfig {
  enabled: boolean;
  repo: string;
  syncMode: 'inbound' | 'outbound' | 'bidirectional';
  labelFilter: string;
  pollIntervalMs: number;
}

export interface IntegrationsConfig {
  github: GitHubSyncConfig;
}

export interface IssueMappings {
  [issueNumber: string]: string; // issueNumber → taskId
}

export interface SyncState {
  lastSyncAt: string | null;
  issueMappings: IssueMappings;
}

export interface SyncResult {
  imported: number;
  updated: number;
  errors: string[];
  lastSyncAt: string;
}

/** Shape returned by `gh issue list --json ...` */
interface GhIssue {
  number: number;
  title: string;
  body: string;
  state: string; // OPEN | CLOSED
  labels: { name: string }[];
  createdAt: string;
  updatedAt: string;
}

// ─── Constants ───────────────────────────────────────────────

const DATA_DIR = join(process.cwd(), '.veritas-kanban');
const INTEGRATIONS_FILE = join(DATA_DIR, 'integrations.json');
const SYNC_STATE_FILE = join(DATA_DIR, 'github-sync.json');

const DEFAULT_CONFIG: IntegrationsConfig = {
  github: {
    enabled: true,
    repo: 'BradGroux/veritas-kanban',
    syncMode: 'bidirectional',
    labelFilter: 'kanban',
    pollIntervalMs: 300_000, // 5 minutes
  },
};

const DEFAULT_STATE: SyncState = {
  lastSyncAt: null,
  issueMappings: {},
};

// ─── Service ─────────────────────────────────────────────────

export class GitHubSyncService {
  private taskService: TaskService;
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.taskService = getTaskService();
  }

  // ── Config persistence ────────────────────────────────────

  async getConfig(): Promise<IntegrationsConfig> {
    await mkdir(DATA_DIR, { recursive: true });
    if (!(await fileExists(INTEGRATIONS_FILE))) {
      return { ...DEFAULT_CONFIG };
    }
    try {
      const raw = await readFile(INTEGRATIONS_FILE, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<IntegrationsConfig>;
      return {
        github: { ...DEFAULT_CONFIG.github, ...parsed.github },
      };
    } catch {
      return { ...DEFAULT_CONFIG };
    }
  }

  async updateConfig(patch: Partial<GitHubSyncConfig>): Promise<IntegrationsConfig> {
    const current = await this.getConfig();
    current.github = { ...current.github, ...patch };
    await mkdir(DATA_DIR, { recursive: true });
    await writeFile(INTEGRATIONS_FILE, JSON.stringify(current, null, 2), 'utf-8');
    return current;
  }

  // ── Sync-state persistence ────────────────────────────────

  async getSyncState(): Promise<SyncState> {
    await mkdir(DATA_DIR, { recursive: true });
    if (!(await fileExists(SYNC_STATE_FILE))) {
      return { ...DEFAULT_STATE, issueMappings: {} };
    }
    try {
      const raw = await readFile(SYNC_STATE_FILE, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<SyncState>;
      return {
        lastSyncAt: parsed.lastSyncAt ?? null,
        issueMappings: parsed.issueMappings ?? {},
      };
    } catch {
      return { ...DEFAULT_STATE, issueMappings: {} };
    }
  }

  private async saveSyncState(state: SyncState): Promise<void> {
    await mkdir(DATA_DIR, { recursive: true });
    await writeFile(SYNC_STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
  }

  // ── gh CLI helpers ────────────────────────────────────────

  /**
   * Execute a `gh` CLI command through the circuit breaker.
   * Returns parsed JSON output.
   */
  private async ghApi<T>(args: string[]): Promise<T> {
    const ghBreaker = getBreaker('github');
    const { stdout } = await ghBreaker.execute(() => execFileAsync('gh', args));
    return JSON.parse(stdout) as T;
  }

  /**
   * Execute a `gh` CLI command that may not return JSON (e.g. issue close).
   */
  private async ghExec(args: string[]): Promise<string> {
    const ghBreaker = getBreaker('github');
    const { stdout } = await ghBreaker.execute(() => execFileAsync('gh', args));
    return stdout.trim();
  }

  // ── Inbound: GitHub → Kanban ──────────────────────────────

  /**
   * Poll GitHub for issues matching the label filter and import new ones.
   */
  async syncFromGitHub(): Promise<SyncResult> {
    const config = await this.getConfig();
    const state = await this.getSyncState();
    const result: SyncResult = { imported: 0, updated: 0, errors: [], lastSyncAt: '' };

    if (!config.github.enabled) {
      result.errors.push('GitHub sync is disabled');
      return result;
    }

    const repo = config.github.repo;
    const label = config.github.labelFilter;

    // Fetch issues with the configured label from GitHub
    let issues: GhIssue[];
    try {
      issues = await this.ghApi<GhIssue[]>([
        'issue',
        'list',
        '--repo',
        repo,
        '--label',
        label,
        '--state',
        'all',
        '--limit',
        '100',
        '--json',
        'number,title,body,state,labels,createdAt,updatedAt',
      ]);
    } catch (err: any) {
      const msg = `Failed to fetch issues from ${repo}: ${err.message}`;
      log.error(msg);
      result.errors.push(msg);
      return result;
    }

    log.info({ count: issues.length, repo, label }, 'Fetched GitHub issues');

    for (const issue of issues) {
      const issueKey = String(issue.number);

      try {
        if (state.issueMappings[issueKey]) {
          // Already synced — update status if changed
          const taskId = state.issueMappings[issueKey];
          const task = await this.taskService.getTask(taskId);
          if (task) {
            const ghStatus = this.ghStateToKanbanStatus(issue.state);
            // Only update if GitHub side has a definitive status change
            // and the kanban side isn't in a nuanced in-between state
            if (task.status === 'done' && ghStatus === 'todo') {
              // Issue was reopened on GitHub
              await this.taskService.updateTask(taskId, { status: 'todo' });
              result.updated++;
              log.info({ issueNumber: issue.number, taskId }, 'Reopened task from GitHub');
            } else if (task.status !== 'done' && ghStatus === 'done') {
              // Issue was closed on GitHub
              await this.taskService.updateTask(taskId, { status: 'done' });
              result.updated++;
              log.info({ issueNumber: issue.number, taskId }, 'Closed task from GitHub');
            }
          }
        } else {
          // New issue — import as a kanban task
          const task = await this.importIssueAsTask(issue, repo);
          state.issueMappings[issueKey] = task.id;
          result.imported++;
          log.info({ issueNumber: issue.number, taskId: task.id }, 'Imported issue as task');
        }
      } catch (err: any) {
        const msg = `Failed to process issue #${issue.number}: ${err.message}`;
        log.error(msg);
        result.errors.push(msg);
      }
    }

    // Persist updated state
    state.lastSyncAt = new Date().toISOString();
    result.lastSyncAt = state.lastSyncAt;
    await this.saveSyncState(state);

    return result;
  }

  /**
   * Import a GitHub issue as a new kanban task.
   */
  private async importIssueAsTask(issue: GhIssue, repo: string): Promise<Task> {
    const priority = this.extractPriority(issue.labels);
    const type = this.extractType(issue.labels);
    const status = this.ghStateToKanbanStatus(issue.state);

    const task = await this.taskService.createTask({
      title: issue.title,
      description: issue.body || '',
      priority,
      type,
    });

    // Now update with github metadata and correct status
    const updated = await this.taskService.updateTask(task.id, {
      status,
      github: { issueNumber: issue.number, repo },
    });

    return updated ?? task;
  }

  // ── Outbound: Kanban → GitHub ─────────────────────────────

  /**
   * Push a task status change to the linked GitHub issue.
   */
  async syncTaskStatusToGitHub(task: Task): Promise<void> {
    if (!task.github) return;

    const config = await this.getConfig();
    if (!config.github.enabled || config.github.syncMode === 'inbound') return;

    const { issueNumber, repo } = task.github;

    try {
      if (task.status === 'done') {
        // Close the issue
        await this.ghExec([
          'issue',
          'close',
          String(issueNumber),
          '--repo',
          repo,
          '--reason',
          'completed',
        ]);
        log.info({ issueNumber, taskId: task.id }, 'Closed GitHub issue');
      } else {
        // Reopen the issue if it was closed
        await this.ghExec(['issue', 'reopen', String(issueNumber), '--repo', repo]);
        log.info({ issueNumber, taskId: task.id }, 'Reopened GitHub issue');
      }
    } catch (err: any) {
      // Ignore "already open" / "already closed" errors
      if (
        !err.message?.includes('already open') &&
        !err.message?.includes('already closed') &&
        !err.stderr?.includes('already open') &&
        !err.stderr?.includes('already closed')
      ) {
        log.error({ err, issueNumber, taskId: task.id }, 'Failed to sync status to GitHub');
        throw err;
      }
    }
  }

  /**
   * Post a kanban task comment to the linked GitHub issue.
   */
  async syncCommentToGitHub(task: Task, commentText: string): Promise<void> {
    if (!task.github) return;

    const config = await this.getConfig();
    if (!config.github.enabled || config.github.syncMode === 'inbound') return;

    const { issueNumber, repo } = task.github;
    const body = `**[Veritas Kanban]** ${commentText}`;

    try {
      await this.ghExec(['issue', 'comment', String(issueNumber), '--repo', repo, '--body', body]);
      log.info({ issueNumber, taskId: task.id }, 'Posted comment to GitHub issue');
    } catch (err: any) {
      log.error({ err, issueNumber, taskId: task.id }, 'Failed to post comment to GitHub');
      throw err;
    }
  }

  // ── Full bidirectional sync ───────────────────────────────

  /**
   * Run a full sync cycle: inbound then outbound reconciliation.
   */
  async sync(): Promise<SyncResult> {
    const config = await this.getConfig();
    if (!config.github.enabled) {
      return { imported: 0, updated: 0, errors: ['GitHub sync is disabled'], lastSyncAt: '' };
    }

    log.info('Starting full sync cycle');
    const result = await this.syncFromGitHub();
    log.info({ result }, 'Sync cycle complete');
    return result;
  }

  // ── Polling ───────────────────────────────────────────────

  async startPolling(): Promise<void> {
    const config = await this.getConfig();
    if (!config.github.enabled) {
      log.info('GitHub sync is disabled — not starting polling');
      return;
    }

    if (this.pollTimer) {
      log.warn('Polling already running');
      return;
    }

    const interval = config.github.pollIntervalMs;
    log.info({ intervalMs: interval }, 'Starting GitHub sync polling');

    // Initial sync
    try {
      await this.sync();
    } catch (err) {
      log.error({ err }, 'Initial sync failed');
    }

    this.pollTimer = setInterval(async () => {
      try {
        await this.sync();
      } catch (err) {
        log.error({ err }, 'Periodic sync failed');
      }
    }, interval);
  }

  stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
      log.info('Stopped GitHub sync polling');
    }
  }

  // ── Helpers ───────────────────────────────────────────────

  private ghStateToKanbanStatus(ghState: string): TaskStatus {
    switch (ghState.toUpperCase()) {
      case 'CLOSED':
        return 'done';
      case 'OPEN':
      default:
        return 'todo';
    }
  }

  private extractPriority(labels: { name: string }[]): TaskPriority {
    for (const label of labels) {
      const match = label.name.match(/^priority:(.+)$/i);
      if (match) {
        const val = match[1].toLowerCase().trim();
        if (val === 'high' || val === 'medium' || val === 'low') {
          return val;
        }
      }
    }
    return 'medium';
  }

  private extractType(labels: { name: string }[]): string {
    for (const label of labels) {
      const match = label.name.match(/^type:(.+)$/i);
      if (match) {
        return match[1].toLowerCase().trim();
      }
    }
    return 'code';
  }
}

// ─── Singleton ───────────────────────────────────────────────

let instance: GitHubSyncService | null = null;

export function getGitHubSyncService(): GitHubSyncService {
  if (!instance) {
    instance = new GitHubSyncService();
  }
  return instance;
}
