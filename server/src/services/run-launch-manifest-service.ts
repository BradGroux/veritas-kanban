import { Buffer } from 'node:buffer';
import type {
  AgentBudgetPolicy,
  HarnessSupportStatus,
  ProviderRuntimeManifest,
  RunLaunchInstructionReference,
  RunLaunchManifest,
  RunLaunchManifestBlocker,
  RunLaunchManifestDriftResult,
  RunLaunchManifestInstructionKind,
  RunLaunchManifestOrigin,
  RunLaunchPermissions,
  RunLaunchProfileReference,
  RunLaunchResources,
  RunLaunchRouting,
  RunLaunchRuntime,
  RunLaunchTools,
  RunLaunchWorkspaceTrust,
  SandboxPolicyDryRunResult,
  TaskEnvelope,
  TaskReadinessSummary,
} from '@veritas-kanban/shared';
import { RUN_LAUNCH_MANIFEST_SCHEMA_VERSION } from '@veritas-kanban/shared';
import { ConflictError, ValidationError } from '../middleware/error-handler.js';
import { parseProviderRuntimeManifest } from '../schemas/provider-runtime-manifest-schemas.js';
import { parseRunLaunchManifest } from '../schemas/run-launch-manifest-schemas.js';
import {
  calculateRunLaunchManifestDigest,
  digestRunLaunchValue,
} from '../utils/run-launch-manifest-digest.js';
import { sanitizeProviderRuntimeDiagnostic } from '../utils/provider-runtime-manifest-sanitize.js';

export interface RunLaunchManifestInstructionInput {
  id: string;
  kind: RunLaunchManifestInstructionKind;
  content: string;
  materialContent?: string;
  origin: string;
  precedence: number;
}

export interface RunLaunchManifestCompileInput {
  taskId: string;
  attemptId: string;
  createdAt?: string;
  taskEnvelope: TaskEnvelope;
  providerRuntimeManifest: ProviderRuntimeManifest;
  requiredRuntimeCapabilities?: string[];
  harnessSupport: HarnessSupportStatus;
  routing: RunLaunchRouting;
  profile?: RunLaunchProfileReference;
  readiness: {
    summary: TaskReadinessSummary;
    overrideReason?: string;
  };
  instructions: RunLaunchManifestInstructionInput[];
  runtime: RunLaunchRuntime;
  tools: RunLaunchTools;
  permissions: RunLaunchPermissions;
  resources?: RunLaunchResources;
  requiredHealthChecks: string[];
  satisfiedHealthChecks?: string[];
  sandboxPolicy: SandboxPolicyDryRunResult;
  budgetPolicy: AgentBudgetPolicy;
  workspaceTrust: RunLaunchWorkspaceTrust;
  origins: RunLaunchManifestOrigin[];
}

const MATERIAL_SECTIONS: Array<keyof RunLaunchManifest> = [
  'taskEnvelope',
  'providerRuntime',
  'providerRequirements',
  'harnessSupport',
  'routing',
  'profile',
  'readiness',
  'instructions',
  'workspace',
  'runtime',
  'tools',
  'permissions',
  'resources',
  'requiredHealthChecks',
  'sandbox',
  'budget',
  'workspaceTrust',
  'origins',
  'enforcement',
];

