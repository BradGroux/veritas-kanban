import path from 'path';
import type {
  AgentHostAuthState,
  AgentHostCompatibilityCheck,
  AgentHostCompatibilityPreview,
  AgentHostCompatibilityResponse,
  AgentHostHealthResponse,
  AgentHostPosture,
  AgentHostPreviewRequest,
  AgentHostRecord,
  AgentHostRoutingDecision,
  ProviderRuntimeCapabilityId,
  ProviderRuntimeManifest,
  ProviderRuntimeSelection,
  SandboxProviderCapabilityId,
} from '@veritas-kanban/shared';
import {
  AGENT_HEARTBEAT_TIMEOUT_MS,
  getAgentRegistryService,
  registeredAgentIsLive,
  type RegisteredAgent,
} from './agent-registry-service.js';
import { selectProviderRuntimeManifest } from './provider-runtime-capability-service.js';

const STALE_HEARTBEAT_MS = AGENT_HEARTBEAT_TIMEOUT_MS;
const DISCONNECTED_HEARTBEAT_MS = 30 * 60 * 1000;

interface AgentHostRegistryReader {
  list(): RegisteredAgent[];
}

interface HostAccumulator {
  id: string;
  name: string;
  supervisorType: string;
  os?: string;
  authState: AgentHostAuthState;
  supportedAgents: Set<string>;
  supportedProviders: Set<string>;
  supportedModels: Set<string>;
  supportedTools: Set<string>;
  sandboxCapabilities: Set<SandboxProviderCapabilityId>;
  manifestRegistrations: HostManifestRegistration[];
  legacyProviders: Set<string>;
  legacyModels: Set<string>;
  legacyTools: Set<string>;
  legacySandboxCapabilities: Set<SandboxProviderCapabilityId>;
  workspaceLabels: Set<string>;
  workspaceRoots: string[];
  activeSessions: number;
  queueDepth: number;
  maxQueueDepth: number;
  lastHeartbeat?: string;
  lastFailure?: string;
  statuses: RegisteredAgent['status'][];
  registeredAgentIds: string[];
  diagnostics: Set<string>;
}

interface HostManifestRegistration {
  agentId: string;
  agentName: string;
  manifest: ProviderRuntimeManifest;
}

interface ResolvedAgentHost extends AgentHostRecord {
  workspaceRoots: string[];
  manifestRegistrations: HostManifestRegistration[];
}

export class AgentHostService {
  constructor(private readonly registry: AgentHostRegistryReader = getAgentRegistryService()) {}

  getHealth(now = new Date()): AgentHostHealthResponse {
    const hosts = this.buildHosts(now);
    return {
      generatedAt: now.toISOString(),
      hosts: hosts.map(stripInternalHostFields),
      summary: summarizeHosts(hosts),
    };
  }

  preview(request: AgentHostPreviewRequest, now = new Date()): AgentHostCompatibilityResponse {
    const hosts = this.buildHosts(now);
    const normalizedRequest = normalizeRequest(request);
    const previews = hosts.map((host) => this.previewHost(host, normalizedRequest));
    return {
      generatedAt: now.toISOString(),
      request: normalizedRequest,
      previews,
      decision: this.resolveDecision(previews, normalizedRequest),
    };
  }

