import type { WorkspaceCheckpointRewindPreview } from '@veritas-kanban/shared';
import { digestRunLaunchValue } from './run-launch-manifest-digest.js';

type WorkspaceCheckpointRewindEvidenceInput =
  | WorkspaceCheckpointRewindPreview
  | Omit<WorkspaceCheckpointRewindPreview, 'digest' | 'evidenceDigest'>;

export function digestWorkspaceCheckpointRewindEvidence(
  input: WorkspaceCheckpointRewindEvidenceInput
): string {
  const {
    digest: _digest,
    evidenceDigest: _evidenceDigest,
    ownership,
    current,
    ...preview
  } = input as WorkspaceCheckpointRewindPreview;
  const { verifiedAt: _verifiedAt, ...stableOwnership } = ownership;
  const { inspectedAt: _inspectedAt, digest: _currentDigest, ...stableCurrent } = current;
  return digestRunLaunchValue({
    ...preview,
    ownership: stableOwnership,
    current: stableCurrent,
  });
}
