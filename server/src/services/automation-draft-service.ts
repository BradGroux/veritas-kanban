import { createHash } from 'node:crypto';
import {
  AUTOMATION_DRAFT_SCHEMA_VERSION,
  EXECUTABLE_AGENT_PROVIDERS,
  type AutomationDraft,
  type AutomationDraftBudget,
  type AutomationDraftCompileInput,
  type AutomationDraftField,
  type AutomationDraftHints,
  type AutomationDraftStandingScope,
  type AutomationDraftValidationIssue,
  type SchedulerItem,
} from '@veritas-kanban/shared';
import { ConflictError, NotFoundError } from '../middleware/error-handler.js';
import { getStorage } from '../storage/index.js';
import {
  FileSchedulerStateRepository,
  type SchedulerStateRepository,
} from '../storage/scheduler-state-repository.js';
import { getCommunicationAdapterService } from './communication-adapter-service.js';
import { getAgentRegistryService } from './agent-registry-service.js';
import { getOutboundIntegrationService } from './outbound-integration-service.js';
import { getSchedulerService } from './scheduler-service.js';
import { getTaskService } from './task-service.js';
import { getWorkflowService } from './workflow-service.js';

const MAX_DRAFTS = 200;
const MAX_REVISIONS = 50;
const RUN_EXAMPLE_COUNT = 3;

interface AutomationDraftDependencies {
  stateRepository?: SchedulerStateRepository;
  now?: () => Date;
  workflowExists?: (id: string) => Promise<boolean>;
  taskExists?: (id: string) => Promise<boolean>;
  templateExists?: (id: string) => Promise<boolean>;
  integrationReady?: (id: string) => Promise<boolean>;
  providerSupported?: (id: string) => boolean;
  listSchedulerItems?: () => Promise<SchedulerItem[]>;
}

interface CompileOptions {
  draftId?: string;
  revision?: number;
  parentDraftId?: string;
}

export class AutomationDraftService {
  private readonly stateRepository: SchedulerStateRepository;
  private readonly now: () => Date;
  private readonly workflowExists: (id: string) => Promise<boolean>;
  private readonly taskExists: (id: string) => Promise<boolean>;
  private readonly templateExists: (id: string) => Promise<boolean>;
  private readonly integrationReady: (id: string) => Promise<boolean>;
  private readonly providerSupported: (id: string) => boolean;
  private readonly listSchedulerItems: () => Promise<SchedulerItem[]>;

  constructor(dependencies: AutomationDraftDependencies = {}) {
    this.stateRepository = dependencies.stateRepository ?? new FileSchedulerStateRepository();
    this.now = dependencies.now ?? (() => new Date());
    this.workflowExists =
      dependencies.workflowExists ??
      (async (id) => Boolean(await getWorkflowService().loadWorkflow(id)));
    this.taskExists =
      dependencies.taskExists ?? (async (id) => Boolean(await getTaskService().getTask(id)));
    this.templateExists =
      dependencies.templateExists ??
      (async (id) => Boolean(await getStorage().templates.getTemplate(id)));
    this.integrationReady = dependencies.integrationReady ?? defaultIntegrationReady;
    this.providerSupported = dependencies.providerSupported ?? defaultProviderSupported;
    this.listSchedulerItems =
      dependencies.listSchedulerItems ?? (async () => (await getSchedulerService().list()).items);
  }

  async preview(input: AutomationDraftCompileInput): Promise<AutomationDraft> {
    return this.compile(input);
  }

  async save(input: AutomationDraftCompileInput): Promise<AutomationDraft> {
    const draft = await this.compile(input);
    let result = draft;
    const state = await this.stateRepository.update((current) => {
      const existing = current.drafts[draft.id] ?? [];
      const replay = findDraftByRequestId(current.drafts, draft.requestId);
      if (replay) {
        if (replay.inputDigest !== draft.inputDigest) {
          throw new ConflictError('Automation draft requestId was reused with different input.');
        }
        result = replay;
        return current;
      }
      if (Object.keys(current.drafts).length >= MAX_DRAFTS && existing.length === 0) {
        throw new Error(`Automation draft limit of ${MAX_DRAFTS} reached.`);
      }
      return {
        ...current,
        drafts: { ...current.drafts, [draft.id]: [...existing, draft] },
      };
    });
    return state.drafts[draft.id]?.at(-1) ?? result;
  }