  private buildHosts(now: Date): ResolvedAgentHost[] {
    const byHost = new Map<string, HostAccumulator>();

    for (const agent of this.registry.list()) {
      const metadata = safeMetadata(agent.metadata);
      const hostId =
        stringValue(metadata.hostId) ??
        stringValue(metadata.supervisorId) ??
        stringValue(metadata.machineId) ??
        `agent:${agent.id}`;
      const host = getOrCreateHost(byHost, hostId, agent, metadata);

      host.supportedAgents.add(agent.id);
      host.supportedAgents.add(agent.name);
      for (const item of stringArray(metadata.supportedAgents)) host.supportedAgents.add(item);
      for (const capability of agent.capabilities) {
        host.legacyTools.add(capability.name);
      }

      if (agent.provider) host.legacyProviders.add(agent.provider);
      for (const item of stringArray(metadata.providers)) host.legacyProviders.add(item);
      for (const capability of sandboxCapabilityArray(metadata.sandboxCapabilities)) {
        host.legacySandboxCapabilities.add(capability);
      }
      for (const capability of inferredSandboxCapabilities(agent.provider)) {
        host.legacySandboxCapabilities.add(capability);
      }
      for (const provider of stringArray(metadata.providers)) {
        for (const capability of inferredSandboxCapabilities(provider)) {
          host.legacySandboxCapabilities.add(capability);
        }
      }

      if (agent.model) host.legacyModels.add(agent.model);
      for (const item of stringArray(metadata.models)) host.legacyModels.add(item);

      for (const item of stringArray(metadata.tools)) host.legacyTools.add(item);
      for (const item of stringArray(metadata.requiredTools)) host.legacyTools.add(item);

      const manifest = agent.providerRuntimeManifest;
      if (manifest && registrationManifestIsCurrent(agent, now)) {
        host.manifestRegistrations.push({ agentId: agent.id, agentName: agent.name, manifest });
        if (manifest.probe.state === 'failed') {
          host.diagnostics.add(
            `Provider manifest ${manifest.digest} failed its readiness probe and is display-only.`
          );
        } else {
          host.supportedProviders.add(manifest.provider);
          host.supportedProviders.add(manifest.adapter);
          for (const model of manifest.models) host.supportedModels.add(model);
          for (const capability of manifest.capabilities) {
            if (capability.state !== 'supported') continue;
            if (capability.id.startsWith('tool.')) host.supportedTools.add(capability.id);
            if (isSandboxCapability(capability.id)) {
              host.sandboxCapabilities.add(capability.id);
            }
          }
        }
      } else if (manifest) {
        host.diagnostics.add(
          `Runtime manifest from agent ${agent.id} was excluded because its registration is offline or outside the five-minute heartbeat window.`
        );
      }

      const rawRoots = stringArray(metadata.workspaceRoots);
      for (const root of rawRoots) {
        host.workspaceRoots.push(root);
        host.workspaceLabels.add(safeWorkspaceLabel(root));
      }
      for (const label of stringArray(metadata.workspaceLabels)) {
        host.workspaceLabels.add(safeWorkspaceLabel(label));
      }

      const activeSessions = numberValue(metadata.activeSessions);
      host.activeSessions += activeSessions ?? (agent.status === 'busy' ? 1 : 0);
      const queueDepth = numberValue(metadata.queueDepth);
      host.queueDepth += queueDepth ?? (agent.status === 'busy' ? 1 : 0);
      host.maxQueueDepth = Math.max(host.maxQueueDepth, numberValue(metadata.maxQueueDepth) ?? 1);
      host.lastHeartbeat = latestIso(host.lastHeartbeat, agent.lastHeartbeat);
      host.lastFailure = latestIso(
        host.lastFailure,
        stringValue(metadata.lastFailure) ?? stringValue(metadata.lastErrorAt)
      );
      host.statuses.push(agent.status);
      host.registeredAgentIds.push(agent.id);

      const agentAuth = authState(metadata);
      host.authState = mergeAuthState(host.authState, agentAuth);
    }

    return Array.from(byHost.values())
      .map((host) => finalizeHost(host, now))
      .sort((a, b) => {
        const postureDelta = postureRank(a.posture) - postureRank(b.posture);
        if (postureDelta !== 0) return postureDelta;
        return a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
      });
  }

