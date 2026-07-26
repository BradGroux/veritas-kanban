import type {
  ProgressWatchdogActionOutcome,
  ProgressWatchdogFinding,
  ProgressWatchdogPolicy,
  ProgressWatchdogRecoveryUsage,
  RunEventEnvelope,
} from '@veritas-kanban/shared';
import { PROGRESS_WATCHDOG_ACTION_SCHEMA_VERSION } from '@veritas-kanban/shared';
import { createLogger } from '../lib/logger.js';
import {
  ProgressWatchdogActionOutcomeSchema,
  ProgressWatchdogFindingSchema,
} from '../schemas/progress-watchdog-schemas.js';
import { sanitizeProviderRuntimeDiagnostic } from '../utils/provider-runtime-manifest-sanitize.js';
import {
  getRunEventJournalService,
  type RunEventJournalService,
} from './run-event-journal-service.js';
import {
  DEFAULT_PROGRESS_WATCHDOG_POLICY,
  ProgressWatchdogService,
} from './progress-watchdog-service.js';

const FINDING_EVENT_KIND = 'progress.watchdog.finding';
const ACTION_EVENT_KIND = 'progress.watchdog.action';
const MAX_ATTEMPT_BUFFER_EVENTS = 500;
const MAX_ACTION_DIAGNOSTIC_LENGTH = 1_000;
const log = createLogger('progress-watchdog-coordinator-service');

export interface ProgressWatchdogActionExecutor {
  execute(finding: ProgressWatchdogFinding): Promise<{
    status: ProgressWatchdogActionOutcome['status'];
    diagnostic: string;
  }>;
}

export interface ProgressWatchdogCoordinatorOptions {
  journal?: RunEventJournalService;
  evaluator?: ProgressWatchdogService;
  policy?: ProgressWatchdogPolicy;
  executor?: ProgressWatchdogActionExecutor;
  onError?: (error: unknown, event: RunEventEnvelope) => void;
  now?: () => Date;
}

interface RecordedAction {
  action: ProgressWatchdogFinding['action'];
  status: ProgressWatchdogActionOutcome['status'];
  turnId?: string;
}

interface AttemptState {
  events: RunEventEnvelope[];
  actions: RecordedAction[];
}

export class ProgressWatchdogCoordinatorService {
  private readonly journal: RunEventJournalService;
  private readonly evaluator: ProgressWatchdogService;
  private readonly policy: ProgressWatchdogPolicy;
  private readonly executor?: ProgressWatchdogActionExecutor;
  private readonly onError: (error: unknown, event: RunEventEnvelope) => void;
  private readonly now: () => Date;
  private readonly attempts = new Map<string, Promise<AttemptState>>();
  private readonly queues = new Map<string, Promise<void>>();
  private started = false;

  private readonly listener = (event: RunEventEnvelope): void => {
    if (isWatchdogInternalEvent(event)) return;
    this.enqueue(event);
  };

  constructor(options: ProgressWatchdogCoordinatorOptions = {}) {
    this.journal = options.journal ?? getRunEventJournalService();
    this.evaluator = options.evaluator ?? new ProgressWatchdogService();
    this.policy = options.policy ?? DEFAULT_PROGRESS_WATCHDOG_POLICY;
    this.executor = options.executor;
    this.onError =
      options.onError ??
      ((error, event) => {
        log.warn(
          { err: error, taskId: event.taskId, attemptId: event.attemptId, eventId: event.eventId },
          'Progress watchdog evaluation failed after durable run event'
        );
      });
    this.now = options.now ?? (() => new Date());
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.journal.onEvent(this.listener);
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    this.journal.offEvent(this.listener);
  }

  async flush(): Promise<void> {
    for (;;) {
      const pending = [...this.queues.values()];
      if (pending.length === 0) return;
      await Promise.all(pending);
      if (pending.every((entry) => ![...this.queues.values()].includes(entry))) continue;
      return;
    }
  }

  private enqueue(event: RunEventEnvelope): void {
    const key = attemptKey(event);
    const previous = this.queues.get(key) ?? Promise.resolve();
    const next = previous
      .then(() => this.evaluateEvent(event))
      .catch((error) => this.onError(error, event))
      .finally(() => {
        if (this.queues.get(key) === next) this.queues.delete(key);
      });
    this.queues.set(key, next);
  }

  private async evaluateEvent(event: RunEventEnvelope): Promise<void> {
    const state = await this.stateFor(event);
    if (!state.events.some((candidate) => candidate.eventId === event.eventId)) {
      state.events.push(event);
      state.events.sort(
        (left, right) => left.sequence - right.sequence || left.eventId.localeCompare(right.eventId)
      );
      state.events = state.events.slice(-MAX_ATTEMPT_BUFFER_EVENTS);
    }

    const evaluatedAt = state.events.at(-1)?.receivedAt ?? event.receivedAt;
    const initial = this.evaluator.evaluate({
      events: state.events,
      policy: this.policy,
      recoveryUsage: recoveryUsage(state.actions, event.turnId),
      evaluatedAt,
    });

    for (const detector of initial.findings.map((finding) => finding.detector)) {
      const finding = this.evaluator
        .evaluate({
          events: state.events,
          policy: this.policy,
          recoveryUsage: recoveryUsage(state.actions, event.turnId),
          evaluatedAt,
        })
        .findings.find((candidate) => candidate.detector === detector);
      if (!finding) continue;
      await this.recordFinding(finding, state);
    }
  }

