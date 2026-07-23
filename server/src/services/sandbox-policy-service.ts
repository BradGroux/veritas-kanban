import type {
  CreateGovernanceTraceInput,
  SandboxPolicyEvaluationInput,
  SandboxPolicyDryRunResult,
  SandboxPolicyPreset,
  SandboxPolicyRuleEvaluation,
  SandboxProviderCapabilityId,
  SandboxProviderCapabilities,
} from '@veritas-kanban/shared';
import { ConflictError, NotFoundError, ValidationError } from '../middleware/error-handler.js';
import { sandboxPolicyPresetSchema } from '../schemas/sandbox-policy-schemas.js';
import { ConfigService, getConfigService } from './config-service.js';
import { sandboxCapabilitiesFromManifest } from './provider-runtime-control-service.js';

const BUILT_IN_TIMESTAMP = '2026-06-18T00:00:00.000Z';

export const DEFAULT_SANDBOX_PRESET_ID = 'legacy-permissive';

export const BUILT_IN_SANDBOX_PRESETS: SandboxPolicyPreset[] = [
  {
    id: DEFAULT_SANDBOX_PRESET_ID,
    name: 'Legacy permissive',
    description:
      'Preserves existing agent behavior. Use this only for trusted local runs or compatibility.',
    enabled: true,
    builtIn: true,
    enforcement: 'advisory',
    requiredCapabilities: [],
    filesystem: {
      readPaths: ['<workspace>'],
      writePaths: ['<workspace>'],
      deniedPaths: [],
      dotfileMasking: false,
      localOnlyHandles: false,
    },
    network: {
      defaultEgress: 'allow',
      allowedHosts: [],
      allowedMethods: [],
      allowedPathPrefixes: [],
      blockPrivateNetwork: false,
      blockMetadataEndpoints: false,
      blockLoopback: false,
    },
    environment: {
      passthrough: [
        'ANTHROPIC_API_KEY',
        'CODEX_API_KEY',
        'CODEX_HOME',
        'HERMES_API_KEY',
        'HERMES_CONFIG_DIR',
        'HOME',
        'OPENAI_API_KEY',
        'OPENAI_BASE_URL',
        'OPENAI_ORG_ID',
        'OPENAI_ORGANIZATION',
        'OPENAI_PROJECT',
        'PATH',
        'SHELL',
        'TEMP',
        'TERM',
        'TMPDIR',
        'USER',
        'VK_API_URL',
      ],
      redactDisplay: true,
    },
    credentials: {
      mode: 'env-passthrough',
      brokerRefs: [],
    },
    createdAt: BUILT_IN_TIMESTAMP,
    updatedAt: BUILT_IN_TIMESTAMP,
  },
  {
    id: 'codex-repo-contained',
    name: 'Codex repo contained',
    description:
      'Repo-scoped read/write access, safe Codex environment passthrough, and no network egress.',
    enabled: true,
    builtIn: true,
    enforcement: 'required',
    requiredCapabilities: ['filesystem.read', 'filesystem.write', 'network.egress'],
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
      passthrough: [
        'ANTHROPIC_API_KEY',
        'CI',
        'CODEX_API_KEY',
        'CODEX_HOME',
        'FORCE_COLOR',
        'HERMES_API_KEY',
        'HERMES_CONFIG_DIR',
        'HOME',
        'LANG',
        'LC_ALL',
        'LC_CTYPE',
        'LOGNAME',
        'NODE_EXTRA_CA_CERTS',
        'NO_COLOR',
        'OPENAI_API_KEY',
        'OPENAI_BASE_URL',
        'OPENAI_ORG_ID',
        'OPENAI_ORGANIZATION',
        'OPENAI_PROJECT',
        'PATH',
        'SHELL',
        'SSL_CERT_FILE',
        'TEMP',
        'TERM',
        'TMP',
        'TMPDIR',
        'USER',
        'VK_API_URL',
      ],
      redactDisplay: true,
    },
    credentials: {
      mode: 'none',
      brokerRefs: [],
    },
    createdAt: BUILT_IN_TIMESTAMP,
    updatedAt: BUILT_IN_TIMESTAMP,
  },
  {
    id: 'brokered-network-allowlist',
    name: 'Brokered network allowlist',
    description:
      'Strict network allowlist and credential broker references for hosts that can enforce fine-grained egress.',
    enabled: true,
    builtIn: true,
    enforcement: 'required',
    requiredCapabilities: [
      'filesystem.read',
      'filesystem.write',
      'network.egress',
      'credential.access',
    ],
    filesystem: {
      readPaths: ['<workspace>'],
      writePaths: ['<workspace>'],
      deniedPaths: ['~/.ssh', '~/.aws', '~/.config/gh', '~/.git-credentials'],
      dotfileMasking: true,
      localOnlyHandles: true,
    },
    network: {
      defaultEgress: 'deny',
      allowedHosts: ['api.github.com', 'github.com', 'api.openai.com'],
      allowedMethods: ['GET', 'POST'],
      allowedPathPrefixes: ['/'],
      blockPrivateNetwork: true,
      blockMetadataEndpoints: true,
      blockLoopback: true,
    },
    environment: {
      passthrough: ['PATH', 'HOME', 'SHELL', 'USER', 'TMPDIR', 'TEMP', 'TERM', 'VK_API_URL'],
      redactDisplay: true,
    },
    credentials: {
      mode: 'brokered',
      brokerRefs: ['github-token', 'openai-api-key'],
    },
    createdAt: BUILT_IN_TIMESTAMP,
    updatedAt: BUILT_IN_TIMESTAMP,
  },
];

