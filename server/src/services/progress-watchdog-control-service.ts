import type {
  ProgressWatchdogFinding,
  ProgressWatchdogInspection,
  ProgressWatchdogOverrideRecord,
  ProgressWatchdogOverrideResolution,
} from '@veritas-kanban/shared';
import { PROGRESS_WATCHDOG_OVERRIDE_SCHEMA_VERSION } from '@veritas-kanban/shared';
import { ConflictError, NotFoundError, ValidationError } from '../middleware/error-handler.js';
import {
  ProgressWatchdogActionOutcomeSchema,
  ProgressWatchdogFindingSchema,
  ProgressWatchdogOverrideRecordSchema,
} from '../schemas/progress-watchdog-schemas.js';
import { sanitizeProviderRuntimeDiagnostic } from '../utils/provider-runtime-manifest-sanitize.js';
import {
  getRunEventJournalService,
  type RunEventJournalService,
} from './run-event-journal-service.js';
import type { AgentStopOptions } from './clawdbot-agent-service.js';

const PAGE_SIZE = 500;

export interface ProgressWatchdogOverrideAgentControl {
  resumeConversation(
    taskId: string,
    sourceAttemptId: string,
    message: string,
    options?: {
      overrideReason?: string;
      admissionIdempotencyKey?: string;
    }
  ): Promise<{ attemptId: string }>;
  stopAgent(taskId: string, expectedAttemptId: string, options?: AgentStopOptions): Promise<void>;
}

export interface ProgressWatchdogOverrideInput {
  taskId: string;
  attemptId: string;
  findingId: string;
  resolution: ProgressWatchdogOverrideResolution;
  reason: string;
  actor: string;
}

export class ProgressWatchdogControlService {
  constructor(
    private readonly journal: RunEventJournalService = getRunEventJournalService(),
    private readonly agents?: ProgressWatchdogOverrideAgentControl,
    private readonly now: () => Date = () => new Date()
  ) {}

  async inspect(taskId: string, attemptId: string): Promise<ProgressWatchdogInspection> {
    const findings: ProgressWatchdogInspection['findings'] = [];
    const actions: ProgressWatchdogInspection['actions'] = [];
    const overrides: ProgressWatchdogInspection['overrides'] = [];
    let cursor = 0;
    for (;;) {
      const page = await this.journal.list({
        taskId,
        attemptId,
        afterSequence: cursor,
        limit: PAGE_SIZE,
      });
      for (const event of page.events) {
        if (event.kind === 'progress.watchdog.finding') {
          const parsed = ProgressWatchdogFindingSchema.safeParse(event.payload);
          if (parsed.success) findings.push(parsed.data);
        } else if (event.kind === 'progress.watchdog.action') {
          const parsed = ProgressWatchdogActionOutcomeSchema.safeParse(event.payload);
          if (parsed.success) actions.push(parsed.data);
        } else if (event.kind.startsWith('progress.watchdog.override.')) {
          const parsed = ProgressWatchdogOverrideRecordSchema.safeParse(event.payload);
          if (parsed.success) overrides.push(parsed.data);
        }
      }
      cursor = page.nextCursor;
      if (!page.hasMore) break;
    }
    return { taskId, attemptId, findings, actions, overrides };
  }

