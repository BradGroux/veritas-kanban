import {
  CONVERSATION_LIFECYCLE_SCHEMA_VERSION,
  RUN_LAUNCH_MANIFEST_SCHEMA_VERSION,
} from '@veritas-kanban/shared';
import type {
  AgentBudgetPolicy,
  AgentConfig,
  AgentProfileResolvedLaunch,
  AgentType,
  ConversationLaunchRequest,
  ConversationLifecycleRecord,
  ExecutableAgentProvider,
  HarnessSupportStatus,
  PhaseName,
  ProviderRuntimeCapabilityId,
  ProviderRuntimeManifest,
  RunLaunchManifest,
  RunLaunchManifestOrigin,
  RunLaunchPhaseAuthority,
  RunLaunchRuntime,
  RunToolCatalog,
  SandboxPolicyDryRunResult,
  Task,
  TaskEnvelope,
  TaskReadinessSummary,
  WorkspaceExecutionTrustEvaluation,
} from '@veritas-kanban/shared';
import { buildSafeCodexEnv } from '../utils/codex-env.js';
import { buildSafeHermesEnv } from '../utils/hermes-env.js';
import type { WorkspaceFileRepository } from '../storage/interfaces.js';
import {
  buildOpenClawTaskSpawnArguments,
  isOpenClawGatewayPrivateIpAllowed,
} from './openclaw-workflow-adapter.js';
import {
  buildClaudeCodeArgs,
  buildSafeClaudeCodeEnv,
  CLAUDE_CODE_CREDENTIAL_ENV_KEYS,
} from './claude-code-adapter.js';
import { buildCodexAppServerArgs, buildSafeCodexAppServerEnv } from './codex-app-server-adapter.js';
import { buildSafeAcpEnv } from './acp-stdio-adapter.js';
import {
  RUN_EGRESS_PROXY_ENVIRONMENT_KEYS,
  runEgressPolicyRequiresGateway,
} from './run-egress-gateway-service.js';
import {
  harnessToolCatalogDelivery,
  normalizeHarnessSupportProfile,
} from './harness-support-profile-registry.js';
import { RunLaunchManifestService } from './run-launch-manifest-service.js';
import {
  PhaseLaunchAuthorityService,
  type PhaseLaunchParentSnapshot,
} from './phase-launch-authority-service.js';
import { RUN_TOOL_BRIDGE_ENV_KEY, type RunToolBridgeService } from './run-tool-bridge-service.js';
import type { ToolControlPlaneService } from './tool-control-plane-service.js';
import type { FilesystemSandboxLaunchPlan } from './filesystem-sandbox-service.js';
import type { ProviderTaskEnvelopeTransport } from './provider-task-envelope-renderer.js';

export interface RunLaunchCompilationOptions {
  sandboxPresetId?: string;
  requiredRuntimeCapabilities?: ProviderRuntimeCapabilityId[];
  phase?: PhaseName;
  conversation?: ConversationLaunchRequest;
}

interface RunLaunchCompilerDependencies {
  runLaunchManifests: RunLaunchManifestService;
  workspaceFiles: WorkspaceFileRepository;
  toolControlPlane: ToolControlPlaneService;
  runToolBridge: RunToolBridgeService;
  phaseAuthority: PhaseLaunchAuthorityService;
  expandPath(value: string): string;
  getCodexFinalPath(logPath: string, attemptId: string): string;
  buildCodexArgs(
    agentConfig: AgentConfig | undefined,
    prompt: string,
    logPath: string,
    attemptId: string,
    sandboxPolicy?: SandboxPolicyDryRunResult,
    conversation?: ConversationLifecycleRecord,
    runToolBridgeOverride?: string
  ): string[];
  buildAcpProviderArgs(agentConfig: AgentConfig, supportProfileId?: string): string[];
}

export class RunLaunchCompiler {
  private readonly runLaunchManifests: RunLaunchManifestService;
  private readonly workspaceFiles: WorkspaceFileRepository;
  private readonly toolControlPlane: ToolControlPlaneService;
  private readonly runToolBridge: RunToolBridgeService;
  private readonly phaseAuthority: PhaseLaunchAuthorityService;

  constructor(private readonly dependencies: RunLaunchCompilerDependencies) {
    this.runLaunchManifests = dependencies.runLaunchManifests;
    this.workspaceFiles = dependencies.workspaceFiles;
    this.toolControlPlane = dependencies.toolControlPlane;
    this.runToolBridge = dependencies.runToolBridge;
    this.phaseAuthority = dependencies.phaseAuthority;
  }

  compilePhaseAuthority(input: {
    requestedPhase?: PhaseName;
    parentPhase?: PhaseLaunchParentSnapshot;
    profileLaunch?: AgentProfileResolvedLaunch;
    sandboxPolicy: SandboxPolicyDryRunResult;
    providerRuntimeManifest: ProviderRuntimeManifest;
    filesystemSandboxPlan: FilesystemSandboxLaunchPlan;
    provider: ExecutableAgentProvider;
    toolCatalogSelected: boolean;
  }): RunLaunchPhaseAuthority {
    const actionMediation = input.provider === 'acp-stdio';
    return this.phaseAuthority.compile({
      requestedPhase: input.requestedPhase,
      parent: input.parentPhase,
      ...(input.profileLaunch
        ? {
            agentProfile: {
              id: input.profileLaunch.profile.id,
              version: input.profileLaunch.profile.version,
            },
          }
        : {}),
      sandboxPolicy: input.sandboxPolicy,
      providerRuntimeManifest: input.providerRuntimeManifest,
      filesystemSandbox: input.filesystemSandboxPlan.evidence,
      selectedHost: input.provider === 'openclaw' ? 'openclaw-gateway' : 'local-process',
      ...(input.toolCatalogSelected ? { toolCatalogId: 'run' } : {}),
      executionEnforcement: {
        commandExecute: actionMediation ? 'enforced' : 'unsupported',
        externalAction: actionMediation ? 'enforced' : 'unsupported',
        planArtifactWrite: 'enforced',
      },
    });
  }

