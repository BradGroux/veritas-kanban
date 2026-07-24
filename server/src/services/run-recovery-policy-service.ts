import {
  RUN_RECOVERY_SCHEMA_VERSION,
  ZERO_AGENT_BUDGET_USAGE,
  type AgentBudgetUsage,
  type CompletionResult,
  type RunFailureClassification,
  type RunRecoveryRecord,
  type TaskCompletionBlocker,
  type TaskCompletionSideEffect,
  type TaskCompletionStatus,
  type TaskTerminalSource,
} from '@veritas-kanban/shared';

const DEFAULT_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;
const JITTER_RATIO = 0.2;

const RATE_LIMIT_PATTERN =
  /\b(?:429|rate[ -]?limit(?:ed|ing)?|too many requests|quota (?:exceeded|exhausted))\b/i;
const TIMEOUT_PATTERN = /\b(?:timed? ?out|timeout|deadline exceeded|etimedout|ehostunreach)\b/i;
const PROVIDER_UNAVAILABLE_PATTERN =
  /\b(?:provider unavailable|service unavailable|temporarily unavailable|unhealthy|not found on path|command not found|enoent|connection refused|econnrefused|gateway unavailable)\b/i;
const TRANSIENT_TRANSPORT_PATTERN =
  /\b(?:econnreset|epipe|socket hang up|connection (?:closed|reset|lost)|network error|fetch failed|http 5\d\d|bad gateway|gateway timeout|dns|eai_again)\b/i;
const INVALID_REQUEST_PATTERN =
  /\b(?:invalid (?:request|configuration|config|argument|option|schema)|validation failed|unsupported (?:flag|option|provider)|unknown (?:flag|option)|malformed|zod)\b/i;
const POLICY_BLOCK_PATTERN =
  /\b(?:policy|sandbox|permission|approval|unauthori[sz]ed|forbidden|denied|budget)\b/i;
const VERIFICATION_PATTERN =
  /\b(?:verification|acceptance criteri|test(?:s|ing)? failed|required (?:output|commit|evidence).*(?:missing|failed))\b/i;

export interface RunFailureEvidence {
  status: TaskCompletionStatus;
  terminalSource?: TaskTerminalSource;
  summary?: string | null;
  error?: string | null;
  blockers?: TaskCompletionBlocker[];
  sideEffects?: TaskCompletionSideEffect[];
}

export interface RunRecoveryDecisionInput {
  rootRunId: string;
  parentRunId: string;
  selectedAgent: string;
  routingDecision: string;
  sourceManifestDigest?: string;
  requiredRuntimeCapabilities?: string[];
  cumulativeBudget?: AgentBudgetUsage;
  previousSequence?: number;
  fallbackUsed?: boolean;
  maxRetries: number;
  fallbackOnFailure: boolean;
  fallbackAgent?: string;
  fallbackEligible?: boolean;
  fallbackReason?: string;
  baseBackoffMs?: number;
  now?: Date;
}

export class RunRecoveryPolicyService {
  constructor(private readonly random: () => number = Math.random) {}

  classifyCompletion(result: CompletionResult): RunFailureClassification {
    return this.classify({
      status: result.status,
      terminalSource: result.terminalSource,
      summary: result.summary,
      error: result.error,
      blockers: result.blockers,
      sideEffects: result.sideEffects,
    });
  }

  classifyError(error: unknown): RunFailureClassification {
    const summary = error instanceof Error ? error.message : String(error || 'Unknown error');
    return this.classify({ status: 'failed', summary, error: summary });
  }