  private previewHost(
    host: ResolvedAgentHost,
    request: AgentHostPreviewRequest
  ): AgentHostCompatibilityPreview {
    const runtimeSelection = this.selectRuntimeManifest(host, request);
    const checks: AgentHostCompatibilityCheck[] = [
      {
        id: 'heartbeat',
        label: 'Heartbeat',
        passed: host.posture === 'connected',
        detail:
          host.posture === 'connected'
            ? 'Host has a current heartbeat.'
            : `Host posture is ${host.posture}.`,
      },
      {
        id: 'capacity',
        label: 'Capacity',
        passed: !host.overloaded,
        detail: host.overloaded
          ? `Queue is ${host.queueDepth}/${host.maxQueueDepth}.`
          : `Queue is ${host.queueDepth}/${host.maxQueueDepth}.`,
      },
      this.workspaceCheck(host, request.workspacePath),
      this.membershipCheck(
        'provider-available',
        'Provider',
        request.provider,
        host.supportedProviders,
        'No provider requirement supplied.'
      ),
      this.membershipCheck(
        'model-supported',
        'Model',
        request.model,
        host.supportedModels,
        'No model requirement supplied.'
      ),
      this.runtimeCapabilitiesCheck(runtimeSelection, request),
      this.requiredToolsCheck(runtimeSelection, request.requiredTools),
      this.sandboxPolicyCheck(request.sandboxPresetId),
      {
        id: 'verification-gates',
        label: 'Verification gates',
        passed: true,
        detail: request.verificationGates?.length
          ? `${request.verificationGates.length} gate(s) will be recorded with the launch.`
          : 'No verification gates supplied.',
      },
    ];

    if (request.agent) {
      checks.push(
        this.membershipCheck(
          'agent-supported',
          'Agent',
          request.agent,
          host.supportedAgents,
          'No agent requirement supplied.'
        )
      );
    }

    const reasons = checks.filter((check) => !check.passed).map((check) => check.detail);
    const warnings = [
      ...host.diagnostics,
      ...checks
        .filter(
          (check) =>
            check.passed &&
            /unknown|not supplied|will be recorded|advisory|legacy/i.test(check.detail)
        )
        .map((check) => check.detail),
    ];

    return {
      hostId: host.id,
      hostName: host.name,
      posture: host.posture,
      compatible: reasons.length === 0,
      checks,
      runtimeSelection,
      reasons,
      warnings: uniqueSorted(warnings),
    };
  }

  private workspaceCheck(
    host: ResolvedAgentHost,
    workspacePath?: string
  ): AgentHostCompatibilityCheck {
    if (!workspacePath) {
      return {
        id: 'workspace-access',
        label: 'Workspace access',
        passed: true,
        detail: 'No workspace requirement supplied.',
      };
    }

    const roots = host.workspaceRoots;
    if (roots.length === 0) {
      return {
        id: 'workspace-access',
        label: 'Workspace access',
        passed: true,
        detail: 'Workspace access is unknown because the host has no registered roots.',
      };
    }

    const accessible = roots.some((root) => pathContains(root, workspacePath));
    return {
      id: 'workspace-access',
      label: 'Workspace access',
      passed: accessible,
      detail: accessible
        ? 'Workspace is under a registered host root.'
        : 'Workspace is outside the registered host roots.',
    };
  }

  private membershipCheck(
    id: AgentHostCompatibilityCheck['id'],
    label: string,
    value: string | undefined,
    supported: string[],
    emptyDetail: string
  ): AgentHostCompatibilityCheck {
    if (!value) {
      return { id, label, passed: true, detail: emptyDetail };
    }
    if (supported.length === 0) {
      return {
        id,
        label,
        passed: false,
        detail: `${label} support is unavailable because no validated runtime manifest reports it.`,
      };
    }
    const matched = supported.some((candidate) => normalize(candidate) === normalize(value));
    return {
      id,
      label,
      passed: matched,
      detail: matched
        ? `${label} "${value}" is supported.`
        : `${label} "${value}" is not registered on this host.`,
    };
  }

  private selectRuntimeManifest(
    host: ResolvedAgentHost,
    request: AgentHostPreviewRequest
  ): ProviderRuntimeSelection {
    const registrations = host.manifestRegistrations.filter(
      (registration) =>
        !request.agent ||
        normalize(request.agent) === normalize(registration.agentId) ||
        normalize(request.agent) === normalize(registration.agentName)
    );
    return selectProviderRuntimeManifest({
      manifests: registrations.map((registration) => registration.manifest),
      provider: request.provider,
      model: request.model,
      requiredCapabilities: [
        ...(request.requiredRuntimeCapabilities ?? []),
        ...(request.requiredTools ?? []).filter((tool) => tool.startsWith('tool.')),
      ],
    });
  }

