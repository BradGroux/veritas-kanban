import { describe, expect, it } from 'vitest';
import type {
  ExecutableAgentProvider,
  RunLaunchRuntime,
  SandboxPolicyDryRunResult,
} from '@veritas-kanban/shared';
import { compileProviderLaunchCredentialPlan } from '../services/provider-launch-credential-plan-service.js';
import { providerRuntimeManifestFixture } from './fixtures/provider-runtime-manifest.js';

const sandbox = (
  mode: SandboxPolicyDryRunResult['preset']['credentials']['mode'] = 'none',
  credentialRefs: string[] = []
): SandboxPolicyDryRunResult => ({
  decision: 'allow',
  preset: {
    id: 'fixture',
    name: 'Fixture',
    enabled: true,
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
    environment: { passthrough: [], redactDisplay: true },
    credentials: { mode, brokerRefs: credentialRefs },
    createdAt: '2026-07-24T00:00:00.000Z',
    updatedAt: '2026-07-24T00:00:00.000Z',
  },
  effective: {
    sandboxMode: 'workspace-write',
    networkAccessEnabled: false,
    envPassthrough: [],
    credentialRefs,
  },
  evaluations: [],
  unsupportedRules: [],
  warnings: [],
});

const runtime = (environmentKeys: string[]): RunLaunchRuntime => ({
  command: 'fixture',
  args: [],
  workingDirectory: 'task-worktree',
  worktree: 'required',
  environmentKeys,
  credentialReferences: environmentKeys.map((key) => `env:${key}`),
});

describe('provider launch credential plan', () => {
  it.each([
    ['openclaw', 'OPENCLAW_GATEWAY_TOKEN'],
    ['codex-cli', 'OPENAI_API_KEY'],
    ['codex-sdk', 'CODEX_API_KEY'],
    ['codex-app-server', 'OPENAI_API_KEY'],
    ['claude-code', 'CLAUDE_CODE_OAUTH_TOKEN'],
    ['hermes-cli', 'HERMES_API_KEY'],
  ] satisfies Array<[ExecutableAgentProvider, string]>)(
    'classifies %s boot authentication without claiming it is brokered',
    (provider, key) => {
      const manifest = providerRuntimeManifestFixture({ provider });
      const plan = compileProviderLaunchCredentialPlan({
        provider,
        providerRuntimeManifest: manifest,
        runtime: runtime([key]),
        sandbox: sandbox(),
      });

      expect(plan).toMatchObject({
        mode: 'none',
        brokerState: 'not-required',
        providerRuntimeManifestDigest: manifest.digest,
        providerRuntimeProbeRevision: manifest.probeRevision,
        references: [
          {
            reference: `env:${key}`,
            classification: 'harness-boot-authentication',
            delivery: 'provider-native-environment',
            boundary: 'provider-process',
            risk: 'provider-required',
          },
        ],
      });
    }
  );

  it('marks unknown credential environment keys as explicit high-risk passthrough', () => {
    const plan = compileProviderLaunchCredentialPlan({
      provider: 'acp-stdio',
      providerRuntimeManifest: providerRuntimeManifestFixture({ provider: 'acp-stdio' }),
      runtime: runtime(['CUSTOM_AUTH_TOKEN']),
      sandbox: sandbox('env-passthrough'),
    });

    expect(plan.references).toEqual([
      {
        reference: 'env:CUSTOM_AUTH_TOKEN',
        classification: 'compatibility-passthrough',
        delivery: 'raw-environment',
        boundary: 'provider-process',
        risk: 'high-risk',
      },
    ]);
  });

  it('classifies ACP profile authentication separately from task credentials', () => {
    for (const [harnessProfileId, key] of [
      ['buzz-agent', 'OPENAI_COMPAT_API_KEY'],
      ['github-copilot-cli', 'COPILOT_GITHUB_TOKEN'],
      ['grok-build', 'XAI_API_KEY'],
    ] as const) {
      const plan = compileProviderLaunchCredentialPlan({
        provider: 'acp-stdio',
        providerRuntimeManifest: providerRuntimeManifestFixture({ provider: 'acp-stdio' }),
        runtime: runtime([key]),
        sandbox: sandbox(),
        harnessProfileId,
      });

      expect(plan.references).toEqual([
        {
          reference: `env:${key}`,
          classification: 'harness-boot-authentication',
          delivery: 'provider-native-environment',
          boundary: 'provider-process',
          risk: 'provider-required',
        },
      ]);
    }
  });

  it('fails task integration references closed until a controlled boundary is present', () => {
    const manifest = providerRuntimeManifestFixture({ provider: 'codex-cli' });
    const plan = compileProviderLaunchCredentialPlan({
      provider: 'codex-cli',
      providerRuntimeManifest: manifest,
      runtime: runtime(['OPENAI_API_KEY']),
      sandbox: sandbox('brokered', ['github-token']),
    });

    expect(plan.brokerState).toBe('blocked');
    expect(plan.references).toContainEqual({
      reference: 'github-token',
      classification: 'task-integration',
      delivery: 'blocked',
      boundary: 'unavailable',
      risk: 'blocked',
    });
  });
});
