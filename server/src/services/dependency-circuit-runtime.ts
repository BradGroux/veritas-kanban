import path from 'node:path';
import type { DependencyIdentity } from '@veritas-kanban/shared';
import {
  FileDependencyCircuitStateRepository,
  InMemoryDependencyCircuitStateRepository,
} from '../storage/dependency-circuit-state-repository.js';
import { getDataDir } from '../utils/paths.js';
import { opaqueDependencyId } from './dependency-circuit-breaker.js';
import { DependencyCircuitRegistryService } from './dependency-circuit-registry-service.js';
import { DependencyCircuitExecutionService } from './dependency-circuit-routing-service.js';

let registry: DependencyCircuitRegistryService | undefined;
let execution: DependencyCircuitExecutionService | undefined;

export function getDependencyCircuitRegistryService(): DependencyCircuitRegistryService {
  registry ??= new DependencyCircuitRegistryService({
    repository: new FileDependencyCircuitStateRepository(
      path.join(getDataDir(), 'dependency-circuits')
    ),
  });
  return registry;
}

export function getDependencyCircuitExecutionService(): DependencyCircuitExecutionService {
  execution ??= new DependencyCircuitExecutionService(getDependencyCircuitRegistryService());
  return execution;
}

export function defaultDependencyCircuitExecutionService(): DependencyCircuitExecutionService {
  if (process.env.NODE_ENV === 'test') {
    return new DependencyCircuitExecutionService(
      new DependencyCircuitRegistryService({
        repository: new InMemoryDependencyCircuitStateRepository(),
      })
    );
  }
  return getDependencyCircuitExecutionService();
}

export function providerDependencyIdentity(
  provider: string,
  model?: string,
  workspaceId = 'local'
): DependencyIdentity {
  return {
    kind: 'model-endpoint',
    id: opaqueDependencyId(`provider:${provider}:model:${model ?? 'default'}`),
    workspaceId,
    provider,
    ...(model ? { model } : {}),
  };
}

export function toolServerDependencyIdentity(
  serverId: string,
  provider?: string,
  workspaceId = 'local'
): DependencyIdentity {
  return {
    kind: 'mcp-server',
    id: opaqueDependencyId(`mcp:${serverId}`),
    workspaceId,
    ...(provider ? { provider } : {}),
  };
}

export function integrationDependencyIdentity(
  endpointId: string,
  integrationType?: string,
  workspaceId = 'local'
): DependencyIdentity {
  return {
    kind: 'integration',
    id: opaqueDependencyId(`integration:${endpointId}`),
    workspaceId,
    ...(integrationType ? { provider: integrationType } : {}),
  };
}

export function storageDependencyIdentity(
  backend: string,
  workspaceId = 'local'
): DependencyIdentity {
  return {
    kind: 'storage',
    id: opaqueDependencyId(`storage:${backend}`),
    workspaceId,
    provider: backend,
  };
}
