import { createHash } from 'node:crypto';
import type { TaskEnvelope } from '@veritas-kanban/shared';

export type TaskEnvelopePayload = Omit<TaskEnvelope, 'digest'>;

export function calculateTaskEnvelopeDigest(envelope: TaskEnvelopePayload): string {
  return `sha256:${createHash('sha256').update(JSON.stringify(envelope)).digest('hex')}`;
}

export function verifyTaskEnvelopeDigest(envelope: TaskEnvelope): boolean {
  const { digest: _digest, ...payload } = envelope;
  return envelope.digest === calculateTaskEnvelopeDigest(payload);
}
