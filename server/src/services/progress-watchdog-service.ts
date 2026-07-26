import { createHash } from 'node:crypto';
import type {
  DurableProgressSignal,
  ExpectedRepetitionLease,
  ProgressWatchdogAction,
  ProgressWatchdogConfidence,
  ProgressWatchdogDetector,
  ProgressWatchdogEvaluation,
  ProgressWatchdogFinding,
  ProgressWatchdogPolicy,
  ProgressWatchdogRecoveryUsage,
  RunEventEnvelope,
  RunEventJsonValue,
} from '@veritas-kanban/shared';
import {
  PROGRESS_WATCHDOG_FINDING_SCHEMA_VERSION,
  PROGRESS_WATCHDOG_POLICY_SCHEMA_VERSION,
} from '@veritas-kanban/shared';
import { ValidationError } from '../middleware/error-handler.js';
import { ProgressWatchdogPolicySchema } from '../schemas/progress-watchdog-schemas.js';

const DURABLE_PROGRESS_SIGNALS = new Set<DurableProgressSignal>([
  'workspace-delta',
  'artifact',
  'verification-passed',
  'task-transition',
  'goal-transition',
  'external-evidence',
  'operator-input',
]);

const FINGERPRINT_EVENT_KINDS = new Set([
  'tool.started',
  'tool.completed',
  'command.started',
  'command.completed',
  'run.error',
  'provider.unknown',
  'message.assistant',
]);

export const DEFAULT_PROGRESS_WATCHDOG_POLICY: ProgressWatchdogPolicy = {
  schemaVersion: PROGRESS_WATCHDOG_POLICY_SCHEMA_VERSION,
  version: 1,
  enabled: true,
  windowEvents: 36,
  identicalRepetitionThreshold: 3,
  cycleMaxLength: 4,
  cycleRepetitionThreshold: 3,
  failedEditThreshold: 3,
  noProgressEventThreshold: 8,
  noProgressSeconds: 120,
  noProgressTotalTokens: 20_000,
  noProgressCostUsd: 2,
  highConfidenceMultiplier: 2,
  progressSignals: [...DURABLE_PROGRESS_SIGNALS],
  expectedRepetitionAllowedKinds: [
    'tool.started',
    'tool.completed',
    'command.started',
    'command.completed',
    'progress',
  ],
  maxExpectedRepetitionLeaseSeconds: 3_600,
  recovery: {
    lowConfidenceAction: 'warn',
    mediumConfidenceAction: 'require-observation',
    highConfidenceAction: 'pause',
    maxAutomatedActionsPerTurn: 2,
    maxAutomatedActionsPerRun: 6,
  },
};

export interface ProgressWatchdogEvaluationInput {
  events: RunEventEnvelope[];
  policy?: ProgressWatchdogPolicy;
  recoveryUsage?: ProgressWatchdogRecoveryUsage;
  evaluatedAt?: string;
}

interface FindingDraft {
  detector: ProgressWatchdogDetector;
  confidence: ProgressWatchdogConfidence;
  evidence: RunEventEnvelope[];
  fingerprints: string[];
}

export class ProgressWatchdogService {
  evaluate(input: ProgressWatchdogEvaluationInput): ProgressWatchdogEvaluation {
    const policy = ProgressWatchdogPolicySchema.parse(
      input.policy ?? DEFAULT_PROGRESS_WATCHDOG_POLICY
    ) as ProgressWatchdogPolicy;
    if (!policy.enabled || input.events.length === 0) {
      return {
        findings: [],
        latestSequence: Math.max(0, ...input.events.map((event) => event.sequence)),
        suppressedEventIds: [],
      };
    }

    const events = normalizeEvents(input.events, policy.windowEvents);
    assertSingleRun(events);
    const evaluatedAt = input.evaluatedAt ?? events.at(-1)?.receivedAt ?? new Date().toISOString();
    const suppressed = suppressedByExpectedRepetition(events, policy, evaluatedAt);
    const progress = events.flatMap((event) =>
      progressSignalsForEvent(event, policy).map((signal) => ({ event, signal }))
    );
    const latestProgressSequence = Math.max(0, ...progress.map(({ event }) => event.sequence));
    const active = events.filter(
      (event) => event.sequence > latestProgressSequence && !suppressed.has(event.eventId)
    );
    const drafts = compactDrafts([
      identicalRepetition(active, policy),
      multiStepCycle(active, policy),
      failedFileEdits(active, policy),
      noDurableProgress(active, policy),
    ]);
    const usage = input.recoveryUsage ?? {
      automatedActionsThisTurn: 0,
      automatedActionsThisRun: 0,
    };
    const findings = drafts.map((draft) =>
      toFinding(draft, events[0], policy, usage, suppressed, progress, evaluatedAt)
    );

    return {
      findings,
      latestSequence: events.at(-1)?.sequence ?? 0,
      progressResetSequence: latestProgressSequence || undefined,
      suppressedEventIds: [...suppressed].sort(),
    };
  }
}

