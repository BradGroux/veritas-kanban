import fs from 'fs/promises';
import path from 'path';
import {
  type MaintenanceCleanupPreviewItem,
  type MaintenanceDebugBundle,
  type MaintenanceHealthCheck,
  type MaintenanceLogSource,
  type MaintenanceLogTail,
  type MaintenanceStorageCategory,
  type MaintenanceSummary,
} from '@veritas-kanban/shared';
import { getWorkProductService } from './work-product-service.js';
import { getSystemHealthService } from './system-health-service.js';
import { buildDataLifecycleManifest } from './data-lifecycle-policy.js';
import {
  getLogsDir,
  getRuntimeDir,
  getStorageRoot,
  getTasksActiveDir,
  getTasksArchiveDir,
  getTasksAttachmentsDir,
  getTasksBacklogDir,
  getTelemetryDir,
  getWorkflowRunsDir,
  getWorktreesDir,
} from '../utils/paths.js';
import { redactString } from '../lib/redact.js';
import { getSqliteStorageDiagnostics } from '../storage/sqlite/database.js';

interface DirectoryStats {
  bytes: number;
  itemCount: number;
  updatedAt?: string;
}

interface LogSourceDefinition {
  id: string;
  label: string;
  path: string;
}

const MAX_TAIL_LINES = 500;

const MAINTENANCE_CONTENT_REDACTIONS: [RegExp, string][] = [
  [
    /\b((?:system|user|assistant)\s+prompt|prompt)\s*[:=]\s*("[^"]*"|'[^']*'|[^\r\n]+)/gi,
    '$1: [redacted-prompt]',
  ],
  [
    /\b(raw\s+chat|chat\s+message|user\s+message|assistant\s+message)\s*[:=]\s*("[^"]*"|'[^']*'|[^\r\n]+)/gi,
    '$1: [redacted-chat-content]',
  ],
  [
    /\b(stdout|stderr|process\s+output|child\s+output)\s*[:=]\s*("[^"]*"|'[^']*'|[^\r\n]+)/gi,
    '$1: [redacted-process-output]',
  ],
  [
    /\b(model\s+output|assistant\s+output|generated(?:\s+sensitive)?\s+text)\s*[:=]\s*("[^"]*"|'[^']*'|[^\r\n]+)/gi,
    '$1: [redacted-generated-text]',
  ],
];

