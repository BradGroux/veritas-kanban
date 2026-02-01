/**
 * Integration framework types.
 *
 * Defines the contracts for external service integrations (Todoist, Jira, etc.).
 */

/** Supported integration provider identifiers. */
export type IntegrationProviderId = 'todoist';

/** Connection status for an integration. */
export type IntegrationStatus = 'disconnected' | 'connected' | 'error';

/** Priority mapping between Veritas and external services. */
export type VeritasPriority = 'low' | 'medium' | 'high';

/** Field mapping between Veritas task fields and external fields. */
export interface FieldMapping {
  title: string;
  description: string;
  status: string;
  priority: string;
  dueDate: string;
}

/** Stored configuration for a single integration. */
export interface IntegrationConfig {
  providerId: IntegrationProviderId;
  enabled: boolean;
  status: IntegrationStatus;
  connectedAt?: string;
  lastSyncAt?: string;
  fieldMapping: FieldMapping;
  /** Provider-specific settings (e.g., project ID, filter). */
  providerConfig: Record<string, unknown>;
}

/** The full integrations config file shape. */
export interface IntegrationsFile {
  version: 1;
  integrations: IntegrationConfig[];
}

/** Secrets stored separately from config. */
export interface IntegrationSecrets {
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: string;
}

/** A task as represented in the integration layer. */
export interface ExternalTask {
  externalId: string;
  title: string;
  description: string;
  status: 'open' | 'completed';
  priority: VeritasPriority;
  dueDate?: string;
  /** Raw data from the external service. */
  raw: unknown;
}

/** Result of a sync operation. */
export interface SyncResult {
  pulled: number;
  pushed: number;
  errors: string[];
}

/** OAuth2 callback result. */
export interface OAuthResult {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string;
}

/** Provider metadata for UI display. */
export interface ProviderInfo {
  id: IntegrationProviderId;
  name: string;
  description: string;
  icon: string;
  authType: 'oauth2' | 'api-key';
  oauthUrl?: string;
}