function normalizeEvents(events: RunEventEnvelope[], limit: number): RunEventEnvelope[] {
  const bySequence = new Map<number, RunEventEnvelope>();
  for (const event of events.filter((candidate) => !isWatchdogInternalEvent(candidate))) {
    const existing = bySequence.get(event.sequence);
    if (!existing || event.eventId.localeCompare(existing.eventId) < 0) {
      bySequence.set(event.sequence, event);
    }
  }
  return [...bySequence.values()]
    .sort(
      (left, right) => left.sequence - right.sequence || left.eventId.localeCompare(right.eventId)
    )
    .slice(-limit);
}

function assertSingleRun(events: RunEventEnvelope[]): void {
  const first = events[0];
  if (
    events.some((event) => event.taskId !== first.taskId || event.attemptId !== first.attemptId)
  ) {
    throw new ValidationError('Progress watchdog events must belong to one task attempt.');
  }
}

function progressSignalsForEvent(
  event: RunEventEnvelope,
  policy: ProgressWatchdogPolicy
): DurableProgressSignal[] {
  const allowed = new Set(policy.progressSignals);
  const explicit = stringValue(event.payload.durableProgress);
  if (
    explicit &&
    DURABLE_PROGRESS_SIGNALS.has(explicit as DurableProgressSignal) &&
    allowed.has(explicit as DurableProgressSignal)
  ) {
    return [explicit as DurableProgressSignal];
  }
  if (event.kind === 'file.changed' && allowed.has('workspace-delta')) return ['workspace-delta'];
  if (event.kind === 'artifact.created' && allowed.has('artifact')) return ['artifact'];
  if (
    event.kind === 'message.operator' &&
    allowed.has('operator-input') &&
    stringValue(event.payload.source) !== 'progress-watchdog'
  ) {
    return ['operator-input'];
  }
  if (
    event.kind === 'command.completed' &&
    allowed.has('verification-passed') &&
    booleanValue(event.payload.verification) === true &&
    eventSucceeded(event)
  ) {
    return ['verification-passed'];
  }
  return [];
}

function isWatchdogInternalEvent(event: RunEventEnvelope): boolean {
  return event.kind.startsWith('progress.watchdog.');
}

function suppressedByExpectedRepetition(
  events: RunEventEnvelope[],
  policy: ProgressWatchdogPolicy,
  evaluatedAt: string
): Set<string> {
  const suppressed = new Set<string>();
  const leaseEvents = new Map<string, RunEventEnvelope[]>();
  const evaluationTime = Date.parse(evaluatedAt);
  for (const event of events) {
    const lease = expectedRepetitionLease(event);
    if (!lease) continue;
    const eventTime = Date.parse(event.receivedAt);
    const startsAt = Date.parse(lease.startsAt);
    const expiresAt = Date.parse(lease.expiresAt);
    if (
      !Number.isFinite(eventTime) ||
      !Number.isFinite(startsAt) ||
      !Number.isFinite(expiresAt) ||
      !Number.isFinite(evaluationTime) ||
      evaluationTime < startsAt ||
      evaluationTime > expiresAt ||
      eventTime < startsAt ||
      eventTime > expiresAt ||
      expiresAt - startsAt > policy.maxExpectedRepetitionLeaseSeconds * 1_000 ||
      !policy.expectedRepetitionAllowedKinds.includes(event.kind) ||
      (lease.allowedKinds?.length && !lease.allowedKinds.includes(event.kind))
    ) {
      continue;
    }
    const group = leaseEvents.get(lease.leaseId) ?? [];
    const recent = group.filter(
      (candidate) => eventTime - Date.parse(candidate.receivedAt) <= 60_000
    );
    group.push(event);
    leaseEvents.set(lease.leaseId, group);
    if (recent.length < lease.maxEventsPerMinute) {
      suppressed.add(event.eventId);
    }
  }
  return suppressed;
}