  async list(): Promise<AutomationDraft[]> {
    const state = await this.stateRepository.read();
    return Object.values(state.drafts)
      .map((revisions) => revisions.at(-1))
      .filter((draft): draft is AutomationDraft => Boolean(draft))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async get(draftId: string, revision?: number): Promise<AutomationDraft> {
    const revisions = (await this.stateRepository.read()).drafts[draftId];
    const draft = revision
      ? revisions?.find((candidate) => candidate.revision === revision)
      : revisions?.at(-1);
    if (!draft) throw new NotFoundError(`Automation draft ${draftId} not found.`);
    return draft;
  }

  async revise(draftId: string, input: AutomationDraftCompileInput): Promise<AutomationDraft> {
    const previous = await this.get(draftId);
    if (previous.revision >= MAX_REVISIONS) {
      throw new Error(`Automation draft revision limit of ${MAX_REVISIONS} reached.`);
    }
    const draft = await this.compile(input, {
      draftId,
      revision: previous.revision + 1,
      parentDraftId: previous.id,
    });
    let result = draft;
    await this.stateRepository.update((current) => {
      const replay = findDraftByRequestId(current.drafts, draft.requestId);
      if (replay) {
        if (replay.id !== draftId || replay.inputDigest !== draft.inputDigest) {
          throw new ConflictError('Automation draft requestId was reused with different input.');
        }
        result = replay;
        return current;
      }
      const revisions = current.drafts[draftId];
      const latest = revisions?.at(-1);
      if (!latest) throw new NotFoundError(`Automation draft ${draftId} not found.`);
      if (latest.revision !== previous.revision) {
        throw new ConflictError('Automation draft changed while the revision was compiled.');
      }
      return {
        ...current,
        drafts: { ...current.drafts, [draftId]: [...revisions, draft] },
      };
    });
    return result;
  }

  async clone(
    draftId: string,
    request: Pick<AutomationDraftCompileInput, 'requestId' | 'requestedBy'>
  ): Promise<AutomationDraft> {
    const source = await this.get(draftId);
    return this.save({
      intent: source.objective.value ?? '',
      requestId: request.requestId,
      requestedBy: request.requestedBy,
      hints: hintsFromDraft(source),
    });
  }

  async delete(draftId: string): Promise<{ deleted: boolean; revisionsDeleted: number }> {
    let revisionsDeleted = 0;
    await this.stateRepository.update((current) => {
      revisionsDeleted = current.drafts[draftId]?.length ?? 0;
      if (revisionsDeleted === 0) return current;
      const drafts = { ...current.drafts };
      delete drafts[draftId];
      return { ...current, drafts };
    });
    return { deleted: revisionsDeleted > 0, revisionsDeleted };
  }

  private async compile(
    rawInput: AutomationDraftCompileInput,
    options: CompileOptions = {}
  ): Promise<AutomationDraft> {
    const input = redactCompileInput(rawInput);
    const identityDigest = sha256(
      stableJson({
        intent: input.intent,
        requestId: input.requestId,
        requestedBy: input.requestedBy,
        hints: input.hints,
      })
    );
    const now = this.now();
    const hints = input.hints ?? {};
    const inferredSchedule = hints.scheduleExpression
      ? undefined
      : inferScheduleExpression(input.intent);
    const expression = field(
      hints.scheduleExpression ?? inferredSchedule?.expression,
      hints.scheduleExpression ? 'explicit' : inferredSchedule ? 'inferred' : 'unresolved',
      inferredSchedule ? 'medium' : hints.scheduleExpression ? 'high' : 'none',
      inferredSchedule?.ambiguous ? 'ambiguous' : undefined,
      inferredSchedule?.explanation ??
        'Provide a five-field cron expression or an unambiguous recurring time.'
    );
    const timezone = field(
      hints.timezone,
      hints.timezone ? 'explicit' : 'unresolved',
      hints.timezone ? 'high' : 'none',
      undefined,
      'Timezone is never inferred because it changes future run times.'
    );
    const issues: AutomationDraftValidationIssue[] = [];
    const nextRunExamples = validateSchedule(
      expression,
      timezone,
      hints.startAt,
      hints.expiresAt,
      now,
      issues
    );

    const draftBase = {
      schemaVersion: AUTOMATION_DRAFT_SCHEMA_VERSION,
      revision: options.revision ?? 1,
      status: 'inactive' as const,
      ...(options.parentDraftId ? { parentDraftId: options.parentDraftId } : {}),
      objective: field(
        input.intent,
        'explicit',
        'high',
        undefined,
        'Recurring objective supplied by the operator.'
      ),
      source: {
        workspaceId: explicitField(hints.workspaceId, 'Source workspace is required.'),
        taskId: explicitField(
          hints.sourceTaskId,
          'Source task is optional but unresolved when omitted.'
        ),
        proposingRunId: explicitField(
          hints.proposingRunId,
          'Proposing run is optional and records model-assisted provenance when present.'
        ),
      },
      execution: {
        workflowId: explicitField(
          hints.workflowId,
          'Select an existing workflow or task template.'
        ),
        taskTemplateId: explicitField(
          hints.taskTemplateId,
          'Select an existing task template or workflow.'
        ),
        provider: explicitField(
          hints.provider,
          'Provider support must be explicit before activation.'
        ),
      },
      schedule: {
        expression,
        timezone,
        startAt: explicitField(hints.startAt, 'Start time is optional.'),
        expiresAt: explicitField(hints.expiresAt, 'A bounded expiry is required.'),
        overlapPolicy: explicitField(hints.overlapPolicy, 'Choose skip, queue-one, or forbid.'),
        retry: explicitField(hints.retry, 'Retry attempts and backoff must be explicit.'),
        nextRunExamples,
      },
      output: {
        destination: explicitField(
          hints.outputDestination,
          'An inspectable output destination is required.'
        ),
        expectedDeliverables: explicitField(
          hints.expectedDeliverables,
          'Expected deliverables must be explicit.'
        ),
      },
      standingScope: explicitField(
        hints.standingScope,
        'Standing reads, writes, sends, targets, tools, and approvals must be explicit.'
      ),
      perRunBudget: explicitField(hints.perRunBudget, 'Per-run budget bounds are required.'),
      aggregateBudget: explicitField(
        hints.aggregateBudget,
        'Aggregate budget and maximum run count are required.'
      ),
      stopConditions: explicitField(
        hints.stopConditions,
        'At least one deterministic stop condition is required.'
      ),
      requestedBy: input.requestedBy,
      requestId: input.requestId,
      inputDigest: identityDigest,
      createdAt: now.toISOString(),
    };

    await this.validateResolvedFields(draftBase, issues, now);
    const state = await this.stateRepository.read();
    const schedulerItems = await this.listSchedulerItems().catch(() => []);
    validateOverlap(draftBase, state.drafts, schedulerItems, issues, options.draftId);
    appendFieldIssues(draftBase, issues);

    const digest = sha256(stableJson({ ...draftBase, validation: issues }));
    const id = options.draftId ?? `automation_${identityDigest.slice(7, 31)}`;
    return {
      ...draftBase,
      id,
      validation: {
        valid: !issues.some((issue) => issue.severity === 'blocker'),
        issues: dedupeIssues(issues),
      },
      redaction: {
        safeToExport: true,
        removedFields: input.removedFields,
      },
      digest,
    };
  }

  private async validateResolvedFields(
    draft: Omit<AutomationDraft, 'id' | 'digest' | 'validation' | 'redaction'>,
    issues: AutomationDraftValidationIssue[],
    now: Date
  ): Promise<void> {
    const { workflowId, taskTemplateId, provider } = draft.execution;
    if (workflowId.value && taskTemplateId.value) {
      issues.push(
        blocker(
          'execution',
          'execution-conflict',
          'Choose either a workflow or a task template, not both.',
          'Remove one execution target.'
        )
      );
    } else if (workflowId.value && !(await this.workflowExists(workflowId.value))) {
      workflowId.status = 'unavailable';
      issues.push(
        blocker(
          'execution.workflowId',
          'workflow-unavailable',
          `Workflow ${workflowId.value} is unavailable.`,
          'Choose an existing workflow.'
        )
      );
    } else if (taskTemplateId.value && !(await this.templateExists(taskTemplateId.value))) {
      taskTemplateId.status = 'unavailable';
      issues.push(
        blocker(
          'execution.taskTemplateId',
          'template-unavailable',
          `Task template ${taskTemplateId.value} is unavailable.`,
          'Choose an existing task template.'
        )
      );
    }
    if (draft.source.taskId.value && !(await this.taskExists(draft.source.taskId.value))) {
      draft.source.taskId.status = 'unavailable';
      issues.push(
        blocker(
          'source.taskId',
          'task-unavailable',
          `Task ${draft.source.taskId.value} is unavailable.`,
          'Choose an existing source task or remove the source-task hint.'
        )
      );
    }
    if (provider.value && !this.providerSupported(provider.value)) {
      provider.status = 'unsupported';
      issues.push(
        blocker(
          'execution.provider',
          'provider-unsupported',
          `Provider ${provider.value} has no executable adapter.`,
          'Choose a supported executable provider.'
        )
      );
    }
    if (draft.standingScope.value) {
      for (const integrationId of draft.standingScope.value.integrationIds) {
        if (!(await this.integrationReady(integrationId))) {
          issues.push(
            blocker(
              'standingScope.integrationIds',
              'integration-unavailable',
              `Integration ${integrationId} is unavailable or disabled.`,
              'Configure and validate the integration before activation.'
            )
          );
        }
      }
      validateStandingScope(draft.standingScope.value, issues);
    }
    validateBudgets(draft.perRunBudget.value, draft.aggregateBudget.value, issues);
    if (draft.schedule.expiresAt.value) {
      const expiry = Date.parse(draft.schedule.expiresAt.value);
      if (!Number.isFinite(expiry) || expiry <= now.getTime()) {
        draft.schedule.expiresAt.status = 'conflict';
        issues.push(
          blocker(
            'schedule.expiresAt',
            'invalid-expiry',
            'Expiry must be a future ISO timestamp.',
            'Set a future bounded expiry.'
          )
        );
      }
    }
    if (
      draft.schedule.startAt.value &&
      !Number.isFinite(Date.parse(draft.schedule.startAt.value))
    ) {
      draft.schedule.startAt.status = 'conflict';
      issues.push(
        blocker(
          'schedule.startAt',
          'invalid-start',
          'Start time must be an ISO timestamp.',
          'Use an ISO 8601 start time.'
        )
      );
    }
    if (
      draft.schedule.startAt.value &&
      draft.schedule.expiresAt.value &&
      Date.parse(draft.schedule.startAt.value) >= Date.parse(draft.schedule.expiresAt.value)
    ) {
      draft.schedule.startAt.status = 'conflict';
      draft.schedule.expiresAt.status = 'conflict';
      issues.push(
        blocker(
          'schedule',
          'schedule-window-invalid',
          'Start time must be earlier than expiry.',
          'Choose a start time before the bounded expiry.'
        )
      );
    }
    if ((draft.output.expectedDeliverables.value?.length ?? 0) === 0) {
      issues.push(
        blocker(
          'output.expectedDeliverables',
          'deliverables-empty',
          'At least one expected deliverable is required.',
          'Describe the output produced by each run.'
        )
      );
    }
    if (draft.output.destination.value && !isSafeDestination(draft.output.destination.value)) {
      draft.output.destination.status = 'unsupported';
      issues.push(
        blocker(
          'output.destination',
          'output-destination-invalid',
          'Output destination must be a safe named destination or HTTPS URL without credentials or query data.',
          'Use an integration-backed target or a contained named artifact destination.'
        )
      );
    }
    if ((draft.stopConditions.value?.length ?? 0) === 0) {
      issues.push(
        blocker(
          'stopConditions',
          'stop-conditions-empty',
          'At least one stop condition is required.',
          'Add expiry, error, budget, or completion stop conditions.'
        )
      );
    }
  }
}

function field<T>(
  value: T | undefined,
  origin: AutomationDraftField<T>['origin'],
  confidence: AutomationDraftField<T>['confidence'],
  status: AutomationDraftField<T>['status'] | undefined,
  explanation: string
): AutomationDraftField<T> {
  return {
    ...(value === undefined ? {} : { value }),
    origin,
    confidence,
    status: status ?? (value === undefined ? 'missing' : 'resolved'),
    explanation,
  };
}

function explicitField<T>(value: T | undefined, explanation: string): AutomationDraftField<T> {
  return field(
    value,
    value === undefined ? 'unresolved' : 'explicit',
    value === undefined ? 'none' : 'high',
    undefined,
    explanation
  );
}

function inferScheduleExpression(intent: string):
  | {
      expression?: string;
      ambiguous?: boolean;
      explanation: string;
    }
  | undefined {
  const normalized = intent.toLowerCase().replace(/[,]+/g, ' ').replace(/\s+/g, ' ');
  const time = normalized.match(/(?:at\s+)(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
  const parsedTime = time ? parseClock(time[1], time[2], time[3]) : undefined;
  if (/\b(?:every day|daily)\b/.test(normalized)) {
    return parsedTime
      ? {
          expression: `${parsedTime.minute} ${parsedTime.hour} * * *`,
          explanation: 'Inferred a daily cron schedule from the recurring intent.',
        }
      : { ambiguous: true, explanation: 'Daily intent did not include an exact time.' };
  }
  if (/\b(?:every weekday|weekdays)\b/.test(normalized)) {
    return parsedTime
      ? {
          expression: `${parsedTime.minute} ${parsedTime.hour} * * 1-5`,
          explanation: 'Inferred a weekday cron schedule from the recurring intent.',
        }
      : { ambiguous: true, explanation: 'Weekday intent did not include an exact time.' };
  }
  const weekday = normalized.match(
    /\b(?:every|weekly on)\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/
  );
  if (weekday) {
    return parsedTime
      ? {
          expression: `${parsedTime.minute} ${parsedTime.hour} * * ${weekdayNumber(weekday[1])}`,
          explanation: `Inferred a weekly ${weekday[1]} cron schedule from the recurring intent.`,
        }
      : { ambiguous: true, explanation: 'Weekly intent did not include an exact time.' };
  }
  const interval = normalized.match(/\bevery\s+(\d{1,2})\s+minutes?\b/);
  if (interval) {
    const minutes = Number(interval[1]);
    return minutes >= 1 && minutes <= 59
      ? {
          expression: `*/${minutes} * * * *`,
          explanation: 'Inferred a bounded minute interval from the recurring intent.',
        }
      : { ambiguous: true, explanation: 'Minute interval must be between 1 and 59.' };
  }
  return undefined;
}

function parseClock(hourText: string, minuteText?: string, meridiem?: string) {
  let hour = Number(hourText);
  const minute = Number(minuteText ?? '0');
  if (minute > 59 || hour > (meridiem ? 12 : 23) || hour < 0) return undefined;
  if (meridiem === 'pm' && hour < 12) hour += 12;
  if (meridiem === 'am' && hour === 12) hour = 0;
  return { hour, minute };
}

function weekdayNumber(value: string): number {
  return ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'].indexOf(
    value
  );
}

function validateSchedule(
  expression: AutomationDraftField<string>,
  timezone: AutomationDraftField<string>,
  startAt: string | undefined,
  expiresAt: string | undefined,
  now: Date,
  issues: AutomationDraftValidationIssue[]
): string[] {
  if (timezone.value && !isValidTimezone(timezone.value)) {
    timezone.status = 'unsupported';
    issues.push(
      blocker(
        'schedule.timezone',
        'timezone-invalid',
        `Timezone ${timezone.value} is not supported.`,
        'Use an IANA timezone such as America/Chicago or UTC.'
      )
    );
    return [];
  }
  if (!expression.value || !timezone.value) return [];
  const cron = parseCron(expression.value);
  if (!cron) {
    expression.status = 'unsupported';
    issues.push(
      blocker(
        'schedule.expression',
        'cron-invalid',
        'Schedule must be a supported five-field cron expression.',
        'Use numeric, wildcard, list, range, or wildcard-step cron fields.'
      )
    );
    return [];
  }
  const parsedStart = startAt ? Date.parse(startAt) : Number.NaN;
  const parsedExpiry = expiresAt ? Date.parse(expiresAt) : Number.NaN;
  const scheduleStart =
    Number.isFinite(parsedStart) && parsedStart > now.getTime() ? new Date(parsedStart) : now;
  const scheduleEnd = Number.isFinite(parsedExpiry) ? new Date(parsedExpiry) : undefined;
  const nextRuns = nextCronRuns(
    cron,
    timezone.value,
    scheduleStart,
    RUN_EXAMPLE_COUNT,
    scheduleEnd
  );
  if (nextRuns.length < RUN_EXAMPLE_COUNT) {
    expression.status = 'conflict';
    issues.push(
      blocker(
        'schedule.expression',
        'cron-no-future-runs',
        'Schedule produced no representative future runs.',
        'Choose a schedule that runs within the next year.'
      )
    );
  }
  return nextRuns;
}

type CronMatcher = (value: number) => boolean;
interface ParsedCron {
  minute: CronMatcher;
  hour: CronMatcher;
  day: CronMatcher;
  month: CronMatcher;
  weekday: CronMatcher;
}

function parseCron(expression: string): ParsedCron | null {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const matchers = [
    parseCronField(parts[0], 0, 59),
    parseCronField(parts[1], 0, 23),
    parseCronField(parts[2], 1, 31),
    parseCronField(parts[3], 1, 12),
    parseCronField(parts[4], 0, 6),
  ];
  if (matchers.some((matcher) => !matcher)) return null;
  return {
    minute: matchers[0] as CronMatcher,
    hour: matchers[1] as CronMatcher,
    day: matchers[2] as CronMatcher,
    month: matchers[3] as CronMatcher,
    weekday: matchers[4] as CronMatcher,
  };
}

function parseCronField(value: string, min: number, max: number): CronMatcher | null {
  if (value === '*') return () => true;
  const step = value.match(/^\*\/(\d+)$/);
  if (step) {
    const interval = Number(step[1]);
    return interval >= 1 && interval <= max - min + 1
      ? (candidate) => (candidate - min) % interval === 0
      : null;
  }
  const allowed = new Set<number>();
  for (const part of value.split(',')) {
    const range = part.match(/^(\d+)-(\d+)$/);
    if (range) {
      const start = Number(range[1]);
      const end = Number(range[2]);
      if (start < min || end > max || start > end) return null;
      for (let candidate = start; candidate <= end; candidate += 1) allowed.add(candidate);
      continue;
    }
    const candidate = Number(part);
    if (!Number.isInteger(candidate) || candidate < min || candidate > max) return null;
    allowed.add(candidate);
  }
  return (candidate) => allowed.has(candidate);
}

function nextCronRuns(
  cron: ParsedCron,
  timezone: string,
  now: Date,
  count: number,
  expiresAt?: Date
): string[] {
  const runs: string[] = [];
  const cursor = new Date(Math.floor(now.getTime() / 60_000) * 60_000 + 60_000);
  const searchLimit = cursor.getTime() + 370 * 24 * 60 * 60_000;
  const limit = expiresAt ? Math.min(searchLimit, expiresAt.getTime()) : searchLimit;
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
  });
  while (cursor.getTime() <= limit && runs.length < count) {
    const parts = zonedParts(cursor, formatter);
    if (
      cron.minute(parts.minute) &&
      cron.hour(parts.hour) &&
      cron.day(parts.day) &&
      cron.month(parts.month) &&
      cron.weekday(parts.weekday)
    ) {
      runs.push(cursor.toISOString());
    }
    cursor.setTime(cursor.getTime() + 60_000);
  }
  return runs;
}