  private runtimeCapabilitiesCheck(
    selection: ProviderRuntimeSelection,
    request: AgentHostPreviewRequest
  ): AgentHostCompatibilityCheck {
    const required = selection.requiredCapabilities;
    const hasManifestRequirement = Boolean(
      request.provider || request.model || required.length > 0
    );
    if (!hasManifestRequirement) {
      return {
        id: 'runtime-capabilities',
        label: 'Runtime manifest',
        passed: true,
        detail: 'No provider, model, or runtime capability requirement supplied.',
      };
    }

    return {
      id: 'runtime-capabilities',
      label: 'Runtime manifest',
      passed: selection.compatible,
      detail: selection.compatible
        ? required.length > 0
          ? selection.selectedManifest?.advisory
            ? `Required runtime capabilities have advisory evidence: ${required.join(', ')}.`
            : `Required runtime capabilities are supported: ${required.join(', ')}.`
          : 'Provider and model requirements are satisfied by one validated runtime manifest.'
        : selection.reason,
    };
  }

  private requiredToolsCheck(
    selection: ProviderRuntimeSelection,
    requiredTools: string[] | undefined
  ): AgentHostCompatibilityCheck {
    const tools = (requiredTools ?? []).map((tool) => tool.trim()).filter(Boolean);
    if (tools.length === 0) {
      return {
        id: 'required-tools',
        label: 'Required tools',
        passed: true,
        detail: 'No required tools supplied.',
      };
    }
    const runtimeTools = tools.filter((tool) => tool.startsWith('tool.'));
    const legacyNamedTools = tools.filter((tool) => !tool.startsWith('tool.'));
    const runtimePassed = runtimeTools.length === 0 || selection.compatible;
    const legacyNamesPassed = legacyNamedTools.length === 0;
    return {
      id: 'required-tools',
      label: 'Required tools',
      passed: runtimePassed && legacyNamesPassed,
      detail: !legacyNamesPassed
        ? `Legacy named tool requirements cannot qualify host runtime posture: ${legacyNamedTools.join(', ')}. Use requiredRuntimeCapabilities with a tool.* identifier.`
        : runtimePassed
          ? 'Required tool capabilities qualify through one validated runtime manifest.'
          : selection.reason,
    };
  }

  private sandboxPolicyCheck(sandboxPresetId: string | undefined): AgentHostCompatibilityCheck {
    if (!sandboxPresetId) {
      return {
        id: 'sandbox-policy',
        label: 'Sandbox policy',
        passed: true,
        detail: 'No sandbox preset requirement supplied.',
      };
    }

    return {
      id: 'sandbox-policy',
      label: 'Sandbox policy',
      passed: false,
      detail: `Sandbox preset ${sandboxPresetId} cannot qualify a host until its required controls are resolved into requiredRuntimeCapabilities.`,
    };
  }

