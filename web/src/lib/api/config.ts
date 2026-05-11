/**
 * Configuration and settings API endpoints.
 */
import type {
  AppConfig,
  RepoConfig,
  AgentConfig,
  AgentType,
  FeatureSettings,
} from '@veritas-kanban/shared';
import { API_BASE, handleResponse } from './helpers';

export const settingsApi = {
  getFeatures: async (): Promise<FeatureSettings> => {
    const response = await fetch(`${API_BASE}/settings/features`);
    return handleResponse<FeatureSettings>(response);
  },

  getCodexHealth: async (): Promise<CodexHealthStatus> => {
    const response = await fetch(`${API_BASE}/settings/codex/health`);
    return handleResponse<CodexHealthStatus>(response);
  },

  updateFeatures: async (patch: Partial<FeatureSettings>): Promise<FeatureSettings> => {
    const response = await fetch(`${API_BASE}/settings/features`, {
      credentials: 'include',
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    return handleResponse<FeatureSettings>(response);
  },
};

export interface CodexHealthStatus {
  checkedAt: string;
  cli: {
    installed: boolean;
    path?: string;
    version?: string;
    authenticated: boolean;
    authMode?: string;
    error?: string;
  };
  sdk: {
    available: boolean;
    error?: string;
  };
  agents: {
    codexCli: boolean;
    codexSdk: boolean;
    codexCloud: boolean;
    enabled: string[];
  };
  ready: {
    cli: boolean;
    sdk: boolean;
    cloud: boolean;
    overall: boolean;
  };
  recommendations: string[];
}

export const configApi = {
  get: async (): Promise<AppConfig> => {
    const response = await fetch(`${API_BASE}/config`);
    return handleResponse<AppConfig>(response);
  },

  repos: {
    list: async (): Promise<RepoConfig[]> => {
      const response = await fetch(`${API_BASE}/config/repos`);
      return handleResponse<RepoConfig[]>(response);
    },

    add: async (repo: RepoConfig): Promise<AppConfig> => {
      const response = await fetch(`${API_BASE}/config/repos`, {
        credentials: 'include',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(repo),
      });
      return handleResponse<AppConfig>(response);
    },

    update: async (name: string, updates: Partial<RepoConfig>): Promise<AppConfig> => {
      const response = await fetch(`${API_BASE}/config/repos/${encodeURIComponent(name)}`, {
        credentials: 'include',
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      return handleResponse<AppConfig>(response);
    },

    remove: async (name: string): Promise<AppConfig> => {
      const response = await fetch(`${API_BASE}/config/repos/${encodeURIComponent(name)}`, {
        credentials: 'include',
        method: 'DELETE',
      });
      return handleResponse<AppConfig>(response);
    },

    validate: async (path: string): Promise<{ valid: boolean; branches: string[] }> => {
      const response = await fetch(`${API_BASE}/config/repos/validate`, {
        credentials: 'include',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path }),
      });
      return handleResponse<{ valid: boolean; branches: string[] }>(response);
    },

    branches: async (name: string): Promise<string[]> => {
      const response = await fetch(`${API_BASE}/config/repos/${encodeURIComponent(name)}/branches`);
      return handleResponse<string[]>(response);
    },
  },

  agents: {
    update: async (agents: AgentConfig[]): Promise<AppConfig> => {
      const response = await fetch(`${API_BASE}/config/agents`, {
        credentials: 'include',
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(agents),
      });
      return handleResponse<AppConfig>(response);
    },

    setDefault: async (agent: AgentType): Promise<AppConfig> => {
      const response = await fetch(`${API_BASE}/config/default-agent`, {
        credentials: 'include',
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent }),
      });
      return handleResponse<AppConfig>(response);
    },
  },
};