export class RunLaunchManifestService {
  compile(input: RunLaunchManifestCompileInput): RunLaunchManifest {
    const providerRuntime = parseProviderRuntimeManifest(input.providerRuntimeManifest);
    this.assertProviderRuntimeLink(input.taskEnvelope, providerRuntime);

    const instructions = [...input.instructions]
      .map<RunLaunchInstructionReference>((instruction) => ({
        id: instruction.id.trim(),
        kind: instruction.kind,
        digest: digestRunLaunchValue(instruction.content),
        materialDigest: digestRunLaunchValue(instruction.materialContent ?? instruction.content),
        byteLength: Buffer.byteLength(instruction.content, 'utf8'),
        origin: instruction.origin.trim(),
        precedence: instruction.precedence,
      }))
      .sort(
        (left, right) =>
          left.precedence - right.precedence ||
          left.kind.localeCompare(right.kind) ||
          left.id.localeCompare(right.id)
      );
    const tools = normalizeTools(input.tools);
    const permissions = normalizePermissions(input.permissions);
    const resources = normalizeResources(
      input.resources ?? {
        skills: [],
        shared: [],
        enforcement: 'not-required',
      }
    );
    const requiredHealthChecks = uniqueSorted(input.requiredHealthChecks);
    const providerRequirements = compileProviderRequirements(
      providerRuntime,
      input.requiredRuntimeCapabilities ?? []
    );
    const satisfiedHealthChecks = new Set(uniqueSorted(input.satisfiedHealthChecks ?? []));
    const sandbox = {
      presetId: input.sandboxPolicy.preset.id,
      enforcement: input.sandboxPolicy.preset.enforcement,
      decision: input.sandboxPolicy.decision,
      effective: {
        sandboxMode: input.sandboxPolicy.effective.sandboxMode,
        networkAccessEnabled: input.sandboxPolicy.effective.networkAccessEnabled,
        environmentKeys: uniqueSorted(input.sandboxPolicy.effective.envPassthrough),
        credentialReferences: uniqueSorted(
          input.sandboxPolicy.effective.credentialRefs.map(sanitizeProviderRuntimeDiagnostic)
        ),
      },
      unsupportedRules: [...input.sandboxPolicy.unsupportedRules]
        .map((rule) => ({
          id: rule.id,
          capability: rule.capability,
          status: rule.status,
        }))
        .sort((left, right) => left.id.localeCompare(right.id)),
      warnings: uniqueSorted(input.sandboxPolicy.warnings.map(sanitizeProviderRuntimeDiagnostic)),
    };
    const blockers = collectBlockers({
      input,
      tools,
      permissions,
      resources,
      providerRequirements,
      requiredHealthChecks,
      satisfiedHealthChecks,
    });
    const enforcementWarnings = uniqueSorted([
      ...sandbox.warnings,
      ...providerRequirements.capabilities
        .filter((capability) => capability.advisory)
        .map((capability) => `${capability.id}: ${capability.reason}`),
      ...(input.harnessSupport.supportTier === 'degraded' ? [input.harnessSupport.reason] : []),
    ]).map(sanitizeProviderRuntimeDiagnostic);
    const payload: Omit<RunLaunchManifest, 'digest'> = {
      schemaVersion: RUN_LAUNCH_MANIFEST_SCHEMA_VERSION,
      createdAt: input.createdAt ?? new Date().toISOString(),
      taskId: input.taskId.trim(),
      attemptId: input.attemptId.trim(),
      taskEnvelope: {
        schemaVersion: input.taskEnvelope.schemaVersion,
        digest: input.taskEnvelope.digest,
        materialDigest: digestTaskEnvelopeMaterial(input.taskEnvelope),
      },
      providerRuntime: {
        schemaVersion: providerRuntime.schemaVersion,
        digest: providerRuntime.digest,
        materialDigest: digestProviderRuntimeMaterial(providerRuntime),
        probeRevision: providerRuntime.probeRevision,
        provider: providerRuntime.provider,
        adapter: providerRuntime.adapter,
        protocolVersion: providerRuntime.protocolVersion,
        providerVersion: sanitizeProviderRuntimeDiagnostic(providerRuntime.providerVersion),
        ...(providerRuntime.providerBuild
          ? {
              providerBuild: sanitizeProviderRuntimeDiagnostic(providerRuntime.providerBuild),
            }
          : {}),
      },
      providerRequirements,
      harnessSupport: {
        profileId: input.harnessSupport.profileId,
        ...(input.harnessSupport.adapterId ? { adapterId: input.harnessSupport.adapterId } : {}),
        transport: input.harnessSupport.transport,
        supportTier: input.harnessSupport.supportTier,
      },
      routing: {
        ...input.routing,
        reason: sanitizeProviderRuntimeDiagnostic(input.routing.reason),
      },
      ...(input.profile ? { profile: { ...input.profile } } : {}),
      readiness: {
        ready: input.readiness.summary.ready,
        overridden:
          !input.readiness.summary.ready && Boolean(input.readiness.overrideReason?.trim()),
        passed: input.readiness.summary.passed,
        total: input.readiness.summary.total,
        missingRequired: uniqueSorted(
          input.readiness.summary.missingRequired.map((check) => check.id)
        ),
        warnings: uniqueSorted(input.readiness.summary.warnings.map((check) => check.id)),
        ...(!input.readiness.summary.ready && input.readiness.overrideReason?.trim()
          ? { overrideReasonDigest: digestRunLaunchValue(input.readiness.overrideReason.trim()) }
          : {}),
      },
      instructions,
      workspace: {
        worktreeId: input.taskEnvelope.workspace.worktreeId,
        ...(input.taskEnvelope.workspace.worktreeManifestId
          ? { worktreeManifestId: input.taskEnvelope.workspace.worktreeManifestId }
          : {}),
        ...(input.taskEnvelope.workspace.ownershipLeaseId
          ? { ownershipLeaseId: input.taskEnvelope.workspace.ownershipLeaseId }
          : {}),
        ...(input.taskEnvelope.workspace.ownershipAttemptId
          ? { ownershipAttemptId: input.taskEnvelope.workspace.ownershipAttemptId }
          : {}),
        repo: input.taskEnvelope.workspace.repo,
        branch: input.taskEnvelope.workspace.branch,
        baseBranch: input.taskEnvelope.workspace.baseBranch,
        resolvedBaseCommit:
          input.taskEnvelope.workspace.resolvedBaseCommit ??
          input.taskEnvelope.workspace.baseline.headSha,
        baseResolutionSource:
          input.taskEnvelope.workspace.baseResolutionSource ?? 'legacy-launch-head',
      },
      runtime: normalizeRuntime(input.runtime),
      tools,
      permissions,
      resources,
      requiredHealthChecks,
      sandbox,
      budget: structuredClone(input.budgetPolicy),
      workspaceTrust: {
        ...input.workspaceTrust,
        source: sanitizeProviderRuntimeDiagnostic(input.workspaceTrust.source),
      },
      origins: [...input.origins]
        .map((origin) => ({
          ...origin,
          field: origin.field.trim(),
          source: sanitizeProviderRuntimeDiagnostic(origin.source),
        }))
        .sort(
          (left, right) =>
            left.field.localeCompare(right.field) ||
            left.precedence - right.precedence ||
            left.source.localeCompare(right.source)
        ),
      enforcement: {
        enforceable: blockers.length === 0,
        blockers,
        warnings: enforcementWarnings,
      },
    };
    return immutableClone(
      parseRunLaunchManifest({
        ...payload,
        digest: calculateRunLaunchManifestDigest(payload),
      })
    );
  }