export class MaintenanceService {
  async buildSummary(): Promise<MaintenanceSummary> {
    const generatedAt = new Date().toISOString();
    const sqlite = getSqliteStorageDiagnostics();
    const workProducts = await getWorkProductService().maintenancePreview();
    const [
      storageRoot,
      runtimeDir,
      activeTasks,
      archivedTasks,
      backlogTasks,
      attachments,
      telemetry,
      workflowRuns,
      worktrees,
      logs,
      debugBundles,
    ] = await Promise.all([
      this.collectDirectoryStats(getStorageRoot()),
      this.collectDirectoryStats(getRuntimeDir()),
      this.collectDirectoryStats(getTasksActiveDir()),
      this.collectDirectoryStats(getTasksArchiveDir()),
      this.collectDirectoryStats(getTasksBacklogDir()),
      this.collectDirectoryStats(getTasksAttachmentsDir()),
      this.collectDirectoryStats(getTelemetryDir()),
      this.collectDirectoryStats(getWorkflowRunsDir()),
      this.collectDirectoryStats(getWorktreesDir()),
      this.collectDirectoryStats(getLogsDir()),
      this.collectDirectoryStats(this.debugBundlesDir()),
    ]);
    const rawLogSources = await this.listLogSources();

    const storageCategories: MaintenanceStorageCategory[] = [
      this.storageCategory('storage-root', 'Storage root', storageRoot, 0, 'Canonical data root.'),
      this.storageCategory(
        'runtime-state',
        'Runtime state',
        runtimeDir,
        0,
        'Settings, logs, traces, workflows, and local runtime data.'
      ),
      this.storageCategory(
        'active-tasks',
        'Active task files',
        activeTasks,
        0,
        'Active work is retained.'
      ),
      this.storageCategory(
        'archived-tasks',
        'Archived task files',
        archivedTasks,
        archivedTasks.itemCount,
        'Archived work requires explicit cleanup confirmation.'
      ),
      this.storageCategory(
        'backlog-tasks',
        'Backlog task files',
        backlogTasks,
        0,
        'Backlog work is retained until promoted, archived, or deleted.'
      ),
      this.storageCategory(
        'attachments',
        'Attachment files',
        attachments,
        0,
        'Attachment cleanup requires parent task and orphan previews.'
      ),
      this.storageCategory(
        'telemetry',
        'Telemetry and traces',
        telemetry,
        telemetry.itemCount,
        'Telemetry retention follows Data settings and requires range preview.'
      ),
      this.storageCategory(
        'workflow-runs',
        'Workflow run state',
        workflowRuns,
        0,
        'Current run state is retained.'
      ),
      this.storageCategory(
        'worktrees',
        'Agent worktrees',
        worktrees,
        0,
        'Active worktrees are never deleted silently.'
      ),
      this.storageCategory(
        'logs',
        'Logs',
        logs,
        logs.itemCount,
        'Logs are redacted before support bundle inclusion.'
      ),
      this.storageCategory(
        'debug-bundles',
        'Debug bundles',
        debugBundles,
        debugBundles.itemCount,
        'Generated support bundles are removed only by explicit filesystem cleanup.'
      ),
      {
        id: 'work-products',
        label: 'Work products and versions',
        bytes: workProducts.totals.estimatedBytes,
        itemCount: workProducts.totals.products,
        cleanupEligibleCount: workProducts.totals.cleanupCandidates,
        retainedReason:
          'Archived generated outputs are cleanup candidates; active products are retained.',
        lastUsedAt: this.latestDate(
          [...workProducts.cleanupCandidates, ...workProducts.retained].map(
            (item) => item.updatedAt
          )
        ),
      },
    ];

    return {
      generatedAt,
      mode: process.env.VERITAS_REMOTE_MODE === 'true' ? 'remote' : 'local',
      storageMode: process.env.VERITAS_STORAGE ?? 'file',
      ...(sqlite ? { sqlite } : {}),
      health: await this.buildHealthChecks(generatedAt),
      storage: {
        totalBytes: storageRoot.bytes,
        categories: storageCategories,
      },
      logs: rawLogSources.map((source) => this.redactLogSource(source)),
      lifecycle: buildDataLifecycleManifest({
        tableCounts: {
          work_products: workProducts.totals.products,
          work_product_versions: workProducts.totals.versions,
        },
      }),
      cleanupPreview: {
        items: this.buildCleanupPreview(storageCategories, workProducts),
        destructiveActionsEnabled: false,
        confirmationRequired: true,
        notes: [
          'Preview only. This endpoint never deletes active task worktrees or current run state.',
          'Cleanup handlers must require explicit confirmation before deleting retained data.',
          'Support bundles redact secrets, private paths, prompts, logs, and generated sensitive text by default.',
        ],
      },
      workProducts,
    };
  }

  async tailLog(sourceId: string, tail = 200): Promise<MaintenanceLogTail> {
    const sources = await this.listLogSources();
    const source = sources.find((candidate) => candidate.id === sourceId);
    if (!source) {
      throw new Error(`Unknown maintenance log source: ${sourceId}`);
    }

    if (!source.exists) {
      return { source: this.redactLogSource(source), lines: [], truncated: false, redacted: true };
    }

    const maxLines = Math.min(Math.max(Math.floor(tail), 1), MAX_TAIL_LINES);
    const content = await fs.readFile(source.path, 'utf-8').catch(() => '');
    const lines = content.split(/\r?\n/);
    const selected = lines.slice(-maxLines).map((line) => this.redactMaintenanceText(line));
    return {
      source: this.redactLogSource(source),
      lines: selected,
      truncated: lines.length > selected.length,
      redacted: true,
    };
  }