  async compile(input: {
    task: Task;
    taskEnvelope: TaskEnvelope;
    taskTransport: ProviderTaskEnvelopeTransport;
    attemptId: string;
    startedAt: string;
    logPath: string;
    requestedAgent: AgentType;
    routingReason: string;
    routingFallback?: AgentType;
    routingFallbackOnFailure: boolean;
    routingMaxRetries: number;
    agent: AgentType;
    launchAgentConfig?: AgentConfig;
    provider: ExecutableAgentProvider;
    providerRuntimeManifest: ProviderRuntimeManifest;
    requiredRuntimeCapabilities: ProviderRuntimeCapabilityId[];
    harnessSupport: HarnessSupportStatus;
    profileLaunch?: AgentProfileResolvedLaunch;
    readiness: TaskReadinessSummary;
    overrideReason?: string;
    sandboxPolicy: SandboxPolicyDryRunResult;
    budgetPolicy?: AgentBudgetPolicy;
    budgetModelOverride?: string;
    budgetSources: {
      workspaceBudget?: AgentBudgetPolicy;
      agentBudget?: AgentBudgetPolicy;
      profileBudget?: AgentBudgetPolicy;
      runBudget?: AgentBudgetPolicy;
    };
    options: RunLaunchCompilationOptions;
    runToolCatalog?: RunToolCatalog;
    filesystemSandboxPlan: FilesystemSandboxLaunchPlan;
    workspaceTrustEvaluation: WorkspaceExecutionTrustEvaluation;
    parentPhase?: PhaseLaunchParentSnapshot;
    phaseAuthority?: RunLaunchPhaseAuthority;
  }): Promise<RunLaunchManifest> {
    const profile = input.profileLaunch?.profile;
    const toolCatalogDelivery = input.launchAgentConfig
      ? harnessToolCatalogDelivery(normalizeHarnessSupportProfile(input.launchAgentConfig).id)
      : 'native';
    const hasToolRestrictions =
      (profile?.tools?.allowed?.length ?? 0) > 0 ||
      (profile?.policy?.toolPolicyIds?.length ?? 0) > 0;
    const hasMcpRestrictions = (profile?.tools?.mcpServers?.length ?? 0) > 0;
    const hasPermissionRequirements =
      Boolean(profile?.permissions?.level) || (profile?.permissions?.required?.length ?? 0) > 0;
    const requiredHealthChecks = (profile?.health?.checks ?? [])
      .filter((check) => check.required)
      .map((check) => check.id);
    const selectedSkills = (profile?.tools?.allowed ?? []).filter((tool) =>
      /^skill(?::|\/)/i.test(tool)
    );
    const selectedSharedResources = [
      ...(profile?.instructions?.promptFile
        ? [`instruction-file:${profile.instructions.promptFile}`]
        : []),
      ...(profile?.instructions?.files ?? []).map((file) => `instruction-file:${file}`),
      ...(profile?.workflow?.id ? [`workflow:${profile.workflow.id}`] : []),
      ...(profile?.workflow?.entrypoint
        ? [`workflow-entrypoint:${profile.workflow.entrypoint}`]
        : []),
    ];
    const selectedHost = input.provider === 'openclaw' ? 'openclaw-gateway' : 'local-process';
    const phase =
      input.phaseAuthority ??
      this.compilePhaseAuthority({
        requestedPhase: input.options.phase,
        parentPhase: input.parentPhase,
        profileLaunch: input.profileLaunch,
        sandboxPolicy: input.sandboxPolicy,
        providerRuntimeManifest: input.providerRuntimeManifest,
        filesystemSandboxPlan: input.filesystemSandboxPlan,
        provider: input.provider,
        toolCatalogSelected: Boolean(input.runToolCatalog),
      });
    const runtime = this.buildRunLaunchRuntime(
      input.provider,
      input.launchAgentConfig,
      input.task.id,
      input.logPath,
      input.attemptId,
      input.sandboxPolicy,
      input.budgetPolicy,
      input.options.conversation
    );
    runtime.environmentKeys = [
      ...new Set([
        ...runtime.environmentKeys,
        ...Object.keys(input.filesystemSandboxPlan.environment),
      ]),
    ].sort();
    if (input.runToolCatalog) {
      runtime.environmentKeys = [
        ...new Set([
          ...runtime.environmentKeys,
          ...(toolCatalogDelivery === 'native'
            ? await this.toolControlPlane.environmentKeys(input.runToolCatalog)
            : []),
          ...((toolCatalogDelivery === 'veritas-bridge' ||
            this.runToolBridge.requiresBridge(input.runToolCatalog)) &&
          this.runToolBridge.support(input.provider).injection === 'codex-config'
            ? [RUN_TOOL_BRIDGE_ENV_KEY]
            : []),
        ]),
      ].sort();
      if (input.provider === 'claude-code') {
        const promptIndex = runtime.args.lastIndexOf('<prompt>');
        const marker = `<run-tool-catalog:${input.runToolCatalog.digest}>`;
        runtime.args.splice(
          promptIndex < 0 ? runtime.args.length : promptIndex,
          0,
          '--strict-mcp-config',
          '--mcp-config',
          marker
        );
      }
    }
    const worktreePath = input.task.git?.worktreePath
      ? this.dependencies.expandPath(input.task.git.worktreePath)
      : undefined;
    const repositoryInstructions =
      worktreePath && input.workspaceTrustEvaluation.status !== 'untrusted'
        ? ((await this.workspaceFiles.readOptionalText(worktreePath, 'AGENTS.md')) ?? '')
        : '';
    const hasRepositoryInstructions = Boolean(repositoryInstructions.trim());
    const instructions = [
      {
        id: 'effective-task-request',
        kind: 'task' as const,
        content: input.taskTransport.content,
        materialContent: this.normalizeRunLaunchTaskPrompt(
          input.taskTransport.content,
          input.attemptId,
          worktreePath,
          input.taskEnvelope.digest,
          input.providerRuntimeManifest.digest
        ),
        origin:
          `task-envelope:${input.taskEnvelope.schemaVersion};` +
          `adapter:${input.taskTransport.provider}`,
        precedence: 100,
      },
      ...(hasRepositoryInstructions
        ? [
            {
              id: 'repository:AGENTS.md',
              kind: 'repository' as const,
              content: repositoryInstructions,
              origin: 'repository:AGENTS.md',
              precedence: 150,
            },
          ]
        : []),
      ...(input.profileLaunch?.instructions
        ? [
            {
              id: `agent-profile:${profile?.id ?? 'unknown'}`,
              kind: 'profile' as const,
              content: input.profileLaunch.instructions,
              origin: `agent-profile:${profile?.id ?? 'unknown'}@${profile?.version ?? 'unknown'}`,
              precedence: 200,
            },
          ]
        : []),
    ];
    const sandboxOrigin: Omit<RunLaunchManifestOrigin, 'field'> = {
      scope: input.options.sandboxPresetId
        ? 'run'
        : profile?.policy?.sandboxPresetId
          ? 'agent-profile'
          : input.launchAgentConfig?.sandboxPresetId
            ? 'provider'
            : 'system-default',
      source: input.options.sandboxPresetId
        ? `operator-sandbox:${input.sandboxPolicy.preset.id}`
        : profile?.policy?.sandboxPresetId
          ? `agent-profile:${profile.id}@${profile.version}`
          : input.launchAgentConfig?.sandboxPresetId
            ? `agent-config:${input.agent}`
            : `sandbox-default:${input.sandboxPolicy.preset.id}`,
      precedence: input.options.sandboxPresetId
        ? 300
        : profile?.policy?.sandboxPresetId
          ? 200
          : input.launchAgentConfig?.sandboxPresetId
            ? 100
            : 0,
    };
    const sandboxAffectsRuntimeArgs =
      input.provider === 'codex-cli' ||
      input.provider === 'codex-sdk' ||
      input.provider === 'codex-app-server';
    const sandboxAffectsEnvironment =
      input.provider !== 'openclaw' && input.sandboxPolicy.effective.envPassthrough.length > 0;
    const sandboxAffectsCredentials =
      input.provider !== 'openclaw' && input.sandboxPolicy.effective.credentialRefs.length > 0;
    const origins = [
      {
        field: 'taskEnvelope',
        scope: 'task-envelope' as const,
        source: `task-envelope:${input.taskEnvelope.schemaVersion}`,
        precedence: 100,
      },
      {
        field: 'providerRuntime',
        scope: 'provider' as const,
        source: `provider-runtime:${input.providerRuntimeManifest.provider}:${input.providerRuntimeManifest.probeRevision}`,
        precedence: 100,
      },
      {
        field: 'providerRequirements',
        scope: 'provider',
        source: `provider-capabilities:${input.providerRuntimeManifest.provider}:${input.providerRuntimeManifest.probeRevision}`,
        precedence: 100,
      },
      {
        field: 'providerRequirements',
        scope: 'system-default',
        source: 'baseline-launch-capabilities',
        precedence: 0,
      },
      ...((profile?.tools?.allowed?.length ?? 0) > 0 ||
      (profile?.tools?.mcpServers?.length ?? 0) > 0
        ? [
            {
              field: 'providerRequirements',
              scope: 'agent-profile' as const,
              source: `agent-profile:${profile?.id}@${profile?.version}`,
              precedence: 200,
            },
          ]
        : []),
      ...(this.budgetRequiresRuntimeEvidence(input.budgetSources.workspaceBudget)
        ? [
            {
              field: 'providerRequirements',
              scope: 'workspace' as const,
              source: 'workspace-budget',
              precedence: 50,
            },
          ]
        : []),
      ...(this.budgetRequiresRuntimeEvidence(input.budgetSources.agentBudget)
        ? [
            {
              field: 'providerRequirements',
              scope: 'provider' as const,
              source: `agent-config:${input.agent}:budget`,
              precedence: 100,
            },
          ]
        : []),
      ...(this.budgetRequiresRuntimeEvidence(input.budgetSources.profileBudget)
        ? [
            {
              field: 'providerRequirements',
              scope: 'agent-profile' as const,
              source: `agent-profile:${profile?.id}@${profile?.version}:budget`,
              precedence: 200,
            },
          ]
        : []),
      ...(this.budgetRequiresRuntimeEvidence(input.budgetSources.runBudget)
        ? [
            {
              field: 'providerRequirements',
              scope: 'run' as const,
              source: 'operator-run-budget',
              precedence: 300,
            },
          ]
        : []),
      ...(input.options.requiredRuntimeCapabilities?.length
        ? [
            {
              field: 'providerRequirements',
              scope: 'run' as const,
              source: 'operator-required-capabilities',
              precedence: 300,
            },
          ]
        : []),
      {
        field: 'harnessSupport',
        scope: 'provider',
        source: `harness-support:${input.harnessSupport.profileId}`,
        precedence: 100,
      },
      {
        field: 'phase.evidence',
        scope: input.options.phase
          ? ('run' as const)
          : input.parentPhase
            ? ('parent' as const)
            : ('system-default' as const),
        source: input.options.phase
          ? `phase-profile:builtin-${input.options.phase}:1`
          : input.parentPhase
            ? `parent-attempt:${input.parentPhase.attemptId}:${input.parentPhase.evidence?.digest ?? 'legacy'}`
            : 'phase-profile:legacy',
        precedence: input.options.phase ? 300 : input.parentPhase ? 400 : 0,
      },
      ...phase.sourceReferences.map((reference) => ({
        field: `phase.sources.${reference.kind}`,
        scope: reference.originScope,
        source: `phase-source:${reference.kind}:${reference.sourceDigest}`,
        precedence:
          reference.originScope === 'parent'
            ? 400
            : reference.originScope === 'run'
              ? 300
              : reference.originScope === 'agent-profile'
                ? 200
                : reference.originScope === 'provider'
                  ? 100
                  : 0,
      })),
      {
        field: 'instructions.effective-task-request',
        scope: 'task-envelope',
        source: `task-envelope:${input.taskEnvelope.schemaVersion}`,
        precedence: 100,
      },
      {
        field: 'instructions.effective-task-request',
        scope: 'provider',
        source: `adapter:${input.taskTransport.provider}:task-envelope-transport`,
        precedence: 110,
      },
      ...(hasRepositoryInstructions
        ? [
            {
              field: 'instructions.repository:AGENTS.md',
              scope: 'workspace' as const,
              source: 'repository:AGENTS.md',
              precedence: 150,
            },
          ]
        : []),
      ...(input.profileLaunch?.instructions
        ? [
            {
              field: `instructions.agent-profile:${profile?.id ?? 'unknown'}`,
              scope: 'agent-profile' as const,
              source: `agent-profile:${profile?.id}@${profile?.version}`,
              precedence: 200,
            },
          ]
        : []),
      {
        field: 'readiness',
        scope: 'system-default',
        source: 'task-readiness-policy',
        precedence: 0,
      },
      ...(!input.readiness.ready && input.overrideReason
        ? [
            {
              field: 'readiness',
              scope: 'run' as const,
              source: 'operator-readiness-override',
              precedence: 300,
            },
          ]
        : []),
      {
        field: 'routing',
        scope: input.profileLaunch
          ? ('agent-profile' as const)
          : input.requestedAgent === 'auto'
            ? ('workspace' as const)
            : ('run' as const),
        source: input.profileLaunch
          ? `agent-profile:${profile?.id}@${profile?.version}`
          : input.requestedAgent === 'auto'
            ? 'agent-routing:auto'
            : `operator-selection:${input.requestedAgent}`,
        precedence: input.profileLaunch ? 200 : input.requestedAgent === 'auto' ? 100 : 300,
      },
      {
        field: 'runtime.command',
        scope: 'provider' as const,
        source: `adapter:${input.provider}`,
        precedence: 100,
      },
      ...(input.launchAgentConfig?.command
        ? [
            {
              field: 'runtime.command',
              scope: 'provider' as const,
              source: `agent-config:${input.agent}`,
              precedence: 110,
            },
          ]
        : []),
      {
        field: 'runtime.args',
        scope: 'provider',
        source: `adapter:${input.provider}`,
        precedence: 100,
      },
      ...(input.launchAgentConfig?.args?.length
        ? [
            {
              field: 'runtime.args',
              scope: 'provider' as const,
              source: `agent-config:${input.agent}:args`,
              precedence: 110,
            },
          ]
        : []),
      ...(sandboxAffectsRuntimeArgs
        ? [
            {
              field: 'runtime.args',
              ...sandboxOrigin,
            },
          ]
        : []),
      ...(input.provider === 'openclaw' && input.launchAgentConfig
        ? [
            {
              field: 'runtime.args',
              scope: 'provider' as const,
              source: `agent-config:${input.agent}`,
              precedence: 110,
            },
          ]
        : []),
      {
        field: 'runtime.workingDirectory',
        scope: 'provider',
        source: `adapter:${input.provider}`,
        precedence: 100,
      },
      {
        field: 'runtime.worktree',
        scope: 'provider',
        source: `adapter:${input.provider}`,
        precedence: 100,
      },
      {
        field: 'runtime.environmentKeys',
        scope: 'provider',
        source: `adapter-env:${input.provider}`,
        precedence: 100,
      },
      {
        field: 'runtime.environmentKeys',
        scope: 'system-default',
        source: 'host-environment:configured-key-presence',
        precedence: 0,
      },
      ...(Object.keys(input.filesystemSandboxPlan.environment).length > 0
        ? [
            {
              field: 'runtime.environmentKeys',
              scope: 'system-default' as const,
              source: 'filesystem-sandbox:run-environment',
              precedence: 150,
            },
          ]
        : []),
      ...(sandboxAffectsEnvironment
        ? [
            {
              field: 'runtime.environmentKeys',
              ...sandboxOrigin,
            },
          ]
        : []),
      {
        field: 'runtime.credentialReferences',
        scope: 'provider',
        source: `adapter-credentials:${input.provider}`,
        precedence: 100,
      },
      ...(sandboxAffectsCredentials
        ? [
            {
              field: 'runtime.credentialReferences',
              ...sandboxOrigin,
            },
          ]
        : []),
      ...(input.profileLaunch?.agentConfig?.model
        ? [
            {
              field: 'runtime.model',
              scope: 'provider' as const,
              source: `agent-config:${input.agent}`,
              precedence: 100,
            },
          ]
        : !input.profileLaunch && input.launchAgentConfig?.model
          ? [
              {
                field: 'runtime.model',
                scope: 'provider' as const,
                source: `agent-config:${input.agent}`,
                precedence: 100,
              },
            ]
          : []),
      ...(input.profileLaunch?.model
        ? [
            {
              field: 'runtime.model',
              scope: 'agent-profile' as const,
              source: `agent-profile:${profile?.id}@${profile?.version}`,
              precedence: 200,
            },
            ...(input.provider === 'openclaw'
              ? [
                  {
                    field: 'runtime.args',
                    scope: 'agent-profile' as const,
                    source: `agent-profile:${profile?.id}@${profile?.version}:model`,
                    precedence: 200,
                  },
                ]
              : []),
          ]
        : []),
      ...(input.budgetModelOverride
        ? [
            {
              field: 'runtime.model',
              scope: 'run' as const,
              source: 'budget-policy:model-downgrade',
              precedence: 300,
            },
            ...(input.provider === 'openclaw'
              ? [
                  {
                    field: 'runtime.args',
                    scope: 'run' as const,
                    source: 'budget-policy:model-downgrade',
                    precedence: 300,
                  },
                ]
              : []),
          ]
        : []),
      {
        field: 'sandbox',
        ...sandboxOrigin,
      },
      ...(input.budgetSources.workspaceBudget
        ? [
            {
              field: 'budget',
              scope: 'workspace' as const,
              source: 'workspace-budget',
              precedence: 50,
            },
          ]
        : []),
      ...(input.budgetSources.agentBudget
        ? [
            {
              field: 'budget',
              scope: 'provider' as const,
              source: `agent-config:${input.agent}`,
              precedence: 100,
            },
          ]
        : []),
      ...(input.budgetSources.profileBudget && profile
        ? [
            {
              field: 'budget',
              scope: 'agent-profile' as const,
              source: `agent-profile:${profile.id}@${profile.version}`,
              precedence: 200,
            },
          ]
        : []),
      ...(input.budgetSources.runBudget
        ? [
            {
              field: 'budget',
              scope: 'run' as const,
              source: 'operator-run-budget',
              precedence: 300,
            },
          ]
        : []),
      ...(!input.budgetSources.workspaceBudget &&
      !input.budgetSources.agentBudget &&
      !input.budgetSources.profileBudget &&
      !input.budgetSources.runBudget
        ? [
            {
              field: 'budget',
              scope: 'system-default' as const,
              source: 'budget:disabled',
              precedence: 0,
            },
          ]
        : []),
      ...(profile
        ? [
            {
              field: 'profile',
              scope: 'agent-profile' as const,
              source: `agent-profile:${profile.id}@${profile.version}`,
              precedence: 200,
            },
            {
              field: 'tools',
              scope: 'agent-profile' as const,
              source: `agent-profile:${profile.id}@${profile.version}`,
              precedence: 200,
            },
            {
              field: 'permissions',
              scope: 'agent-profile' as const,
              source: `agent-profile:${profile.id}@${profile.version}`,
              precedence: 200,
            },
          ]
        : [
            {
              field: 'tools',
              scope: 'system-default',
              source: 'tool-catalog:none',
              precedence: 0,
            },
            {
              field: 'permissions',
              scope: 'system-default',
              source: 'permission-requirements:none',
              precedence: 0,
            },
          ]),
      {
        field: 'resources',
        scope: profile ? 'agent-profile' : 'system-default',
        source: profile
          ? `agent-profile:${profile.id}@${profile.version}`
          : 'resource-selection:none',
        precedence: profile ? 200 : 0,
      },
      ...(profile?.workflow
        ? [
            {
              field: 'resources',
              scope: 'workflow' as const,
              source: `workflow:${profile.workflow.id ?? profile.workflow.entrypoint ?? 'unknown'}`,
              precedence: 250,
            },
          ]
        : []),
      {
        field: 'workspace',
        scope: 'task-envelope',
        source: 'task-envelope:worktree-allocation',
        precedence: 100,
      },
      {
        field: 'requiredHealthChecks',
        scope: profile ? 'agent-profile' : 'system-default',
        source: profile ? `agent-profile:${profile.id}@${profile.version}` : 'health-checks:none',
        precedence: profile ? 200 : 0,
      },
      {
        field: 'workspaceTrust',
        scope: input.workspaceTrustEvaluation.decision ? 'workspace' : 'system-default',
        source: input.workspaceTrustEvaluation.decision
          ? `workspace-trust-decision:${input.workspaceTrustEvaluation.decision.id}`
          : `workspace-trust-scan:${input.workspaceTrustEvaluation.inventory.digest}`,
        precedence: input.workspaceTrustEvaluation.decision ? 200 : 0,
      },
      {
        field: 'enforcement',
        scope: 'system-default',
        source: `run-launch-compiler:${RUN_LAUNCH_MANIFEST_SCHEMA_VERSION}`,
        precedence: 1_000,
      },
    ].map((origin): RunLaunchManifestOrigin => ({
      ...origin,
      scope: origin.scope as RunLaunchManifestOrigin['scope'],
    }));

    return this.runLaunchManifests.compile({
      taskId: input.task.id,
      attemptId: input.attemptId,
      createdAt: input.startedAt,
      taskEnvelope: input.taskEnvelope,
      providerRuntimeManifest: input.providerRuntimeManifest,
      requiredRuntimeCapabilities: input.requiredRuntimeCapabilities,
      harnessSupport: input.harnessSupport,
      routing: {
        requestedAgent: input.requestedAgent,
        selectedAgent: input.agent,
        selectedHost,
        reason: input.routingReason,
        fallbackAgent: input.routingFallback ?? null,
        fallbackAllowed: Boolean(input.routingFallback && input.routingFallbackOnFailure),
        fallbackOnFailure: input.routingFallbackOnFailure,
        maxRetries: input.routingMaxRetries,
      },
      ...(profile
        ? {
            profile: {
              id: profile.id,
              version: profile.version,
              role: profile.role,
            },
          }
        : {}),
      phase,
      readiness: {
        summary: input.readiness,
        overrideReason: input.overrideReason,
      },
      instructions,
      runtime,
      tools: {
        allowed: profile?.tools?.allowed ?? [],
        denied: input.runToolCatalog
          ? input.runToolCatalog.entries.flatMap((entry) =>
              entry.tools
                .filter((tool) => tool.decision === 'deny')
                .map((tool) => tool.qualifiedName)
            )
          : [],
        policyIds: profile?.policy?.toolPolicyIds ?? [],
        mcpServers: profile?.tools?.mcpServers ?? [],
        ...(input.runToolCatalog ? { catalogDigest: input.runToolCatalog.digest } : {}),
        enforcement: hasToolRestrictions
          ? 'unavailable'
          : input.runToolCatalog
            ? 'enforced'
            : hasMcpRestrictions
              ? 'unavailable'
              : 'not-required',
      },
      permissions: {
        level: profile?.permissions?.level ?? 'specialist',
        required: profile?.permissions?.required ?? [],
        enforcement: hasPermissionRequirements ? 'unavailable' : 'not-required',
      },
      resources: {
        skills: selectedSkills,
        shared: selectedSharedResources,
        enforcement:
          selectedSkills.length > 0 || selectedSharedResources.length > 0
            ? 'unavailable'
            : 'not-required',
      },
      requiredHealthChecks,
      sandboxPolicy: input.sandboxPolicy,
      filesystemSandbox: input.filesystemSandboxPlan.evidence,
      runToolCatalog: input.runToolCatalog,
      budgetPolicy: input.budgetPolicy ?? {
        enabled: false,
        scope: 'run',
      },
      workspaceTrust: input.workspaceTrustEvaluation,
      origins,
    });
  }