  assertEnforceable(manifest: RunLaunchManifest): void {
    const parsed = parseRunLaunchManifest(manifest);
    if (parsed.enforcement.enforceable) return;
    throw new ConflictError('The effective run launch manifest cannot be enforced.', {
      manifestDigest: parsed.digest,
      blockers: parsed.enforcement.blockers,
    });
  }

  private assertProviderRuntimeLink(
    taskEnvelope: TaskEnvelope,
    providerRuntime: ProviderRuntimeManifest
  ): void {
    const reference = taskEnvelope.launchManifest;
    if (
      reference.schemaVersion !== providerRuntime.schemaVersion ||
      reference.digest !== providerRuntime.digest ||
      reference.provider !== providerRuntime.provider ||
      reference.adapter !== providerRuntime.adapter ||
      reference.protocolVersion !== providerRuntime.protocolVersion
    ) {
      throw new ValidationError(
        'Task envelope provider runtime reference does not match the selected runtime manifest.'
      );
    }
  }
}

export function diffRunLaunchManifests(
  current: RunLaunchManifest,
  parent: RunLaunchManifest
): RunLaunchManifestDriftResult {
  const currentManifest = parseRunLaunchManifest(current);
  const parentManifest = parseRunLaunchManifest(parent);
  const changes = MATERIAL_SECTIONS.flatMap((field) => {
    const beforeValue =
      field === 'taskEnvelope'
        ? {
            schemaVersion: parentManifest.taskEnvelope.schemaVersion,
            materialDigest: parentManifest.taskEnvelope.materialDigest,
          }
        : field === 'providerRuntime'
          ? {
              ...parentManifest.providerRuntime,
              digest: undefined,
            }
          : field === 'instructions'
            ? materialInstructions(parentManifest.instructions)
            : field === 'runtime'
              ? materialRuntime(parentManifest)
              : parentManifest[field];
    const afterValue =
      field === 'taskEnvelope'
        ? {
            schemaVersion: currentManifest.taskEnvelope.schemaVersion,
            materialDigest: currentManifest.taskEnvelope.materialDigest,
          }
        : field === 'providerRuntime'
          ? {
              ...currentManifest.providerRuntime,
              digest: undefined,
            }
          : field === 'instructions'
            ? materialInstructions(currentManifest.instructions)
            : field === 'runtime'
              ? materialRuntime(currentManifest)
              : currentManifest[field];
    const beforeDigest = digestRunLaunchValue(beforeValue);
    const afterDigest = digestRunLaunchValue(afterValue);
    return beforeDigest === afterDigest ? [] : [{ field, beforeDigest, afterDigest }];
  });
  return {
    material: changes.length > 0,
    changes,
  };
}

