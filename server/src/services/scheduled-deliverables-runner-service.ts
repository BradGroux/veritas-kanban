import { createLogger } from '../lib/logger.js';
import {
  getScheduledDeliverablesService,
  type Deliverable,
  type DeliverableRun,
} from './scheduled-deliverables-service.js';
import {
  DigestService,
  type AgentOperationsDigest,
  type DigestMarkdownMessage,
} from './digest-service.js';

const log = createLogger('deliverables-runner');
const OPERATIONS_DIGEST_TAG = 'operations-digest';
const DEFAULT_RUNNER_INTERVAL_MS = 60_000;

interface RunnerLogger {
  info: (data: unknown, message?: string) => void;
  warn: (data: unknown, message?: string) => void;
  error: (data: unknown, message?: string) => void;
}

interface ScheduledDeliverablesStore {
  listDue(now?: Date): Promise<Deliverable[]>;
  recordRun(params: {
    deliverableId: string;
    status: DeliverableRun['status'];
    outputFile?: string;
    summary?: string;
    durationMs?: number;
    error?: string;
    sourceRunId?: string;
    workflowId?: string;
    snapshotMetadata?: Record<string, string | number | boolean | null>;
  }): Promise<DeliverableRun>;
}

interface OperationsDigestService {
  generateOperationsDigest(): Promise<AgentOperationsDigest>;
  formatOperationsDigestMarkdown(digest: AgentOperationsDigest): DigestMarkdownMessage;
}

export interface ScheduledDeliverablesRunnerResult {
  checked: number;
  executed: number;
  skipped: number;
  failed: number;
  overlapping: boolean;
}

export interface ScheduledDeliverablesRunnerOptions {
  deliverablesService?: ScheduledDeliverablesStore;
  digestService?: OperationsDigestService;
  logger?: RunnerLogger;
}

export class ScheduledDeliverablesRunner {
  private running = false;
  private readonly deliverablesService: ScheduledDeliverablesStore;
  private readonly digestService: OperationsDigestService;
  private readonly logger: RunnerLogger;

  constructor(options: ScheduledDeliverablesRunnerOptions = {}) {
    this.deliverablesService = options.deliverablesService ?? getScheduledDeliverablesService();
    this.digestService = options.digestService ?? new DigestService();
    this.logger = options.logger ?? log;
  }

  async runDue(now = new Date()): Promise<ScheduledDeliverablesRunnerResult> {
    if (this.running) {
      this.logger.warn({ now: now.toISOString() }, 'Scheduled deliverables runner already active');
      return { checked: 0, executed: 0, skipped: 0, failed: 0, overlapping: true };
    }

    this.running = true;
    const result: ScheduledDeliverablesRunnerResult = {
      checked: 0,
      executed: 0,
      skipped: 0,
      failed: 0,
      overlapping: false,
    };

    try {
      const due = await this.deliverablesService.listDue(now);
      result.checked = due.length;

      for (const deliverable of due) {
        if (deliverable.tags.includes(OPERATIONS_DIGEST_TAG)) {
          const status = await this.runOperationsDigestDeliverable(deliverable);
          result[status] += 1;
        } else {
          await this.recordUnsupportedDeliverable(deliverable);
          result.skipped += 1;
        }
      }

      if (result.checked > 0) {
        this.logger.info(result, 'Scheduled deliverables runner completed due pass');
      }
      return result;
    } finally {
      this.running = false;
    }
  }

  private async runOperationsDigestDeliverable(
    deliverable: Deliverable
  ): Promise<'executed' | 'failed'> {
    const startedAt = Date.now();

    try {
      const digest = await this.digestService.generateOperationsDigest();
      const message = this.digestService.formatOperationsDigestMarkdown(digest);
      await this.deliverablesService.recordRun({
        deliverableId: deliverable.id,
        status: 'success',
        workflowId: OPERATIONS_DIGEST_TAG,
        outputFile: operationsDigestOutputFile(deliverable, digest.generatedAt),
        summary: operationsDigestSummary(digest, message),
        durationMs: Date.now() - startedAt,
        snapshotMetadata: operationsDigestMetadata(digest, message),
      });
      return 'executed';
    } catch (error) {
      const message = errorMessage(error);
      this.logger.error(
        { err: error, deliverableId: deliverable.id },
        'Scheduled operations digest failed'
      );
      await this.deliverablesService.recordRun({
        deliverableId: deliverable.id,
        status: 'failed',
        workflowId: OPERATIONS_DIGEST_TAG,
        summary: 'Operations digest generation failed.',
        durationMs: Date.now() - startedAt,
        error: message,
      });
      return 'failed';
    }
  }

