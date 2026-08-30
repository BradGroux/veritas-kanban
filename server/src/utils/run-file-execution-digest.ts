import type { RunFileExecutionApprovalEvidence } from '@veritas-kanban/shared';
import { digestRunLaunchValue } from './run-launch-manifest-digest.js';

export function calculateRunFileExecutionEvidenceDigest(
  evidence: RunFileExecutionApprovalEvidence | Omit<RunFileExecutionApprovalEvidence, 'digest'>
): string {
  const { digest: _digest, ...material } = evidence as RunFileExecutionApprovalEvidence;
  return digestRunLaunchValue(material);
}

export function verifyRunFileExecutionEvidenceDigest(
  evidence: RunFileExecutionApprovalEvidence
): boolean {
  return evidence.digest === calculateRunFileExecutionEvidenceDigest(evidence);
}
