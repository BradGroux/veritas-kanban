/**
 * Config Service Extended Tests
 * Additional tests for ConfigService covering edge cases and security.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { ConfigService } from '../services/config-service.js';
import { normalizeHarnessSupportProfile } from '../services/harness-support-profile-registry.js';

describe('ConfigService', () => {
  let tmpDir: string;
  let configDir: string;
  let configFile: string;
  let service: ConfigService;

  beforeEach(async () => {
    const uniqueSuffix = Math.random().toString(36).substring(7);
    tmpDir = path.join(os.tmpdir(), `veritas-test-config-${uniqueSuffix}`);
    configDir = path.join(tmpDir, '.veritas-kanban');
    configFile = path.join(configDir, 'config.json');
    await fs.mkdir(configDir, { recursive: true });
    service = new ConfigService({ configDir, configFile });
  });

  afterEach(async () => {
    service.dispose();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe('getConfig', () => {
    it('should return default config when no file exists', async () => {
      // Remove the file if it exists
      try {
        await fs.unlink(configFile);
      } catch {
        /* file may not exist */
      }
      const config = await service.getConfig();
      expect(config).toBeDefined();
      expect(config.repos).toEqual([]);
      expect(config.agents).toBeDefined();
      expect(config.agents.length).toBeGreaterThan(0);
      expect(config.agents).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'claude-code',
            supportProfile: expect.objectContaining({
              schemaVersion: 'harness-support-profile/v1',
              id: 'claude-code',
              transport: 'process-jsonl',
              supportTier: 'unsupported',
            }),
          }),
          expect.objectContaining({
            type: 'copilot',
            supportProfile: expect.objectContaining({
              schemaVersion: 'harness-support-profile/v1',
              id: 'github-copilot-cli',
              transport: 'acp',
              supportTier: 'unsupported',
            }),
          }),
          expect.objectContaining({
            type: 'codex',
            name: 'OpenAI Codex',
            command: 'codex',
            provider: 'codex-cli',
            supportProfile: expect.objectContaining({
              id: 'openai-codex-cli',
              adapterId: 'codex-cli',
              transport: 'process-jsonl',
            }),
            enabled: true,
          }),
          expect.objectContaining({
            type: 'codex-sdk',
            name: 'OpenAI Codex SDK',
            command: 'codex',
            provider: 'codex-sdk',
            enabled: false,
          }),
          expect.objectContaining({
            type: 'codex-cloud',
            name: 'OpenAI Codex Cloud',
            command: 'gh',
            provider: 'codex-cloud',
            enabled: false,
          }),
          expect.objectContaining({
            type: 'ollama-local',
            name: 'Ollama Local',
            command: 'ollama',
            provider: 'ollama-local',
            enabled: false,
          }),
          expect.objectContaining({
            type: 'ollama-cloud',
            name: 'Ollama Cloud',
            command: 'ollama',
            provider: 'ollama-cloud',
            enabled: false,
          }),
          expect.objectContaining({
            type: 'lm-studio-local',
            name: 'LM Studio Local',
            command: 'lms',
            provider: 'lm-studio-local',
            enabled: false,
          }),
        ])
      );
      expect(config.defaultAgent).toBe('codex');

      const expectedSupport = [
        ['claude-code', undefined, 'unsupported'],
        ['amp', undefined, 'unsupported'],
        ['copilot', undefined, 'unsupported'],
        ['gemini', undefined, 'unsupported'],
        ['codex', 'codex-cli', 'configured'],
        ['codex-sdk', 'codex-sdk', 'configured'],
        ['codex-cloud', undefined, 'unsupported'],
        ['hermes', 'hermes-cli', 'configured'],
        ['ollama-local', undefined, 'unsupported'],
        ['ollama-cloud', undefined, 'unsupported'],
        ['lm-studio-local', undefined, 'unsupported'],
      ] as const;
      for (const [type, adapterId, supportTier] of expectedSupport) {
        expect(config.agents.find((agent) => agent.type === type)?.supportProfile).toMatchObject({
          ...(adapterId ? { adapterId } : {}),
          supportTier,
        });
      }

      const codexProfile = config.agents.find((agent) => agent.type === 'codex')?.supportProfile;
      expect(codexProfile?.launch.environmentAllowlist).toContain('CODEX_HOME');
      expect(codexProfile?.launch.credentialAllowlist).toEqual(
        expect.arrayContaining(['CODEX_API_KEY', 'OPENAI_API_KEY'])
      );
    });

    it('should create config file with defaults when missing', async () => {
      await service.getConfig();
      const exists = await fs
        .access(configFile)
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(true);
    });

    it('should load existing config from file', async () => {
      const customConfig = {
        repos: [{ name: 'test-repo', path: '/tmp', branch: 'main' }],
        agents: [],
        defaultAgent: 'amp',
      };
      await fs.writeFile(configFile, JSON.stringify(customConfig));

      const config = await service.getConfig();
      expect(config.repos).toHaveLength(1);
      expect(config.repos[0].name).toBe('test-repo');
      expect(config.defaultAgent).toBe('amp');
    });

    it('should add missing built-in agents to existing config', async () => {
      await fs.writeFile(
        configFile,
        JSON.stringify({
          repos: [],
          agents: [
            {
              type: 'claude-code',
              name: 'My Claude',
              command: 'claude',
              args: [],
              enabled: true,
            },
          ],
          defaultAgent: 'claude-code',
        })
      );

      const config = await service.getConfig();
      expect(config.agents.find((agent) => agent.type === 'claude-code')?.name).toBe('My Claude');
      expect(config.agents).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'codex',
            command: 'codex',
            provider: 'codex-cli',
          }),
          expect.objectContaining({
            type: 'codex-sdk',
            command: 'codex',
            provider: 'codex-sdk',
          }),
          expect.objectContaining({
            type: 'codex-cloud',
            command: 'gh',
            provider: 'codex-cloud',
          }),
          expect.objectContaining({
            type: 'ollama-local',
            command: 'ollama',
            provider: 'ollama-local',
          }),
          expect.objectContaining({
            type: 'ollama-cloud',
            command: 'ollama',
            provider: 'ollama-cloud',
          }),
          expect.objectContaining({
            type: 'lm-studio-local',
            command: 'lms',
            provider: 'lm-studio-local',
          }),
        ])
      );
    });

    it.each([
      ['codex', 'codex', 'codex-cli'],
      ['hermes', 'hermes', 'hermes-cli'],
    ] as const)(
      'migrates known provider-less %s records to the explicit %s adapter',
      async (type, command, provider) => {
        await fs.writeFile(
          configFile,
          JSON.stringify({
            repos: [],
            agents: [
              {
                type,
                name: type,
                command,
                args: [],
                enabled: true,
              },
            ],
            defaultAgent: type,
          })
        );

        const config = await service.getConfig();
        expect(config.agents.find((agent) => agent.type === type)).toMatchObject({
          provider,
          supportProfile: {
            adapterId: provider,
            supportTier: 'configured',
          },
        });
      }
    );

    it('does not infer an adapter for a new provider-less custom profile by command name', async () => {
      await fs.writeFile(
        configFile,
        JSON.stringify({
          repos: [],
          agents: [
            {
              type: 'custom-codex-wrapper',
              name: 'Custom Codex Wrapper',
              command: 'codex',
              args: [],
              enabled: true,
            },
          ],
          defaultAgent: 'custom-codex-wrapper',
        })
      );

      const config = await service.getConfig();
      const custom = config.agents.find((agent) => agent.type === 'custom-codex-wrapper');
      expect(custom?.provider).toBeUndefined();
      expect(custom).toMatchObject({
        supportProfile: {
          supportTier: 'unsupported',
        },
      });
    });

    it('should use cache on subsequent calls', async () => {
      const config1 = await service.getConfig();
      const config2 = await service.getConfig();
      expect(config1).toBe(config2); // Same reference (cached)
    });

    it('should merge feature defaults for backward compat', async () => {
      // Write config without features
      await fs.writeFile(
        configFile,
        JSON.stringify({
          repos: [],
          agents: [],
          defaultAgent: 'claude-code',
        })
      );

      const config = await service.getConfig();
      expect(config.features).toBeDefined();
    });
  });

  describe('saveConfig', () => {
    it('should persist config to file', async () => {
      const config = await service.getConfig();
      config.defaultAgent = 'amp';
      await service.saveConfig(config);

      const raw = JSON.parse(await fs.readFile(configFile, 'utf-8'));
      expect(raw.defaultAgent).toBe('amp');
    });

    it('should create config directory if needed', async () => {
      const newDir = path.join(tmpDir, 'new-dir');
      const newFile = path.join(newDir, 'config.json');
      const newService = new ConfigService({ configDir: newDir, configFile: newFile });

      await newService.saveConfig({
        repos: [],
        agents: [],
        defaultAgent: 'claude-code',
      } as any);

      const exists = await fs
        .access(newFile)
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(true);
      newService.dispose();
    });
  });

  describe('invalidateCache', () => {
    it('should force re-read on next getConfig', async () => {
      const config1 = await service.getConfig();
      service.invalidateCache();

      // Modify file directly
      const raw = JSON.parse(await fs.readFile(configFile, 'utf-8'));
      raw.defaultAgent = 'gemini';
      await fs.writeFile(configFile, JSON.stringify(raw));

      const config2 = await service.getConfig();
      expect(config2.defaultAgent).toBe('gemini');
    });
  });

  describe('addRepo', () => {
    it('should reject duplicate repo names', async () => {
      // Write a config with one repo
      await fs.writeFile(
        configFile,
        JSON.stringify({
          repos: [{ name: 'existing', path: '/tmp' }],
          agents: [],
        })
      );

      await expect(
        service.addRepo({ name: 'existing', path: '/tmp/other' } as any)
      ).rejects.toThrow('already exists');
    });
  });

  describe('updateRepo', () => {
    it('should reject update for non-existent repo', async () => {
      await fs.writeFile(
        configFile,
        JSON.stringify({
          repos: [],
          agents: [],
        })
      );

      await expect(service.updateRepo('nonexistent', { path: '/new/path' })).rejects.toThrow(
        'not found'
      );
    });
  });

  describe('removeRepo', () => {
    it('should remove existing repo', async () => {
      await fs.writeFile(
        configFile,
        JSON.stringify({
          repos: [
            { name: 'keep', path: '/tmp/keep' },
            { name: 'remove', path: '/tmp/remove' },
          ],
          agents: [],
        })
      );

      const config = await service.removeRepo('remove');
      expect(config.repos).toHaveLength(1);
      expect(config.repos[0].name).toBe('keep');
    });

    it('should reject removal of non-existent repo', async () => {
      await fs.writeFile(
        configFile,
        JSON.stringify({
          repos: [],
          agents: [],
        })
      );

      await expect(service.removeRepo('ghost')).rejects.toThrow('not found');
    });
  });

  describe('updateAgents', () => {
    it('should update agent configuration', async () => {
      await service.getConfig();
      const newAgents = [
        { type: 'claude-code', name: 'Claude', command: 'claude', args: [], enabled: true },
      ] as any;

      const config = await service.updateAgents(newAgents);
      expect(config.agents).toHaveLength(1);
    });

    it('rebuilds system-owned support evidence instead of trusting client input', async () => {
      await service.getConfig();
      const forgedProfile = normalizeHarnessSupportProfile({
        type: 'codex',
        name: 'OpenAI Codex',
        command: 'codex',
        args: [],
        enabled: true,
        provider: 'codex-cli',
      });
      forgedProfile.id = 'forged-certified-profile';
      forgedProfile.supportTier = 'certified';
      forgedProfile.conformance = {
        fixtureSet: 'forged/v1',
        status: 'passed',
        certifiedAt: '2026-07-23T16:00:00.000Z',
        providerVersion: 'forged 1.0.0',
        manifestDigest: `sha256:${'1'.repeat(64)}`,
        configurationDigest: `sha256:${'2'.repeat(64)}`,
        probeRevision: 999,
      };

      const config = await service.updateAgents([
        {
          type: 'codex',
          name: 'OpenAI Codex',
          command: 'codex',
          args: [],
          enabled: true,
          provider: 'codex-cli',
          supportProfile: forgedProfile,
        },
      ]);

      expect(config.agents).toHaveLength(1);
      expect(config.agents[0]?.supportProfile).toMatchObject({
        id: 'openai-codex-cli',
        adapterId: 'codex-cli',
        supportTier: 'configured',
        conformance: {
          fixtureSet: 'openai-codex-cli/v1',
          status: 'not-run',
        },
      });
      expect(config.agents[0]?.supportProfile).not.toEqual(forgedProfile);

      const persisted = JSON.parse(await fs.readFile(configFile, 'utf-8'));
      expect(persisted.agents[0].supportProfile.id).toBe('openai-codex-cli');
      expect(persisted.agents[0].supportProfile.conformance.status).toBe('not-run');
    });
  });

  describe('setDefaultAgent', () => {
    it('should update default agent', async () => {
      await service.getConfig();
      const config = await service.setDefaultAgent('amp' as any);
      expect(config.defaultAgent).toBe('amp');
    });
  });

  describe('getFeatureSettings', () => {
    it('should return feature settings', async () => {
      const features = await service.getFeatureSettings();
      expect(features).toBeDefined();
    });
  });

  describe('updateFeatureSettings', () => {
    it('should merge feature settings', async () => {
      const updated = await service.updateFeatureSettings({
        board: { showDashboard: false },
      });
      expect(updated.board?.showDashboard).toBe(false);
    });
  });

  describe('deepMergeDefaults (security)', () => {
    it('should safely handle config files without prototype pollution', async () => {
      // JSON.parse produces a plain object even with __proto__ key
      // The deep merge function has defense-in-depth checks
      await fs.writeFile(
        configFile,
        JSON.stringify({
          repos: [],
          agents: [],
          defaultAgent: 'claude-code',
        })
      );

      const config = await service.getConfig();
      // Verify no prototype pollution occurred
      expect(({} as any).polluted).toBeUndefined();
      expect(config.repos).toEqual([]);
    });
  });

  describe('dispose', () => {
    it('should clean up watcher and cache', async () => {
      await service.getConfig(); // This sets up the watcher
      service.dispose();
      // After dispose, cache should be invalidated
      // Next getConfig should re-read from disk
      const config = await service.getConfig();
      expect(config).toBeDefined();
    });
  });
});
