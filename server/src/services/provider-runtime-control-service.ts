import type {
  ProviderRuntimeCapabilityId,
  ProviderRuntimeControlAction,
  ProviderRuntimeControlAssessment,
  ProviderRuntimeControlSet,
  ProviderRuntimeManifest,
  SandboxProviderCapabilities,
  SandboxProviderCapabilityId,
} from '@veritas-kanban/shared';
import { ConflictError } from '../middleware/error-handler.js';
import { ProviderRuntimeManifestSchema } from '../schemas/provider-runtime-manifest-schemas.js';
import { selectProviderRuntimeManifest } from './provider-runtime-capability-service.js';

interface RuntimeControlDefinition {
  action: ProviderRuntimeControlAction;
  label: string;
  capabilityId: ProviderRuntimeCapabilityId;
}

const CONTROL_DEFINITIONS: RuntimeControlDefinition[] = [
  { action: 'start', label: 'Start run', capabilityId: 'run.start' },
  { action: 'status', label: 'Read run status', capabilityId: 'run.status' },
  { action: 'logs', label: 'Read run logs', capabilityId: 'run.logs' },
  { action: 'complete', label: 'Complete run', capabilityId: 'run.complete' },
  { action: 'stop', label: 'Stop run', capabilityId: 'run.stop' },
  { action: 'interrupt', label: 'Interrupt run', capabilityId: 'run.interrupt' },
  { action: 'message', label: 'Steer run', capabilityId: 'run.steer' },
  { action: 'resume', label: 'Resume run', capabilityId: 'run.resume' },
  { action: 'reattach', label: 'Reattach run', capabilityId: 'run.reattach' },
  { action: 'approvals', label: 'Provider approvals', capabilityId: 'run.approvals' },
  { action: 'tool-calls', label: 'Tool calls', capabilityId: 'tool.calls' },
  { action: 'mcp', label: 'MCP tools', capabilityId: 'tool.mcp' },
  { action: 'structured-output', label: 'Structured output', capabilityId: 'output.structured' },
  { action: 'token-usage', label: 'Token usage', capabilityId: 'usage.tokens' },
  { action: 'artifacts', label: 'Artifact writes', capabilityId: 'artifact.write' },
];

export const BASELINE_LAUNCH_CAPABILITIES: ProviderRuntimeCapabilityId[] = [
  'run.start',
  'run.status',
  'run.logs',
  'run.complete',
  'workspace.worktrees',
];

const SANDBOX_CAPABILITY_IDS = new Set<SandboxProviderCapabilityId>([
  'filesystem.read',
  'filesystem.write',
  'filesystem.deny-paths',
  'filesystem.dotfile-masking',
  'network.disable',
  'network.allowlist',
  'network.block-private',
  'network.block-metadata',
  'environment.allowlist',
  'credential.broker',
]);

export function providerRuntimeControls(
  manifest: ProviderRuntimeManifest | undefined
): ProviderRuntimeControlSet {
  const validation = validateManifest(manifest);
  if (validation.reason) {
    return {
      manifestDigest: manifest?.digest,
      provider: manifest?.provider,
      providerVersion: manifest?.providerVersion,
      probeState: manifest?.probe.state,
      controls: CONTROL_DEFINITIONS.map((definition) => ({
        ...definition,
        state: 'unknown',
        available: false,
        advisory: false,
        reason: validation.reason as string,
        remediation:
          'Re-probe the provider and persist a valid manifest snapshot before using run controls.',
      })),
    };
  }
  const validatedManifest = validation.manifest;
  return {
    manifestDigest: validatedManifest?.digest,
    provider: validatedManifest?.provider,
    providerVersion: validatedManifest?.providerVersion,
    probeState: validatedManifest?.probe.state,
    controls: CONTROL_DEFINITIONS.map((definition) => assessControl(validatedManifest, definition)),
  };
}

export function providerRuntimeControl(
  manifest: ProviderRuntimeManifest | undefined,
  action: ProviderRuntimeControlAction
): ProviderRuntimeControlAssessment {
  const validation = validateManifest(manifest);
  if (validation.reason) {
    const definition = CONTROL_DEFINITIONS.find((candidate) => candidate.action === action);
    if (!definition) throw new Error(`Unknown provider runtime control action: ${action}`);
    return {
      ...definition,
      state: 'unknown',
      available: false,
      advisory: false,
      reason: validation.reason,
      remediation:
        'Re-probe the provider and persist a valid manifest snapshot before using run controls.',
    };
  }
  const definition = CONTROL_DEFINITIONS.find((candidate) => candidate.action === action);
  if (!definition) {
    throw new Error(`Unknown provider runtime control action: ${action}`);
  }
  return assessControl(validation.manifest, definition);
}

export function assertProviderRuntimeManifestSnapshot(
  manifest: ProviderRuntimeManifest | undefined,
  expectedDigest?: string
): asserts manifest is ProviderRuntimeManifest {
  const validation = validateManifest(manifest);
  if (validation.reason) {
    throw new ConflictError(`Provider runtime manifest is stale or invalid: ${validation.reason}`, {
      manifestDigest: manifest?.digest,
      expectedDigest,
      reasons: [validation.reason],
      remediation:
        'Re-probe the provider and persist a valid manifest snapshot before using run controls.',
    });
  }
  if (expectedDigest && validation.manifest?.digest !== expectedDigest) {
    throw new ConflictError('Provider runtime manifest is stale or invalid: digest mismatch', {
      manifestDigest: validation.manifest?.digest,
      expectedDigest,
      reasons: ['The active and persisted provider runtime manifest digests do not match.'],
      remediation:
        'Terminate the detached provider through its host supervisor, reconcile persisted attempt state, and launch again with one manifest snapshot.',
    });
  }
}