function zonedParts(date: Date, formatter: Intl.DateTimeFormat) {
  const values = Object.fromEntries(
    formatter.formatToParts(date).map((part) => [part.type, part.value])
  );
  return {
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(values.weekday),
  };
}

function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format();
    return true;
  } catch {
    return false;
  }
}

function validateBudgets(
  perRun: AutomationDraftBudget | undefined,
  aggregate: AutomationDraftBudget | undefined,
  issues: AutomationDraftValidationIssue[]
): void {
  for (const [path, budget] of [
    ['perRunBudget', perRun],
    ['aggregateBudget', aggregate],
  ] as const) {
    if (!budget) continue;
    if (!Number.isSafeInteger(budget.maxRuns) || budget.maxRuns < 1) {
      issues.push(
        blocker(
          path,
          'budget-max-runs-invalid',
          'Budget maxRuns must be a positive integer.',
          'Set a finite positive maximum run count.'
        )
      );
    }
    for (const key of ['maxCostUsd', 'maxTokens', 'maxDurationMinutes'] as const) {
      const value = budget[key];
      if (value !== undefined && (!Number.isFinite(value) || value <= 0)) {
        issues.push(
          blocker(
            `${path}.${key}`,
            'budget-bound-invalid',
            `${key} must be a finite positive bound.`,
            'Set a finite positive value or remove the optional bound.'
          )
        );
      }
    }
  }
  if (perRun && perRun.maxRuns !== 1) {
    issues.push(
      blocker(
        'perRunBudget.maxRuns',
        'per-run-count-invalid',
        'Per-run budget maxRuns must be exactly 1.',
        'Set perRunBudget.maxRuns to 1 and use aggregateBudget.maxRuns for the series limit.'
      )
    );
  }
  if (perRun && aggregate && aggregate.maxRuns < perRun.maxRuns) {
    issues.push(
      blocker(
        'aggregateBudget.maxRuns',
        'budget-conflict',
        'Aggregate maxRuns cannot be below the per-run budget maxRuns.',
        'Increase the aggregate bound or reduce the per-run bound.'
      )
    );
  }
}