  private resolveDecision(
    previews: AgentHostCompatibilityPreview[],
    request: AgentHostPreviewRequest
  ): AgentHostRoutingDecision {
    const excludedHostIds = previews
      .filter((preview) => !preview.compatible || preview.posture !== 'connected')
      .map((preview) => preview.hostId);

    if (previews.length === 0) {
      return {
        policy: 'disabled',
        reason: 'No agent hosts are registered.',
        fallbackBehavior: 'Existing local execution can continue, but auto-routing is disabled.',
        excludedHostIds,
      };
    }

    if (request.manualHostId) {
      const manual = previews.find((preview) => preview.hostId === request.manualHostId);
      if (manual?.compatible) {
        return selectedDecision('manual', manual, 'Manual host target selected.', excludedHostIds);
      }
      return {
        policy: 'manual',
        reason: manual
          ? `Manual host "${manual.hostName}" is not compatible.`
          : `Manual host "${request.manualHostId}" is not registered.`,
        fallbackBehavior: 'Do not launch until the selected host is compatible.',
        excludedHostIds,
      };
    }

    if (request.projectDefaultHostId) {
      const projectDefault = previews.find(
        (preview) => preview.hostId === request.projectDefaultHostId
      );
      if (projectDefault?.compatible && projectDefault.posture === 'connected') {
        return selectedDecision(
          'project-default',
          projectDefault,
          'Project default host selected.',
          excludedHostIds
        );
      }
    }

    if (request.autoRouting === false) {
      return {
        policy: 'disabled',
        reason: 'Automatic host routing is disabled for this launch.',
        fallbackBehavior: 'Use a manual host target to dispatch.',
        excludedHostIds,
      };
    }

    const selected = previews.find(
      (preview) => preview.compatible && preview.posture === 'connected'
    );
    if (selected) {
      return selectedDecision(
        'first-capable-healthy',
        selected,
        'Selected first capable connected host.',
        excludedHostIds
      );
    }

    return {
      policy: 'disabled',
      reason: 'No connected compatible host qualifies for automatic routing.',
      fallbackBehavior: 'Keep the launch queued or choose a compatible manual host.',
      excludedHostIds,
    };
  }
}

export function getAgentHostService(): AgentHostService {
  return new AgentHostService();
}

function getOrCreateHost(
  byHost: Map<string, HostAccumulator>,
  hostId: string,
  agent: RegisteredAgent,
  metadata: Record<string, unknown>
): HostAccumulator {
  const existing = byHost.get(hostId);
  if (existing) return existing;

  const host: HostAccumulator = {
    id: hostId,
    name:
      stringValue(metadata.hostName) ??
      stringValue(metadata.supervisorName) ??
      stringValue(metadata.hostname) ??
      agent.name,
    supervisorType:
      stringValue(metadata.supervisorType) ?? stringValue(metadata.hostType) ?? 'local-agent',
    os: stringValue(metadata.os),
    authState: 'unknown',
    supportedAgents: new Set(),
    supportedProviders: new Set(),
    supportedModels: new Set(),
    supportedTools: new Set(),
    sandboxCapabilities: new Set(),
    manifestRegistrations: [],
    legacyProviders: new Set(),
    legacyModels: new Set(),
    legacyTools: new Set(),
    legacySandboxCapabilities: new Set(),
    workspaceLabels: new Set(),
    workspaceRoots: [],
    activeSessions: 0,
    queueDepth: 0,
    maxQueueDepth: 1,
    statuses: [],
    registeredAgentIds: [],
    diagnostics: new Set(),
  };
  byHost.set(hostId, host);
  return host;
}

