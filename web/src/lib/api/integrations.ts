/**
 * Integration API endpoints.
 */
import { API_BASE, apiFetch } from './helpers';

export interface ProviderInfo {
  id: string;
  name: string;
  description: string;
  icon: string;
  authType: 'oauth2' | 'api-key';
  oauthUrl?: string;
}

export interface IntegrationConfig {
  providerId: string;
  enabled: boolean;
  status: 'disconnected' | 'connected' | 'error';
  connectedAt?: string;
  lastSyncAt?: string;
  fieldMapping: Record<string, string>;
  providerConfig: Record<string, unknown>;
}

export interface OAuthConfig {
  clientId: string;
  scope: string;
  oauthUrl: string;
}

export interface SyncResult {
  pulled: number;
  pushed: number;
  errors: string[];
}

export const integrationsApi = {
  /** List available integration providers. */
  listProviders: (): Promise<ProviderInfo[]> =>
    apiFetch<ProviderInfo[]>(`${API_BASE}/integrations/providers`),

  /** Get public OAuth config for a provider (client_id, scope, etc.). */
  getOAuthConfig: (providerId: string): Promise<OAuthConfig> =>
    apiFetch<OAuthConfig>(`${API_BASE}/integrations/oauth-config/${providerId}`),

  /** List configured integrations. */
  list: (): Promise<IntegrationConfig[]> =>
    apiFetch<IntegrationConfig[]>(`${API_BASE}/integrations`),

  /** Connect a provider. */
  connect: (providerId: string, params: Record<string, string>): Promise<{ status: string }> =>
    apiFetch<{ status: string }>(`${API_BASE}/integrations/${providerId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    }),

  /** Disconnect a provider. */
  disconnect: (providerId: string): Promise<{ status: string }> =>
    apiFetch<{ status: string }>(`${API_BASE}/integrations/${providerId}`, {
      method: 'DELETE',
    }),

  /** Trigger sync for a provider. */
  sync: (providerId: string): Promise<SyncResult> =>
    apiFetch<SyncResult>(`${API_BASE}/integrations/${providerId}/sync`, {
      method: 'POST',
    }),
};