function defaultProviderSupported(id: string): boolean {
  if (!EXECUTABLE_AGENT_PROVIDERS.includes(id as never)) return false;
  return getAgentRegistryService()
    .list()
    .some(
      (agent) =>
        agent.status !== 'offline' &&
        agent.provider === id &&
        agent.providerRuntimeManifest?.provider === id &&
        agent.providerRuntimeManifest.probe.state === 'ready'
    );
}

function findDraftByRequestId(
  drafts: Record<string, AutomationDraft[]>,
  requestId: string
): AutomationDraft | undefined {
  for (const revisions of Object.values(drafts)) {
    const draft = revisions.find((candidate) => candidate.requestId === requestId);
    if (draft) return draft;
  }
  return undefined;
}

function validateStandingScope(
  scope: AutomationDraftStandingScope,
  issues: AutomationDraftValidationIssue[]
): void {
  const materialActions = scope.writes.length + scope.sends.length;
  if (materialActions > 0 && scope.approvalRequiredActions.length === 0) {
    issues.push(
      blocker(
        'standingScope.approvalRequiredActions',
        'approval-posture-missing',
        'Writes or sends require an explicit approval posture.',
        'List the exact actions that require approval, or explicitly constrain the workflow to mediated allow decisions.'
      )
    );
  }
  for (const target of scope.externalTargets) {
    if (/^https?:\/\//i.test(target)) {
      try {
        const url = new URL(target);
        if (url.username || url.password || url.search || url.hash) {
          issues.push({
            severity: 'warning',
            code: 'target-redacted',
            path: 'standingScope.externalTargets',
            message:
              'External target credentials, query, or fragment were removed from the export-safe draft.',
            remediation:
              'Bind credentials by integration definition ID during a later activation review.',
          });
        }
      } catch {
        issues.push(
          blocker(
            'standingScope.externalTargets',
            'target-invalid',
            `External target ${target} is invalid.`,
            'Use a valid HTTPS URL or a safe named target.'
          )
        );
      }
    } else if (!isSafeNamedTarget(target)) {
      issues.push(
        blocker(
          'standingScope.externalTargets',
          'target-invalid',
          `External target ${target} is not a safe named target.`,
          'Use an integration ID, safe target name, or HTTPS URL.'
        )
      );
    }
  }
}

