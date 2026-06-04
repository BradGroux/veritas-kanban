import {
  DEFAULT_FEATURE_SETTINGS,
  type WatcherContinuationDecision,
  type WatcherContinuationEvaluationRequest,
  type WatcherContinuationEvaluationResult,
  type WatcherContinuationEvidence,
  type WatcherContinuationMode,
  type WatcherContinuationPolicy,
  type WatcherContinuationSettings,
  type WatcherRiskClass,
  type WatcherRiskLevel,
} from '@veritas-kanban/shared';
import { auditLog, type AuditEvent } from './audit-service.js';

type AuditWriter = (event: AuditEvent) => Promise<void>;

interface EffectiveWatcherPolicy {
  mode: WatcherContinuationMode;
  maxContinuations: number;
  spendCapUsd: number;
  riskClasses: WatcherRiskClass[];
  dispatchDenyPatterns: string[];
  matchedPolicyId?: string;
}

export interface WatcherPolicyServiceOptions {
  settings?: WatcherContinuationSettings;
  auditWriter?: AuditWriter;
}

const DESTRUCTIVE_COMMAND_PATTERNS = [
  /\brm\s+-[^\n]*r[^\n]*f\b/i,
  /\bgit\s+reset\s+--hard\b/i,
  /\bgit\s+clean\s+-[^\n]*f/i,
  /\bterraform\s+destroy\b/i,
  /\bkubectl\s+delete\b/i,
  /\bdocker\s+system\s+prune\b/i,
  /\bdiskutil\s+erase/i,
  /\bmkfs(?:\.\w+)?\b/i,
  /\bdd\s+if=/i,
  /\bDROP\s+TABLE\b/i,
  /\bTRUNCATE\s+TABLE\b/i,
];

const CREDENTIAL_PATTERNS = [
  /\b(api[_-]?key|access[_-]?token|refresh[_-]?token|secret|password|passphrase)\b/i,
  /BEGIN [A-Z ]*PRIVATE KEY/i,
  /\bAWS_SECRET_ACCESS_KEY\b/i,
  /\bGITHUB_TOKEN\b/i,
  /\bSUPABASE_SERVICE_ROLE_KEY\b/i,
];

const RISK_LEVEL_BY_CLASS: Record<WatcherRiskClass, WatcherRiskLevel> = {
  destructive_command: 'critical',
  credential_reference: 'high',
  recent_test_failure: 'medium',
  provider_error: 'medium',
  policy_violation: 'high',
};

const RISK_LEVEL_WEIGHT: Record<WatcherRiskLevel, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

export class WatcherPolicyService {
  private settings: WatcherContinuationSettings;
  private readonly auditWriter: AuditWriter;

  constructor(options: WatcherPolicyServiceOptions = {}) {
    this.settings = normalizeSettings(
      options.settings ?? DEFAULT_FEATURE_SETTINGS.watcherContinuations
    );
    this.auditWriter = options.auditWriter ?? auditLog;
  }

  configure(settings: WatcherContinuationSettings | undefined): void {
    this.settings = normalizeSettings(settings ?? DEFAULT_FEATURE_SETTINGS.watcherContinuations);
  }

  getSettings(): WatcherContinuationSettings {
    return cloneJson(this.settings);
  }

  async evaluateContinuation(
    input: WatcherContinuationEvaluationRequest,
    options: { actor?: string; audit?: boolean } = {}
  ): Promise<WatcherContinuationEvaluationResult> {
    const result = this.evaluate(input);

    if (options.audit !== false) {
      await this.auditWriter({
        action: 'watcher.continuation.evaluate',
        actor: options.actor ?? 'system',
        resource: input.runId ?? input.taskId ?? 'watcher-continuation',
        details: {
          decision: result.decision,
          mode: result.mode,
          riskLevel: result.riskLevel,
          riskClasses: result.riskClasses,
          matchedPolicyId: result.matchedPolicyId,
          reasons: result.reasons,
          runId: input.runId,
          taskId: input.taskId,
          project: input.project,
          agent: input.agent,
          continuationCount: input.continuationCount,
          monthlySpendUsd: input.monthlySpendUsd,
        },
      });
    }

    return { ...result, auditLogged: options.audit !== false };
  }