function expectedRepetitionLease(event: RunEventEnvelope): ExpectedRepetitionLease | undefined {
  const raw = objectValue(event.payload.expectedRepetition);
  if (!raw) return undefined;
  const leaseId = stringValue(raw.leaseId);
  const startsAt = stringValue(raw.startsAt);
  const expiresAt = stringValue(raw.expiresAt);
  const maxEventsPerMinute = numberValue(raw.maxEventsPerMinute);
  const allowedKinds = arrayValue(raw.allowedKinds)
    ?.map(stringValue)
    .filter((value): value is string => Boolean(value));
  if (
    !leaseId ||
    !startsAt ||
    !expiresAt ||
    !Number.isInteger(maxEventsPerMinute) ||
    (maxEventsPerMinute ?? 0) < 1
  ) {
    return undefined;
  }
  return {
    leaseId,
    startsAt,
    expiresAt,
    maxEventsPerMinute: maxEventsPerMinute as number,
    allowedKinds,
  };
}

function identicalRepetition(
  events: RunEventEnvelope[],
  policy: ProgressWatchdogPolicy
): FindingDraft | undefined {
  const fingerprinted = events
    .map((event) => ({ event, fingerprint: fingerprintEvent(event) }))
    .filter((item): item is { event: RunEventEnvelope; fingerprint: string } =>
      Boolean(item.fingerprint)
    );
  const last = fingerprinted.at(-1);
  if (!last) return undefined;
  const tail: typeof fingerprinted = [];
  for (let index = fingerprinted.length - 1; index >= 0; index -= 1) {
    if (fingerprinted[index].fingerprint !== last.fingerprint) break;
    tail.unshift(fingerprinted[index]);
  }
  if (tail.length < policy.identicalRepetitionThreshold) return undefined;
  return {
    detector: 'identical-repetition',
    confidence:
      tail.length >= policy.identicalRepetitionThreshold * policy.highConfidenceMultiplier
        ? 'high'
        : 'medium',
    evidence: tail.map(({ event }) => event),
    fingerprints: [last.fingerprint],
  };
}

function multiStepCycle(
  events: RunEventEnvelope[],
  policy: ProgressWatchdogPolicy
): FindingDraft | undefined {
  const fingerprinted = events
    .map((event) => ({ event, fingerprint: fingerprintEvent(event) }))
    .filter((item): item is { event: RunEventEnvelope; fingerprint: string } =>
      Boolean(item.fingerprint)
    );
  for (let length = 2; length <= policy.cycleMaxLength; length += 1) {
    const required = length * policy.cycleRepetitionThreshold;
    if (fingerprinted.length < required) continue;
    const pattern = fingerprinted.slice(-length).map((item) => item.fingerprint);
    if (new Set(pattern).size < 2) continue;
    const tail: typeof fingerprinted = [];
    for (let index = fingerprinted.length - 1; index >= 0; index -= 1) {
      const patternIndex = (((index - (fingerprinted.length - length)) % length) + length) % length;
      if (fingerprinted[index].fingerprint !== pattern[patternIndex]) break;
      tail.unshift(fingerprinted[index]);
    }
    const repetitions = Math.floor(tail.length / length);
    if (repetitions < policy.cycleRepetitionThreshold) continue;
    return {
      detector: 'multi-step-cycle',
      confidence:
        repetitions >= policy.cycleRepetitionThreshold * policy.highConfidenceMultiplier
          ? 'high'
          : 'medium',
      evidence: tail.map(({ event }) => event),
      fingerprints: [...new Set(pattern)],
    };
  }
  return undefined;
}