function materialInstructions(
  instructions: RunLaunchManifest['instructions']
): Array<Omit<RunLaunchInstructionReference, 'digest' | 'byteLength'>> {
  return instructions.map(
    ({ digest: _digest, byteLength: _byteLength, ...instruction }) => instruction
  );
}

function materialRuntime(manifest: RunLaunchManifest): RunLaunchRuntime {
  const normalizedAttemptId = manifest.attemptId
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  const attemptVariants = [...new Set([manifest.attemptId, normalizedAttemptId].filter(Boolean))];
  return {
    ...manifest.runtime,
    args: manifest.runtime.args.map((argument) =>
      attemptVariants.reduce(
        (normalized, attemptId) => normalized.replaceAll(attemptId, '<attempt-id>'),
        argument
      )
    ),
  };
}

function normalizeRuntime(runtime: RunLaunchRuntime): RunLaunchRuntime {
  return {
    ...(runtime.model ? { model: sanitizeProviderRuntimeDiagnostic(runtime.model) } : {}),
    command: sanitizeProviderRuntimeDiagnostic(runtime.command),
    args: runtime.args.map(sanitizeProviderRuntimeDiagnostic),
    workingDirectory: runtime.workingDirectory,
    worktree: runtime.worktree,
    environmentKeys: uniqueSorted(runtime.environmentKeys),
    credentialReferences: uniqueSorted(
      runtime.credentialReferences.map(sanitizeProviderRuntimeDiagnostic)
    ),
  };
}

function normalizeTools(tools: RunLaunchTools): RunLaunchTools {
  return {
    allowed: uniqueSorted(tools.allowed),
    denied: uniqueSorted(tools.denied),
    policyIds: uniqueSorted(tools.policyIds),
    mcpServers: uniqueSorted(tools.mcpServers),
    enforcement: tools.enforcement,
  };
}

function normalizePermissions(permissions: RunLaunchPermissions): RunLaunchPermissions {
  return {
    level: permissions.level,
    required: uniqueSorted(permissions.required),
    enforcement: permissions.enforcement,
  };
}

function normalizeResources(resources: RunLaunchResources): RunLaunchResources {
  return {
    skills: uniqueSorted(resources.skills),
    shared: uniqueSorted(resources.shared),
    enforcement: resources.enforcement,
  };
}

