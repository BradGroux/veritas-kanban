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

  updateFeatures: async (patch: Partial<FeatureSettings>): Promise<FeatureSettings> => {
    const response = await fetch(`${API_BASE}/settings/features`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    return handleResponse<FeatureSettings>(response);
  },
};

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
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(repo),
      });
      return handleResponse<AppConfig>(response);
    },

    update: async (name: string, updates: Partial<RepoConfig>): Promise<AppConfig> => {
      const response = await fetch(`${API_BASE}/config/repos/${encodeURIComponent(name)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      return handleResponse<AppConfig>(response);
    },

    remove: async (name: string): Promise<AppConfig> => {
      const response = await fetch(`${API_BASE}/config/repos/${encodeURIComponent(name)}`, {
        method: 'DELETE',
      });
      return handleResponse<AppConfig>(response);
    },

    validate: async (path: string): Promise<{ valid: boolean; branches: string[] }> => {
      const response = await fetch(`${API_BASE}/config/repos/validate`, {
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
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(agents),
      });
      return handleResponse<AppConfig>(response);
    },

    setDefault: async (agent: AgentType): Promise<AppConfig> => {
      const response = await fetch(`${API_BASE}/config/default-agent`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent }),
      });
      return handleResponse<AppConfig>(response);
    },
  },
};