  private async recordFinding(
    finding: ProgressWatchdogFinding,
    state: AttemptState
  ): Promise<void> {
    const persistedFinding = ProgressWatchdogFindingSchema.parse(finding);
    const recorded = await this.journal.append({
      taskId: finding.taskId,
      attemptId: finding.attemptId,
      turnId: finding.turnId,
      causalEventId: finding.evidenceEventIds.at(-1),
      kind: FINDING_EVENT_KIND,
      source: { provider: 'system', adapter: 'progress-watchdog' },
      payload: { ...persistedFinding },
      dedupeKey: `progress-watchdog:finding:${finding.id}`,
    });
    if (!recorded.appended) return;

    const outcome = ProgressWatchdogActionOutcomeSchema.parse(await this.execute(finding));
    await this.journal.append({
      taskId: finding.taskId,
      attemptId: finding.attemptId,
      turnId: finding.turnId,
      causalEventId: recorded.event.eventId,
      kind: ACTION_EVENT_KIND,
      source: { provider: 'system', adapter: 'progress-watchdog' },
      payload: { ...outcome },
      dedupeKey: `progress-watchdog:action:${finding.id}`,
    });
    state.actions.push({
      action: outcome.action,
      status: outcome.status,
      turnId: outcome.turnId,
    });
  }

  private async execute(finding: ProgressWatchdogFinding): Promise<ProgressWatchdogActionOutcome> {
    let result: Awaited<ReturnType<ProgressWatchdogActionExecutor['execute']>>;
    if (finding.action === 'warn') {
      result = {
        status: 'executed',
        diagnostic: 'Warning recorded for operator inspection.',
      };
    } else if (!this.executor) {
      result = {
        status: 'operator-required',
        diagnostic: `No automatic executor is registered for ${finding.action}.`,
      };
    } else {
      try {
        result = await this.executor.execute(finding);
      } catch (error) {
        result = {
          status: 'failed',
          diagnostic:
            error instanceof Error ? error.message : 'Progress watchdog action execution failed.',
        };
      }
    }
    return {
      schemaVersion: PROGRESS_WATCHDOG_ACTION_SCHEMA_VERSION,
      findingId: finding.id,
      taskId: finding.taskId,
      attemptId: finding.attemptId,
      turnId: finding.turnId,
      action: finding.action,
      status: result.status,
      diagnostic: boundedDiagnostic(result.diagnostic),
      recordedAt: this.now().toISOString(),
    };
  }

  private stateFor(event: RunEventEnvelope): Promise<AttemptState> {
    const key = attemptKey(event);
    const existing = this.attempts.get(key);
    if (existing) return existing;
    const loading = this.loadAttempt(event.taskId, event.attemptId).catch((error) => {
      this.attempts.delete(key);
      throw error;
    });
    this.attempts.set(key, loading);
    return loading;
  }

  private async loadAttempt(taskId: string, attemptId: string): Promise<AttemptState> {
    const events: RunEventEnvelope[] = [];
    const actions: RecordedAction[] = [];
    let cursor = 0;
    for (;;) {
      const page = await this.journal.list({
        taskId,
        attemptId,
        afterSequence: cursor,
        limit: MAX_ATTEMPT_BUFFER_EVENTS,
      });
      for (const event of page.events) {
        if (event.kind === ACTION_EVENT_KIND) {
          const action = recordedAction(event);
          if (action) actions.push(action);
        }
        events.push(event);
      }
      cursor = page.nextCursor;
      if (!page.hasMore) break;
    }
    return {
      events: events.slice(-MAX_ATTEMPT_BUFFER_EVENTS),
      actions,
    };
  }
}

function recoveryUsage(
  actions: RecordedAction[],
  turnId: string | undefined
): ProgressWatchdogRecoveryUsage {
  const automated = actions.filter(
    (entry) => entry.status === 'executed' && entry.action !== 'warn'
  );
  return {
    turnId,
    automatedActionsThisTurn: automated.filter((entry) => entry.turnId === turnId).length,
    automatedActionsThisRun: automated.length,
  };
}

function recordedAction(event: RunEventEnvelope): RecordedAction | undefined {
  const action = event.payload.action;
  const status = event.payload.status;
  if (
    typeof action !== 'string' ||
    !['warn', 'steer', 'require-observation', 'retry', 'fallback', 'pause', 'cancel'].includes(
      action
    ) ||
    typeof status !== 'string' ||
    !['executed', 'operator-required', 'failed'].includes(status)
  ) {
    return undefined;
  }
  return {
    action: action as RecordedAction['action'],
    status: status as RecordedAction['status'],
    turnId: typeof event.payload.turnId === 'string' ? event.payload.turnId : event.turnId,
  };
}

function attemptKey(event: Pick<RunEventEnvelope, 'taskId' | 'attemptId'>): string {
  return `${event.taskId}:${event.attemptId}`;
}

function isWatchdogInternalEvent(event: RunEventEnvelope): boolean {
  return event.kind.startsWith('progress.watchdog.');
}

function boundedDiagnostic(value: string): string {
  const normalized = value.trim() || 'No diagnostic was provided.';
  return sanitizeProviderRuntimeDiagnostic(normalized).slice(0, MAX_ACTION_DIAGNOSTIC_LENGTH);
}