function isSafeDestination(value: string): boolean {
  if (/^https?:\/\//i.test(value)) {
    try {
      const url = new URL(value);
      return (
        url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash
      );
    } catch {
      return false;
    }
  }
  return isSafeNamedTarget(value);
}

function isSafeNamedTarget(value: string): boolean {
  const hasControlCharacter = [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint < 32 || codePoint === 127;
  });
  return (
    value.length <= 1000 &&
    !value.includes('..') &&
    !hasControlCharacter &&
    /^[a-zA-Z0-9][a-zA-Z0-9._:/ -]*$/.test(value)
  );
}

function appendFieldIssues(
  draft: Omit<AutomationDraft, 'id' | 'digest' | 'validation' | 'redaction'>,
  issues: AutomationDraftValidationIssue[]
): void {
  const required: Array<[string, AutomationDraftField<unknown>]> = [
    ['source.workspaceId', draft.source.workspaceId],
    ['execution.provider', draft.execution.provider],
    ['schedule.expression', draft.schedule.expression],
    ['schedule.timezone', draft.schedule.timezone],
    ['schedule.expiresAt', draft.schedule.expiresAt],
    ['schedule.overlapPolicy', draft.schedule.overlapPolicy],
    ['schedule.retry', draft.schedule.retry],
    ['output.destination', draft.output.destination],
    ['output.expectedDeliverables', draft.output.expectedDeliverables],
    ['standingScope', draft.standingScope],
    ['perRunBudget', draft.perRunBudget],
    ['aggregateBudget', draft.aggregateBudget],
    ['stopConditions', draft.stopConditions],
  ];
  if (!draft.execution.workflowId.value && !draft.execution.taskTemplateId.value) {
    required.push(['execution.workflowId', draft.execution.workflowId]);
  }
  for (const [path, candidate] of required) {
    if (candidate.status === 'resolved') continue;
    issues.push(
      blocker(
        path,
        `field-${candidate.status}`,
        candidate.explanation,
        'Resolve this field before activation.'
      )
    );
  }
}

