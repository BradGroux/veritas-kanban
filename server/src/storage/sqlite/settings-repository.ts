import type { AppConfig, FeatureSettings } from '@veritas-kanban/shared';
import { DEFAULT_FEATURE_SETTINGS } from '@veritas-kanban/shared';
import type { SettingsRepository } from '../interfaces.js';
import type { SqliteDatabase } from './database.js';

const APP_CONFIG_KEY = 'app_config';
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

interface ConfigRow {
  document_json: string;
}

export interface SqliteSettingsRepositoryOptions {
  defaultConfig: AppConfig;
  normalizeConfig?: (config: AppConfig) => AppConfig;
}

export class SqliteSettingsRepository implements SettingsRepository {
  constructor(
    private readonly database: SqliteDatabase,
    private readonly options: SqliteSettingsRepositoryOptions
  ) {}

  async get(): Promise<FeatureSettings> {
    const config = await this.getConfig();
    return config.features ?? DEFAULT_FEATURE_SETTINGS;
  }

  async update(settings: Partial<FeatureSettings>): Promise<FeatureSettings> {
    if (hasDangerousKeys(settings)) {
      throw new Error('Invalid input: dangerous keys detected');
    }

    const config = await this.getConfig();
    const current = config.features ?? DEFAULT_FEATURE_SETTINGS;
    const merged = mergeFeatureSettings(current, settings);

    await this.saveConfig({
      ...config,
      features: merged,
    });

    return merged;
  }

  async getConfig(): Promise<AppConfig> {
    const row = this.database
      .getConnection()
      .prepare('SELECT document_json FROM app_config_documents WHERE key = ?')
      .get(APP_CONFIG_KEY) as ConfigRow | undefined;

    if (!row) {
      const defaultConfig = this.normalize(cloneJson(this.options.defaultConfig));
      await this.saveConfig(defaultConfig);
      return defaultConfig;
    }

    return this.normalize(JSON.parse(row.document_json) as AppConfig);
  }

  async saveConfig(config: AppConfig): Promise<void> {
    if (hasDangerousKeys(config)) {
      throw new Error('Invalid input: dangerous keys detected');
    }

    const normalized = this.normalize(config);
    const now = new Date().toISOString();
    const documentJson = JSON.stringify(normalized);

    this.database
      .getConnection()
      .prepare(
        `
          INSERT INTO app_config_documents (key, document_json, created_at, updated_at)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(key) DO UPDATE SET
            document_json = excluded.document_json,
            updated_at = excluded.updated_at
        `
      )
      .run(APP_CONFIG_KEY, documentJson, now, now);
  }

  private normalize(config: AppConfig): AppConfig {
    return this.options.normalizeConfig ? this.options.normalizeConfig(config) : config;
  }
}

function mergeFeatureSettings(
  current: FeatureSettings,
  patch: Partial<FeatureSettings>
): FeatureSettings {
  const merged = { ...current } as unknown as Record<string, Record<string, unknown>>;

  for (const section of Object.keys(patch)) {
    const patchSection = (patch as Record<string, unknown>)[section];
    if (typeof patchSection === 'object' && patchSection !== null && !Array.isArray(patchSection)) {
      merged[section] = {
        ...(merged[section] || {}),
        ...(patchSection as Record<string, unknown>),
      };
    } else {
      merged[section] = patchSection as Record<string, unknown>;
    }
  }

  return merged as unknown as FeatureSettings;
}

function hasDangerousKeys(obj: unknown): boolean {
  if (obj === null || typeof obj !== 'object') return false;
  if (Array.isArray(obj)) return obj.some(hasDangerousKeys);

  for (const key of Object.keys(obj)) {
    if (DANGEROUS_KEYS.has(key)) return true;
    if (hasDangerousKeys((obj as Record<string, unknown>)[key])) return true;
  }

  return false;
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
