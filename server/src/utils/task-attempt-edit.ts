import type { TaskAttempt } from '@veritas-kanban/shared';
import { ValidationError } from '../middleware/error-handler.js';

// The historical generic task editor supports only these legacy fields. Any
// additional field identifies server-owned evidence, including future contracts.
const LEGACY_ATTEMPT_FIELDS = new Set([
  'id',
  'agent',
  'status',
  'started',
  'ended',
  'provider',
  'model',
  'threadId',
  'cloudUrl',
  'cloudTarget',
  'orchestration',
]);

export function assertLegacyAttemptEditable(attempt: TaskAttempt | undefined): void {
  if (attempt && Object.keys(attempt).some((key) => !LEGACY_ATTEMPT_FIELDS.has(key))) {
    throw new ValidationError('Managed attempts can only be changed through run lifecycle APIs');
  }
}
