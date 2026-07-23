import fs from 'fs/promises';
import { watch, type FSWatcher } from '../storage/fs-helpers.js';
import path from 'path';
import { simpleGit } from 'simple-git';
import type {
  AppConfig,
  RepoConfig,
  AgentConfig,
  AgentType,
  FeatureSettings,
} from '@veritas-kanban/shared';
import { DEFAULT_FEATURE_SETTINGS } from '@veritas-kanban/shared';
import { withFileLock } from './file-lock.js';
import { SqliteDatabase, type SqliteConnectionOptions } from '../storage/sqlite/database.js';
import { SqliteSettingsRepository } from '../storage/sqlite/settings-repository.js';
import { getRuntimeDir } from '../utils/paths.js';
import { normalizeHarnessSupportProfile } from './harness-support-profile-registry.js';

/** How long cached config stays valid before re-reading from disk */
const CACHE_TTL_MS = 60_000; // 60 seconds

/** Ignore file-watcher events within this window after our own writes */
const WRITE_DEBOUNCE_MS = 200;

const CONFIG_FILENAME = 'config.json';

const DEFAULT_CONFIG: AppConfig = {
  repos: [],
  agents: [
    {
      type: 'claude-code',
      name: 'Claude Code',
      command: 'claude',
      args: ['--dangerously-skip-permissions'],
      enabled: false,
    },
    {
      type: 'amp',
      name: 'Amp',
      command: 'amp',
      args: ['--dangerously-allow-all'],
      enabled: false,
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
    {
      type: 'codex',
      name: 'OpenAI Codex',
      command: 'codex',
      args: ['exec', '--sandbox', 'workspace-write', '--json'],
      enabled: true,
      provider: 'codex-cli',
    },
    {
      type: 'codex-sdk',
      name: 'OpenAI Codex SDK',
      command: 'codex',
      args: [],
      enabled: false,
      provider: 'codex-sdk',
    },
    {
      type: 'codex-cloud',
      name: 'OpenAI Codex Cloud',
      command: 'gh',
      args: [],
      enabled: false,
      provider: 'codex-cloud',
    },
    {
      type: 'hermes',
      name: 'Hermes Agent',
      command: 'hermes',
      args: [],
      enabled: false,
      provider: 'hermes-cli',
    },
    {
      type: 'ollama-local',
      name: 'Ollama Local',
      command: 'ollama',
      args: ['run', 'llama3.2'],
      enabled: false,
      provider: 'ollama-local',
      model: 'llama3.2',
    },
    {
      type: 'ollama-cloud',
      name: 'Ollama Cloud',
      command: 'ollama',
      args: ['run', 'gpt-oss:120b-cloud'],
      enabled: false,
      provider: 'ollama-cloud',
      model: 'gpt-oss:120b-cloud',
    },
    {
      type: 'lm-studio-local',
      name: 'LM Studio Local',
      command: 'lms',
      args: ['server', 'status'],
      enabled: false,
      provider: 'lm-studio-local',
    },
  ],
  defaultAgent: 'codex',
  agentProfiles: [],
};

export function createDefaultConfig(): AppConfig {
  return normalizeAppConfig({
    ...cloneJson(DEFAULT_CONFIG),
    features: cloneJson(DEFAULT_FEATURE_SETTINGS),
  });
}

export function normalizeAppConfig(config: AppConfig): AppConfig {
  const normalized = cloneJson(config);
  normalized.features = deepMergeDefaults(normalized.features || {}, DEFAULT_FEATURE_SETTINGS);
  normalized.agents = mergeDefaultAgents(normalized.agents || []).map(normalizeAgentConfig);
  normalized.agentProfiles = normalized.agentProfiles || [];
  return normalized;
}

function mergeDefaultAgents(agents: AgentConfig[]): AgentConfig[] {
  const existingTypes = new Set(agents.map((agent) => agent.type));
  const missingDefaults = DEFAULT_CONFIG.agents.filter((agent) => !existingTypes.has(agent.type));
  return [...agents, ...cloneJson(missingDefaults)];
}

function migrateLegacyAgentProvider(agent: AgentConfig): AgentConfig {
  if (agent.provider) return agent;
  const command = path.basename(agent.command.trim().split(/\s+/)[0] ?? '');
  if (agent.type === 'codex' && command === 'codex') {
    return { ...agent, provider: 'codex-cli' };
  }
  if (agent.type === 'hermes' && command === 'hermes') {
    return { ...agent, provider: 'hermes-cli' };
  }
  return agent;
}

function normalizeAgentConfig(agent: AgentConfig): AgentConfig {
  const migrated = migrateLegacyAgentProvider(agent);
  return {
    ...migrated,
    supportProfile: normalizeHarnessSupportProfile(migrated),
  };
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * Keys that could lead to prototype pollution and must be rejected
 */
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Check if an object has any dangerous keys (including nested)
 */
function hasDangerousKeys(obj: unknown): boolean {
  if (obj === null || typeof obj !== 'object') return false;
  if (Array.isArray(obj)) return obj.some(hasDangerousKeys);

  for (const key of Object.keys(obj)) {
    if (DANGEROUS_KEYS.has(key)) return true;
    if (hasDangerousKeys((obj as Record<string, unknown>)[key])) return true;
  }
  return false;
}

/**
 * Deep merge source into target. For each key in source:
 * - If both values are plain objects, recurse
 * - Otherwise, target value wins if it exists; source fills missing keys
 *
 * Security: Rejects objects containing __proto__, constructor, or prototype keys
 * to prevent prototype pollution attacks.
 */
function deepMergeDefaults<T extends object>(target: Partial<T>, defaults: T): T {
  // Security: Check for prototype pollution attempts
  if (hasDangerousKeys(target)) {
    throw new Error('Invalid input: dangerous keys detected');
  }

  // Use Record views for safe dynamic key access within the merge
  // SAFETY: T is an object with string keys; spread produces a plain object
  const result = { ...defaults } as Record<string, unknown>;
  const src = { ...target } as Record<string, unknown>;
  for (const key of Object.keys(defaults)) {
    // Skip dangerous keys (defense in depth)
    if (DANGEROUS_KEYS.has(key)) continue;

    if (key in src) {
      const targetVal = src[key];
      const defaultVal = result[key];
      if (
        defaultVal !== null &&
        typeof defaultVal === 'object' &&
        !Array.isArray(defaultVal) &&
        targetVal !== null &&
        typeof targetVal === 'object' &&
        !Array.isArray(targetVal)
      ) {
        result[key] = deepMergeDefaults(
          targetVal as Record<string, unknown>,
          defaultVal as Record<string, unknown>
        );
      } else {
        result[key] = targetVal;
      }
    }
  }
  return result as T;
}

export interface ConfigServiceOptions {
  configDir?: string;
  configFile?: string;
  storageType?: 'file' | 'sqlite';
  sqliteDatabase?: SqliteDatabase;
  sqliteConnectionOptions?: SqliteConnectionOptions;
}

export class ConfigService {
  private configDir: string;
  private configFile: string;
  private config: AppConfig | null = null;
  private cacheTimestamp: number = 0;
  private lastWriteTime: number = 0;
  private watcher: FSWatcher | null = null;
  private pendingRead: Promise<AppConfig> | null = null;
  private sqliteDatabase: SqliteDatabase | null = null;
  private sqliteSettings: SqliteSettingsRepository | null = null;
  private ownsSqliteDatabase = false;

  constructor(options: ConfigServiceOptions = {}) {
    this.configDir = options.configDir || getRuntimeDir();
    this.configFile = options.configFile || path.join(this.configDir, CONFIG_FILENAME);
    const storageType =
      options.storageType ?? (process.env.VERITAS_STORAGE === 'sqlite' ? 'sqlite' : 'file');

    if (storageType === 'sqlite') {
      this.sqliteDatabase =
        options.sqliteDatabase ?? new SqliteDatabase(options.sqliteConnectionOptions);
      this.ownsSqliteDatabase = !options.sqliteDatabase;
      this.sqliteDatabase.open();
      this.sqliteSettings = new SqliteSettingsRepository(this.sqliteDatabase, {
        defaultConfig: createDefaultConfig(),
        normalizeConfig: normalizeAppConfig,
      });
    }
  }

  /** Check whether the in-memory cache is still usable */
  private isCacheValid(): boolean {
    return this.config !== null && Date.now() - this.cacheTimestamp < CACHE_TTL_MS;
  }

  /** Force the next getConfig() to re-read from disk */
  invalidateCache(): void {
    this.config = null;
    this.cacheTimestamp = 0;
  }

  /**
   * Watch the config file for external changes and invalidate cache.
   * Self-writes are debounced so we don't needlessly throw away
   * the value we just wrote.
   */
  private setupWatcher(): void {
    if (this.watcher) return;
    try {
      this.watcher = watch(this.configFile, () => {
        if (Date.now() - this.lastWriteTime < WRITE_DEBOUNCE_MS) return;
        this.invalidateCache();
      });
      this.watcher.on('error', () => {
        this.closeWatcher();
      });
    } catch {
      // Config file may not exist yet; watcher will retry on next read
    }
  }

  private closeWatcher(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
  }

  /** Release file-watcher and clear cache (call on shutdown) */
  dispose(): void {
    this.closeWatcher();
    if (this.ownsSqliteDatabase) {
      this.sqliteDatabase?.close();
    }
    this.sqliteDatabase = null;
    this.sqliteSettings = null;
    this.invalidateCache();
  }

  private async ensureConfigDir(): Promise<void> {
    await fs.mkdir(this.configDir, { recursive: true });
  }

  async getConfig(): Promise<AppConfig> {
    if (this.isCacheValid()) return this.config!;

    // Prevent cache stampede: coalesce concurrent reads into a single disk read
    if (this.pendingRead) return this.pendingRead;

    this.pendingRead = (
      this.sqliteSettings ? this.readConfigFromSqlite() : this.readConfigFromDisk()
    ).finally(() => {
      this.pendingRead = null;
    });

    return this.pendingRead;
  }

  private async readConfigFromSqlite(): Promise<AppConfig> {
    if (!this.sqliteSettings) {
      throw new Error('SQLite settings repository is not configured');
    }

    const config = await this.sqliteSettings.getConfig();
    this.config = normalizeAppConfig(config);
    this.cacheTimestamp = Date.now();
    return this.config;
  }

  private async readConfigFromDisk(): Promise<AppConfig> {
    await this.ensureConfigDir();

    try {
      const content = await fs.readFile(this.configFile, 'utf-8');
      const raw = JSON.parse(content) as AppConfig;
      // Auto-merge feature defaults for backward compatibility
      this.config = normalizeAppConfig(raw);
      this.cacheTimestamp = Date.now();
      this.setupWatcher();
      return this.config;
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        // Create default config with features
        const config = createDefaultConfig();
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

  async updateFeatureSettings(patch: Record<string, unknown>): Promise<FeatureSettings> {
    const config = await this.getConfig();
    const current = config.features || DEFAULT_FEATURE_SETTINGS;

    // Deep merge: start with current, apply patch updates
    // SAFETY: FeatureSettings sections are all objects with string keys
    const merged = { ...current } as unknown as Record<string, Record<string, unknown>>;

    for (const section of Object.keys(patch)) {
      const patchSection = patch[section];
      if (
        typeof patchSection === 'object' &&
        patchSection !== null &&
        !Array.isArray(patchSection)
      ) {
        // Merge section: preserve existing keys, override with patch
        merged[section] = {
          ...(merged[section] || {}),
          ...(patchSection as Record<string, unknown>),
        };
      } else {
        // Non-object value (shouldn't happen with current schema, but handle it)
        merged[section] = patchSection as Record<string, unknown>;
      }
    }

    config.features = merged as unknown as FeatureSettings;
    await this.saveConfig(config);
    return config.features;
  }

  async saveConfig(config: AppConfig): Promise<void> {
    if (this.sqliteSettings) {
      const normalized = normalizeAppConfig(config);
      await this.sqliteSettings.saveConfig(normalized);
      this.config = normalized;
      this.cacheTimestamp = Date.now();
      return;
    }

    await this.ensureConfigDir();
    this.lastWriteTime = Date.now();
    await withFileLock(this.configFile, async () => {
      await fs.writeFile(this.configFile, JSON.stringify(config, null, 2), 'utf-8');
    });
    this.config = config;
    this.cacheTimestamp = Date.now();
    this.setupWatcher();
  }

  async addRepo(repo: RepoConfig): Promise<AppConfig> {
    const config = await this.getConfig();

    // Validate repo doesn't already exist
    if (
      config.repos.some(
        (r: { name: string; path: string; defaultBranch: string; devServer?: any }) =>
          r.name === repo.name
      )
    ) {
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
    const index = config.repos.findIndex(
      (r: { name: string; path: string; defaultBranch: string; devServer?: any }) => r.name === name
    );

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
    const index = config.repos.findIndex(
      (r: { name: string; path: string; defaultBranch: string; devServer?: any }) => r.name === name
    );

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
        throw new Error(`Path is not a git repository: ${repoPath}`, { cause: error });
      }
      throw error;
    }
  }

  async getRepoBranches(repoName: string): Promise<string[]> {
    const config = await this.getConfig();
    const repo = config.repos.find(
      (r: { name: string; path: string; defaultBranch: string; devServer?: any }) =>
        r.name === repoName
    );

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
    // Harness support profiles are system-owned evidence. Always rebuild them
    // after parsing API input so clients cannot spoof adapter or certification
    // state in the file-backed cache between writes and the next reload.
    config.agents = agents.map(normalizeAgentConfig);
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

// Singleton instance
let configInstance: ConfigService | null = null;

export function getConfigService(): ConfigService {
  if (!configInstance) {
    configInstance = new ConfigService();
  }
  return configInstance;
}
