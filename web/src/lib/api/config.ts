/**
 * Configuration and settings API endpoints.
 */
import type {
  AppConfig,
  RepoConfig,
  AgentConfig,
  AgentType,
  FeatureSettings,
  AgentProfileExportResult,
  AgentProfilePackage,
  AgentProfilePackageFormat,
  AgentProfilePackageSummary,
  AgentProfileValidationResult,
} from '@veritas-kanban/shared';
import { API_BASE, apiFetch } from './helpers';

export const settingsApi = {
  getFeatures: async (): Promise<FeatureSettings> => {
    return apiFetch<FeatureSettings>(`${API_BASE}/settings/features`);
  },

  getCodexHealth: async (): Promise<CodexHealthStatus> => {
    return apiFetch<CodexHealthStatus>(`${API_BASE}/settings/codex/health`);
  },

  getProviderHealth: async (): Promise<ContextProviderHealthResponse> => {
    return apiFetch<ContextProviderHealthResponse>(`${API_BASE}/settings/provider-health`);
  },

  updateFeatures: async (patch: Partial<FeatureSettings>): Promise<FeatureSettings> => {
    return apiFetch<FeatureSettings>(`${API_BASE}/settings/features`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
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

export type ContextProviderState = 'connected' | 'degraded' | 'stale' | 'disconnected' | 'unknown';

export type ContextProviderRisk = 'safe' | 'normal' | 'risky';
export type ContextProviderBoundary = 'local' | 'cloud' | 'mixed' | 'unknown';
export type ContextProviderPostureStatus =
  | 'safe'
  | 'normal'
  | 'risky'
  | 'degraded'
  | 'stale'
  | 'disconnected'
  | 'unknown';

export interface ContextProviderPostureCheck {
  id: string;
  label: string;
  status: ContextProviderPostureStatus;
  detail: string;
  checkedAt?: string;
  items?: string[];
}

export interface ContextProviderHealth {
  id: string;
  name: string;
  provider: 'codex' | 'openclaw' | 'custom';
  state: ContextProviderState;
  risk: ContextProviderRisk;
  boundary: ContextProviderBoundary;
  readCapability: boolean;
  writeCapability: boolean;
  privacyScope: string;
  lastCheckedAt: string;
  detail: string;
  tools: string[];
  postureFlags: string[];
  recommendations: string[];
  postureChecks?: ContextProviderPostureCheck[];
}

export interface ContextProviderHealthResponse {
  checkedAt: string;
  summary: {
    total: number;
    connected: number;
    degraded: number;
    stale: number;
    disconnected: number;
    unknown: number;
    risky: number;
    writeCapable: number;
  };
  providers: ContextProviderHealth[];
}

export const configApi = {
  get: async (): Promise<AppConfig> => {
    return apiFetch<AppConfig>(`${API_BASE}/config`);
  },

  repos: {
    list: async (): Promise<RepoConfig[]> => {
      return apiFetch<RepoConfig[]>(`${API_BASE}/config/repos`);
    },

    add: async (repo: RepoConfig): Promise<AppConfig> => {
      return apiFetch<AppConfig>(`${API_BASE}/config/repos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(repo),
      });
    },

    update: async (name: string, updates: Partial<RepoConfig>): Promise<AppConfig> => {
      return apiFetch<AppConfig>(`${API_BASE}/config/repos/${encodeURIComponent(name)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
    },

    remove: async (name: string): Promise<AppConfig> => {
      return apiFetch<AppConfig>(`${API_BASE}/config/repos/${encodeURIComponent(name)}`, {
        method: 'DELETE',
      });
    },

    validate: async (path: string): Promise<{ valid: boolean; branches: string[] }> => {
      return apiFetch<{ valid: boolean; branches: string[] }>(`${API_BASE}/config/repos/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path }),
      });
    },

    branches: async (name: string): Promise<string[]> => {
      return apiFetch<string[]>(`${API_BASE}/config/repos/${encodeURIComponent(name)}/branches`);
    },
  },

  agents: {
    update: async (agents: AgentConfig[]): Promise<AppConfig> => {
      return apiFetch<AppConfig>(`${API_BASE}/config/agents`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(agents),
      });
    },

    setDefault: async (agent: AgentType): Promise<AppConfig> => {
      return apiFetch<AppConfig>(`${API_BASE}/config/default-agent`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent }),
      });
    },
  },

  agentProfiles: {
    list: async (): Promise<AgentProfilePackageSummary[]> => {
      return apiFetch<AgentProfilePackageSummary[]>(`${API_BASE}/config/agent-profiles`);
    },

    validate: async (input: {
      content: string;
      format?: AgentProfilePackageFormat;
      source?: string;
    }): Promise<AgentProfileValidationResult> => {
      return apiFetch<AgentProfileValidationResult>(`${API_BASE}/config/agent-profiles/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
    },

    import: async (input: {
      content: string;
      format?: AgentProfilePackageFormat;
      source?: string;
    }): Promise<{ profile: AgentProfilePackage; created: boolean }> => {
      return apiFetch<{ profile: AgentProfilePackage; created: boolean }>(
        `${API_BASE}/config/agent-profiles/import`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        }
      );
    },

    export: async (
      id: string,
      format: AgentProfilePackageFormat = 'yaml'
    ): Promise<AgentProfileExportResult> => {
      return apiFetch<AgentProfileExportResult>(
        `${API_BASE}/config/agent-profiles/${encodeURIComponent(id)}/export?format=${format}`
      );
    },

    update: async (
      id: string,
      patch: Partial<
        Pick<
          AgentProfilePackage,
          'enabled' | 'displayName' | 'role' | 'description' | 'capabilities' | 'defaultTaskTypes'
        >
      >
    ): Promise<AgentProfilePackage> => {
      return apiFetch<AgentProfilePackage>(
        `${API_BASE}/config/agent-profiles/${encodeURIComponent(id)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        }
      );
    },

    remove: async (id: string): Promise<void> => {
      return apiFetch<void>(`${API_BASE}/config/agent-profiles/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
    },
  },
};
