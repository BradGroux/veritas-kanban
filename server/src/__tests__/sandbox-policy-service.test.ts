import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { SandboxPolicyPreset } from '@veritas-kanban/shared';
import { ConfigService } from '../services/config-service.js';
import {
  DEFAULT_SANDBOX_PRESET_ID,
  SandboxPolicyService,
} from '../services/sandbox-policy-service.js';
import { providerRuntimeManifestFixture } from './fixtures/provider-runtime-manifest.js';

function preset(overrides: Partial<SandboxPolicyPreset> = {}): SandboxPolicyPreset {
  const now = '2026-06-18T00:00:00.000Z';
  return {
    id: 'custom-repo-contained',
    name: 'Custom repo contained',
    enabled: true,
    builtIn: false,
    enforcement: 'required',
    requiredCapabilities: [],
    filesystem: {
      readPaths: ['<workspace>'],
      writePaths: ['<workspace>'],
      deniedPaths: [],
      dotfileMasking: false,
      localOnlyHandles: true,
    },
    network: {
      defaultEgress: 'deny',
      allowedHosts: [],
      allowedMethods: [],
      allowedPathPrefixes: [],
      blockPrivateNetwork: true,
      blockMetadataEndpoints: true,
      blockLoopback: true,
    },
    environment: {
      passthrough: ['PATH', 'HOME'],
      redactDisplay: true,
    },
    credentials: {
      mode: 'none',
      brokerRefs: [],
    },
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('SandboxPolicyService', () => {
  let testRoot: string;
  let configService: ConfigService;
  let service: SandboxPolicyService;

  beforeEach(async () => {
    testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'veritas-sandbox-policy-'));
    const configDir = path.join(testRoot, '.veritas-kanban');
    configService = new ConfigService({
      configDir,
      configFile: path.join(configDir, 'config.json'),
      storageType: 'file',
    });
    service = new SandboxPolicyService(configService);
  });

  afterEach(async () => {
    configService.dispose();
    await fs.rm(testRoot, { recursive: true, force: true });
  });

  it('seeds built-in presets and persists the default preset id', async () => {
    const presets = await service.listPresets();

    expect(presets.map((item) => item.id)).toEqual(
      expect.arrayContaining([
        DEFAULT_SANDBOX_PRESET_ID,
        'codex-repo-contained',
        'brokered-network-allowlist',
      ])
    );
    expect((await configService.getConfig()).defaultSandboxPresetId).toBe(
      DEFAULT_SANDBOX_PRESET_ID
    );
  });

  it('uses manifest evidence instead of provider names for sandbox enforcement', async () => {
    const sdkManifest = providerRuntimeManifestFixture({
      provider: 'codex-sdk',
      capabilityStates: {
        'filesystem.read': 'supported',
        'filesystem.write': 'supported',
        'network.disable': 'supported',
        'environment.allowlist': 'supported',
      },
    });
    const sdkResult = await service.dryRun({
      presetId: 'codex-repo-contained',
      provider: 'codex-sdk',
      providerRuntimeManifest: sdkManifest,
    });

    expect(sdkResult.decision).toBe('allow');
    expect(sdkResult.effective).toMatchObject({
      sandboxMode: 'workspace-write',
      networkAccessEnabled: false,
    });

    const cliResult = await service.dryRun({
      presetId: 'codex-repo-contained',
      provider: 'codex-cli',
      providerRuntimeManifest: providerRuntimeManifestFixture({
        provider: 'codex-cli',
        capabilityStates: {
          'filesystem.read': 'supported',
          'filesystem.write': 'supported',
          'environment.allowlist': 'supported',
        },
      }),
    });

    expect(cliResult.decision).toBe('block');
    expect(cliResult.unsupportedRules.map((rule) => rule.capability)).toContain('network.disable');
  });

  it('fails closed when only a provider name is supplied', async () => {
    const result = await service.dryRun({
      presetId: 'codex-repo-contained',
      provider: 'codex-sdk',
    });

    expect(result.decision).toBe('block');
    expect(result.unsupportedRules.length).toBeGreaterThan(0);
  });

  it('warns instead of silently allowing unsupported advisory controls', async () => {
    const result = await service.dryRun({
      preset: preset({ enforcement: 'advisory' }),
      provider: 'codex-sdk',
    });

    expect(result.decision).toBe('warn');
    expect(result.warnings).toEqual(
      expect.arrayContaining(result.unsupportedRules.map((rule) => rule.detail))
    );
  });

  it('creates, updates, and deletes custom presets without allowing built-in mutation', async () => {
    const created = await service.createPreset(preset());
    expect(created.builtIn).toBe(false);

    const updated = await service.updatePreset(created.id, {
      ...created,
      name: 'Custom repo contained updated',
      environment: {
        ...created.environment,
        passthrough: ['PATH', 'HOME', 'PATH'],
      },
    });
    expect(updated.name).toBe('Custom repo contained updated');
    expect(updated.environment.passthrough).toEqual(['HOME', 'PATH']);

    const builtIn = await service.getPreset('codex-repo-contained');
    if (!builtIn) throw new Error('Expected the built-in sandbox preset');
    await expect(
      service.updatePreset('codex-repo-contained', {
        ...builtIn,
        name: 'Edited built in',
      })
    ).rejects.toThrow('Built-in sandbox presets cannot be edited');
    await expect(service.deletePreset('codex-repo-contained')).rejects.toThrow(
      'Built-in sandbox presets cannot be deleted'
    );

    await service.deletePreset(created.id);
    expect(await service.getPreset(created.id)).toBeNull();
  });

  it('rejects credential values disguised as broker references', async () => {
    let caught: unknown;
    try {
      await service.dryRunWithTrace({
        preset: preset({
          id: 'brokered-custom',
          name: 'Brokered custom',
          credentials: {
            mode: 'brokered',
            brokerRefs: ['github-token=raw-secret'],
          },
        }),
        provider: 'hosted-agent',
        providerRuntimeManifest: providerRuntimeManifestFixture({
          provider: 'hosted-agent',
          capabilityStates: {
            'credential.broker': 'supported',
          },
        }),
        workspacePath: '/Users/bradgroux/Projects/veritas-kanban',
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toMatch(/broker references/i);
    expect((caught as Error).message).not.toContain('raw-secret');
  });

  it('blocks required brokered credentials when runtime evidence is only advisory', async () => {
    const result = await service.dryRun({
      preset: preset({
        id: 'required-broker',
        name: 'Required broker',
        credentials: {
          mode: 'brokered',
          brokerRefs: ['github-token'],
        },
      }),
      providerRuntimeManifest: providerRuntimeManifestFixture({
        provider: 'openclaw',
        capabilityStates: {
          'filesystem.read': 'supported',
          'filesystem.write': 'supported',
          'network.disable': 'supported',
          'network.block-private': 'supported',
          'network.block-metadata': 'supported',
          'environment.allowlist': 'supported',
          'credential.broker': 'advisory',
        },
      }),
    });

    expect(result.decision).toBe('block');
    expect(result.unsupportedRules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          capability: 'credential.broker',
          status: 'unsupported',
        }),
      ])
    );
  });
});