function finalizeHost(host: HostAccumulator, now: Date): ResolvedAgentHost {
  const overloaded = host.queueDepth >= host.maxQueueDepth;
  const posture = resolvePosture(host, overloaded, now);
  if (overloaded) {
    host.diagnostics.add(`Queue depth ${host.queueDepth} reached capacity ${host.maxQueueDepth}.`);
  }
  if (host.authState === 'unauthenticated') {
    host.diagnostics.add('Supervisor authentication is unavailable.');
  }
  if (posture === 'stale') {
    host.diagnostics.add('Supervisor heartbeat is stale.');
  }
  if (posture === 'disconnected') {
    host.diagnostics.add('Supervisor is disconnected.');
  }
  if (host.lastFailure) {
    host.diagnostics.add('Supervisor reported a recent failure.');
  }
  if (
    host.legacyProviders.size > 0 ||
    host.legacyModels.size > 0 ||
    host.legacyTools.size > 0 ||
    host.legacySandboxCapabilities.size > 0
  ) {
    host.diagnostics.add(
      'Legacy provider, model, tool, and sandbox metadata is display-only and cannot satisfy runtime capability requirements.'
    );
  }

  return {
    id: host.id,
    name: host.name,
    supervisorType: host.supervisorType,
    os: host.os,
    posture,
    authState: host.authState,
    supportedAgents: uniqueSorted(Array.from(host.supportedAgents)),
    supportedProviders: uniqueSorted(Array.from(host.supportedProviders)),
    supportedModels: uniqueSorted(Array.from(host.supportedModels)),
    supportedTools: uniqueSorted(Array.from(host.supportedTools)),
    sandboxCapabilities: uniqueSorted(
      Array.from(host.sandboxCapabilities)
    ) as SandboxProviderCapabilityId[],
    providerRuntimeManifests: uniqueManifests(
      host.manifestRegistrations.map((registration) => registration.manifest)
    ),
    legacyRuntimePosture: {
      providers: uniqueSorted(Array.from(host.legacyProviders)),
      models: uniqueSorted(Array.from(host.legacyModels)),
      tools: uniqueSorted(Array.from(host.legacyTools)),
      sandboxCapabilities: uniqueSorted(
        Array.from(host.legacySandboxCapabilities)
      ) as SandboxProviderCapabilityId[],
    },
    workspaceLabels: uniqueSorted(Array.from(host.workspaceLabels)),
    activeSessions: host.activeSessions,
    queueDepth: host.queueDepth,
    maxQueueDepth: host.maxQueueDepth,
    overloaded,
    lastHeartbeat: host.lastHeartbeat,
    lastFailure: host.lastFailure,
    diagnostics: uniqueSorted(Array.from(host.diagnostics)),
    registeredAgentIds: uniqueSorted(host.registeredAgentIds),
    workspaceRoots: uniqueSorted(host.workspaceRoots),
    manifestRegistrations: host.manifestRegistrations,
  };
}

function resolvePosture(host: HostAccumulator, overloaded: boolean, now: Date): AgentHostPosture {
  if (!host.lastHeartbeat) return 'unknown';
  const age = now.getTime() - Date.parse(host.lastHeartbeat);
  if (!Number.isFinite(age)) return 'unknown';
  if (host.statuses.every((status) => status === 'offline') || age > DISCONNECTED_HEARTBEAT_MS) {
    return 'disconnected';
  }
  if (host.authState === 'unauthenticated') return 'risky';
  if (age > STALE_HEARTBEAT_MS) return 'stale';
  if (overloaded || host.statuses.includes('busy') || host.lastFailure) return 'degraded';
  return 'connected';
}

function registrationManifestIsCurrent(agent: RegisteredAgent, now: Date): boolean {
  return registeredAgentIsLive(agent, now.getTime());
}

function summarizeHosts(
  hosts: Pick<AgentHostRecord, 'posture' | 'overloaded'>[]
): AgentHostHealthResponse['summary'] {
  const summary: AgentHostHealthResponse['summary'] = {
    total: hosts.length,
    connected: 0,
    stale: 0,
    degraded: 0,
    disconnected: 0,
    risky: 0,
    unknown: 0,
    overloaded: 0,
  };
  for (const host of hosts) {
    summary[host.posture]++;
    if (host.overloaded) summary.overloaded++;
  }
  return summary;
}

function stripInternalHostFields(host: ResolvedAgentHost): AgentHostRecord {
  const {
    workspaceRoots: _workspaceRoots,
    manifestRegistrations: _manifestRegistrations,
    ...publicHost
  } = host;
  return publicHost;
}

function normalizeRequest(request: AgentHostPreviewRequest): AgentHostPreviewRequest {
  return {
    agent: trimOptional(request.agent),
    provider: trimOptional(request.provider),
    model: trimOptional(request.model),
    workspacePath: trimOptional(request.workspacePath),
    requiredTools: uniqueSorted(request.requiredTools ?? []),
    requiredRuntimeCapabilities: uniqueSorted(request.requiredRuntimeCapabilities ?? []),
    verificationGates: uniqueSorted(request.verificationGates ?? []),
    sandboxPresetId: trimOptional(request.sandboxPresetId),
    manualHostId: trimOptional(request.manualHostId),
    projectDefaultHostId: trimOptional(request.projectDefaultHostId),
    autoRouting: request.autoRouting,
  };
}