  private evaluate(
    input: WatcherContinuationEvaluationRequest
  ): WatcherContinuationEvaluationResult {
    const effective = this.resolvePolicy(input);
    const evidence: WatcherContinuationEvidence[] = [];
    const reasons: string[] = [];
    let decision: WatcherContinuationDecision = 'allow';

    if (!this.settings.enabled) {
      return this.blockedResult(
        effective,
        input,
        ['Watcher continuations are disabled.'],
        [
          {
            code: 'watchers_disabled',
            message: 'Continuation watchers are disabled in feature settings.',
          },
        ]
      );
    }

    if (this.settings.globalKillSwitch) {
      return this.blockedResult(
        effective,
        input,
        ['Global watcher kill switch is active.'],
        [
          {
            code: 'global_kill_switch',
            message: 'The global kill switch blocks all watcher continuations.',
          },
        ]
      );
    }

    const riskClasses = this.classifyRisk(input, evidence);
    const riskLevel = riskLevelFor(riskClasses);
    const filteredRiskClasses = riskClasses.filter((riskClass) =>
      effective.riskClasses.includes(riskClass)
    );

    const matchedDispatchFilter = this.findDispatchFilterMatch(
      input,
      effective.dispatchDenyPatterns
    );
    if (matchedDispatchFilter !== null) {
      return this.blockedResult(
        effective,
        input,
        ['Continuation prompt matched dispatch filter.'],
        [
          ...evidence,
          {
            code: 'dispatch_filter',
            message: `Dispatch deny pattern #${matchedDispatchFilter + 1} matched the continuation payload.`,
          },
        ],
        riskClasses
      );
    }

    if (
      typeof input.continuationCount === 'number' &&
      input.continuationCount >= effective.maxContinuations
    ) {
      return this.blockedResult(
        effective,
        input,
        ['Continuation cap reached for this run.'],
        [
          ...evidence,
          {
            code: 'continuation_cap',
            message: `Continuation count ${input.continuationCount} reached cap ${effective.maxContinuations}.`,
          },
        ],
        riskClasses
      );
    }

    if (
      effective.spendCapUsd > 0 &&
      typeof input.monthlySpendUsd === 'number' &&
      input.monthlySpendUsd >= effective.spendCapUsd
    ) {
      return this.blockedResult(
        effective,
        input,
        ['Watcher spend cap reached.'],
        [
          ...evidence,
          {
            code: 'spend_cap',
            message: `Monthly watcher spend ${input.monthlySpendUsd} reached cap ${effective.spendCapUsd}.`,
          },
        ],
        riskClasses
      );
    }

    if (effective.mode === 'ask_always') {
      decision = 'require_approval';
      reasons.push('Policy mode ask_always requires approval for every continuation.');
    } else if (filteredRiskClasses.length > 0) {
      decision = 'require_approval';
      reasons.push('Continuation has monitored risk classes and requires approval.');
    } else {
      reasons.push('Continuation is within policy, dispatch, and cap limits.');
    }

    return {
      decision,
      mode: effective.mode,
      riskLevel,
      riskClasses,
      ...(effective.matchedPolicyId ? { matchedPolicyId: effective.matchedPolicyId } : {}),
      reasons,
      evidence,
      caps: {
        maxContinuations: effective.maxContinuations,
        spendCapUsd: effective.spendCapUsd,
      },
      auditLogged: false,
      evaluatedAt: new Date().toISOString(),
    };
  }

  private blockedResult(
    effective: EffectiveWatcherPolicy,
    input: WatcherContinuationEvaluationRequest,
    reasons: string[],
    evidence: WatcherContinuationEvidence[],
    classifiedRiskClasses?: WatcherRiskClass[]
  ): WatcherContinuationEvaluationResult {
    const riskClasses = classifiedRiskClasses ?? this.classifyRisk(input, evidence);
    return {
      decision: 'block',
      mode: effective.mode,
      riskLevel: riskLevelFor(riskClasses),
      riskClasses,
      ...(effective.matchedPolicyId ? { matchedPolicyId: effective.matchedPolicyId } : {}),
      reasons,
      evidence,
      caps: {
        maxContinuations: effective.maxContinuations,
        spendCapUsd: effective.spendCapUsd,
      },
      auditLogged: false,
      evaluatedAt: new Date().toISOString(),
    };
  }