  classify(evidence: RunFailureEvidence): RunFailureClassification {
    const blockers = evidence.blockers ?? [];
    const sideEffects = evidence.sideEffects ?? [];
    const summary = boundedSummary(
      evidence.error || evidence.summary || `Run reported ${evidence.status}.`
    );
    const text = [summary, ...blockers.flatMap((blocker) => [blocker.code, blocker.detail])].join(
      ' '
    );
    const destructiveSideEffects =
      evidence.status === 'partial' &&
      sideEffects.some((effect) =>
        [
          'filesystem-write',
          'process-execute',
          'network-egress',
          'git-commit',
          'external-write',
          'task-mutate',
        ].includes(effect.kind)
      );

    if (evidence.status === 'interrupted' || evidence.terminalSource === 'operator-interruption') {
      return classification('cancellation', summary, false, false, false);
    }
    if (destructiveSideEffects) {
      return classification('partial-side-effect', summary, false, true, true);
    }
    if (
      evidence.status === 'blocked' ||
      blockers.some((blocker) => !blocker.retryable || POLICY_BLOCK_PATTERN.test(blocker.code))
    ) {
      return classification('policy-block', summary, false, true, false);
    }
    if (INVALID_REQUEST_PATTERN.test(text)) {
      return classification('invalid-request', summary, false, true, false);
    }
    if (RATE_LIMIT_PATTERN.test(text)) {
      return classification('rate-limit', summary, true, false, false);
    }
    if (TIMEOUT_PATTERN.test(text)) {
      return classification('timeout', summary, true, false, false);
    }
    if (PROVIDER_UNAVAILABLE_PATTERN.test(text)) {
      return classification('provider-unavailable', summary, true, false, false);
    }
    if (TRANSIENT_TRANSPORT_PATTERN.test(text)) {
      return classification('transient-transport', summary, true, false, false);
    }
    if (
      evidence.status === 'partial' ||
      VERIFICATION_PATTERN.test(text) ||
      (blockers.length > 0 && blockers.every((blocker) => blocker.retryable))
    ) {
      return classification('verification-failure', summary, true, false, false);
    }
    if (evidence.status === 'failed') {
      return classification('task-failure', summary, false, false, false);
    }
    return classification('unknown', summary, false, false, false);
  }

  decide(failure: RunFailureClassification, input: RunRecoveryDecisionInput): RunRecoveryRecord {
    const previousSequence = Math.max(0, Math.trunc(input.previousSequence ?? 0));
    const maxRetries = clampInteger(input.maxRetries, 0, 3);
    const fallbackUsed = input.fallbackUsed === true;
    const now = input.now ?? new Date();
    const cumulativeBudget = input.cumulativeBudget ?? { ...ZERO_AGENT_BUDGET_USAGE };
    const base = {
      schemaVersion: RUN_RECOVERY_SCHEMA_VERSION,
      rootRunId: input.rootRunId,
      parentRunId: input.parentRunId,
      sequence: previousSequence,
      fallbackUsed,
      failure,
      selectedAgent: input.selectedAgent,
      ...(input.fallbackAgent ? { fallbackAgent: input.fallbackAgent } : {}),
      routingDecision: input.routingDecision,
      sourceManifestDigest: input.sourceManifestDigest,
      requiredRuntimeCapabilities: [...new Set(input.requiredRuntimeCapabilities ?? [])].sort(),
      cumulativeBudget: { ...cumulativeBudget },
    } satisfies Omit<
      RunRecoveryRecord,
      'state' | 'action' | 'reason' | 'backoffMs' | 'scheduledAt' | 'notBefore' | 'handoff'
    >;

    if (failure.classification === 'cancellation') {
      return {
        ...base,
        state: 'cancelled',
        action: 'cancelled',
        reason: 'The operator or provider explicitly cancelled the run.',
        backoffMs: 0,
        cancelledAt: now.toISOString(),
        handoff: {
          summary: 'Automatic recovery was cancelled.',
          nextActions: ['Start a new run explicitly if the objective should continue.'],
        },
      };
    }

    if (failure.approvalRequired) {
      return {
        ...base,
        state: 'approval-required',
        action: 'approval',
        reason: `Automatic recovery is unsafe for ${failure.classification}.`,
        backoffMs: 0,
        handoff: {
          summary: `Recovery requires operator review after ${failure.classification}.`,
          nextActions: [
            'Inspect the terminal evidence and side effects.',
            'Resolve the policy or configuration blocker.',
            'Launch a new attempt explicitly after approval.',
          ],
        },
      };
    }

    if (!failure.retryable) {
      return {
        ...base,
        state: 'exhausted',
        action: 'terminal',
        reason: `Failure class ${failure.classification} is not explicitly retryable.`,
        backoffMs: 0,
        handoff: {
          summary: `Automatic recovery stopped after ${failure.classification}.`,
          nextActions: [
            'Inspect the attempt log and normalized completion evidence.',
            'Correct the task or provider inputs before launching another attempt.',
          ],
        },
      };
    }

    if (previousSequence < maxRetries) {
      return this.scheduledRecord(
        base,
        'retry',
        input.selectedAgent,
        `Retry ${previousSequence + 1} of ${maxRetries} after ${failure.classification}.`,
        now,
        input.baseBackoffMs
      );
    }

    if (
      input.fallbackOnFailure &&
      !fallbackUsed &&
      input.fallbackAgent &&
      input.fallbackEligible !== false
    ) {
      return this.scheduledRecord(
        {
          ...base,
          fallbackUsed: true,
        },
        'fallback',
        input.fallbackAgent,
        input.fallbackReason ||
          `Retry budget exhausted; route from ${input.selectedAgent} to ${input.fallbackAgent}.`,
        now,
        input.baseBackoffMs,
        input.fallbackAgent
      );
    }

    const fallbackDetail =
      input.fallbackOnFailure && input.fallbackAgent && input.fallbackEligible === false
        ? ` Fallback ${input.fallbackAgent} was rejected: ${input.fallbackReason || 'incompatible runtime policy'}.`
        : '';
    return {
      ...base,
      state: 'exhausted',
      action: 'terminal',
      reason: `Retry budget of ${maxRetries} exhausted.${fallbackDetail}`,
      backoffMs: 0,
      ...(input.fallbackAgent ? { fallbackAgent: input.fallbackAgent } : {}),
      handoff: {
        summary: 'Automatic retry and fallback policy was exhausted.',
        nextActions: [
          'Review the failure classification and prior attempt chain.',
          fallbackDetail
            ? 'Choose a fallback that satisfies runtime capabilities and sandbox policy.'
            : 'Correct the provider or task failure before relaunching.',
        ],
      },
    };
  }