function failedFileEdits(
  events: RunEventEnvelope[],
  policy: ProgressWatchdogPolicy
): FindingDraft | undefined {
  const failures = events
    .map((event) => ({ event, pathHash: failedEditPathHash(event) }))
    .filter((item): item is { event: RunEventEnvelope; pathHash: string } =>
      Boolean(item.pathHash)
    );
  const last = failures.at(-1);
  if (!last) return undefined;
  const matching = failures.filter((item) => item.pathHash === last.pathHash);
  if (matching.length < policy.failedEditThreshold) return undefined;
  return {
    detector: 'failed-file-edit',
    confidence:
      matching.length >= policy.failedEditThreshold * policy.highConfidenceMultiplier
        ? 'high'
        : 'medium',
    evidence: matching.map(({ event }) => event),
    fingerprints: [last.pathHash],
  };
}

function noDurableProgress(
  events: RunEventEnvelope[],
  policy: ProgressWatchdogPolicy
): FindingDraft | undefined {
  if (events.length < policy.noProgressEventThreshold) return undefined;
  const firstTime = Date.parse(events[0].receivedAt);
  const lastTime = Date.parse(events.at(-1)?.receivedAt ?? '');
  const elapsedSeconds = (lastTime - firstTime) / 1_000;
  const usage = events
    .filter((event) => event.kind === 'usage.updated')
    .reduce(
      (total, event) => ({
        totalTokens: total.totalTokens + (numberValue(event.payload.totalTokens) ?? 0),
        costUsd: total.costUsd + (numberValue(event.payload.costUsd) ?? 0),
      }),
      { totalTokens: 0, costUsd: 0 }
    );
  if (
    !Number.isFinite(elapsedSeconds) ||
    (elapsedSeconds < policy.noProgressSeconds &&
      usage.totalTokens < policy.noProgressTotalTokens &&
      usage.costUsd < policy.noProgressCostUsd)
  ) {
    return undefined;
  }
  return {
    detector: 'no-durable-progress',
    confidence:
      events.length >= policy.noProgressEventThreshold * policy.highConfidenceMultiplier &&
      (elapsedSeconds >= policy.noProgressSeconds * policy.highConfidenceMultiplier ||
        usage.totalTokens >= policy.noProgressTotalTokens * policy.highConfidenceMultiplier ||
        usage.costUsd >= policy.noProgressCostUsd * policy.highConfidenceMultiplier)
        ? 'high'
        : 'low',
    evidence: events.slice(-policy.noProgressEventThreshold),
    fingerprints: events
      .slice(-policy.noProgressEventThreshold)
      .map(fingerprintEvent)
      .filter((value): value is string => Boolean(value)),
  };
}

