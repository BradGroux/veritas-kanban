import fs from 'fs/promises';
import path from 'path';
import { simpleGit } from 'simple-git';
import type { AppConfig, RepoConfig, AgentConfig, AgentType, FeatureSettings } from '@veritas-kanban/shared';
import { DEFAULT_FEATURE_SETTINGS } from '@veritas-kanban/shared';

// Default paths - resolve to project root
const PROJECT_ROOT = path.resolve(process.cwd(), '..');
const CONFIG_DIR = path.join(PROJECT_ROOT, '.veritas-kanban');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

const DEFAULT_CONFIG: AppConfig = {
  repos: [],
  agents: [
    {
      type: 'claude-code',
      name: 'Claude Code',
      command: 'claude',
      args: ['--dangerously-skip-permissions'],
      enabled: true,
    },
    {
      type: 'amp',
      name: 'Amp',
      command: 'amp',
      args: ['--dangerously-allow-all'],
      enabled: true,
    },
    {
      type: 'copilot',
      name: 'GitHub Copilot',
      command: 'copilot',
      args: ['-p'],
      enabled: false,
    },
    {
      type: 'gemini',
      name: 'Gemini CLI',
      command: 'gemini',
      args: [],
      enabled: false,
    },
  ],
  defaultAgent: 'claude-code',
};

/**
 * Deep merge source into target. For each key in source:
 * - If both values are plain objects, recurse
 * - Otherwise, target value wins if it exists; source fills missing keys
 */
function deepMergeDefaults<T extends Record<string, any>>(target: Partial<T>, defaults: T): T {
  const result = { ...defaults };
  for (const key of Object.keys(defaults) as Array<keyof T>) {
    if (key in target) {
      const targetVal = (target as any)[key];
      const defaultVal = defaults[key];
      if (
        defaultVal !== null && typeof defaultVal === 'object' && !Array.isArray(defaultVal) &&
        targetVal !== null && typeof targetVal === 'object' && !Array.isArray(targetVal)
      ) {
        (result as any)[key] = deepMergeDefaults(targetVal, defaultVal);
      } else {
        (result as any)[key] = targetVal;
      }
    }
  }
  return result;
}

export interface ConfigServiceOptions {
  configDir?: string;
  configFile?: string;
}

export class ConfigService {
  private configDir: string;
  private configFile: string;
  private config: AppConfig | null = null;

  constructor(options: ConfigServiceOptions = {}) {
    this.configDir = options.configDir || CONFIG_DIR;
    this.configFile = options.configFile || CONFIG_FILE;
  }

  private async ensureConfigDir(): Promise<void> {
    await fs.mkdir(this.configDir, { recursive: true });
  }

  async getConfig(): Promise<AppConfig> {
    if (this.config) return this.config;

    await this.ensureConfigDir();

    try {
      const content = await fs.readFile(this.configFile, 'utf-8');
      const raw = JSON.parse(content) as AppConfig;
      // Auto-merge feature defaults for backward compatibility
      raw.features = deepMergeDefaults(raw.features || {}, DEFAULT_FEATURE_SETTINGS);
      this.config = raw;
      return this.config;
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        // Create default config with features
        const config = { ...DEFAULT_CONFIG, features: DEFAULT_FEATURE_SETTINGS };
        await this.saveConfig(config);
        return config;
      }
      throw error;
    }
  }

  async getFeatureSettings(): Promise<FeatureSettings> {
    const config = await this.getConfig();
    return config.features || DEFAULT_FEATURE_SETTINGS;
  }

  async updateFeatureSettings(patch: Record<string, any>): Promise<FeatureSettings> {
    const config = await this.getConfig();
    const current = config.features || DEFAULT_FEATURE_SETTINGS;
    // Deep merge the patch into current settings
    const merged = deepMergeDefaults(patch as Partial<FeatureSettings>, current);
    // Also merge any new keys from patch that aren't in defaults
    for (const section of Object.keys(patch)) {
      if (section in merged && typeof patch[section] === 'object' && !Array.isArray(patch[section])) {
        (merged as any)[section] = { ...(merged as any)[section], ...patch[section] };
      }
    }
    config.features = merged;
    await this.saveConfig(config);
    return merged;
  }

  async saveConfig(config: AppConfig): Promise<void> {
    await this.ensureConfigDir();
    await fs.writeFile(this.configFile, JSON.stringify(config, null, 2), 'utf-8');
    this.config = config;
  }

  async addRepo(repo: RepoConfig): Promise<AppConfig> {
    const config = await this.getConfig();
    
    // Validate repo doesn't already exist
    if (config.repos.some(r => r.name === repo.name)) {
      throw new Error(`Repo "${repo.name}" already exists`);
    }

    // Validate path exists and is a git repo
    await this.validateRepoPath(repo.path);

    config.repos.push(repo);
    await this.saveConfig(config);
    return config;
  }

  async updateRepo(name: string, updates: Partial<RepoConfig>): Promise<AppConfig> {
    const config = await this.getConfig();
    const index = config.repos.findIndex(r => r.name === name);
    
    if (index === -1) {
      throw new Error(`Repo "${name}" not found`);
    }

    // If path is being updated, validate it
    if (updates.path) {
      await this.validateRepoPath(updates.path);
    }

    config.repos[index] = { ...config.repos[index], ...updates };
    await this.saveConfig(config);
    return config;
  }

  async removeRepo(name: string): Promise<AppConfig> {
    const config = await this.getConfig();
    const index = config.repos.findIndex(r => r.name === name);
    
    if (index === -1) {
      throw new Error(`Repo "${name}" not found`);
    }

    config.repos.splice(index, 1);
    await this.saveConfig(config);
    return config;
  }

  async validateRepoPath(repoPath: string): Promise<{ valid: boolean; branches: string[] }> {
    // Expand ~ to home directory
    const expandedPath = repoPath.replace(/^~/, process.env.HOME || '');
    
    try {
      await fs.access(expandedPath);
    } catch {
      throw new Error(`Path does not exist: ${repoPath}`);
    }

    try {
      const git = simpleGit(expandedPath);
      const isRepo = await git.checkIsRepo();
      
      if (!isRepo) {
        throw new Error(`Path is not a git repository: ${repoPath}`);
      }

      // Get branches
      const branchSummary = await git.branchLocal();
      const branches = branchSummary.all;

      return { valid: true, branches };
    } catch (error: any) {
      if (error.message.includes('not a git repository')) {
        throw new Error(`Path is not a git repository: ${repoPath}`);
      }
      throw error;
    }
  }

  async getRepoBranches(repoName: string): Promise<string[]> {
    const config = await this.getConfig();
    const repo = config.repos.find(r => r.name === repoName);
    
    if (!repo) {
      throw new Error(`Repo "${repoName}" not found`);
    }

    const expandedPath = repo.path.replace(/^~/, process.env.HOME || '');
    const git = simpleGit(expandedPath);
    const branchSummary = await git.branchLocal();
    
    return branchSummary.all;
  }

  async updateAgents(agents: AgentConfig[]): Promise<AppConfig> {
    const config = await this.getConfig();
    config.agents = agents;
    await this.saveConfig(config);
    return config;
  }

  async setDefaultAgent(agentType: AgentType): Promise<AppConfig> {
    const config = await this.getConfig();
    config.defaultAgent = agentType;
    await this.saveConfig(config);
    return config;
  }
}
