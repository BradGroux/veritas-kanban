import { createHash } from 'node:crypto';
import type {
  AdmissionQueueEntry,
  AdmissionQueuePriority,
  AdmissionQueueSchedulerSettings,
  AdmissionQueueSelectionEvidence,
} from '@veritas-kanban/shared';

export interface RankedAdmissionQueueCandidate {
  entry: AdmissionQueueEntry;
  workspaceKey: string;
  rawPriority: number;
  ageMs: number;
  agePromotion: number;
  effectivePriority: number;
  workspaceTurn: 'normal' | 'fairness-promoted';
}

export interface AdmissionQueueRanking {
  candidates: RankedAdmissionQueueCandidate[];
  snapshotSize: number;
  evaluatedCount: number;
  deferredWorkspaceKey?: string;
}

export interface AdmissionQueueOrdering {
  candidates: RankedAdmissionQueueCandidate[];
  snapshotSize: number;
  deferredWorkspaceKey?: string;
}

export interface RankAdmissionQueueEntriesInput {
  entries: AdmissionQueueEntry[];
  history: AdmissionQueueSelectionEvidence[];
  now: string;
  settings: AdmissionQueueSchedulerSettings;
}

export function rankAdmissionQueueEntries(
  input: RankAdmissionQueueEntriesInput
): AdmissionQueueRanking {
  const ordered = orderAdmissionQueueEntries(input);
  const evaluated = ordered.candidates.slice(0, input.settings.evaluationLimit);

  return {
    candidates: evaluated,
    snapshotSize: ordered.snapshotSize,
    evaluatedCount: evaluated.length,
    ...(ordered.deferredWorkspaceKey ? { deferredWorkspaceKey: ordered.deferredWorkspaceKey } : {}),
  };
}

export function orderAdmissionQueueEntries(
  input: RankAdmissionQueueEntriesInput
): AdmissionQueueOrdering {
  assertSchedulerSettings(input.settings);
  const nowMs = Date.parse(input.now);
  if (!Number.isFinite(nowMs)) throw new Error('Admission scheduler requires a valid timestamp.');

  const eligible = [...input.entries]
    .filter(
      (entry) =>
        ['queued', 'requeued'].includes(entry.state) && Date.parse(entry.availableAt) <= nowMs
    )
    .sort(compareStable);
  const history = [...input.history].sort(
    (left, right) =>
      Date.parse(right.selectedAt) - Date.parse(left.selectedAt) ||
      left.selectedQueueEntryId.localeCompare(right.selectedQueueEntryId)
  );
  const deferredWorkspaceKey = workspaceAtBurstLimit(history, input.settings.workspaceBurstLimit);
  const candidates = eligible.map((entry) =>
    scoreAdmissionQueueEntryAt(entry, nowMs, input.settings)
  );
  const fairnessApplies =
    deferredWorkspaceKey !== undefined &&
    candidates.some((candidate) => candidate.workspaceKey !== deferredWorkspaceKey);

  candidates.sort((left, right) => {
    if (fairnessApplies) {
      const leftDeferred = left.workspaceKey === deferredWorkspaceKey;
      const rightDeferred = right.workspaceKey === deferredWorkspaceKey;
      if (leftDeferred !== rightDeferred) return leftDeferred ? 1 : -1;
    }
    return (
      right.effectivePriority - left.effectivePriority ||
      left.entry.enqueueSequence - right.entry.enqueueSequence ||
      left.entry.id.localeCompare(right.entry.id)
    );
  });

  if (fairnessApplies) {
    for (let index = 0; index < candidates.length; index++) {
      if (candidates[index]?.workspaceKey === deferredWorkspaceKey) break;
      candidates[index] = { ...candidates[index], workspaceTurn: 'fairness-promoted' };
    }
  }
  return {
    candidates,
    snapshotSize: eligible.length,
    ...(fairnessApplies ? { deferredWorkspaceKey } : {}),
  };
}