function collectBlockers({
  input,
  tools,
  permissions,
  resources,
  providerRequirements,
  requiredHealthChecks,
  satisfiedHealthChecks,
}: {
  input: RunLaunchManifestCompileInput;
  tools: RunLaunchTools;
  permissions: RunLaunchPermissions;
  resources: RunLaunchResources;
  providerRequirements: RunLaunchManifest['providerRequirements'];
  requiredHealthChecks: string[];
  satisfiedHealthChecks: Set<string>;
}): RunLaunchManifestBlocker[] {
  const blockers: RunLaunchManifestBlocker[] = [];
  const add = (code: string, field: string, detail: string, remediation: string): void => {
    blockers.push({ code, field, detail, remediation });
  };
  if (
    tools.enforcement !== 'enforced' &&
    (tools.allowed.length > 0 || tools.denied.length > 0 || tools.policyIds.length > 0)
  ) {
    add(
      'tool-policy-unenforceable',
      'tools',
      'The profile declares tool restrictions that the selected adapter cannot enforce.',
      'Select an adapter with tool-policy enforcement or remove the declared restrictions.'
    );
  }
  for (const capability of providerRequirements.capabilities) {
    if (capability.satisfied) continue;
    add(
      'provider-capability-unavailable',
      `providerRequirements.${capability.id}`,
      `${capability.id}: ${capability.reason}`,
      'Select a provider that evidences every required runtime capability.'
    );
  }
  if (tools.enforcement !== 'enforced' && tools.mcpServers.length > 0) {
    add(
      'mcp-unavailable',
      'tools.mcpServers',
      'The profile declares MCP servers that the selected adapter cannot inject safely.',
      'Select an adapter with explicit MCP injection or remove the MCP declarations.'
    );
  }
  if (permissions.enforcement !== 'enforced' && permissions.required.length > 0) {
    add(
      'permission-unenforceable',
      'permissions.required',
      'The profile declares permissions that the selected adapter cannot enforce.',
      'Select an adapter with permission enforcement or remove the required permissions.'
    );
  }
  if (resources.enforcement !== 'enforced' && resources.skills.length > 0) {
    add(
      'skill-resource-unavailable',
      'resources.skills',
      'The launch selects skills that the adapter cannot inject and verify.',
      'Select an adapter with explicit skill injection or remove the selected skills.'
    );
  }
  if (resources.enforcement !== 'enforced' && resources.shared.length > 0) {
    add(
      'shared-resource-unavailable',
      'resources.shared',
      'The launch selects shared resources that the adapter cannot inject and verify.',
      'Select an adapter with explicit shared-resource injection or remove the resources.'
    );
  }
  const missingHealthChecks = requiredHealthChecks.filter(
    (checkId) => !satisfiedHealthChecks.has(checkId)
  );
  if (missingHealthChecks.length > 0) {
    add(
      'health-check-unavailable',
      'requiredHealthChecks',
      `Required profile health checks were not satisfied: ${missingHealthChecks.join(', ')}.`,
      'Run and satisfy every required profile health check before launch.'
    );
  }
  if (input.sandboxPolicy.decision === 'block') {
    add(
      'sandbox-policy-blocked',
      'sandbox.decision',
      'The resolved sandbox policy blocks this launch.',
      input.sandboxPolicy.remediation ?? 'Resolve the sandbox policy blockers before launch.'
    );
  } else if (
    input.sandboxPolicy.preset.enforcement === 'required' &&
    input.sandboxPolicy.unsupportedRules.length > 0
  ) {
    add(
      'sandbox-policy-unenforceable',
      'sandbox.unsupportedRules',
      'The required sandbox policy contains rules the selected adapter cannot enforce.',
      input.sandboxPolicy.remediation ?? 'Select a compatible adapter or sandbox preset.'
    );
  }
  if (input.workspaceTrust.status === 'untrusted') {
    add(
      'workspace-untrusted',
      'workspaceTrust',
      'The selected workspace trust posture does not permit launch.',
      'Trust the workspace explicitly or choose a non-executable profile.'
    );
  }
  if (!input.harnessSupport.enabled || input.harnessSupport.supportTier === 'unsupported') {
    add(
      'harness-unavailable',
      'harnessSupport',
      sanitizeProviderRuntimeDiagnostic(input.harnessSupport.reason),
      'Configure a supported executable harness before launch.'
    );
  }
  if (input.providerRuntimeManifest.probe.state === 'failed') {
    add(
      'provider-probe-failed',
      'providerRuntime',
      'The provider runtime probe failed.',
      'Resolve the provider runtime diagnostics and probe again.'
    );
  }
  return blockers.sort(
    (left, right) => left.field.localeCompare(right.field) || left.code.localeCompare(right.code)
  );
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort((left, right) =>
    left.localeCompare(right)
  );
}

function compileProviderRequirements(
  providerRuntime: ProviderRuntimeManifest,
  requiredCapabilities: string[]
): RunLaunchManifest['providerRequirements'] {
  const required = uniqueSorted(requiredCapabilities);
  return {
    required,
    capabilities: required.map((id) => {
      const evidence = providerRuntime.capabilities.find((capability) => capability.id === id);
      const state = evidence?.state ?? 'unknown';
      return {
        id,
        state,
        satisfied: state === 'supported' || state === 'advisory',
        advisory: state === 'advisory',
        reason: evidence?.reason ?? 'No capability evidence is present.',
      };
    }),
  };
}

function digestTaskEnvelopeMaterial(taskEnvelope: TaskEnvelope): string {
  const { digest: _digest, attempt: _attempt, workspace, ...stableEnvelope } = taskEnvelope;
  const { capturedAt: _capturedAt, ...baseline } = workspace.baseline;
  const { digest: _launchDigest, ...stableLaunchManifest } = stableEnvelope.launchManifest;
  return digestRunLaunchValue({
    ...stableEnvelope,
    launchManifest: stableLaunchManifest,
    workspace: {
      ...workspace,
      baseline,
    },
  });
}

function digestProviderRuntimeMaterial(providerRuntime: ProviderRuntimeManifest): string {
  const { digest: _digest, probe, ...stableRuntime } = providerRuntime;
  const { probedAt: _probedAt, ...stableProbe } = probe;
  return digestRunLaunchValue({
    ...stableRuntime,
    probe: stableProbe,
  });
}

function immutableClone<T>(value: T): T {
  return deepFreeze(structuredClone(value));
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return value;
}
