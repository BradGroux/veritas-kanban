import type { AdmissionQueueDraft, AdmissionQueueEntry } from '@veritas-kanban/shared';

type QueueIdentity = Pick<AdmissionQueueEntry, 'agent' | 'target'>;

export function sameAdmissionQueueTarget(
  existing: QueueIdentity,
  requested: Pick<AdmissionQueueDraft, 'agent' | 'target'>
): boolean {
  const existingTarget =
    existing.target ?? (existing.agent ? { kind: 'direct', agent: existing.agent } : undefined);
  const requestedTarget =
    requested.target ?? (requested.agent ? { kind: 'direct', agent: requested.agent } : undefined);
  return JSON.stringify(existingTarget) === JSON.stringify(requestedTarget);
}