  private classifyRisk(
    input: WatcherContinuationEvaluationRequest,
    evidence: WatcherContinuationEvidence[]
  ): WatcherRiskClass[] {
    const riskClasses = new Set<WatcherRiskClass>(input.riskHints ?? []);
    const payload = [input.prompt, input.command, input.toolName].filter(Boolean).join('\n');

    if (DESTRUCTIVE_COMMAND_PATTERNS.some((pattern) => pattern.test(payload))) {
      riskClasses.add('destructive_command');
      evidence.push({
        riskClass: 'destructive_command',
        code: 'destructive_command_detected',
        message: 'Continuation payload contains destructive command syntax.',
      });
    }

    if (CREDENTIAL_PATTERNS.some((pattern) => pattern.test(payload))) {
      riskClasses.add('credential_reference');
      evidence.push({
        riskClass: 'credential_reference',
        code: 'credential_reference_detected',
        message: 'Continuation payload references credential-like material.',
      });
    }

    if (input.hasRecentTestFailures) {
      riskClasses.add('recent_test_failure');
      evidence.push({
        riskClass: 'recent_test_failure',
        code: 'recent_test_failure',
        message: 'Recent test failures are attached to this run.',
      });
    }

    if ((input.recentProviderErrors ?? 0) > 0) {
      riskClasses.add('provider_error');
      evidence.push({
        riskClass: 'provider_error',
        code: 'provider_error',
        message: 'Recent AI/provider errors are attached to this run.',
      });
    }

    if ((input.policyViolations?.length ?? 0) > 0) {
      riskClasses.add('policy_violation');
      evidence.push({
        riskClass: 'policy_violation',
        code: 'policy_violation',
        message: 'Policy violations are attached to this continuation request.',
      });
    }

    return Array.from(riskClasses);
  }

  private findDispatchFilterMatch(
    input: WatcherContinuationEvaluationRequest,
    patterns: string[]
  ): number | null {
    if (patterns.length === 0) return null;
    const payload = [input.prompt, input.command, input.toolName]
      .filter(Boolean)
      .join('\n')
      .toLowerCase();

    return patterns.findIndex((pattern) => {
      const normalized = pattern.trim().toLowerCase();
      return normalized.length > 0 && payload.includes(normalized);
    });
  }

  private resolvePolicy(input: WatcherContinuationEvaluationRequest): EffectiveWatcherPolicy {
    const matched = [...this.settings.policies]
      .filter((policy) => policy.enabled && policyMatches(policy, input))
      .sort((a, b) => policySpecificity(b) - policySpecificity(a))[0];

    return {
      mode: matched?.mode ?? this.settings.defaultMode,
      maxContinuations: matched?.maxContinuations ?? this.settings.maxContinuationsPerRun,
      spendCapUsd: matched?.spendCapUsd ?? this.settings.spendCapUsd,
      riskClasses: matched?.riskClasses ?? this.settings.riskClasses,
      dispatchDenyPatterns: [
        ...this.settings.dispatchDenyPatterns,
        ...(matched?.dispatchDenyPatterns ?? []),
      ],
      ...(matched ? { matchedPolicyId: matched.id } : {}),
    };
  }
}

let watcherPolicyService: WatcherPolicyService | null = null;

export function getWatcherPolicyService(): WatcherPolicyService {
  if (!watcherPolicyService) {
    watcherPolicyService = new WatcherPolicyService();
  }
  return watcherPolicyService;
}

export function setWatcherContinuationSettings(
  settings: WatcherContinuationSettings | undefined
): void {
  getWatcherPolicyService().configure(settings);
}

export function resetWatcherPolicyServiceForTests(service?: WatcherPolicyService): void {
  watcherPolicyService = service ?? null;
}

function policyMatches(
  policy: WatcherContinuationPolicy,
  input: WatcherContinuationEvaluationRequest
): boolean {
  if (policy.project && policy.project !== input.project) return false;
  if (policy.agent && policy.agent !== input.agent) return false;
  return true;
}

function policySpecificity(policy: WatcherContinuationPolicy): number {
  return Number(Boolean(policy.project)) + Number(Boolean(policy.agent));
}

function riskLevelFor(riskClasses: WatcherRiskClass[]): WatcherRiskLevel {
  return riskClasses.reduce<WatcherRiskLevel>((max, riskClass) => {
    const level = RISK_LEVEL_BY_CLASS[riskClass];
    return RISK_LEVEL_WEIGHT[level] > RISK_LEVEL_WEIGHT[max] ? level : max;
  }, 'low');
}

function normalizeSettings(settings: WatcherContinuationSettings): WatcherContinuationSettings {
  return {
    ...DEFAULT_FEATURE_SETTINGS.watcherContinuations,
    ...cloneJson(settings),
    policies: settings.policies?.map((policy) => ({ ...policy })) ?? [],
  };
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
