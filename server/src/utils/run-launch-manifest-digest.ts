import { createHash } from 'node:crypto';
import type { RunLaunchManifest } from '@veritas-kanban/shared';

export type RunLaunchManifestPayload = Omit<RunLaunchManifest, 'digest'>;

export function calculateRunLaunchManifestDigest(
  manifest: RunLaunchManifestPayload | RunLaunchManifest
): string {
  const { digest: _digest, ...payload } = manifest as RunLaunchManifest;
  return digestRunLaunchValue(payload);
}

export function verifyRunLaunchManifestDigest(manifest: RunLaunchManifest): boolean {
  return manifest.digest === calculateRunLaunchManifestDigest(manifest);
}

export function digestRunLaunchValue(value: unknown): string {
  return `sha256:${createHash('sha256').update(stableStringify(value)).digest('hex')}`;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortObjectKeys(value)) ?? 'undefined';
}

function sortObjectKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sortObjectKeys(entry));
  }
  if (!value || typeof value !== 'object') {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, sortObjectKeys(entry)])
  );
}
