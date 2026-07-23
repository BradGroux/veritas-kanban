import {
  COMPLETION_RESULT_SCHEMA_VERSION,
  TASK_ENVELOPE_SCHEMA_VERSION,
  type CompletionResult,
  type Task,
  type TaskCompletionArtifact,
  type TaskCompletionBlocker,
  type TaskCompletionEvidence,
  type TaskCompletionStatus,
  type TaskCompletionVerification,
  type TaskEnvelope,
  type TaskEvidenceKind,
  type TaskTerminalSource,
} from '@veritas-kanban/shared';
import {
  parseCompletionResultForEnvelope,
  parseTaskEnvelope,
} from '../schemas/task-envelope-schemas.js';
import {
  calculateCompletionResultDigest,
  type CompletionResultPayload,
} from '../utils/completion-result-digest.js';
import { digestRunLaunchValue } from '../utils/run-launch-manifest-digest.js';
import {
  GitCompletionEvidenceSource,
  type CompletionEvidenceSnapshot,
  type CompletionEvidenceSource,
} from './task-envelope-service.js';
import { redactString } from '../lib/redact.js';

const MAX_TEXT_LENGTH = 20_000;
const MAX_SHORT_TEXT_LENGTH = 500;
const MAX_PROVIDER_EVIDENCE = 128;
const MAX_PROVIDER_ARTIFACTS = 64;

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]'],
  [/\bBasic\s+[A-Za-z0-9+/=]+/gi, 'Basic [REDACTED]'],
  [/\bsk-[A-Za-z0-9_-]{8,}/g, 'sk-[REDACTED]'],
  [/\bgh[pousr]_[A-Za-z0-9_]{8,}/gi, '[REDACTED_GITHUB_TOKEN]'],
  [/\bgithub_pat_[A-Za-z0-9_]{8,}/g, 'github_pat_[REDACTED]'],
  [
    /\b([A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_KEY|ACCESS_KEY)[A-Z0-9_]*)\s*=\s*([^\s"'`]+)/gi,
    '$1=[REDACTED]',
  ],
  [/\b(api[_-]?key|token|secret|password|authorization)\s*[:=]\s*([^\s"'`,}]+)/gi, '$1=[REDACTED]'],
];

export interface ProviderCompletionEvidenceClaim {
  id: string;
  kind: TaskEvidenceKind;
  summary: string;
  reference?: string | null;
  requirementIds?: string[];
}

export interface ProviderCompletionArtifactClaim {
  id: string;
  kind: TaskCompletionArtifact['kind'];
  name: string;
  reference: string;
  mediaType?: string | null;
  sha256?: string | null;
}

export interface ProviderTerminalClaim {
  terminalSource: TaskTerminalSource;
  status: TaskCompletionStatus;
  summary?: string;
  error?: string;
  blockers?: TaskCompletionBlocker[];
  evidence?: ProviderCompletionEvidenceClaim[];
  artifacts?: ProviderCompletionArtifactClaim[];
  verification?: TaskCompletionVerification[];
  continuation?: CompletionResult['continuation'];
}

export interface LegacyProviderTerminalClaim {
  success: boolean;
  summary?: string;
  error?: string;
}

export interface CompleteProviderRunInput {
  task: Task;
  taskEnvelope: TaskEnvelope;
  claim: ProviderTerminalClaim;
}

type TerminalEvidenceSource = Pick<CompletionEvidenceSource, 'captureCompletionEvidence'>;

export class ProviderCompletionService {
  constructor(
    private readonly evidenceSource: TerminalEvidenceSource = new GitCompletionEvidenceSource(),
    private readonly now: () => string = () => new Date().toISOString()
  ) {}

  normalizeLegacyClaim(
    claim: LegacyProviderTerminalClaim,
    terminalSource: TaskTerminalSource
  ): ProviderTerminalClaim {
    return {
      terminalSource,
      status: claim.success ? 'success' : 'failed',
      summary: claim.summary,
      error: claim.success
        ? undefined
        : claim.error || claim.summary || 'Provider reported failure.',
    };
  }

  idempotencyKey(input: { taskEnvelope: TaskEnvelope; claim: ProviderTerminalClaim }): string {
    const taskEnvelope = parseTaskEnvelope(input.taskEnvelope);
    return digestRunLaunchValue({
      taskId: taskEnvelope.subject.id,
      attemptId: taskEnvelope.attempt.id,
      taskEnvelopeDigest: taskEnvelope.digest,
      providerRuntimeManifestDigest: taskEnvelope.launchManifest.digest,
      claim: sanitizeClaim(input.claim),
    });
  }

  async complete(input: CompleteProviderRunInput): Promise<CompletionResult> {
    const taskEnvelope = parseTaskEnvelope(input.taskEnvelope);
    if (taskEnvelope.subject.id !== input.task.id) {
      throw new Error('Completion task does not match the persisted task envelope');
    }
    const claim = sanitizeClaim(input.claim);
    const completedAt = this.now();
    const idempotencyKey = this.idempotencyKey({
      taskEnvelope: input.taskEnvelope,
      claim,
    });
    const reportedArtifacts: TaskCompletionArtifact[] = claim.artifacts.map((artifact) => ({
      id: artifact.id,
      kind: artifact.kind,
      name: artifact.name,
      reference: artifact.reference,
      mediaType: artifact.mediaType ?? null,
      sha256: artifact.sha256 ?? null,
      verified: false,
    }));
    const snapshot = await this.evidenceSource.captureCompletionEvidence({
      task: input.task,
      taskEnvelope,
      capturedAt: completedAt,
      reportedArtifacts,
    });
    assertBoundedSnapshot(snapshot);

    const policy = evaluateCompletionPolicy(taskEnvelope, claim.status, snapshot);
    const status = policy.status;
    const evidence = buildCompletionEvidence(taskEnvelope, claim, snapshot);
    const verification = mergeVerification(taskEnvelope, claim.verification, snapshot.verification);
    const error =
      status === 'success'
        ? null
        : status === 'failed'
          ? sanitizeText(claim.error || claim.summary || 'Provider reported failure.')
          : claim.error
            ? sanitizeText(claim.error)
            : null;
    const blockers =
      status === 'blocked' && claim.blockers.length === 0
        ? [
            {
              code: 'provider-blocked',
              summary: 'Provider reported a blocked run',
              detail: claim.summary,
              retryable: true,
            },
          ]
        : [...claim.blockers, ...policy.blockers].slice(0, 64);
    const payload: CompletionResultPayload = {
      schemaVersion: COMPLETION_RESULT_SCHEMA_VERSION,
      idempotencyKey,
      completedAt,
      terminalSource: claim.terminalSource,
      taskEnvelopeSchemaVersion: TASK_ENVELOPE_SCHEMA_VERSION,
      taskEnvelopeDigest: taskEnvelope.digest,
      taskId: taskEnvelope.subject.id,
      attemptId: taskEnvelope.attempt.id,
      providerRuntimeManifestDigest: taskEnvelope.launchManifest.digest,
      status,
      summary: claim.summary,
      error,
      blockers,
      evidence,
      changedFiles: snapshot.changedFiles.slice(0, 2000),
      artifacts: snapshot.artifacts.slice(0, 256),
      verification,
      sideEffects: snapshot.sideEffects
        .slice(0, 256)
        .map((sideEffect) =>
          sideEffect.kind === 'git-commit' && taskEnvelope.commitPolicy === 'forbidden'
            ? { ...sideEffect, authorized: false }
            : sideEffect
        ),
      continuation: claim.continuation,
    };
    const result = parseCompletionResultForEnvelope(
      {
        ...payload,
        digest: calculateCompletionResultDigest(payload),
      },
      taskEnvelope
    );
    return deepFreeze(structuredClone(result));
  }
}

function sanitizeClaim(claim: ProviderTerminalClaim): Required<ProviderTerminalClaim> {
  const summary = sanitizeText(
    claim.summary ||
      claim.error ||
      (claim.status === 'success'
        ? 'Provider completed without a final summary.'
        : `Provider reported ${claim.status}.`)
  );
  return {
    terminalSource: claim.terminalSource,
    status: claim.status,
    summary,
    error: claim.error ? sanitizeText(claim.error) : '',
    blockers: (claim.blockers ?? []).slice(0, 64).map((blocker) => ({
      code: sanitizeIdentifier(blocker.code),
      summary: sanitizeText(blocker.summary, MAX_SHORT_TEXT_LENGTH),
      detail: sanitizeText(blocker.detail),
      retryable: blocker.retryable,
    })),
    evidence: (claim.evidence ?? []).slice(0, MAX_PROVIDER_EVIDENCE).map((evidence) => ({
      id: sanitizeIdentifier(evidence.id),
      kind: evidence.kind,
      summary: sanitizeText(evidence.summary),
      reference: evidence.reference ? sanitizeText(evidence.reference, 4096) : null,
      requirementIds: (evidence.requirementIds ?? [])
        .slice(0, 64)
        .map((id) => sanitizeIdentifier(id)),
    })),
    artifacts: (claim.artifacts ?? []).slice(0, MAX_PROVIDER_ARTIFACTS).map((artifact) => ({
      id: sanitizeIdentifier(artifact.id),
      kind: artifact.kind,
      name: sanitizeText(artifact.name, MAX_SHORT_TEXT_LENGTH),
      reference: sanitizeText(artifact.reference, 4096),
      mediaType: artifact.mediaType ? sanitizeText(artifact.mediaType, 200) : null,
      sha256: /^[a-f0-9]{64}$/.test(artifact.sha256 ?? '') ? (artifact.sha256 ?? null) : null,
    })),
    verification: (claim.verification ?? []).slice(0, 256).map((verification) => ({
      gateId: sanitizeIdentifier(verification.gateId),
      status: verification.status,
      summary: sanitizeText(verification.summary),
      evidenceIds: verification.evidenceIds.slice(0, 128).map((id) => sanitizeIdentifier(id)),
    })),
    continuation: claim.continuation
      ? {
          provider: sanitizeIdentifier(claim.continuation.provider),
          kind: claim.continuation.kind,
          reference: sanitizeText(claim.continuation.reference, 4096),
        }
      : null,
  };
}

function evaluateCompletionPolicy(
  envelope: TaskEnvelope,
  claimedStatus: TaskCompletionStatus,
  snapshot: CompletionEvidenceSnapshot
): { status: TaskCompletionStatus; blockers: TaskCompletionBlocker[] } {
  if (claimedStatus !== 'success') return { status: claimedStatus, blockers: [] };

  const blockers: TaskCompletionBlocker[] = [];
  if (envelope.commitPolicy === 'required' && snapshot.commits.length === 0) {
    blockers.push({
      code: 'required-commit-missing',
      summary: 'Required commit was not created',
      detail: 'The launch contract required at least one commit attributable to this attempt.',
      retryable: true,
    });
  }
  if (envelope.commitPolicy === 'forbidden' && snapshot.commits.length > 0) {
    blockers.push({
      code: 'forbidden-commit-created',
      summary: 'Forbidden commit was created',
      detail: 'The launch contract prohibited commits, but the harness observed a new commit.',
      retryable: false,
    });
  }
  for (const sideEffect of snapshot.sideEffects.filter((effect) => !effect.authorized)) {
    blockers.push({
      code: `unauthorized-${sideEffect.kind}`,
      summary: 'Unauthorized side effect observed',
      detail: `${sideEffect.description}${sideEffect.target ? ` Target: ${sideEffect.target}` : ''}`,
      retryable: false,
    });
  }
  const verificationByGate = new Map(snapshot.verification.map((gate) => [gate.gateId, gate]));
  for (const gate of envelope.verificationGates.filter((entry) => entry.required)) {
    if (verificationByGate.get(gate.id)?.status !== 'passed') {
      blockers.push({
        code: `verification-missing-${gate.id}`,
        summary: 'Required verification evidence is missing',
        detail: gate.description,
        retryable: true,
      });
    }
  }
  for (const output of envelope.expectedOutputs.filter((entry) => entry.required)) {
    if (output.kind === 'text' && output.id === 'completion-summary') continue;
    if (output.kind === 'commit') continue;
    if (
      (output.kind === 'file' || output.kind === 'artifact') &&
      !snapshot.artifacts.some((artifact) => artifact.id === output.id && artifact.verified)
    ) {
      blockers.push({
        code: `expected-output-missing-${output.id}`,
        summary: 'Required output is missing or unverified',
        detail: output.description,
        retryable: true,
      });
    }
  }
  return {
    status: blockers.length > 0 ? 'partial' : 'success',
    blockers: blockers.slice(0, 64),
  };
}

function buildCompletionEvidence(
  envelope: TaskEnvelope,
  claim: Required<ProviderTerminalClaim>,
  snapshot: CompletionEvidenceSnapshot
): TaskCompletionEvidence[] {
  const evidence: TaskCompletionEvidence[] = [
    {
      id: `terminal-${claim.terminalSource}`,
      kind: 'provider-output',
      source: 'harness',
      summary: `Harness observed the ${claim.terminalSource} terminal path.`,
      reference: null,
      requirementIds: ['terminal-state'],
      verified: true,
    },
  ];
  for (const providerEvidence of claim.evidence) {
    evidence.push({
      id: providerEvidence.id.startsWith('provider-')
        ? providerEvidence.id
        : `provider-${providerEvidence.id}`,
      kind: providerEvidence.kind,
      source: 'provider',
      summary: providerEvidence.summary,
      reference: providerEvidence.reference ?? null,
      requirementIds: providerEvidence.requirementIds ?? [],
      verified: false,
    });
  }
  if (snapshot.changedFiles.length > 0) {
    evidence.push({
      id: 'file-changes',
      kind: 'file-change',
      source: 'harness',
      summary: `Harness attributed ${snapshot.changedFiles.length} changed file${snapshot.changedFiles.length === 1 ? '' : 's'} to this attempt.`,
      reference: snapshot.headSha,
      requirementIds: [],
      verified: true,
    });
  }
  if (snapshot.commits.length > 0) {
    evidence.push({
      id: 'commits',
      kind: 'commit',
      source: 'harness',
      summary: `Harness attributed ${snapshot.commits.length} commit${snapshot.commits.length === 1 ? '' : 's'} to this attempt.`,
      reference: snapshot.commits[0]?.sha ?? null,
      requirementIds: envelope.commitPolicy === 'required' ? ['commit'] : [],
      verified: true,
    });
  }
  for (const verification of snapshot.verification.filter((gate) => gate.status === 'passed')) {
    evidence.push({
      id: `verification-${verification.gateId}`,
      kind: 'verification',
      source: 'harness',
      summary: verification.summary,
      reference: null,
      requirementIds: ['verification'],
      verified: true,
    });
  }
  for (const artifact of snapshot.artifacts.filter((entry) => entry.verified)) {
    evidence.push({
      id: `artifact-${artifact.id}`,
      kind: 'artifact',
      source: 'harness',
      summary: `Harness verified artifact ${artifact.name}.`,
      reference: artifact.reference,
      requirementIds: [],
      verified: true,
    });
  }
  return evidence.slice(0, 512);
}

function mergeVerification(
  envelope: TaskEnvelope,
  providerVerification: TaskCompletionVerification[],
  harnessVerification: TaskCompletionVerification[]
): TaskCompletionVerification[] {
  const providerByGate = new Map(providerVerification.map((entry) => [entry.gateId, entry]));
  const harnessByGate = new Map(harnessVerification.map((entry) => [entry.gateId, entry]));
  return envelope.verificationGates.map((gate) => {
    const harness = harnessByGate.get(gate.id);
    if (harness?.status === 'passed') {
      return {
        ...harness,
        evidenceIds: [`verification-${gate.id}`],
      };
    }
    const provider = providerByGate.get(gate.id);
    return {
      gateId: gate.id,
      status: harness?.status ?? 'unknown',
      summary:
        harness?.summary ??
        (provider
          ? `Provider reported ${provider.status}, but no harness-verifiable evidence corroborated it.`
          : 'No completion verification was reported.'),
      evidenceIds: [],
    };
  });
}

function assertBoundedSnapshot(snapshot: CompletionEvidenceSnapshot): void {
  if (snapshot.changedFiles.length > 2000)
    throw new Error('Completion evidence exceeds 2000 files');
  if (snapshot.commits.length > 256) throw new Error('Completion evidence exceeds 256 commits');
  if (snapshot.artifacts.length > 256) throw new Error('Completion evidence exceeds 256 artifacts');
  if (snapshot.verification.length > 256) {
    throw new Error('Completion evidence exceeds 256 verification results');
  }
  if (snapshot.sideEffects.length > 256) {
    throw new Error('Completion evidence exceeds 256 side effects');
  }
}

function sanitizeText(value: string, maxLength = MAX_TEXT_LENGTH): string {
  let sanitized = redactString(value.trim());
  for (const [pattern, replacement] of SECRET_PATTERNS) {
    sanitized = sanitized.replace(pattern, replacement);
  }
  sanitized = sanitized.slice(0, maxLength).trim();
  return sanitized || 'No details provided.';
}

function sanitizeIdentifier(value: string): string {
  return sanitizeText(value, 160).replace(/\s+/g, '-');
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return value;
}