function compactDrafts(drafts: Array<FindingDraft | undefined>): FindingDraft[] {
  const seen = new Set<string>();
  return drafts.filter((draft): draft is FindingDraft => {
    if (!draft) return false;
    const key = `${draft.detector}:${draft.evidence.map((event) => event.eventId).join(':')}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function toFinding(
  draft: FindingDraft,
  firstEvent: RunEventEnvelope,
  policy: ProgressWatchdogPolicy,
  usage: ProgressWatchdogRecoveryUsage,
  suppressed: Set<string>,
  progress: Array<{ event: RunEventEnvelope; signal: DurableProgressSignal }>,
  evaluatedAt: string
): ProgressWatchdogFinding {
  const evidenceEventIds = draft.evidence.map((event) => event.eventId).slice(-100);
  const recoveryBudgetRemaining = {
    turn: Math.max(0, policy.recovery.maxAutomatedActionsPerTurn - usage.automatedActionsThisTurn),
    run: Math.max(0, policy.recovery.maxAutomatedActionsPerRun - usage.automatedActionsThisRun),
  };
  return {
    schemaVersion: PROGRESS_WATCHDOG_FINDING_SCHEMA_VERSION,
    id: `watchdog_${hashValue({
      detector: draft.detector,
      policyVersion: policy.version,
      evidenceEventIds,
    }).slice(0, 32)}`,
    taskId: firstEvent.taskId,
    attemptId: firstEvent.attemptId,
    turnId: draft.evidence.at(-1)?.turnId ?? usage.turnId,
    detector: draft.detector,
    confidence: draft.confidence,
    policyVersion: policy.version,
    evidenceEventIds,
    fingerprintHashes: [...new Set(draft.fingerprints)].slice(0, 24),
    suppressedEventIds: [...suppressed].sort().slice(0, 100),
    progressSignals: [...new Set(progress.map(({ signal }) => signal))],
    action: actionForFinding(draft.confidence, policy, recoveryBudgetRemaining),
    recoveryBudgetRemaining,
    createdAt: evaluatedAt,
  };
}

function actionForFinding(
  confidence: ProgressWatchdogConfidence,
  policy: ProgressWatchdogPolicy,
  remaining: { turn: number; run: number }
): ProgressWatchdogAction {
  const configured =
    confidence === 'high'
      ? policy.recovery.highConfidenceAction
      : confidence === 'medium'
        ? policy.recovery.mediumConfidenceAction
        : policy.recovery.lowConfidenceAction;
  if (configured === 'warn') return configured;
  return remaining.turn > 0 && remaining.run > 0 ? configured : 'pause';
}

function fingerprintEvent(event: RunEventEnvelope): string | undefined {
  if (!FINGERPRINT_EVENT_KINDS.has(event.kind)) return undefined;
  if (event.kind === 'message.assistant') {
    const content =
      stringValue(event.payload.content) ??
      stringValue(event.payload.summary) ??
      stringValue(event.payload.text);
    if (!content) return undefined;
    return `sha256:${hashValue({
      kind: event.kind,
      tailHash: hashValue(content.slice(-512)),
    })}`;
  }
  if (event.kind === 'run.error' || event.kind === 'provider.unknown') {
    return `sha256:${hashValue({
      kind: event.kind,
      errorClass:
        stringValue(event.payload.errorClass) ??
        stringValue(event.payload.code) ??
        stringValue(event.payload.name) ??
        stringValue(event.payload.type) ??
        'unknown',
    })}`;
  }
  const started = event.kind === 'tool.started' || event.kind === 'command.started';
  const input = started
    ? (event.payload.arguments ??
      event.payload.input ??
      event.payload.params ??
      event.payload.command ??
      event.payload.script)
    : undefined;
  const evidence = !started
    ? (event.payload.resultHash ??
      event.payload.outputHash ??
      event.payload.evidenceHash ??
      tailHash(event.payload.output) ??
      tailHash(event.payload.result))
    : undefined;
  const identity = {
    kind: event.kind,
    tool: stringValue(event.payload.toolName) ?? stringValue(event.payload.name),
    outcome:
      stringValue(event.payload.status) ??
      stringValue(event.payload.outcome) ??
      stringValue(event.payload.code),
    ...(input !== undefined ? { inputHash: hashValue(input) } : {}),
    ...(evidence !== undefined ? { evidenceHash: evidence } : {}),
    ...(input === undefined && evidence === undefined ? { payloadHash: event.payloadHash } : {}),
  };
  return `sha256:${hashValue(identity)}`;
}

function tailHash(value: RunEventJsonValue | undefined): string | undefined {
  return typeof value === 'string' ? hashValue(value.slice(-512)) : undefined;
}

function failedEditPathHash(event: RunEventEnvelope): string | undefined {
  if (!['tool.completed', 'command.completed'].includes(event.kind) || eventSucceeded(event)) {
    return undefined;
  }
  const tool = (
    stringValue(event.payload.toolName) ??
    stringValue(event.payload.name) ??
    ''
  ).toLowerCase();
  if (!/(?:edit|write|patch|apply)/.test(tool)) return undefined;
  const path =
    stringValue(event.payload.filePath) ??
    stringValue(event.payload.path) ??
    stringValue(event.payload.targetPath);
  return path ? `sha256:${hashValue(path)}` : undefined;
}

function eventSucceeded(event: RunEventEnvelope): boolean {
  const success = booleanValue(event.payload.success);
  if (success !== undefined) return success;
  const exitCode = numberValue(event.payload.exitCode);
  if (exitCode !== undefined) return exitCode === 0;
  const status = stringValue(event.payload.status)?.toLowerCase();
  return status === 'success' || status === 'completed' || status === 'passed';
}

function hashValue(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function canonicalJson(value: unknown): string {
  if (value === undefined) return '"[undefined]"';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
    .join(',')}}`;
}

function objectValue(
  value: RunEventJsonValue | undefined
): Record<string, RunEventJsonValue> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : undefined;
}

function arrayValue(value: RunEventJsonValue | undefined): RunEventJsonValue[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

function stringValue(value: RunEventJsonValue | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function numberValue(value: RunEventJsonValue | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function booleanValue(value: RunEventJsonValue | undefined): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}