function validateOverlap(
  draft: Omit<AutomationDraft, 'id' | 'digest' | 'validation' | 'redaction'>,
  drafts: Record<string, AutomationDraft[]>,
  schedulerItems: SchedulerItem[],
  issues: AutomationDraftValidationIssue[],
  currentDraftId?: string
): void {
  const expression = draft.schedule.expression.value;
  const timezone = draft.schedule.timezone.value;
  const target = draft.execution.workflowId.value ?? draft.execution.taskTemplateId.value;
  if (!expression || !timezone || !target) return;
  for (const [draftId, revisions] of Object.entries(drafts)) {
    if (draftId === currentDraftId) continue;
    const other = revisions.at(-1);
    if (
      other?.schedule.expression.value === expression &&
      other.schedule.timezone.value === timezone &&
      (other.execution.workflowId.value ?? other.execution.taskTemplateId.value) === target
    ) {
      issues.push(
        blocker(
          'schedule',
          'draft-overlap',
          `Inactive draft ${draftId} has the same target and schedule.`,
          'Revise the existing draft or choose a distinct schedule.'
        )
      );
    }
  }
  if (
    schedulerItems.some(
      (item) =>
        item.sourceId === target &&
        item.trigger.cronExpr === expression &&
        (item.trigger.timezone ?? 'UTC') === timezone
    )
  ) {
    issues.push(
      blocker(
        'schedule',
        'active-overlap',
        'An active scheduler definition has the same target and schedule.',
        'Revise the existing scheduler definition or choose a distinct schedule.'
      )
    );
  }
}

