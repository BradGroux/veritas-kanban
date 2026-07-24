import type {
  ExecutableAgentProvider,
  ProviderRuntimeManifest,
  RunLaunchCredentialPlan,
  RunLaunchCredentialReference,
  RunLaunchRuntime,
  SandboxPolicyDryRunResult,
} from '@veritas-kanban/shared';
import { RUN_LAUNCH_CREDENTIAL_PLAN_SCHEMA_VERSION } from '@veritas-kanban/shared';
import { digestRunLaunchValue } from '../utils/run-launch-manifest-digest.js';
import {
  BUZZ_AGENT_CREDENTIAL_ENV_KEYS,
  BUZZ_AGENT_RUNTIME_PROFILE_ID,
  COPILOT_ACP_CREDENTIAL_ENV_KEYS,
  COPILOT_ACP_RUNTIME_PROFILE_ID,
  GROK_BUILD_CREDENTIAL_ENV_KEYS,
  GROK_BUILD_RUNTIME_PROFILE_ID,
} from './acp-stdio-adapter.js';

const CREDENTIAL_ENV_KEY_PATTERN =
  /(?:^|_)(?:API_KEYS?|AUTHORIZATION|AUTH_TOKEN|BEARER|BEARER_TOKEN|COOKIE|CREDENTIALS?|DATABASE_URL|DB_URL|PASSWORD|PASS|PRIVATE_KEY|SECRET|SESSION|SESSION_TOKEN|TOKEN|WEBHOOK)(?:_|$)/i;

const PROVIDER_BOOT_AUTH_KEYS: Record<ExecutableAgentProvider, ReadonlySet<string>> = {
  openclaw: new Set(['CLAWDBOT_GATEWAY_TOKEN', 'OPENCLAW_GATEWAY_TOKEN']),
  'codex-cli': new Set(['CODEX_API_KEY', 'OPENAI_API_KEY']),
  'codex-sdk': new Set(['CODEX_API_KEY', 'OPENAI_API_KEY']),
  'codex-app-server': new Set(['CODEX_API_KEY', 'OPENAI_API_KEY']),
  'claude-code': new Set(['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN']),
  'acp-stdio': new Set(),
  'hermes-cli': new Set([
    'ANTHROPIC_API_KEY',
    'HERMES_API_KEY',
    'OPENAI_API_KEY',
    'OPENROUTER_API_KEY',
  ]),
};

export function compileProviderLaunchCredentialPlan(input: {
  provider: string;
  providerRuntimeManifest: ProviderRuntimeManifest;
  runtime: RunLaunchRuntime;
  sandbox: SandboxPolicyDryRunResult;
  harnessProfileId?: string;
  brokeredCredentialReferences?: string[];
}): RunLaunchCredentialPlan {
  const providerBootAuthKeys = new Set([
    ...(PROVIDER_BOOT_AUTH_KEYS[input.provider as ExecutableAgentProvider] ?? []),
    ...(input.harnessProfileId === BUZZ_AGENT_RUNTIME_PROFILE_ID
      ? BUZZ_AGENT_CREDENTIAL_ENV_KEYS
      : []),
    ...(input.harnessProfileId === COPILOT_ACP_RUNTIME_PROFILE_ID
      ? COPILOT_ACP_CREDENTIAL_ENV_KEYS
      : []),
    ...(input.harnessProfileId === GROK_BUILD_RUNTIME_PROFILE_ID
      ? GROK_BUILD_CREDENTIAL_ENV_KEYS
      : []),
  ]);
  const taskReferences = new Set(input.sandbox.effective.credentialRefs);
  const brokeredReferences = new Set(input.brokeredCredentialReferences ?? []);
  const environmentReferences = new Set(
    input.runtime.credentialReferences
      .filter((reference) => reference.startsWith('env:'))
      .map((reference) => reference.slice(4))
  );
  for (const key of input.runtime.environmentKeys) {
    if (CREDENTIAL_ENV_KEY_PATTERN.test(key)) environmentReferences.add(key);
  }

  const references: RunLaunchCredentialReference[] = [
    ...[...environmentReferences].map((key): RunLaunchCredentialReference => {
      const bootAuthentication = providerBootAuthKeys.has(key);
      return bootAuthentication
        ? {
            reference: `env:${key}`,
            classification: 'harness-boot-authentication',
            delivery: 'provider-native-environment',
            boundary: 'provider-process',
            risk: 'provider-required',
          }
        : {
            reference: `env:${key}`,
            classification: 'compatibility-passthrough',
            delivery: 'raw-environment',
            boundary: 'provider-process',
            risk: 'high-risk',
          };
    }),
    ...[...taskReferences].map((reference): RunLaunchCredentialReference => {
      const brokered = brokeredReferences.has(reference);
      return {
        reference,
        classification: 'task-integration',
        delivery: brokered ? 'brokered-boundary' : 'blocked',
        boundary: brokered ? 'tool-control-plane' : 'unavailable',
        risk: brokered ? 'brokered' : 'blocked',
      };
    }),
  ].sort(
    (left, right) =>
      left.classification.localeCompare(right.classification) ||
      left.reference.localeCompare(right.reference)
  );

  const payload: Omit<RunLaunchCredentialPlan, 'digest'> = {
    schemaVersion: RUN_LAUNCH_CREDENTIAL_PLAN_SCHEMA_VERSION,
    mode: input.sandbox.preset.credentials.mode,
    brokerState:
      taskReferences.size === 0
        ? 'not-required'
        : [...taskReferences].every((reference) => brokeredReferences.has(reference))
          ? 'supported'
          : 'blocked',
    providerRuntimeManifestDigest: input.providerRuntimeManifest.digest,
    providerRuntimeProbeRevision: input.providerRuntimeManifest.probeRevision,
    references,
  };
  return {
    ...payload,
    digest: digestRunLaunchValue(payload),
  };
}