  private async recordUnsupportedDeliverable(deliverable: Deliverable): Promise<void> {
    await this.deliverablesService.recordRun({
      deliverableId: deliverable.id,
      status: 'skipped',
      summary: 'No runner is registered for this scheduled deliverable.',
    });
    this.logger.warn(
      { deliverableId: deliverable.id, tags: deliverable.tags },
      'Skipped scheduled deliverable without a registered runner'
    );
  }
}

let runnerTimer: ReturnType<typeof setInterval> | null = null;
let runnerInstance: ScheduledDeliverablesRunner | null = null;

export function startScheduledDeliverablesRunner(
  options: {
    intervalMs?: number;
    runImmediately?: boolean;
    runner?: ScheduledDeliverablesRunner;
  } = {}
): ScheduledDeliverablesRunner | null {
  if (process.env.VERITAS_SCHEDULED_DELIVERABLES_RUNNER === 'false') {
    log.info('Scheduled deliverables runner disabled by environment');
    return null;
  }
  if (runnerTimer) return runnerInstance;

  const intervalMs =
    options.intervalMs ?? parseRunnerInterval(process.env.SCHEDULED_DELIVERABLES_INTERVAL_MS);
  const runner = options.runner ?? new ScheduledDeliverablesRunner();
  runnerInstance = runner;

  const tick = () => {
    void runner.runDue().catch((error) => {
      log.error({ err: error }, 'Scheduled deliverables runner tick failed');
    });
  };

  if (options.runImmediately ?? true) tick();
  runnerTimer = setInterval(tick, intervalMs);
  runnerTimer.unref?.();
  log.info({ intervalMs }, 'Started scheduled deliverables runner');
  return runner;
}

export function stopScheduledDeliverablesRunner(): void {
  if (!runnerTimer) return;
  clearInterval(runnerTimer);
  runnerTimer = null;
  runnerInstance = null;
  log.info('Stopped scheduled deliverables runner');
}

function parseRunnerInterval(value: string | undefined): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 5_000) return DEFAULT_RUNNER_INTERVAL_MS;
  return parsed;
}

function operationsDigestOutputFile(deliverable: Deliverable, generatedAt: string): string {
  const outputDir = (deliverable.outputPath?.trim() || 'operations/digests').replace(/\/+$/, '');
  return `${outputDir}/operations-digest-${generatedAt.slice(0, 10)}.md`;
}

function operationsDigestSummary(
  digest: AgentOperationsDigest,
  message: DigestMarkdownMessage
): string {
  if (message.isEmpty || !digest.hasActivity) {
    return 'No operations activity found for the scheduled window.';
  }

  return [
    'Operations digest generated',
    `${digest.totals.groups} groups`,
    `${digest.totals.completed} completed`,
    `${digest.totals.failed} failed`,
    `${digest.totals.openApprovals} open approvals`,
  ].join(', ');
}

function operationsDigestMetadata(
  digest: AgentOperationsDigest,
  message: DigestMarkdownMessage
): Record<string, string | number | boolean | null> {
  return {
    generatedAt: digest.generatedAt,
    periodStart: digest.period.start,
    periodEnd: digest.period.end,
    windowHours: digest.period.windowHours,
    hasActivity: digest.hasActivity,
    groups: digest.totals.groups,
    active: digest.totals.active,
    blocked: digest.totals.blocked,
    stuck: digest.totals.stuck,
    completed: digest.totals.completed,
    failed: digest.totals.failed,
    runs: digest.totals.runs,
    openApprovals: digest.totals.openApprovals,
    totalTokens: digest.totals.totalTokens,
    markdownBytes: message.markdown?.length ?? 0,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