  async createDebugBundle(): Promise<MaintenanceDebugBundle> {
    const createdAt = new Date().toISOString();
    const id = `debug-bundle-${createdAt.replace(/[:.]/g, '-')}`;
    const bundleDir = path.join(this.debugBundlesDir(), id);
    await fs.mkdir(bundleDir, { recursive: true });
    await fs.mkdir(path.join(bundleDir, 'logs'), { recursive: true });

    const summary = await this.buildSummary();
    const logTails: MaintenanceLogTail[] = [];
    for (const source of summary.logs.filter((entry) => entry.exists)) {
      const tail = await this.tailLog(source.id, 200);
      logTails.push(tail);
      await fs.writeFile(
        path.join(bundleDir, 'logs', `${source.id}.log`),
        tail.lines.join('\n'),
        'utf-8'
      );
    }

    const manifest: MaintenanceDebugBundle['manifest'] = {
      includedCategories: ['health', 'storage', 'lifecycle', 'work-products', 'redacted-log-tails'],
      excludedCategories: [
        'raw tokens',
        'token hashes',
        'cookies',
        'private keys',
        'raw prompts',
        'raw chat content',
        'generated sensitive text',
      ],
      redactionRules: [
        'Bearer tokens, API keys, JWTs, opaque tokens, and long hashes are replaced.',
        'Local home, project, storage, runtime, and log paths are replaced with redacted path labels.',
        'Log files are included as redacted tails only, capped at 200 lines per source.',
      ],
      files: summary.logs.map((source) => this.redactLogSource(source)),
    };

    await fs.writeFile(
      path.join(bundleDir, 'summary.json'),
      JSON.stringify(this.redactMaintenanceValue(summary), null, 2),
      'utf-8'
    );
    await fs.writeFile(
      path.join(bundleDir, 'manifest.json'),
      JSON.stringify(manifest, null, 2),
      'utf-8'
    );

    return {
      id,
      createdAt,
      outputPath: bundleDir,
      redacted: true,
      manifest,
    };
  }

  async listLogSources(): Promise<MaintenanceLogSource[]> {
    const definitions = await this.logSourceDefinitions();
    return Promise.all(
      definitions.map(async (definition) => {
        const stat = await fs.stat(definition.path).catch(() => null);
        return {
          id: definition.id,
          label: definition.label,
          path: definition.path,
          exists: Boolean(stat?.isFile()),
          sizeBytes: stat?.isFile() ? stat.size : 0,
          updatedAt: stat?.isFile() ? stat.mtime.toISOString() : undefined,
          redacted: true,
        };
      })
    );
  }

  private async buildHealthChecks(checkedAt: string): Promise<MaintenanceHealthCheck[]> {
    const [storageWritable, diskState, logsState, workProductsState] = await Promise.all([
      this.checkStorageWritable(),
      this.checkDisk(),
      this.checkPathExists(getLogsDir()),
      getWorkProductService()
        .maintenancePreview()
        .then(() => true)
        .catch(() => false),
    ]);
    const systemHealth = await getSystemHealthService()
      .getStatus()
      .catch(() => null);
    const agentState = this.signalState(systemHealth?.signals.agents.status);
    const operationsState = this.signalState(systemHealth?.signals.operations.status);
    const sqlite = getSqliteStorageDiagnostics();
    const sqliteEnabled = process.env.VERITAS_STORAGE === 'sqlite';

    return [
      {
        id: 'storage',
        label: 'Storage',
        state: storageWritable ? 'ok' : 'fail',
        detail: storageWritable
          ? 'Runtime storage is readable and writable.'
          : 'Storage write check failed.',
        checkedAt,
      },
      {
        id: 'disk',
        label: 'Disk',
        state: diskState,
        detail:
          diskState === 'ok'
            ? 'Free disk space is above the maintenance threshold.'
            : 'Free disk space is below the maintenance threshold or unavailable.',
        checkedAt,
      },
      {
        id: 'logs',
        label: 'Logs',
        state: logsState ? 'ok' : 'warn',
        detail: logsState ? 'Log directory is available.' : 'No log directory found yet.',
        checkedAt,
      },
      {
        id: 'work-products',
        label: 'Work products',
        state: workProductsState ? 'ok' : 'warn',
        detail: workProductsState
          ? 'Work product maintenance preview is available.'
          : 'Work product maintenance preview could not be generated.',
        checkedAt,
      },
      {
        id: 'agent-runner',
        label: 'Agent runner',
        state: agentState,
        detail: systemHealth
          ? `${systemHealth.signals.agents.online}/${systemHealth.signals.agents.total} registered agents online.`
          : 'Agent runner status is unavailable.',
        checkedAt,
      },
      {
        id: 'recent-runs',
        label: 'Recent runs',
        state: operationsState,
        detail: systemHealth
          ? `${systemHealth.signals.operations.successRate}% success across ${systemHealth.signals.operations.recentRuns} recent runs.`
          : 'Recent run status is unavailable.',
        checkedAt,
      },
      {
        id: 'lifecycle-policy',
        label: 'Lifecycle policy',
        state: 'ok',
        detail: 'Data lifecycle policy is loaded for cleanup previews.',
        checkedAt,
      },
      ...(sqliteEnabled
        ? [
            {
              id: 'sqlite-posture',
              label: 'SQLite storage posture',
              state:
                sqlite?.healthPosture === 'degraded'
                  ? ('warn' as const)
                  : sqlite?.journalMode === 'memory' && sqlite.healthPosture === 'healthy'
                    ? ('ok' as const)
                    : sqlite?.filesystemPosture === 'supported-local' &&
                        sqlite.journalMode === 'wal' &&
                        sqlite.lastIntegrityCheck?.status === 'ok'
                      ? ('ok' as const)
                      : sqlite
                        ? ('fail' as const)
                        : ('unknown' as const),
              detail: sqlite
                ? `${sqlite.filesystemType} is ${sqlite.filesystemPosture}; journal mode is ${sqlite.journalMode}; locking is ${sqlite.lockingPosture ?? 'unavailable'}; override is ${sqlite.override?.status ?? 'none'}; last quick check is ${sqlite.lastIntegrityCheck?.status ?? 'unavailable'}.`
                : 'SQLite filesystem posture is unavailable.',
              checkedAt,
            },
          ]
        : []),
    ];
  }

