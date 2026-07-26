import fs from 'fs/promises';
import path from 'path';
import { createHash } from 'node:crypto';
import {
  PHASE_AUTHORITY_DIMENSIONS,
  type AdmissionQueueDepth,
  type AdmissionQueueInspectionEntry,
  type ExecutionTreeBreakerEvidence,
  type PhaseCapabilityEvidence,
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
import { getStorage } from '../storage/index.js';
import { getRunPhaseAuthorityService } from './run-phase-authority-service.js';
import { getAdmissionControlService } from './admission-control-service.js';

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
const MAX_PHASE_DIAGNOSTIC_RUNS = 200;
const MAX_ADMISSION_QUEUE_DIAGNOSTICS = 200;

interface PhaseAuthorityDiagnosticExport {
  generatedAt: string;
  status: 'ok' | 'unavailable';
  truncated: boolean;
  records: Array<Record<string, unknown>>;
}

type PhaseAuthorityDiagnosticCollector = () => Promise<PhaseAuthorityDiagnosticExport>;

interface AdmissionQueueDiagnosticExport {
  generatedAt: string;
  status: 'ok' | 'unavailable';
  truncated: boolean;
  depth?: AdmissionQueueDepth;
  entries: AdmissionQueueInspectionEntry[];
  treeControls?: Array<{
    rootObjectiveKey: string;
    state: 'paused' | 'resumed' | 'cancelled';
    trigger: 'operator' | 'fan-out-breaker';
    recordedAt: string;
    resumedAt?: string;
    signals: string[];
    observed?: ExecutionTreeBreakerEvidence['observed'];
    thresholds?: ExecutionTreeBreakerEvidence['thresholds'];
    recoveryGuidance: string[];
  }>;
}

type AdmissionQueueDiagnosticCollector = () => Promise<AdmissionQueueDiagnosticExport>;

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
  constructor(
    private readonly collectPhaseAuthority: PhaseAuthorityDiagnosticCollector = collectPhaseAuthorityDiagnostics,
    private readonly collectAdmissionQueue: AdmissionQueueDiagnosticCollector = collectAdmissionQueueDiagnostics
  ) {}

  async buildSummary(): Promise<MaintenanceSummary> {
    const generatedAt = new Date().toISOString();
    const sqlite = getSqliteStorageDiagnostics();
    const workProducts = await getWorkProductService().maintenancePreview();
    const runOutputArtifacts = await this.collectRunOutputArtifactStats(generatedAt);
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
      {
        id: 'run-output-artifacts',
        label: 'Governed run output artifacts',
        bytes: runOutputArtifacts.bytes,
        itemCount: runOutputArtifacts.itemCount,
        cleanupEligibleCount: runOutputArtifacts.cleanupEligibleCount,
        retainedReason:
          'Active-run leases retain bodies; expired and quarantined metadata remains as causal tombstones.',
        lastUsedAt: runOutputArtifacts.lastUsedAt,
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
          run_output_artifacts: runOutputArtifacts.itemCount,
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
    const phaseAuthority = await this.collectPhaseAuthority();
    const admissionQueue = await this.collectAdmissionQueue();
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
      includedCategories: [
        'health',
        'storage',
        'lifecycle',
        'work-products',
        'phase-authority',
        'admission-queue',
        'redacted-log-tails',
      ],
      excludedCategories: [
        'raw tokens',
        'token hashes',
        'cookies',
        'private keys',
        'raw prompts',
        'raw chat content',
        'generated sensitive text',
        'raw run output artifact bodies',
      ],
      redactionRules: [
        'Bearer tokens, API keys, JWTs, opaque tokens, and long hashes are replaced.',
        'Local home, project, storage, runtime, and log paths are replaced with redacted path labels.',
        'Log files are included as redacted tails only, capped at 200 lines per source.',
        'Admission queue diagnostics use the bounded inspection projection and never include durable replay targets.',
        'Run output artifact bodies are excluded; lifecycle summaries contain metadata and policy only.',
      ],
      files: summary.logs.map((source) => this.redactLogSource(source)),
    };

    await fs.writeFile(
      path.join(bundleDir, 'summary.json'),
      JSON.stringify(this.redactMaintenanceValue(summary), null, 2),
      'utf-8'
    );
    await fs.writeFile(
      path.join(bundleDir, 'phase-authority.json'),
      JSON.stringify(this.redactMaintenanceValue(phaseAuthority), null, 2),
      'utf-8'
    );
    await fs.writeFile(
      path.join(bundleDir, 'admission-queue.json'),
      JSON.stringify(this.redactMaintenanceValue(admissionQueue), null, 2),
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

  private async collectRunOutputArtifactStats(now: string): Promise<{
    bytes: number;
    itemCount: number;
    cleanupEligibleCount: number;
    lastUsedAt?: string;
  }> {
    try {
      const artifacts = await getStorage().runOutputArtifacts.list({
        workspaceId: 'local',
        limit: 2_000,
      });
      const current = Date.parse(now);
      const available = artifacts.filter((artifact) => artifact.state === 'available');
      return {
        bytes: available.reduce((total, artifact) => total + artifact.storedBytes, 0),
        itemCount: artifacts.length,
        cleanupEligibleCount: available.filter(
          (artifact) =>
            Date.parse(artifact.retention.expiresAt) <= current &&
            (!artifact.retention.activeLeaseUntil ||
              Date.parse(artifact.retention.activeLeaseUntil) <= current)
        ).length,
        lastUsedAt: this.latestDate(
          artifacts.map((artifact) => artifact.redaction.validatedAt)
        ),
      };
    } catch {
      return { bytes: 0, itemCount: 0, cleanupEligibleCount: 0 };
    }
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

async function collectAdmissionQueueDiagnostics(): Promise<AdmissionQueueDiagnosticExport> {
  try {
    const admission = getAdmissionControlService();
    const [queue, reservations] = await Promise.all([
      admission.inspectQueue({
        limit: MAX_ADMISSION_QUEUE_DIAGNOSTICS,
      }),
      admission.list({ limit: 10_000 }),
    ]);
    const controls = reservations
      .filter(
        (reservation) =>
          reservation.request.executionTree?.edge === 'root' && reservation.executionTreeControl
      )
      .flatMap((reservation) => {
        const control = reservation.executionTreeControl;
        if (!control) return [];
        return {
          rootObjectiveKey: `sha256:${createHash('sha256')
            .update(control.rootObjectiveId)
            .digest('hex')}`,
          state: control.state,
          trigger: control.trigger,
          recordedAt: control.recordedAt,
          ...(control.resumedAt ? { resumedAt: control.resumedAt } : {}),
          signals: control.evidence?.signals ?? [],
          ...(control.evidence ? { observed: control.evidence.observed } : {}),
          ...(control.evidence ? { thresholds: control.evidence.thresholds } : {}),
          recoveryGuidance: control.evidence?.recoveryGuidance ?? [],
        };
      });
    return {
      generatedAt: queue.generatedAt,
      status: 'ok',
      truncated:
        queue.pagination.hasMore ||
        queue.pagination.snapshotTruncated ||
        controls.length > MAX_ADMISSION_QUEUE_DIAGNOSTICS,
      depth: queue.depth,
      entries: queue.entries,
      treeControls: controls.slice(0, MAX_ADMISSION_QUEUE_DIAGNOSTICS),
    };
  } catch {
    return {
      generatedAt: new Date().toISOString(),
      status: 'unavailable',
      truncated: false,
      entries: [],
    };
  }
}

async function collectPhaseAuthorityDiagnostics(): Promise<PhaseAuthorityDiagnosticExport> {
  const generatedAt = new Date().toISOString();
  let tasks;
  try {
    tasks = await getStorage().tasks.findAll();
  } catch {
    return { generatedAt, status: 'unavailable', truncated: false, records: [] };
  }

  const candidates = tasks.flatMap((task) => {
    const attempts = [...(task.attempts ?? []), ...(task.attempt ? [task.attempt] : [])];
    const unique = new Map(attempts.map((attempt) => [attempt.id, attempt]));
    return [...unique.values()]
      .filter((attempt) => attempt.runLaunchManifest?.phase)
      .map((attempt) => ({ task, attempt }));
  });
  const selected = candidates.slice(0, MAX_PHASE_DIAGNOSTIC_RUNS);
  const phaseAuthority = getRunPhaseAuthorityService();
  const records = await Promise.all(
    selected.map(async ({ task, attempt }) => {
      try {
        const snapshot = await phaseAuthority.get('local', task.id, attempt.id, 100);
        if (!snapshot) return { taskId: task.id, attemptId: attempt.id, status: 'legacy' };
        return {
          taskId: task.id,
          attemptId: attempt.id,
          provider: attempt.provider,
          status: 'available',
          launch: phaseEvidenceDiagnostic(snapshot.launch.evidence),
          effective: phaseEvidenceDiagnostic(snapshot.effectiveEvidence),
          transitionSequence: snapshot.transitionSequence,
          sources: snapshot.launch.sourceReferences.map((source) => ({
            kind: source.kind,
            originScope: source.originScope,
            digest: digestFingerprint(source.sourceDigest),
          })),
          authorityExpansions: snapshot.history
            .filter((transition) =>
              transition.authorityDelta.entries.some((entry) => entry.addedScopes.length > 0)
            )
            .map((transition) => ({
              sequence: transition.sequence,
              policyDecision: transition.policyDecision,
              dimensions: transition.authorityDelta.entries
                .filter((entry) => entry.addedScopes.length > 0)
                .map((entry) => ({
                  dimension: entry.dimension,
                  addedScopeCount: entry.addedScopes.length,
                })),
              ...(transition.emergencyOverride
                ? { overrideExpiresAt: transition.emergencyOverride.expiresAt }
                : {}),
            })),
          ...(attempt.completionResult?.phase
            ? {
                completion: {
                  launchEvidenceDigest: digestFingerprint(
                    attempt.completionResult.phase.launchEvidenceDigest
                  ),
                  effective: phaseEvidenceDiagnostic(
                    attempt.completionResult.phase.effectiveEvidence
                  ),
                  transitionSequence: attempt.completionResult.phase.transitionSequence,
                  authorityExpansionCount:
                    attempt.completionResult.phase.authorityExpansions.length,
                },
              }
            : {}),
        };
      } catch {
        return { taskId: task.id, attemptId: attempt.id, status: 'unavailable' };
      }
    })
  );
  return {
    generatedAt,
    status: 'ok',
    truncated: candidates.length > selected.length,
    records,
  };
}

function phaseEvidenceDiagnostic(evidence: PhaseCapabilityEvidence) {
  return {
    identity: evidence.identity,
    status: evidence.status,
    digest: digestFingerprint(evidence.digest),
    authority: Object.fromEntries(
      PHASE_AUTHORITY_DIMENSIONS.map((dimension) => [
        dimension,
        {
          scopeCount: evidence.effectiveAuthority[dimension].length,
          wildcard: evidence.effectiveAuthority[dimension].includes('*'),
        },
      ])
    ),
    blockers: evidence.blockers.map((blocker) => ({
      code: blocker.code,
      dimension: blocker.dimension,
    })),
  };
}

function digestFingerprint(digest: string): string {
  return digest.slice(0, 19);
}

let singleton: MaintenanceService | null = null;

export function getMaintenanceService(): MaintenanceService {
  singleton ??= new MaintenanceService();
  return singleton;
}