  buildRunLaunchRuntime(
    provider: ExecutableAgentProvider,
    agentConfig: AgentConfig | undefined,
    taskId: string,
    logPath: string,
    attemptId: string,
    sandboxPolicy: SandboxPolicyDryRunResult,
    budgetPolicy?: AgentBudgetPolicy,
    conversationRequest?: ConversationLaunchRequest
  ): RunLaunchRuntime {
    const environment = this.buildRunLaunchEnvironment(provider, sandboxPolicy, agentConfig);
    const runtimeBase = {
      ...(agentConfig?.model ? { model: agentConfig.model } : {}),
      workingDirectory: 'task-worktree' as const,
      worktree: 'required' as const,
      ...environment,
    };
    if (provider === 'codex-cli') {
      const finalPath = this.dependencies.getCodexFinalPath(logPath, attemptId);
      return {
        ...runtimeBase,
        command: agentConfig?.command || 'codex',
        args: this.dependencies
          .buildCodexArgs(
            agentConfig,
            '<prompt>',
            logPath,
            attemptId,
            sandboxPolicy,
            manifestConversation(conversationRequest)
          )
          .map((argument) => (argument === finalPath ? '<run-log>/final-message.md' : argument)),
      };
    }
    if (provider === 'codex-sdk') {
      const sdkExecutable = this.resolveCodexSdkExecutable(agentConfig);
      const threadSettings = this.buildCodexSdkThreadSettings(sandboxPolicy);
      return {
        ...runtimeBase,
        command: sdkExecutable.manifestCommand,
        args: [
          conversationRequest?.mode === 'resume' ? 'resumeThread' : 'startThread',
          ...(conversationRequest?.mode === 'resume' ? ['<source-conversation>'] : []),
          `skipGitRepoCheck=${threadSettings.skipGitRepoCheck}`,
          `sandboxMode=${threadSettings.sandboxMode}`,
          `approvalPolicy=${threadSettings.approvalPolicy}`,
          `networkAccessEnabled=${threadSettings.networkAccessEnabled}`,
          'runStreamed',
          '<prompt>',
        ],
      };
    }
    if (provider === 'codex-app-server') {
      return {
        ...runtimeBase,
        command: agentConfig?.command || 'codex',
        args: buildCodexAppServerArgs(agentConfig?.args),
      };
    }
    if (provider === 'claude-code') {
      return {
        ...runtimeBase,
        command: agentConfig?.command || 'claude',
        args: buildClaudeCodeArgs({
          prompt: '<prompt>',
          model: agentConfig?.model,
          extraArgs: agentConfig?.args,
          ...(conversationRequest?.mode === 'resume'
            ? { resumeSessionId: '<source-conversation>' }
            : conversationRequest?.mode === 'fork'
              ? { resumeSessionId: '<source-conversation>', forkSession: true }
              : {}),
          sandboxMode: sandboxPolicy.effective.sandboxMode,
          networkAccessEnabled: sandboxPolicy.effective.networkAccessEnabled,
          maxBudgetUsd: budgetPolicy?.enabled ? budgetPolicy.limits?.costUsd : undefined,
        }),
      };
    }
    if (provider === 'acp-stdio') {
      const supportProfile = agentConfig ? normalizeHarnessSupportProfile(agentConfig) : undefined;
      return {
        ...runtimeBase,
        command: agentConfig?.command || '',
        args: agentConfig
          ? this.dependencies.buildAcpProviderArgs(agentConfig, supportProfile?.id)
          : [],
      };
    }
    if (provider === 'hermes-cli') {
      return {
        ...runtimeBase,
        command: agentConfig?.command || 'hermes',
        args: ['-z', ...(agentConfig?.args ?? []), '<prompt>'],
      };
    }
    const spawnArguments = buildOpenClawTaskSpawnArguments({
      taskId,
      attemptId,
      agentId: agentConfig?.type || 'openclaw',
      agentName: agentConfig?.name,
      model: agentConfig?.model,
      prompt: '<prompt>',
      timeoutSeconds: 900,
    });
    const sessionKeySource =
      this.firstConfiguredEnvironmentKey(['OPENCLAW_GATEWAY_SESSION_KEY']) ?? 'default:main';
    const gatewayUrlSource =
      this.firstConfiguredEnvironmentKey([
        'OPENCLAW_GATEWAY_URL',
        'CLAWDBOT_GATEWAY',
        'CLAWDBOT_GATEWAY_URL',
      ]) ?? 'default:http://127.0.0.1:18789';
    return {
      ...runtimeBase,
      command: 'openclaw.sessions_spawn',
      args: [
        'tool=sessions_spawn',
        ...Object.entries(spawnArguments).map(([key, value]) => `${key}=${String(value)}`),
        `sessionKey=${sessionKeySource.startsWith('default:') ? sessionKeySource : `env:${sessionKeySource}`}`,
        `gatewayUrl=${gatewayUrlSource.startsWith('default:') ? gatewayUrlSource : `env:${gatewayUrlSource}`}`,
        `allowPrivateIp=${isOpenClawGatewayPrivateIpAllowed()}`,
        'requestTimeoutMs=60000',
      ],
      workingDirectory: 'provider-managed',
      worktree: 'provider-managed',
    };
  }