export class SandboxPolicyService {
  constructor(private readonly configService: ConfigService = getConfigService()) {}

  async listPresets(): Promise<SandboxPolicyPreset[]> {
    const config = await this.configService.getConfig();
    const presets = this.mergeBuiltIns(config.sandboxPolicyPresets ?? []);
    if (presetsChanged(config.sandboxPolicyPresets ?? [], presets)) {
      config.sandboxPolicyPresets = presets;
      config.defaultSandboxPresetId ??= DEFAULT_SANDBOX_PRESET_ID;
      await this.configService.saveConfig(config);
    }
    return presets;
  }

  async getPreset(id: string): Promise<SandboxPolicyPreset | null> {
    const presets = await this.listPresets();
    return presets.find((preset) => preset.id === id) ?? null;
  }

  async createPreset(input: SandboxPolicyPreset): Promise<SandboxPolicyPreset> {
    const config = await this.configService.getConfig();
    const presets = this.mergeBuiltIns(config.sandboxPolicyPresets ?? []);
    if (presets.some((preset) => preset.id === input.id)) {
      throw new ConflictError(`Sandbox preset already exists: ${input.id}`);
    }
    const now = new Date().toISOString();
    const preset = this.normalizePreset({
      ...input,
      builtIn: false,
      createdAt: now,
      updatedAt: now,
    });
    config.sandboxPolicyPresets = [...presets, preset];
    config.defaultSandboxPresetId ??= DEFAULT_SANDBOX_PRESET_ID;
    await this.configService.saveConfig(config);
    return preset;
  }

  async updatePreset(id: string, input: SandboxPolicyPreset): Promise<SandboxPolicyPreset> {
    if (id !== input.id) {
      throw new ValidationError('Sandbox preset id in URL must match request body');
    }

    const config = await this.configService.getConfig();
    const presets = this.mergeBuiltIns(config.sandboxPolicyPresets ?? []);
    const index = presets.findIndex((preset) => preset.id === id);
    if (index === -1) throw new NotFoundError(`Sandbox preset not found: ${id}`);
    const existing = presets[index];
    if (existing.builtIn) {
      throw new ValidationError('Built-in sandbox presets cannot be edited');
    }

    const preset = this.normalizePreset({
      ...input,
      builtIn: false,
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
    });
    presets[index] = preset;
    config.sandboxPolicyPresets = presets;
    await this.configService.saveConfig(config);
    return preset;
  }

  async deletePreset(id: string): Promise<void> {
    const config = await this.configService.getConfig();
    const presets = this.mergeBuiltIns(config.sandboxPolicyPresets ?? []);
    const preset = presets.find((candidate) => candidate.id === id);
    if (!preset) throw new NotFoundError(`Sandbox preset not found: ${id}`);
    if (preset.builtIn) throw new ValidationError('Built-in sandbox presets cannot be deleted');

    config.sandboxPolicyPresets = presets.filter((candidate) => candidate.id !== id);
    if (config.defaultSandboxPresetId === id)
      config.defaultSandboxPresetId = DEFAULT_SANDBOX_PRESET_ID;
    await this.configService.saveConfig(config);
  }