function blocker(
  path: string,
  code: string,
  message: string,
  remediation: string
): AutomationDraftValidationIssue {
  return { severity: 'blocker', path, code, message, remediation };
}

function dedupeIssues(issues: AutomationDraftValidationIssue[]): AutomationDraftValidationIssue[] {
  return [
    ...new Map(
      issues.map((issue) => [`${issue.code}:${issue.path}:${issue.message}`, issue])
    ).values(),
  ].sort((a, b) => `${a.path}:${a.code}`.localeCompare(`${b.path}:${b.code}`));
}

function hintsFromDraft(draft: AutomationDraft): AutomationDraftHints {
  return {
    workspaceId: draft.source.workspaceId.value,
    sourceTaskId: draft.source.taskId.value,
    proposingRunId: draft.source.proposingRunId.value,
    workflowId: draft.execution.workflowId.value,
    taskTemplateId: draft.execution.taskTemplateId.value,
    provider: draft.execution.provider.value,
    scheduleExpression: draft.schedule.expression.value,
    timezone: draft.schedule.timezone.value,
    startAt: draft.schedule.startAt.value,
    expiresAt: draft.schedule.expiresAt.value,
    overlapPolicy: draft.schedule.overlapPolicy.value,
    retry: draft.schedule.retry.value,
    outputDestination: draft.output.destination.value,
    expectedDeliverables: draft.output.expectedDeliverables.value,
    standingScope: draft.standingScope.value,
    perRunBudget: draft.perRunBudget.value,
    aggregateBudget: draft.aggregateBudget.value,
    stopConditions: draft.stopConditions.value,
  };
}