  resolveCodexSdkExecutable(agentConfig: AgentConfig | undefined): {
    manifestCommand: string;
    codexPathOverride?: string;
  } {
    const codexPathOverride =
      agentConfig?.command && agentConfig.command !== 'codex' ? agentConfig.command : undefined;
    return {
      manifestCommand: codexPathOverride ?? '@openai/codex-sdk:bundled-codex',
      ...(codexPathOverride ? { codexPathOverride } : {}),
    };
  }

  buildCodexSdkThreadSettings(sandboxPolicy: SandboxPolicyDryRunResult | undefined): {
    skipGitRepoCheck: true;
    sandboxMode: 'read-only' | 'workspace-write' | 'danger-full-access';
    approvalPolicy: 'never';
    networkAccessEnabled: boolean;
  } {
    return {
      skipGitRepoCheck: true,
      sandboxMode: sandboxPolicy?.effective.sandboxMode ?? 'workspace-write',
      approvalPolicy: 'never',
      networkAccessEnabled: sandboxPolicy?.effective.networkAccessEnabled ?? true,
    };
  }

  buildRunLaunchEnvironment(
    provider: ExecutableAgentProvider,
    sandboxPolicy: SandboxPolicyDryRunResult,
    agentConfig?: AgentConfig
  ): Pick<RunLaunchRuntime, 'environmentKeys' | 'credentialReferences'> {
    const egressEnvironmentKeys =
      provider !== 'openclaw' &&
      sandboxPolicy.effective.networkPolicy &&
      runEgressPolicyRequiresGateway(sandboxPolicy.effective.networkPolicy)
        ? [...RUN_EGRESS_PROXY_ENVIRONMENT_KEYS]
        : [];
    if (provider === 'codex-cli' || provider === 'codex-sdk' || provider === 'codex-app-server') {
      const environmentKeys = [
        ...Object.keys(
          provider === 'codex-app-server'
            ? buildSafeCodexAppServerEnv(process.env, sandboxPolicy.effective.envPassthrough)
            : buildSafeCodexEnv(process.env, sandboxPolicy.effective.envPassthrough)
        ),
        ...egressEnvironmentKeys,
      ];
      return {
        environmentKeys,
        credentialReferences: [
          ...sandboxPolicy.effective.credentialRefs,
          ...environmentKeys
            .filter((key) => key === 'CODEX_API_KEY' || key === 'OPENAI_API_KEY')
            .map((key) => `env:${key}`),
        ],
      };
    }
    if (provider === 'hermes-cli') {
      const environmentKeys = [
        ...Object.keys(buildSafeHermesEnv(process.env, sandboxPolicy.effective.envPassthrough)),
        ...egressEnvironmentKeys,
      ];
      return {
        environmentKeys,
        credentialReferences: [
          ...sandboxPolicy.effective.credentialRefs,
          ...environmentKeys
            .filter((key) => key === 'ANTHROPIC_API_KEY' || key === 'HERMES_API_KEY')
            .map((key) => `env:${key}`),
        ],
      };
    }
    if (provider === 'claude-code') {
      const environmentKeys = [
        ...Object.keys(buildSafeClaudeCodeEnv(process.env, sandboxPolicy.effective.envPassthrough)),
        ...egressEnvironmentKeys,
      ];
      const credentialKeys = new Set<string>(CLAUDE_CODE_CREDENTIAL_ENV_KEYS);
      return {
        environmentKeys,
        credentialReferences: [
          ...sandboxPolicy.effective.credentialRefs,
          ...environmentKeys.filter((key) => credentialKeys.has(key)).map((key) => `env:${key}`),
        ],
      };
    }
    if (provider === 'acp-stdio') {
      const supportProfile = agentConfig ? normalizeHarnessSupportProfile(agentConfig) : undefined;
      const profileEnvironmentKeys = [
        ...(supportProfile?.launch.environmentAllowlist ?? []),
        ...(supportProfile?.launch.credentialAllowlist ?? []),
      ];
      const environmentKeys = [
        ...Object.keys(
          buildSafeAcpEnv(process.env, [
            ...sandboxPolicy.effective.envPassthrough,
            ...profileEnvironmentKeys,
          ])
        ),
        ...egressEnvironmentKeys,
      ];
      const credentialKeys = new Set(supportProfile?.launch.credentialAllowlist ?? []);
      return {
        environmentKeys,
        credentialReferences: [
          ...sandboxPolicy.effective.credentialRefs,
          ...environmentKeys.filter((key) => credentialKeys.has(key)).map((key) => `env:${key}`),
        ],
      };
    }

    const gatewayUrlKey = this.firstConfiguredEnvironmentKey([
      'OPENCLAW_GATEWAY_URL',
      'CLAWDBOT_GATEWAY',
      'CLAWDBOT_GATEWAY_URL',
    ]);
    const gatewayTokenKey = this.firstConfiguredEnvironmentKey([
      'OPENCLAW_GATEWAY_TOKEN',
      'CLAWDBOT_GATEWAY_TOKEN',
    ]);
    const gatewaySessionKey = this.firstConfiguredEnvironmentKey(['OPENCLAW_GATEWAY_SESSION_KEY']);
    const environmentKeys = [
      gatewayUrlKey,
      gatewayTokenKey,
      gatewaySessionKey,
      this.firstConfiguredEnvironmentKey(['OPENCLAW_GATEWAY_ALLOW_PRIVATE']),
    ].filter((key): key is string => Boolean(key));
    return {
      environmentKeys,
      credentialReferences: gatewayTokenKey ? [`env:${gatewayTokenKey}`] : [],
    };
  }

