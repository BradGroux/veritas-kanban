import type { CompletionResult } from '@veritas-kanban/shared';
import { digestRunLaunchValue } from './run-launch-manifest-digest.js';

export type CompletionResultPayload = Omit<CompletionResult, 'digest'>;

export function calculateCompletionResultDigest(
  result: CompletionResultPayload | CompletionResult
): string {
  const { digest: _digest, ...payload } = result as CompletionResult;
  return digestRunLaunchValue(payload);
}

export function verifyCompletionResultDigest(result: CompletionResult): boolean {
  return result.digest === calculateCompletionResultDigest(result);
}