  private scheduledRecord(
    base: Omit<
      RunRecoveryRecord,
      'state' | 'action' | 'reason' | 'backoffMs' | 'scheduledAt' | 'notBefore' | 'handoff'
    >,
    action: 'retry' | 'fallback',
    selectedAgent: string,
    reason: string,
    now: Date,
    requestedBaseBackoffMs?: number,
    fallbackAgent?: string
  ): RunRecoveryRecord {
    const sequence = base.sequence + 1;
    const backoffMs = this.backoffMs(sequence, requestedBaseBackoffMs);
    return {
      ...base,
      sequence,
      state: 'scheduled',
      action,
      reason,
      backoffMs,
      scheduledAt: now.toISOString(),
      notBefore: new Date(now.getTime() + backoffMs).toISOString(),
      selectedAgent,
      ...(fallbackAgent ? { fallbackAgent } : {}),
    };
  }

  backoffMs(sequence: number, requestedBaseBackoffMs = DEFAULT_BACKOFF_MS): number {
    const boundedSequence = clampInteger(sequence, 1, 32);
    const base = clampInteger(requestedBaseBackoffMs, 100, MAX_BACKOFF_MS);
    const exponential = Math.min(MAX_BACKOFF_MS, base * 2 ** (boundedSequence - 1));
    const random = Math.max(0, Math.min(1, this.random()));
    const jitterMultiplier = 1 - JITTER_RATIO + random * JITTER_RATIO * 2;
    return Math.max(100, Math.min(MAX_BACKOFF_MS, Math.round(exponential * jitterMultiplier)));
  }
}

function classification(
  classificationValue: RunFailureClassification['classification'],
  summary: string,
  retryable: boolean,
  approvalRequired: boolean,
  destructiveSideEffects: boolean
): RunFailureClassification {
  return {
    classification: classificationValue,
    summary,
    retryable,
    approvalRequired,
    destructiveSideEffects,
  };
}

function boundedSummary(value: string): string {
  const trimmed = value.trim();
  return (trimmed || 'Run failed without a diagnostic summary.').slice(0, 2_000);
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.max(minimum, Math.min(maximum, Math.trunc(value)));
}