  async dryRun(input: SandboxPolicyEvaluationInput = {}): Promise<SandboxPolicyDryRunResult> {
    const preset = input.preset
      ? this.normalizePreset(input.preset)
      : await this.resolvePreset(input.presetId);
    if (!preset.enabled) {
      return this.resultForDisabledPreset(preset, input);
    }

    const capabilities = sandboxCapabilitiesFromManifest(input.providerRuntimeManifest);
    const evaluations = this.evaluateRules(preset, capabilities).map((rule) =>
      preset.enforcement === 'required' &&
      rule.capability === 'credential.broker' &&
      rule.status === 'advisory'
        ? {
            ...rule,
            status: 'unsupported' as const,
            detail:
              `${rule.detail} Advisory or externally delegated credential handling does not ` +
              'satisfy required brokered mode.',
          }
        : rule
    );
    const unsupportedRules = evaluations.filter((rule) => rule.status === 'unsupported');
    const advisoryRules = evaluations.filter((rule) => rule.status === 'advisory');
    const advisoryUnsupportedRules = preset.enforcement === 'advisory' ? unsupportedRules : [];
    const shouldBlock = preset.enforcement === 'required' && unsupportedRules.length > 0;
    const decision = shouldBlock
      ? 'block'
      : advisoryRules.length > 0 || advisoryUnsupportedRules.length > 0
        ? 'warn'
        : 'allow';
    const networkAccessEnabled = preset.network.defaultEgress === 'allow';
    return {
      decision,
      preset: this.redactPresetForResult(preset),
      provider: input.providerRuntimeManifest?.provider ?? input.provider ?? capabilities.provider,
      effective: {
        sandboxMode: this.effectiveSandboxMode(preset),
        networkAccessEnabled,
        envPassthrough: preset.environment.passthrough.slice().sort(),
        credentialRefs: redactBrokerRefs(preset.credentials.brokerRefs),
      },
      evaluations,
      unsupportedRules,
      warnings: [
        ...advisoryRules.map((rule) => rule.detail),
        ...advisoryUnsupportedRules.map((rule) => rule.detail),
        ...(networkAccessEnabled ? ['Network egress remains enabled by this preset.'] : []),
      ],
      remediation: shouldBlock
        ? 'Select a provider or host that reports support for every required sandbox rule, or choose a less restrictive preset.'
        : undefined,
    };
  }

  async dryRunWithTrace(input: SandboxPolicyEvaluationInput = {}): Promise<{
    result: SandboxPolicyDryRunResult;
    trace: CreateGovernanceTraceInput;
  }> {
    const result = await this.dryRun(input);
    return {
      result,
      trace: this.buildTrace(result, input),
    };
  }

  async assertLaunchAllowed(
    input: SandboxPolicyEvaluationInput = {}
  ): Promise<SandboxPolicyDryRunResult> {
    const result = await this.dryRun(input);
    if (result.decision === 'block') {
      throw new ConflictError(
        'Sandbox preset cannot be enforced by the selected provider or host',
        {
          presetId: result.preset.id,
          provider: result.provider,
          unsupportedRules: result.unsupportedRules.map((rule) => ({
            id: rule.id,
            capability: rule.capability,
            detail: rule.detail,
          })),
        }
      );
    }
    return result;
  }

  private async resolvePreset(id?: string): Promise<SandboxPolicyPreset> {
    const config = await this.configService.getConfig();
    const presetId = id ?? config.defaultSandboxPresetId ?? DEFAULT_SANDBOX_PRESET_ID;
    const preset = await this.getPreset(presetId);
    if (!preset) throw new NotFoundError(`Sandbox preset not found: ${presetId}`);
    return preset;
  }