  private signalState(status: string | undefined): MaintenanceHealthCheck['state'] {
    if (!status) return 'unknown';
    if (status === 'ok') return 'ok';
    if (status === 'warn') return 'warn';
    return 'fail';
  }

  private async checkStorageWritable(): Promise<boolean> {
    const runtimeDir = getRuntimeDir();
    try {
      await fs.mkdir(runtimeDir, { recursive: true });
      const probe = path.join(runtimeDir, `.maintenance-${Date.now()}.tmp`);
      await fs.writeFile(probe, 'ok', 'utf-8');
      await fs.unlink(probe);
      return true;
    } catch {
      return false;
    }
  }

  private async checkDisk(): Promise<MaintenanceHealthCheck['state']> {
    try {
      const stats = await fs.statfs(getStorageRoot());
      const freeBytes = stats.bfree * stats.bsize;
      return freeBytes > 100 * 1024 * 1024 ? 'ok' : 'warn';
    } catch {
      return 'unknown';
    }
  }

  private async checkPathExists(targetPath: string): Promise<boolean> {
    try {
      await fs.access(targetPath);
      return true;
    } catch {
      return false;
    }
  }

  private buildCleanupPreview(
    categories: MaintenanceStorageCategory[],
    workProducts: MaintenanceSummary['workProducts']
  ): MaintenanceCleanupPreviewItem[] {
    const categoryItems = categories
      .filter((category) => category.cleanupEligibleCount > 0)
      .map((category) => ({
        id: category.id,
        label: category.label,
        category: 'storage',
        cleanupEligible: category.id !== 'worktrees' && category.id !== 'active-tasks',
        affectedCount: category.cleanupEligibleCount,
        estimatedBytes: category.bytes,
        retainedReason: category.retainedReason,
        lastUsedAt: category.lastUsedAt,
      }));

    const productItems = workProducts.cleanupCandidates.slice(0, 20).map((item) => ({
      id: `work-product:${item.id}`,
      label: item.title,
      category: 'work-products',
      cleanupEligible: item.cleanupEligible,
      affectedCount: item.versionCount,
      estimatedBytes: item.estimatedBytes,
      retainedReason: item.retainedReason,
      sourceHref: item.taskId ? `/tasks/${encodeURIComponent(item.taskId)}` : undefined,
      lastUsedAt: item.updatedAt,
    }));

    return [...categoryItems, ...productItems].sort(
      (a, b) => b.estimatedBytes - a.estimatedBytes || a.label.localeCompare(b.label)
    );
  }

  private storageCategory(
    id: string,
    label: string,
    stats: DirectoryStats,
    cleanupEligibleCount: number,
    retainedReason: string
  ): MaintenanceStorageCategory {
    return {
      id,
      label,
      bytes: stats.bytes,
      itemCount: stats.itemCount,
      cleanupEligibleCount,
      retainedReason,
      lastUsedAt: stats.updatedAt,
    };
  }

