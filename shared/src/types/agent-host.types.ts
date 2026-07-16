import type { SandboxProviderCapabilityId } from './sandbox-policy.types.js';
import type {
  ProviderRuntimeCapabilityId,
  ProviderRuntimeManifest,
  ProviderRuntimeSelection,
} from './provider-runtime.types.js';

export type AgentHostPosture =
  'connected' | 'stale' | 'degraded' | 'disconnected' | 'risky' | 'unknown';

export type AgentHostAuthState = 'authenticated' | 'unauthenticated' | 'not-required' | 'unknown';

export type AgentHostRoutingPolicy =
  'manual' | 'project-default' | 'first-capable-healthy' | 'disabled';

export interface AgentHostLegacyRuntimePosture {
  providers: string[];
  models: string[];
  tools: string[];
  sandboxCapabilities: SandboxProviderCapabilityId[];
}

export interface AgentHostRecord {
  id: string;
  name: string;
  supervisorType: string;
  os?: string;
  posture: AgentHostPosture;
  authState: AgentHostAuthState;
  supportedAgents: string[];
  supportedProviders: string[];
  supportedModels: string[];
  supportedTools: string[];
  sandboxCapabilities: SandboxProviderCapabilityId[];
  providerRuntimeManifests: ProviderRuntimeManifest[];
  legacyRuntimePosture: AgentHostLegacyRuntimePosture;
  workspaceLabels: string[];
  activeSessions: number;
  queueDepth: number;
  maxQueueDepth: number;
  overloaded: boolean;
  lastHeartbeat?: string;
  lastFailure?: string;
  diagnostics: string[];
  registeredAgentIds: string[];
}

export interface AgentHostHealthResponse {
  generatedAt: string;
  hosts: AgentHostRecord[];
  summary: Record<AgentHostPosture, number> & {
    total: number;
    overloaded: number;
  };
}

export type AgentHostCompatibilityCheckId =
  | 'heartbeat'
  | 'capacity'
  | 'workspace-access'
  | 'provider-available'
  | 'model-supported'
  | 'agent-supported'
  | 'required-tools'
  | 'runtime-capabilities'
  | 'sandbox-policy'
  | 'verification-gates';

export interface AgentHostCompatibilityCheck {
  id: AgentHostCompatibilityCheckId;
  label: string;
  passed: boolean;
  detail: string;
}

export interface AgentHostCompatibilityPreview {
  hostId: string;
  hostName: string;
  posture: AgentHostPosture;
  compatible: boolean;
  checks: AgentHostCompatibilityCheck[];
  runtimeSelection?: ProviderRuntimeSelection;
  reasons: string[];
  warnings: string[];
}

export interface AgentHostPreviewRequest {
  agent?: string;
  provider?: string;
  model?: string;
  workspacePath?: string;
  requiredTools?: string[];
  requiredRuntimeCapabilities?: ProviderRuntimeCapabilityId[];
  verificationGates?: string[];
  sandboxPresetId?: string;
  manualHostId?: string;
  projectDefaultHostId?: string;
  autoRouting?: boolean;
}

export interface AgentHostRoutingDecision {
  policy: AgentHostRoutingPolicy;
  selectedHostId?: string;
  selectedHostName?: string;
  reason: string;
  fallbackBehavior?: string;
  excludedHostIds: string[];
}

export interface AgentHostCompatibilityResponse {
  generatedAt: string;
  request: AgentHostPreviewRequest;
  previews: AgentHostCompatibilityPreview[];
  decision: AgentHostRoutingDecision;
}