  async override(input: ProgressWatchdogOverrideInput): Promise<ProgressWatchdogOverrideRecord> {
    const inspection = await this.inspect(input.taskId, input.attemptId);
    const finding = inspection.findings.find((candidate) => candidate.id === input.findingId);
    if (!finding) {
      throw new NotFoundError(`Progress watchdog finding "${input.findingId}" was not found.`);
    }
    this.assertOverrideable(finding, inspection);

    const prior = inspection.overrides.filter((record) => record.findingId === finding.id);
    const completed = prior.find((record) => record.status === 'completed');
    if (completed) {
      if (completed.resolution !== input.resolution) {
        throw new ConflictError('Progress watchdog finding already has a different resolution.', {
          findingId: finding.id,
          existingResolution: completed.resolution,
          requestedResolution: input.resolution,
        });
      }
      return completed;
    }
    const different = prior.find((record) => record.resolution !== input.resolution);
    if (different) {
      throw new ConflictError(
        'Progress watchdog override resolution changed after it was recorded.',
        {
          findingId: finding.id,
          existingResolution: different.resolution,
          requestedResolution: input.resolution,
        }
      );
    }

    const requestedAt = this.now().toISOString();
    const reason = boundedDiagnostic(input.reason);
    const actor = boundedActor(input.actor);
    const requested = ProgressWatchdogOverrideRecordSchema.parse({
      schemaVersion: PROGRESS_WATCHDOG_OVERRIDE_SCHEMA_VERSION,
      findingId: finding.id,
      taskId: input.taskId,
      attemptId: input.attemptId,
      resolution: input.resolution,
      status: 'requested',
      actor,
      reason,
      requestedAt,
    });
    await this.appendOverride(requested, 'requested', finding);

    try {
      const launchedAttemptId = await this.executeOverride(requested, finding);
      const completedRecord = ProgressWatchdogOverrideRecordSchema.parse({
        ...requested,
        status: 'completed',
        completedAt: this.now().toISOString(),
        ...(launchedAttemptId ? { launchedAttemptId } : {}),
      });
      await this.appendOverride(completedRecord, 'completed', finding);
      return completedRecord;
    } catch (error) {
      const failed = ProgressWatchdogOverrideRecordSchema.parse({
        ...requested,
        status: 'failed',
        completedAt: this.now().toISOString(),
        diagnostic: boundedDiagnostic(
          error instanceof Error ? error.message : 'Watchdog override execution failed.'
        ),
      });
      await this.appendOverride(failed, 'failed', finding);
      throw error;
    }
  }

  private assertOverrideable(
    finding: ProgressWatchdogFinding,
    inspection: ProgressWatchdogInspection
  ): void {
    const action = [...inspection.actions]
      .reverse()
      .find((candidate) => candidate.findingId === finding.id);
    if (
      finding.action === 'warn' ||
      (finding.action !== 'pause' &&
        action?.status !== 'operator-required' &&
        action?.status !== 'failed')
    ) {
      throw new ValidationError(
        'Only paused or operator-required watchdog decisions can be overridden.'
      );
    }
  }

  private async executeOverride(
    record: ProgressWatchdogOverrideRecord,
    finding: ProgressWatchdogFinding
  ): Promise<string | undefined> {
    if (record.resolution === 'acknowledge') return undefined;
    if (!this.agents) {
      throw new ConflictError('Agent run control is unavailable for this watchdog override.');
    }
    if (record.resolution === 'cancel') {
      await this.agents.stopAgent(record.taskId, record.attemptId, {
        actor: 'operator',
        source: 'progress-watchdog-override',
        reason: `Cancelled by ${record.actor} after watchdog finding ${finding.id}.`,
        terminalSource: 'operator-interruption',
      });
      return undefined;
    }
    const launched = await this.agents.resumeConversation(
      record.taskId,
      record.attemptId,
      [
        `Operator ${record.actor} approved continuation after progress watchdog finding ${finding.id}.`,
        'Use a materially different approach grounded in fresh observable evidence.',
      ].join(' '),
      {
        overrideReason: record.reason,
        admissionIdempotencyKey: `progress-watchdog-override:${finding.id}`,
      }
    );
    return launched.attemptId;
  }

  private async appendOverride(
    record: ProgressWatchdogOverrideRecord,
    phase: ProgressWatchdogOverrideRecord['status'],
    finding: ProgressWatchdogFinding
  ): Promise<void> {
    await this.journal.append({
      taskId: record.taskId,
      attemptId: record.attemptId,
      causalEventId: finding.evidenceEventIds.at(-1),
      kind: `progress.watchdog.override.${phase}`,
      source: { provider: 'operator', adapter: 'progress-watchdog-override' },
      payload: { ...record },
      dedupeKey: `progress-watchdog:override:${record.findingId}:${phase}`,
    });
  }
}

function boundedActor(value: string): string {
  return (value.trim() || 'operator').slice(0, 160);
}

function boundedDiagnostic(value: string): string {
  return sanitizeProviderRuntimeDiagnostic(value.trim()).slice(0, 1_000);
}