  private async collectDirectoryStats(dirPath: string): Promise<DirectoryStats> {
    let bytes = 0;
    let itemCount = 0;
    let latestMs = 0;

    const walk = async (current: string): Promise<void> => {
      const entries = await fs.readdir(current, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        const entryPath = path.join(current, entry.name);
        const stat = await fs.stat(entryPath).catch(() => null);
        if (!stat) continue;
        latestMs = Math.max(latestMs, stat.mtimeMs);
        if (entry.isFile()) {
          itemCount += 1;
          bytes += stat.size;
        } else if (entry.isDirectory()) {
          await walk(entryPath);
        }
      }
    };

    await walk(dirPath);
    return {
      bytes,
      itemCount,
      updatedAt: latestMs > 0 ? new Date(latestMs).toISOString() : undefined,
    };
  }

  private async logSourceDefinitions(): Promise<LogSourceDefinition[]> {
    const logsDir = getLogsDir();
    const latestAgentLog = await this.latestLogFile(logsDir, '.md');
    return [
      { id: 'server', label: 'Server log', path: path.join(logsDir, 'server.log') },
      { id: 'web', label: 'Web log', path: path.join(logsDir, 'web.log') },
      {
        id: 'agent-run',
        label: 'Latest agent run log',
        path: latestAgentLog ?? path.join(logsDir, 'agent-run.log'),
      },
    ];
  }

  private async latestLogFile(dirPath: string, extension: string): Promise<string | null> {
    const entries = await fs.readdir(dirPath, { withFileTypes: true }).catch(() => []);
    const files = await Promise.all(
      entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(extension))
        .map(async (entry) => {
          const filePath = path.join(dirPath, entry.name);
          const stat = await fs.stat(filePath).catch(() => null);
          return stat ? { filePath, mtimeMs: stat.mtimeMs } : null;
        })
    );
    return (
      files
        .filter((entry): entry is { filePath: string; mtimeMs: number } => Boolean(entry))
        .sort((a, b) => b.mtimeMs - a.mtimeMs)[0]?.filePath ?? null
    );
  }

  private debugBundlesDir(): string {
    return path.join(getRuntimeDir(), 'debug-bundles');
  }

  private latestDate(values: Array<string | undefined>): string | undefined {
    const latest = values
      .filter((value): value is string => Boolean(value))
      .map((value) => Date.parse(value))
      .filter((value) => Number.isFinite(value))
      .sort((a, b) => b - a)[0];
    return latest ? new Date(latest).toISOString() : undefined;
  }

  private redactLogSource(source: MaintenanceLogSource): MaintenanceLogSource {
    return {
      ...source,
      path: this.redactMaintenanceText(source.path),
      redacted: true,
    };
  }

  private redactMaintenanceValue(value: unknown): unknown {
    if (typeof value === 'string') return this.redactMaintenanceText(value);
    if (Array.isArray(value)) return value.map((entry) => this.redactMaintenanceValue(entry));
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
          key,
          this.redactMaintenanceValue(entry),
        ])
      );
    }
    return value;
  }

  private redactMaintenanceText(value: string): string {
    let redacted = redactString(value);
    for (const [pattern, replacement] of MAINTENANCE_CONTENT_REDACTIONS) {
      redacted = redacted.replace(pattern, replacement);
    }
    const replacements = [
      [getLogsDir(), '[redacted-logs]'],
      [getRuntimeDir(), '[redacted-runtime]'],
      [getStorageRoot(), '[redacted-storage]'],
      [process.env.HOME, '[redacted-home]'],
    ] as const;

    for (const [prefix, label] of replacements) {
      if (prefix) {
        redacted = redacted.split(prefix).join(label);
      }
    }

    return redacted
      .replace(/\/Users\/[^/\s]+\/[^\s)]+/g, '[redacted-local-path]')
      .replace(/[A-Z]:\\Users\\[^\\\s]+\\[^\s)]+/g, '[redacted-local-path]');
  }
}

let singleton: MaintenanceService | null = null;

export function getMaintenanceService(): MaintenanceService {
  singleton ??= new MaintenanceService();
  return singleton;
}
