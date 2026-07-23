import { createHash } from 'node:crypto';
import type {
  CredentialAction,
  CredentialDefinition,
  CredentialScope,
} from '@veritas-kanban/shared';
import { digestRunLaunchValue } from './run-launch-manifest-digest.js';

export type CredentialDefinitionPayload = Omit<CredentialDefinition, 'digest'>;

export function calculateCredentialDefinitionDigest(
  definition: CredentialDefinitionPayload | CredentialDefinition
): string {
  const {
    digest: _digest,
    createdAt: _createdAt,
    updatedAt: _updatedAt,
    ...payload
  } = definition as CredentialDefinition;
  return digestRunLaunchValue(payload);
}

export function verifyCredentialDefinitionDigest(definition: CredentialDefinition): boolean {
  return definition.digest === calculateCredentialDefinitionDigest(definition);
}

export function calculateCredentialScopeDigest(scope: CredentialScope): string {
  return digestRunLaunchValue(scope);
}

export function calculateCredentialActionFingerprint(action: CredentialAction): string {
  return digestRunLaunchValue(action);
}

export function hashCredentialHandle(handle: string): string {
  return createHash('sha256').update(handle, 'utf8').digest('hex');
}
