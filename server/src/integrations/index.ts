/**
 * Integration provider registry.
 *
 * Registers all available providers and exposes factory + lookup methods.
 */
import type { IntegrationProviderId, ProviderInfo } from './types.js';
import { IntegrationProvider } from './base.js';
import { TodoistProvider } from './todoist.js';

/** Map of registered provider instances (singletons). */
const providers = new Map<IntegrationProviderId, IntegrationProvider>();

/** Register built-in providers. */
function registerBuiltins(): void {
  providers.set('todoist', new TodoistProvider());
}

// Initialize on import
registerBuiltins();

/**
 * Get a provider by ID.
 * @throws Error if the provider is not registered.
 */
export function getProvider(id: IntegrationProviderId): IntegrationProvider {
  const provider = providers.get(id);
  if (!provider) {
    throw new Error(`Integration provider not found: ${id}`);
  }
  return provider;
}

/**
 * Get metadata for all registered providers.
 */
export function listProviders(): ProviderInfo[] {
  return Array.from(providers.values()).map((p) => p.info);
}

/**
 * Check if a provider ID is valid.
 */
export function isValidProvider(id: string): id is IntegrationProviderId {
  return providers.has(id as IntegrationProviderId);
}

// Re-export types and base class
export { IntegrationProvider } from './base.js';
export type {
  IntegrationProviderId,
  IntegrationConfig,
  IntegrationSecrets,
  IntegrationsFile,
  ExternalTask,
  SyncResult,
  OAuthResult,
  ProviderInfo,
  FieldMapping,
} from './types.js';
