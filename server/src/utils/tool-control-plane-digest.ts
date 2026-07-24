import type {
  RunToolCatalog,
  ToolServerDefinition,
  ToolServerDefinitionInput,
  ToolServerDiscovery,
} from '@veritas-kanban/shared';
import { digestRunLaunchValue } from './run-launch-manifest-digest.js';

export function calculateToolServerDefinitionDigest(
  definition: ToolServerDefinitionInput | ToolServerDefinition
): string {
  const {
    schemaVersion: _schemaVersion,
    digest: _digest,
    createdAt: _createdAt,
    updatedAt: _updatedAt,
    ...payload
  } = definition as ToolServerDefinition;
  return digestRunLaunchValue(payload);
}

export function calculateToolDiscoveryDigest(discovery: ToolServerDiscovery): string {
  const { digest: _digest, discoveredAt: _discoveredAt, ...payload } = discovery;
  return digestRunLaunchValue(payload);
}

export function calculateRunToolCatalogDigest(catalog: RunToolCatalog): string {
  const { digest: _digest, createdAt: _createdAt, ...payload } = catalog;
  return digestRunLaunchValue(payload);
}