function selectedDecision(
  policy: AgentHostRoutingDecision['policy'],
  preview: AgentHostCompatibilityPreview,
  reason: string,
  excludedHostIds: string[]
): AgentHostRoutingDecision {
  return {
    policy,
    selectedHostId: preview.hostId,
    selectedHostName: preview.hostName,
    reason,
    excludedHostIds,
  };
}

function safeMetadata(metadata: RegisteredAgent['metadata']): Record<string, unknown> {
  return metadata && typeof metadata === 'object' ? metadata : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function trimOptional(value: string | undefined): string | undefined {
  return value?.trim() || undefined;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

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

function isSandboxCapability(
  value: ProviderRuntimeCapabilityId
): value is SandboxProviderCapabilityId {
  return SANDBOX_CAPABILITY_IDS.has(value as SandboxProviderCapabilityId);
}

function sandboxCapabilityArray(value: unknown): SandboxProviderCapabilityId[] {
  return stringArray(value).filter((item): item is SandboxProviderCapabilityId =>
    SANDBOX_CAPABILITY_IDS.has(item as SandboxProviderCapabilityId)
  );
}

function inferredSandboxCapabilities(provider: string | undefined): SandboxProviderCapabilityId[] {
  switch (provider) {
    case 'codex-cli':
      return ['filesystem.read', 'filesystem.write', 'environment.allowlist'];
    case 'codex-sdk':
      return ['filesystem.read', 'filesystem.write', 'network.disable', 'environment.allowlist'];
    case 'openclaw':
      return ['filesystem.read', 'filesystem.write', 'environment.allowlist'];
    default:
      return [];
  }
}

function numberValue(value: unknown): number | undefined {
  const parsed =
    typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function authState(metadata: Record<string, unknown>): AgentHostAuthState {
  const state = stringValue(metadata.authState);
  if (
    state === 'authenticated' ||
    state === 'unauthenticated' ||
    state === 'not-required' ||
    state === 'unknown'
  ) {
    return state;
  }
  const authenticated = booleanValue(metadata.authenticated);
  if (authenticated === true) return 'authenticated';
  if (authenticated === false) return 'unauthenticated';
  return 'unknown';
}

function mergeAuthState(current: AgentHostAuthState, next: AgentHostAuthState): AgentHostAuthState {
  if (current === 'unauthenticated' || next === 'unauthenticated') return 'unauthenticated';
  if (current === 'authenticated' || next === 'authenticated') return 'authenticated';
  if (current === 'not-required' || next === 'not-required') return 'not-required';
  return 'unknown';
}

function latestIso(current: string | undefined, next: string | undefined): string | undefined {
  if (!next) return current;
  if (!current) return next;
  return Date.parse(next) > Date.parse(current) ? next : current;
}

function safeWorkspaceLabel(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return 'workspace';
  if (trimmed.includes('/') || trimmed.includes('\\')) {
    return `workspace:${path.basename(trimmed) || 'root'}`;
  }
  return trimmed.slice(0, 80);
}

function pathContains(root: string, workspacePath: string): boolean {
  const resolvedRoot = path.resolve(root);
  const resolvedWorkspace = path.resolve(workspacePath);
  const relative = path.relative(resolvedRoot, resolvedWorkspace);
  return (
    relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative))
  );
}

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))).sort((a, b) =>
    a.localeCompare(b)
  );
}

function uniqueManifests(manifests: ProviderRuntimeManifest[]): ProviderRuntimeManifest[] {
  const byDigest = new Map<string, ProviderRuntimeManifest>();
  for (const manifest of manifests) byDigest.set(manifest.digest, manifest);
  return Array.from(byDigest.values()).sort(
    (left, right) =>
      left.provider.localeCompare(right.provider) || left.digest.localeCompare(right.digest)
  );
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function postureRank(posture: AgentHostPosture): number {
  switch (posture) {
    case 'connected':
      return 0;
    case 'degraded':
      return 1;
    case 'stale':
      return 2;
    case 'risky':
      return 3;
    case 'unknown':
      return 4;
    case 'disconnected':
      return 5;
  }
}