export function scoreAdmissionQueueEntry(
  entry: AdmissionQueueEntry,
  now: string,
  settings: AdmissionQueueSchedulerSettings
): RankedAdmissionQueueCandidate {
  assertSchedulerSettings(settings);
  const nowMs = Date.parse(now);
  if (!Number.isFinite(nowMs)) throw new Error('Admission scheduler requires a valid timestamp.');
  return scoreAdmissionQueueEntryAt(entry, nowMs, settings);
}

function scoreAdmissionQueueEntryAt(
  entry: AdmissionQueueEntry,
  nowMs: number,
  settings: AdmissionQueueSchedulerSettings
): RankedAdmissionQueueCandidate {
  const rawPriority = normalizeNumericPriority(
    entry.priority ?? settings.defaultPriority,
    settings
  );
  const ageMs = Math.max(0, nowMs - Date.parse(entry.createdAt));
  const agePromotion = Math.min(
    settings.maxAgePromotion,
    Math.floor(ageMs / settings.agingIntervalMs)
  );
  return {
    entry,
    workspaceKey: workspaceKey(entry.request.workspaceId),
    rawPriority,
    ageMs,
    agePromotion,
    effectivePriority: Math.min(settings.priorityLevels - 1, rawPriority + agePromotion),
    workspaceTurn: 'normal',
  };
}

export function resolveAdmissionQueuePriority(
  priority: AdmissionQueuePriority | undefined,
  settings: AdmissionQueueSchedulerSettings
): number {
  assertSchedulerSettings(settings);
  if (priority === undefined) return settings.defaultPriority;
  if (typeof priority === 'number') return normalizeNumericPriority(priority, settings);
  const highest = settings.priorityLevels - 1;
  switch (priority) {
    case 'low':
      return 0;
    case 'medium':
      return Math.round(highest / 3);
    case 'high':
      return Math.round((highest * 2) / 3);
    case 'critical':
      return highest;
  }
}

export function workspaceKey(workspaceId: string): string {
  return redactedKey(workspaceId);
}

export function admissionScopeKey(scope: string, scopeId: string): string {
  return redactedKey(`${scope}:${scopeId}`);
}

export function assertSchedulerSettings(settings: AdmissionQueueSchedulerSettings): void {
  if (
    !Number.isInteger(settings.priorityLevels) ||
    settings.priorityLevels < 2 ||
    settings.priorityLevels > 16 ||
    !Number.isInteger(settings.defaultPriority) ||
    settings.defaultPriority < 0 ||
    settings.defaultPriority >= settings.priorityLevels ||
    !Number.isInteger(settings.agingIntervalMs) ||
    settings.agingIntervalMs < 1_000 ||
    !Number.isInteger(settings.maxAgePromotion) ||
    settings.maxAgePromotion < settings.priorityLevels - 1 ||
    settings.maxAgePromotion > 15 ||
    !Number.isInteger(settings.workspaceBurstLimit) ||
    settings.workspaceBurstLimit < 1 ||
    !Number.isInteger(settings.evaluationLimit) ||
    settings.evaluationLimit < 1 ||
    settings.evaluationLimit > 256
  ) {
    throw new Error('Invalid admission queue scheduler settings.');
  }
}

function normalizeNumericPriority(
  priority: number,
  settings: AdmissionQueueSchedulerSettings
): number {
  if (!Number.isInteger(priority) || priority < 0 || priority >= settings.priorityLevels) {
    throw new Error('Admission queue priority is outside the configured priority levels.');
  }
  return priority;
}

function compareStable(left: AdmissionQueueEntry, right: AdmissionQueueEntry): number {
  return left.enqueueSequence - right.enqueueSequence || left.id.localeCompare(right.id);
}

function workspaceAtBurstLimit(
  history: AdmissionQueueSelectionEvidence[],
  burstLimit: number
): string | undefined {
  const latestWorkspace = history[0]?.workspaceKey;
  if (!latestWorkspace) return undefined;
  let consecutive = 0;
  for (const selection of history) {
    if (selection.workspaceKey !== latestWorkspace) break;
    consecutive += 1;
  }
  return consecutive >= burstLimit ? latestWorkspace : undefined;
}

function redactedKey(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}