export function assertProviderRuntimeCapabilities(
  manifest: ProviderRuntimeManifest | undefined,
  requiredCapabilities: ProviderRuntimeCapabilityId[],
  action: string
): void {
  if (manifest) assertProviderRuntimeManifestSnapshot(manifest);
  const selection = selectProviderRuntimeManifest({
    manifests: manifest ? [manifest] : [],
    requiredCapabilities,
  });
  if (selection.compatible) return;

  const reasons = selection.candidates.flatMap((candidate) => candidate.reasons);
  const resolvedReasons = reasons.length > 0 ? reasons : [selection.reason];
  const remediation = remediationForManifest(manifest);
  throw new ConflictError(
    `Provider runtime does not support ${action}: ${resolvedReasons[0]} ${remediation}`,
    {
      action,
      manifestDigest: manifest?.digest,
      provider: manifest?.provider,
      providerVersion: manifest?.providerVersion,
      probeState: manifest?.probe.state,
      requiredCapabilities: selection.requiredCapabilities,
      reasons: resolvedReasons,
      remediation,
    }
  );
}

export function assertProviderRuntimeControl(
  manifest: ProviderRuntimeManifest | undefined,
  action: ProviderRuntimeControlAction
): void {
  if (manifest) assertProviderRuntimeManifestSnapshot(manifest);
  const control = providerRuntimeControl(manifest, action);
  if (control.available) return;
  throw new ConflictError(
    `Provider runtime does not support ${control.label.toLowerCase()}: ${control.reason} ${control.remediation}`,
    {
      action,
      manifestDigest: manifest?.digest,
      provider: manifest?.provider,
      providerVersion: manifest?.providerVersion,
      probeState: manifest?.probe.state,
      requiredCapabilities: [control.capabilityId],
      reasons: [control.reason],
      remediation: control.remediation,
    }
  );
}

export function sandboxCapabilitiesFromManifest(
  manifest: ProviderRuntimeManifest | undefined
): SandboxProviderCapabilities {
  const validation = validateManifest(manifest);
  const validatedManifest = validation.manifest;
  const supported: SandboxProviderCapabilityId[] = [];
  const advisory: SandboxProviderCapabilityId[] = [];
  for (const capability of validatedManifest?.capabilities ?? []) {
    if (!isSandboxCapability(capability.id)) continue;
    if (capability.state === 'supported') supported.push(capability.id);
    if (capability.state === 'advisory') advisory.push(capability.id);
  }
  return {
    provider: validatedManifest?.provider ?? manifest?.provider,
    supported: uniqueSorted(supported),
    advisory: uniqueSorted(advisory),
  };
}

function validateManifest(manifest: ProviderRuntimeManifest | undefined): {
  manifest?: ProviderRuntimeManifest;
  reason?: string;
} {
  if (!manifest) return { reason: 'No persisted provider runtime manifest is available.' };
  const parsed = ProviderRuntimeManifestSchema.safeParse(manifest);
  if (!parsed.success) {
    return {
      reason: 'The persisted provider runtime manifest failed schema or digest validation.',
    };
  }
  return { manifest: parsed.data as ProviderRuntimeManifest };
}

function assessControl(
  manifest: ProviderRuntimeManifest | undefined,
  definition: RuntimeControlDefinition
): ProviderRuntimeControlAssessment {
  const selection = selectProviderRuntimeManifest({
    manifests: manifest ? [manifest] : [],
    requiredCapabilities: [definition.capabilityId],
  });
  const candidate = selection.candidates[0];
  const capability = candidate?.capabilities[0];
  const reason =
    candidate?.probeState === 'failed'
      ? (candidate.reasons[0] ?? selection.reason)
      : (capability?.reason ?? candidate?.reasons[0] ?? selection.reason);
  return {
    ...definition,
    state: capability?.state ?? 'unknown',
    available: selection.compatible,
    advisory: selection.selectedManifest?.advisory ?? false,
    reason,
    remediation: selection.compatible ? undefined : remediationForManifest(manifest),
  };
}

function remediationForManifest(manifest: ProviderRuntimeManifest | undefined): string {
  if (!manifest) {
    return 'Select a provider with a validated runtime manifest and run its readiness probe again.';
  }
  if (manifest.probe.state === 'failed') {
    return 'Resolve the provider readiness probe failure and launch again with fresh manifest evidence.';
  }
  return 'Select a provider whose fresh manifest reports this capability as supported or advisory.';
}

function isSandboxCapability(
  capabilityId: ProviderRuntimeCapabilityId
): capabilityId is SandboxProviderCapabilityId {
  return SANDBOX_CAPABILITY_IDS.has(capabilityId as SandboxProviderCapabilityId);
}

function uniqueSorted<T extends string>(values: T[]): T[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}