function redactCompileInput(
  input: AutomationDraftCompileInput
): AutomationDraftCompileInput & { removedFields: string[] } {
  const removedFields: string[] = [];
  const redact = (value: string, path: string) => {
    let result = value.replace(
      /\b(password|secret|token|api[_-]?key)\s*[:=]\s*\S+/gi,
      (_match, key: string) => {
        removedFields.push(path);
        return `${key}=[redacted]`;
      }
    );
    result = result.replace(/https?:\/\/[^\s]+/gi, (candidate) => {
      try {
        const url = new URL(candidate);
        if (url.username || url.password || url.search || url.hash) removedFields.push(path);
        url.username = '';
        url.password = '';
        url.search = '';
        url.hash = '';
        return url.toString();
      } catch {
        return candidate;
      }
    });
    return result;
  };
  const hints = input.hints
    ? {
        ...input.hints,
        outputDestination: input.hints.outputDestination
          ? redact(input.hints.outputDestination, 'hints.outputDestination')
          : undefined,
        standingScope: input.hints.standingScope
          ? (Object.fromEntries(
              Object.entries(input.hints.standingScope).map(([key, values]) => [
                key,
                (values as string[]).map((value) => redact(value, `hints.standingScope.${key}`)),
              ])
            ) as unknown as AutomationDraftStandingScope)
          : undefined,
      }
    : undefined;
  return {
    ...input,
    intent: redact(input.intent, 'intent'),
    requestedBy: redact(input.requestedBy, 'requestedBy'),
    ...(hints ? { hints } : {}),
    removedFields: [...new Set(removedFields)].sort(),
  };
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

async function defaultIntegrationReady(id: string): Promise<boolean> {
  const [adapters, endpoints] = await Promise.all([
    getCommunicationAdapterService()
      .listAdapters()
      .catch(() => []),
    getOutboundIntegrationService()
      .listEndpoints()
      .catch(() => []),
  ]);
  return (
    adapters.some((adapter) => adapter.id === id && adapter.enabled) ||
    endpoints.some(
      (endpoint) => endpoint.id === id && endpoint.enabled && endpoint.validation.valid
    )
  );
}

let automationDraftService: AutomationDraftService | null = null;

export function getAutomationDraftService(): AutomationDraftService {
  automationDraftService ??= new AutomationDraftService();
  return automationDraftService;
}