  private mergeBuiltIns(existing: SandboxPolicyPreset[]): SandboxPolicyPreset[] {
    const byId = new Map<string, SandboxPolicyPreset>();
    for (const preset of BUILT_IN_SANDBOX_PRESETS)
      byId.set(preset.id, this.normalizePreset(preset));
    for (const preset of existing) {
      if (preset.builtIn) continue;
      byId.set(preset.id, this.normalizePreset(preset));
    }
    return Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name));
  }

  private normalizePreset(input: SandboxPolicyPreset): SandboxPolicyPreset {
    const now = new Date().toISOString();
    const parsed = sandboxPolicyPresetSchema.parse({
      ...input,
      createdAt: input.createdAt ?? now,
      updatedAt: input.updatedAt ?? now,
    }) as SandboxPolicyPreset;
    return {
      ...parsed,
      filesystem: {
        ...parsed.filesystem,
        readPaths: uniqueSorted(parsed.filesystem.readPaths),
        writePaths: uniqueSorted(parsed.filesystem.writePaths),
        deniedPaths: uniqueSorted(parsed.filesystem.deniedPaths),
      },
      network: {
        ...parsed.network,
        allowedHosts: uniqueSorted(parsed.network.allowedHosts.map((host) => host.toLowerCase())),
        allowedMethods: uniqueSorted(
          parsed.network.allowedMethods.map((method) => method.toUpperCase())
        ),
        allowedPathPrefixes: uniqueSorted(parsed.network.allowedPathPrefixes),
      },
      environment: {
        ...parsed.environment,
        passthrough: uniqueSorted(parsed.environment.passthrough.map((key) => key.toUpperCase())),
      },
      credentials: {
        ...parsed.credentials,
        brokerRefs: uniqueSorted(parsed.credentials.brokerRefs),
      },
    };
  }

  private evaluateRules(
    preset: SandboxPolicyPreset,
    capabilities: SandboxProviderCapabilities
  ): SandboxPolicyRuleEvaluation[] {
    const supported = new Set(capabilities.supported);
    const advisory = new Set(capabilities.advisory ?? []);
    const evaluations: SandboxPolicyRuleEvaluation[] = [];
    const add = (
      id: string,
      label: string,
      capability: SandboxProviderCapabilityId,
      required: boolean,
      detail: string,
      supportedWhen?: boolean
    ) => {
      if (!required) return;
      const status =
        supportedWhen === true || supported.has(capability)
          ? 'supported'
          : advisory.has(capability)
            ? 'advisory'
            : 'unsupported';
      evaluations.push({ id, label, capability, status, detail });
    };

    add(
      'filesystem-read',
      'Filesystem read grants',
      'filesystem.read',
      preset.filesystem.readPaths.length > 0,
      `Read paths: ${preset.filesystem.readPaths.join(', ')}`
    );
    add(
      'filesystem-write',
      'Filesystem write grants',
      'filesystem.write',
      preset.filesystem.writePaths.length > 0,
      `Write paths: ${preset.filesystem.writePaths.join(', ')}`
    );
    add(
      'filesystem-deny',
      'Filesystem denied paths',
      'filesystem.deny-paths',
      preset.filesystem.deniedPaths.length > 0,
      `Denied paths: ${preset.filesystem.deniedPaths.join(', ')}`
    );
    add(
      'filesystem-dotfiles',
      'Dotfile masking',
      'filesystem.dotfile-masking',
      preset.filesystem.dotfileMasking,
      'Dotfile masking must be enforced before launch.'
    );
    add(
      'network-disabled',
      'Default-deny network',
      'network.disable',
      preset.network.defaultEgress === 'deny' && preset.network.allowedHosts.length === 0,
      'Network egress is disabled.',
      supported.has('network.disable')
    );
    add(
      'network-allowlist',
      'Network allowlist',
      'network.allowlist',
      preset.network.defaultEgress === 'deny' && preset.network.allowedHosts.length > 0,
      `Allowed hosts: ${preset.network.allowedHosts.join(', ')}`
    );
    add(
      'network-private',
      'Private network blocking',
      'network.block-private',
      preset.network.blockPrivateNetwork,
      'Private network ranges must be blocked.',
      preset.network.defaultEgress === 'deny' && preset.network.allowedHosts.length === 0
    );
    add(
      'network-metadata',
      'Metadata endpoint blocking',
      'network.block-metadata',
      preset.network.blockMetadataEndpoints,
      'Cloud metadata endpoints must be blocked.',
      preset.network.defaultEgress === 'deny' && preset.network.allowedHosts.length === 0
    );
    add(
      'environment-allowlist',
      'Environment allowlist',
      'environment.allowlist',
      preset.environment.passthrough.length > 0,
      `Environment passthrough keys: ${preset.environment.passthrough.length}`
    );
    add(
      'credential-broker',
      'Credential broker',
      'credential.broker',
      preset.credentials.mode === 'brokered',
      `Broker refs: ${redactBrokerRefs(preset.credentials.brokerRefs).join(', ')}`
    );
    return evaluations;
  }

  private resultForDisabledPreset(
    preset: SandboxPolicyPreset,
    input: SandboxPolicyEvaluationInput
  ): SandboxPolicyDryRunResult {
    return {
      decision: preset.enforcement === 'required' ? 'block' : 'warn',
      preset: this.redactPresetForResult(preset),
      provider: input.provider,
      effective: {
        sandboxMode: 'danger-full-access',
        networkAccessEnabled: true,
        envPassthrough: [],
        credentialRefs: [],
      },
      evaluations: [],
      unsupportedRules: [],
      warnings: [`Sandbox preset ${preset.id} is disabled.`],
      remediation: 'Enable the preset or choose another preset before launch.',
    };
  }

  private effectiveSandboxMode(
    preset: SandboxPolicyPreset
  ): SandboxPolicyDryRunResult['effective']['sandboxMode'] {
    const hasWrites = preset.filesystem.writePaths.length > 0;
    const workspaceOnly =
      preset.filesystem.readPaths.every((entry) => entry === '<workspace>') &&
      preset.filesystem.writePaths.every((entry) => entry === '<workspace>');
    if (hasWrites && workspaceOnly) return 'workspace-write';
    if (!hasWrites && preset.filesystem.readPaths.length > 0) return 'read-only';
    return 'danger-full-access';
  }

  private buildTrace(
    result: SandboxPolicyDryRunResult,
    input: SandboxPolicyEvaluationInput
  ): CreateGovernanceTraceInput {
    const outcome =
      result.decision === 'block' ? 'blocked' : result.decision === 'warn' ? 'warned' : 'allowed';
    return {
      kind: 'sandbox-policy',
      outcome,
      title: `Sandbox preset ${result.preset.name}`,
      summary:
        result.decision === 'block'
          ? `Preset ${result.preset.id} cannot be fully enforced.`
          : `Preset ${result.preset.id} can be used with decision ${result.decision}.`,
      remediation: result.remediation,
      subject: {
        actionType: 'sandbox-policy.validate',
        project: input.workspacePath ? '[redacted-local-path]' : undefined,
      },
      evaluatedRules: result.evaluations.map((rule) => ({
        id: rule.id,
        label: rule.label,
        type: 'sandbox-policy',
        status:
          rule.status === 'supported'
            ? 'matched'
            : rule.status === 'advisory'
              ? 'info'
              : 'not-matched',
        outcome:
          rule.status === 'unsupported'
            ? 'blocked'
            : rule.status === 'advisory'
              ? 'warned'
              : 'allowed',
        message: rule.detail,
        details: {
          capability: rule.capability,
          status: rule.status,
        },
      })),
      matchedRules: result.evaluations
        .filter((rule) => rule.status !== 'supported')
        .map((rule) => ({
          id: rule.id,
          label: rule.label,
          type: 'sandbox-policy',
          status: rule.status === 'advisory' ? 'info' : 'not-matched',
          outcome: rule.status === 'advisory' ? 'warned' : 'blocked',
          message: rule.detail,
          details: {
            capability: rule.capability,
            status: rule.status,
          },
        })),
      raw: {
        presetId: result.preset.id,
        provider: result.provider,
        effective: result.effective,
        unsupportedRules: result.unsupportedRules.map((rule) => ({
          id: rule.id,
          capability: rule.capability,
          status: rule.status,
        })),
      },
    };
  }

  private redactPresetForResult(preset: SandboxPolicyPreset): SandboxPolicyPreset {
    return {
      ...preset,
      credentials: {
        ...preset.credentials,
        brokerRefs: redactBrokerRefs(preset.credentials.brokerRefs),
      },
    };
  }
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort();
}

function redactBrokerRefs(refs: string[]): string[] {
  return uniqueSorted(refs.map((ref) => ref.replace(/=.*/, '=[redacted]')));
}

function presetsChanged(existing: SandboxPolicyPreset[], merged: SandboxPolicyPreset[]): boolean {
  return JSON.stringify(existing) !== JSON.stringify(merged);
}

let singleton: SandboxPolicyService | null = null;

export function getSandboxPolicyService(): SandboxPolicyService {
  singleton ??= new SandboxPolicyService();
  return singleton;
}