  private firstConfiguredEnvironmentKey(keys: string[]): string | undefined {
    return keys.find((key) => Boolean(process.env[key]));
  }

  normalizeRunLaunchTaskPrompt(
    prompt: string,
    attemptId: string,
    worktreePath: string | undefined,
    taskEnvelopeDigest: string,
    providerRuntimeDigest: string
  ): string {
    const normalizedIdentifiers = [
      [attemptId, '<attempt-id>'],
      [worktreePath, '<worktree>'],
      [taskEnvelopeDigest, '<task-envelope-digest>'],
      [providerRuntimeDigest, '<provider-runtime-digest>'],
    ].reduce(
      (normalized, [value, replacement]) =>
        value ? normalized.replaceAll(value, replacement ?? '') : normalized,
      prompt
    );
    return normalizedIdentifiers.replace(/\(\d+ minutes ago\)/g, '(<elapsed-minutes> minutes ago)');
  }

  private budgetRequiresRuntimeEvidence(policy: AgentBudgetPolicy | undefined): boolean {
    if (!policy || policy.enabled === false || !policy.limits) return false;
    return (
      policy.limits.inputTokens !== undefined ||
      policy.limits.outputTokens !== undefined ||
      policy.limits.totalTokens !== undefined ||
      policy.limits.costUsd !== undefined ||
      policy.limits.toolCalls !== undefined
    );
  }
}

function manifestConversation(
  request: ConversationLaunchRequest | undefined
): ConversationLifecycleRecord | undefined {
  if (!request || request.mode === 'fresh') return undefined;
  const timestamp = '1970-01-01T00:00:00.000Z';
  return {
    schemaVersion: CONVERSATION_LIFECYCLE_SCHEMA_VERSION,
    mode: request.mode,
    intent: request.intent ?? request.mode,
    ...(request.mode === 'resume' ? { conversationId: '<source-conversation>' } : {}),
    ...(request.mode === 'fork' ? { parentConversationId: '<source-conversation>' } : {}),
    state: 'active',
    contextWindow: { posture: 'unknown', measuredAt: timestamp },
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}
