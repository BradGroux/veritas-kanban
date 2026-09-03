import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  ConfigService,
  createDefaultConfig,
  normalizeAppConfig,
} from '../services/config-service.js';

const limits = {
  inputTokens: 100,
  outputTokens: 200,
  totalTokens: 300,
  costUsd: 1.25,
  toolCalls: 4,
  runtimeSeconds: 60,
  idleRuntimeSeconds: 30,
  retries: 0,
  fanOut: 97,
};
const policy = {
  enabled: true,
  limits,
  hardAction: 'downgrade',
  downgradeModel: 'smaller-model',
  notes: 'Retain all configured limits across restart.',
};

describe('workspace run budget persistence', () => {
  const services: ConfigService[] = [];
  const directories: string[] = [];
  afterEach(async () => {
    for (const service of services.splice(0)) service.dispose();
    for (const directory of directories.splice(0)) await fs.rm(directory, { recursive: true });
  });

  it.each(['file', 'sqlite'] as const)(
    'retains every limit on %s save and fresh read',
    async (storageType) => {
      const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'vk-budget-roundtrip-'));
      directories.push(directory);
      const options = {
        storageType,
        configDir: directory,
        configFile: path.join(directory, 'config.json'),
        sqliteConnectionOptions: { databasePath: path.join(directory, 'settings.db') },
      };
      const writer = new ConfigService(options);
      services.push(writer);
      await writer.updateFeatureSettings({ budget: { defaultRunBudget: policy } });
      const reader = new ConfigService(options);
      services.push(reader);
      expect((await reader.getFeatureSettings()).budget.defaultRunBudget).toMatchObject(policy);
      expect((await writer.getFeatureSettings()).budget.defaultRunBudget?.limits).toEqual(limits);
    }
  );

  it('fills policy defaults without inventing zero limits', () => {
    const config = createDefaultConfig();
    config.features!.budget.defaultRunBudget = { limits: { fanOut: 2 } };
    expect(normalizeAppConfig(config).features!.budget.defaultRunBudget).toMatchObject({
      enabled: false,
      limits: { fanOut: 2 },
      hardAction: 'require-approval',
    });
  });

  it.each([{ fanOut: -1 }, { unknownLimit: 3 }, JSON.parse('{"__proto__":{"polluted":true}}')])(
    'rejects invalid limits instead of silently disabling them',
    (invalidLimits) => {
      const config = createDefaultConfig();
      config.features!.budget.defaultRunBudget = { limits: invalidLimits };
      expect(() => normalizeAppConfig(config)).toThrow();
      expect(Object.prototype).not.toHaveProperty('polluted');
    }
  );
});
