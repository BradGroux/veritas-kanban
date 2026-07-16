/**
 * AgentRoutingService - Task-aware agent/model routing
 *
 * Matches task metadata (type, priority, project, complexity) against
 * user-configured routing rules to select the optimal agent and model.
 *
 * Rules are evaluated in order — first match wins.
 * Falls back to the configured default when no rules match.
 */

import { ConfigService } from './config-service.js';
import {
  DEFAULT_ROUTING_CONFIG,
  type AgentConfig,
  type CreateGovernanceTraceInput,
  type GovernanceTraceRule,
  type GovernanceTraceStep,
  type AgentRoutingConfig,
  type RoutingRule,
  type RoutingResult,
  type RoutingMatchCriteria,
  type ProviderRuntimeCapabilityId,
  type ProviderRuntimeRouteCandidate,
  type ProviderRuntimeSelection,
} from '@veritas-kanban/shared';
import type { Task, AgentType } from '@veritas-kanban/shared';
import { createLogger } from '../lib/logger.js';
import { ConflictError } from '../middleware/error-handler.js';
import {
  AgentHealthService,
  type AgentHealthChecker,
  type AgentHealthStatus,
} from './agent-health-service.js';
import { TeamRosterService } from './team-roster-service.js';
import {
  getAgentRegistryService,
  registeredAgentIsLive,
  type RegisteredAgent,
} from './agent-registry-service.js';
import { selectProviderRuntimeManifest } from './provider-runtime-capability-service.js';

const log = createLogger('agent-routing');

type RoutableTask = Pick<Task, 'type' | 'priority' | 'project' | 'subtasks'>;

interface RoutingTraceContext {
  taskId?: string;
  requiredRuntimeCapabilities?: ProviderRuntimeCapabilityId[];
}

interface RuntimeManifestRegistryReader {
  list(): RegisteredAgent[];
}

interface RuntimeIdentityResolution {
  registrations: RegisteredAgent[];
  rejectionReason?: string;
}

interface AgentAvailability {
  agentConfig?: AgentConfig;
  health?: AgentHealthStatus;
  available: boolean;
  reason: string;
  runtimeSelection?: ProviderRuntimeSelection;
}

export class AgentRoutingService {
  private configService: ConfigService;
  private agentHealth: AgentHealthChecker;
  private teamRoster: TeamRosterService;
  private runtimeRegistry?: RuntimeManifestRegistryReader;

  constructor(
    configService?: ConfigService,
    agentHealth?: AgentHealthChecker,
    runtimeRegistry?: RuntimeManifestRegistryReader
  ) {
    this.configService = configService || new ConfigService();
    this.agentHealth = agentHealth || new AgentHealthService();
    this.teamRoster = new TeamRosterService(this.configService);
    this.runtimeRegistry = runtimeRegistry;
  }

  /**
   * Resolve the best agent for a given task.
   *
   * @param task - Full task object (or partial with type/priority/project/subtasks)
   * @returns RoutingResult with the selected agent, optional model, fallback, and reasoning
   */
  async resolveAgent(task: RoutableTask): Promise<RoutingResult> {
    return (await this.resolveAgentWithTrace(task)).result;
  }

  async resolveAgentWithTrace(
    task: RoutableTask,
    context: RoutingTraceContext = {}
  ): Promise<{ result: RoutingResult; trace: CreateGovernanceTraceInput }> {
    const config = await this.configService.getConfig();
    const routing: AgentRoutingConfig = config.agentRouting || DEFAULT_ROUTING_CONFIG;
    const requiredRuntimeCapabilities = uniqueRuntimeCapabilities(
      context.requiredRuntimeCapabilities ?? []
    );
    const runtimeCandidates: ProviderRuntimeRouteCandidate[] = [];
    const evaluatedRules: GovernanceTraceRule[] = [];
    const steps: GovernanceTraceStep[] = [];
    const rosterPreview = this.teamRoster.resolveRoute(
      {
        type: task.type,
        priority: task.priority,
        project: task.project,
        subtaskCount: task.subtasks?.length,
      },
      config.teamRoster
    );

    if (rosterPreview.matched && rosterPreview.agent) {
      const profile = config.agentProfiles?.find(
        (candidate) => candidate.id === rosterPreview.profileId
      );
      const availability = await this.getAgentAvailability(
        config.agents,
        rosterPreview.agent,
        requiredRuntimeCapabilities,
        profile?.runtime.model
      );
      recordRuntimeCandidate(
        runtimeCandidates,
        rosterPreview.agent,
        profile?.runtime.model,
        availability
      );
      const ruleId = rosterPreview.ruleId ?? rosterPreview.member?.id ?? 'default';
      const traceRule: GovernanceTraceRule = {
        id: `team-roster:${ruleId}`,
        label: rosterPreview.ruleId ? `Team roster rule ${rosterPreview.ruleId}` : 'Team roster',
        type: 'routing',
        status: availability.available ? 'matched' : 'skipped',
        outcome: availability.available ? 'routed' : 'skipped',
        message: availability.available
          ? rosterPreview.reason
          : `Roster selected ${rosterPreview.agent}, but it is unavailable: ${availability.reason}.`,
        details: {
          memberId: rosterPreview.member?.id,
          profileId: rosterPreview.profileId,
          reviewerMemberIds: rosterPreview.reviewerMembers.map((member) => member.id),
        },
      };
      evaluatedRules.push(traceRule);
      steps.push({
        id: `team-roster:${ruleId}`,
        label: 'Team roster',
        status: availability.available ? 'matched' : 'skipped',
        message: traceRule.message,
      });

      if (availability.available) {
        markLastRuntimeCandidateSelected(runtimeCandidates);
        const result: RoutingResult = {
          agent: rosterPreview.agent,
          model: profile?.runtime.model ?? availability.agentConfig?.model,
          rule: traceRule.id,
          reason: withRuntimeReason(rosterPreview.reason, availability.runtimeSelection),
          runtimeSelection: availability.runtimeSelection,
          runtimeCandidates: optionalRuntimeCandidates(runtimeCandidates),
        };
        return {
          result,
          trace: this.buildRoutingTrace(task, context, result, {
            outcome: 'routed',
            evaluatedRules,
            matchedRules: [traceRule],
            steps,
            routing,
          }),
        };
      }
    } else if (rosterPreview.issues.length) {
      steps.push({
        id: 'team-roster-invalid',
        label: 'Team roster',
        status: 'skipped',
        message: `Team roster skipped: ${rosterPreview.issues[0]?.message}`,
      });
    }

    // If routing is disabled, return the global default
    if (!routing.enabled) {
      const defaultAgent = routing.defaultAgent || config.defaultAgent;
      const defaultAvailability = await this.getAgentAvailability(
        config.agents,
        defaultAgent,
        requiredRuntimeCapabilities,
        routing.defaultModel
      );
      recordRuntimeCandidate(
        runtimeCandidates,
        defaultAgent,
        routing.defaultModel,
        defaultAvailability
      );
      if (!defaultAvailability.available) {
        throw new ConflictError('No healthy agent available for routing', {
          agent: defaultAgent,
          reason: defaultAvailability.reason,
          runtimeSelection: defaultAvailability.runtimeSelection,
          runtimeCandidates: optionalRuntimeCandidates(runtimeCandidates),
          routingEnabled: routing.enabled,
        });
      }

      const result: RoutingResult = {
        agent: defaultAgent,
        model: routing.defaultModel,
        reason: withRuntimeReason(
          'Routing disabled, using default agent',
          defaultAvailability.runtimeSelection
        ),
        runtimeSelection: defaultAvailability.runtimeSelection,
        runtimeCandidates: optionalRuntimeCandidates(runtimeCandidates),
      };
      markLastRuntimeCandidateSelected(runtimeCandidates);
      return {
        result,
        trace: this.buildRoutingTrace(task, context, result, {
          outcome: 'skipped',
          evaluatedRules,
          matchedRules: [],
          steps: [
            {
              id: 'routing-disabled',
              label: 'Routing disabled',
              status: 'skipped',
              message: 'Agent routing is disabled in configuration.',
            },
          ],
          routing,
        }),
      };
    }

    // Evaluate rules in order (first match wins)
    for (const rule of routing.rules) {
      if (!rule.enabled) {
        evaluatedRules.push(this.routingRuleTrace(rule, 'skipped', 'Rule is disabled.'));
        continue;
      }

      if (this.matchesRule(task, rule.match)) {
        const availability = await this.getAgentAvailability(
          config.agents,
          rule.agent,
          requiredRuntimeCapabilities,
          rule.model
        );
        recordRuntimeCandidate(runtimeCandidates, rule.agent, rule.model, availability);
        if (!availability.available) {
          const message = `Rule "${rule.name}" matched but agent "${rule.agent}" is unavailable: ${availability.reason}.`;
          log.warn(message);
          const skippedRule = this.routingRuleTrace(rule, 'matched', message, 'skipped');
          evaluatedRules.push(skippedRule);
          steps.push({
            id: `rule:${rule.id}`,
            label: rule.name,
            status: 'skipped',
            message,
          });

          if (routing.fallbackOnFailure && rule.fallback) {
            const fallbackAvailability = await this.getAgentAvailability(
              config.agents,
              rule.fallback,
              requiredRuntimeCapabilities
            );
            recordRuntimeCandidate(
              runtimeCandidates,
              rule.fallback,
              fallbackAvailability.agentConfig?.model,
              fallbackAvailability
            );
            if (fallbackAvailability.available) {
              markLastRuntimeCandidateSelected(runtimeCandidates);
              const reason = `${message} Using fallback agent "${rule.fallback}".`;
              const result: RoutingResult = {
                agent: rule.fallback,
                rule: rule.id,
                reason: withRuntimeReason(reason, fallbackAvailability.runtimeSelection),
                runtimeSelection: fallbackAvailability.runtimeSelection,
                runtimeCandidates: optionalRuntimeCandidates(runtimeCandidates),
              };
              return {
                result,
                trace: this.buildRoutingTrace(task, context, result, {
                  outcome: 'fallback',
                  evaluatedRules,
                  matchedRules: [],
                  steps: [
                    ...steps,
                    {
                      id: `fallback:${rule.id}`,
                      label: `${rule.name} fallback`,
                      status: 'matched',
                      message: `Selected fallback agent ${rule.fallback}.`,
                    },
                  ],
                  routing,
                }),
              };
            }

            const fallbackMessage = `Fallback agent "${rule.fallback}" for rule "${rule.name}" is unavailable: ${fallbackAvailability.reason}.`;
            log.warn(fallbackMessage);
            steps.push({
              id: `fallback:${rule.id}`,
              label: `${rule.name} fallback`,
              status: 'skipped',
              message: fallbackMessage,
            });
          }

          continue;
        }

        log.info(
          `Task [type=${task.type}, priority=${task.priority}] matched rule "${rule.name}" → ${rule.agent}${rule.model ? ` (${rule.model})` : ''}`
        );
        const matchedRule = this.routingRuleTrace(
          rule,
          'matched',
          `Matched rule: ${rule.name}`,
          'routed'
        );
        evaluatedRules.push(matchedRule);
        const result: RoutingResult = {
          agent: rule.agent,
          model: rule.model,
          fallback: rule.fallback,
          rule: rule.id,
          reason: withRuntimeReason(`Matched rule: ${rule.name}`, availability.runtimeSelection),
          runtimeSelection: availability.runtimeSelection,
          runtimeCandidates: optionalRuntimeCandidates(runtimeCandidates),
        };
        markLastRuntimeCandidateSelected(runtimeCandidates);
        return {
          result,
          trace: this.buildRoutingTrace(task, context, result, {
            outcome: 'routed',
            evaluatedRules,
            matchedRules: [matchedRule],
            steps: [
              ...steps,
              {
                id: `rule:${rule.id}`,
                label: rule.name,
                status: 'matched',
                message: `Selected ${rule.agent}.`,
              },
            ],
            routing,
          }),
        };
      }

      evaluatedRules.push(
        this.routingRuleTrace(rule, 'not-matched', 'Rule criteria did not match.')
      );
    }

    // No rule matched — use defaults
    log.info(
      `Task [type=${task.type}, priority=${task.priority}] — no rules matched, using default: ${routing.defaultAgent}`
    );
    const result: RoutingResult = {
      agent: routing.defaultAgent || config.defaultAgent,
      model: routing.defaultModel,
      reason: 'No routing rules matched, using default agent',
    };
    const defaultAvailability = await this.getAgentAvailability(
      config.agents,
      result.agent,
      requiredRuntimeCapabilities,
      result.model
    );
    recordRuntimeCandidate(runtimeCandidates, result.agent, result.model, defaultAvailability);
    if (!defaultAvailability.available) {
      const message = `Default agent "${result.agent}" is unavailable: ${defaultAvailability.reason}.`;
      steps.push({
        id: 'default-agent',
        label: 'Default agent',
        status: 'skipped',
        message,
      });
      throw new ConflictError('No healthy agent available for routing', {
        agent: result.agent,
        reason: defaultAvailability.reason,
        runtimeSelection: defaultAvailability.runtimeSelection,
        runtimeCandidates: optionalRuntimeCandidates(runtimeCandidates),
        routingEnabled: routing.enabled,
      });
    }
    result.reason = withRuntimeReason(result.reason, defaultAvailability.runtimeSelection);
    result.runtimeSelection = defaultAvailability.runtimeSelection;
    markLastRuntimeCandidateSelected(runtimeCandidates);
    result.runtimeCandidates = optionalRuntimeCandidates(runtimeCandidates);

    return {
      result,
      trace: this.buildRoutingTrace(task, context, result, {
        outcome: 'fallback',
        evaluatedRules,
        matchedRules: [],
        steps: [
          ...steps,
          {
            id: 'default-agent',
            label: 'Default agent',
            status: 'info',
            message: `Selected default agent ${result.agent}.`,
          },
        ],
        routing,
      }),
    };
  }

  /**
   * Get the fallback agent for a given primary agent.
   * Used when an agent fails and `fallbackOnFailure` is enabled.
   */
  async getFallback(
    task: Pick<Task, 'type' | 'priority' | 'project' | 'subtasks'>,
    failedAgent: AgentType
  ): Promise<RoutingResult | null> {
    const config = await this.configService.getConfig();
    const routing: AgentRoutingConfig = config.agentRouting || DEFAULT_ROUTING_CONFIG;

    if (!routing.fallbackOnFailure) {
      return null;
    }

    // Find the rule that originally matched (to get its fallback)
    for (const rule of routing.rules) {
      if (!rule.enabled) continue;
      if (rule.agent !== failedAgent) continue;
      if (!rule.fallback) continue;
      if (!this.matchesRule(task, rule.match)) continue;

      const fallbackAvailability = await this.getAgentAvailability(config.agents, rule.fallback);
      if (!fallbackAvailability.available) {
        log.warn(
          `Fallback agent "${rule.fallback}" for rule "${rule.name}" is unavailable: ${fallbackAvailability.reason}`
        );
        continue;
      }

      log.info(`Falling back from ${failedAgent} → ${rule.fallback} (rule: ${rule.name})`);
      return {
        agent: rule.fallback,
        rule: rule.id,
        reason: `Fallback: ${failedAgent} failed → ${rule.fallback} (rule: ${rule.name})`,
      };
    }

    // No specific fallback found — try default if it's different from failed
    const defaultAgent = routing.defaultAgent || config.defaultAgent;
    if (defaultAgent !== failedAgent) {
      const defaultAvailability = await this.getAgentAvailability(config.agents, defaultAgent);
      if (defaultAvailability.available) {
        return {
          agent: defaultAgent,
          model: routing.defaultModel,
          reason: `Fallback: ${failedAgent} failed → default agent (${defaultAgent})`,
        };
      }
    }

    return null;
  }

  /**
   * Get the current routing config (for UI display).
   */
  async getRoutingConfig(): Promise<AgentRoutingConfig> {
    const config = await this.configService.getConfig();
    return config.agentRouting || DEFAULT_ROUTING_CONFIG;
  }

  /**
   * Update routing config.
   */
  async updateRoutingConfig(routing: AgentRoutingConfig): Promise<AgentRoutingConfig> {
    // Validate rule IDs are unique
    const ids = routing.rules.map(
      (r: { id: string; name: string; enabled: boolean; agent: string; match: any }) => r.id
    );
    const uniqueIds = new Set(ids);
    if (ids.length !== uniqueIds.size) {
      throw new Error('Routing rule IDs must be unique');
    }

    // Validate maxRetries range
    if (routing.maxRetries < 0 || routing.maxRetries > 3) {
      throw new Error('maxRetries must be between 0 and 3');
    }

    const config = await this.configService.getConfig();
    await this.configService.saveConfig({ ...config, agentRouting: routing });
    return routing;
  }

  // ─── Private helpers ───────────────────────────────────────────

  private async getAgentAvailability(
    agents: AgentConfig[],
    agent: AgentType,
    requiredRuntimeCapabilities: ProviderRuntimeCapabilityId[] = [],
    model?: string
  ): Promise<AgentAvailability> {
    const agentConfig = agents.find((candidate) => candidate.type === agent);
    if (!agentConfig) {
      return {
        available: false,
        reason: 'Agent is not configured',
      };
    }

    if (!agentConfig.enabled) {
      return {
        agentConfig,
        available: false,
        reason: 'Agent is disabled',
      };
    }

    const runtimeSelection =
      requiredRuntimeCapabilities.length > 0
        ? this.selectAgentRuntimeManifest(agentConfig, requiredRuntimeCapabilities, model)
        : undefined;
    if (runtimeSelection && !runtimeSelection.compatible) {
      return {
        agentConfig,
        available: false,
        reason: runtimeSelection.reason,
        runtimeSelection,
      };
    }

    const health = await this.agentHealth.checkAgent(agentConfig);
    if (!health.healthy) {
      return {
        agentConfig,
        health,
        available: false,
        reason: health.reason || 'Agent health check failed',
        runtimeSelection,
      };
    }

    return {
      agentConfig,
      health,
      available: true,
      reason: withRuntimeReason('Agent is healthy', runtimeSelection),
      runtimeSelection,
    };
  }

  private selectAgentRuntimeManifest(
    agentConfig: AgentConfig,
    requiredCapabilities: ProviderRuntimeCapabilityId[],
    model?: string
  ): ProviderRuntimeSelection {
    const registeredAgents = (this.runtimeRegistry ?? getAgentRegistryService()).list();
    const identity = resolveRegisteredRuntimeIdentity(registeredAgents, agentConfig);
    const selection = selectProviderRuntimeManifest({
      manifests: identity.registrations
        .map((registered) => registered.providerRuntimeManifest)
        .filter((manifest) => manifest !== undefined),
      provider: agentConfig.provider === 'custom' ? undefined : agentConfig.provider,
      model: model ?? agentConfig.model,
      requiredCapabilities,
    });
    return identity.rejectionReason
      ? {
          ...selection,
          compatible: false,
          selectedManifest: undefined,
          reason: identity.rejectionReason,
        }
      : selection;
  }

  /**
   * Check if a task matches a rule's criteria.
   * All specified criteria must match (AND logic).
   * Unspecified criteria are ignored (wildcard).
   */
  private matchesRule(
    task: Pick<Task, 'type' | 'priority' | 'project' | 'subtasks'>,
    match: RoutingMatchCriteria
  ): boolean {
    // Type check
    if (match.type !== undefined) {
      if (!this.matchesValue(task.type, match.type)) return false;
    }

    // Priority check
    if (match.priority !== undefined) {
      if (!this.matchesValue(task.priority, match.priority)) return false;
    }

    // Project check
    if (match.project !== undefined) {
      if (!task.project) return false;
      if (!this.matchesValue(task.project, match.project)) return false;
    }

    // Complexity (subtask count)
    if (match.minSubtasks !== undefined) {
      const subtaskCount = task.subtasks?.length ?? 0;
      if (subtaskCount < match.minSubtasks) return false;
    }

    return true;
  }

  /**
   * Check if a value matches a single value or array of acceptable values.
   */
  private matchesValue<T>(actual: T, expected: T | T[]): boolean {
    if (Array.isArray(expected)) {
      return expected.includes(actual);
    }
    return actual === expected;
  }

  private routingRuleTrace(
    rule: RoutingRule,
    status: GovernanceTraceRule['status'],
    message: string,
    outcome?: CreateGovernanceTraceInput['outcome']
  ): GovernanceTraceRule {
    return {
      id: `routing:${rule.id}`,
      label: rule.name,
      type: 'routing',
      status,
      outcome,
      message,
      details: {
        match: rule.match,
        agent: rule.agent,
        model: rule.model,
        fallback: rule.fallback,
        enabled: rule.enabled,
      },
    };
  }

  private buildRoutingTrace(
    task: RoutableTask,
    context: RoutingTraceContext,
    result: RoutingResult,
    input: {
      outcome: CreateGovernanceTraceInput['outcome'];
      evaluatedRules: GovernanceTraceRule[];
      matchedRules: GovernanceTraceRule[];
      steps: GovernanceTraceStep[];
      routing: AgentRoutingConfig;
    }
  ): CreateGovernanceTraceInput {
    return {
      kind: 'routing',
      outcome: input.outcome,
      title: `Agent routing: ${result.agent}`,
      summary: result.reason,
      remediation:
        input.outcome === 'fallback'
          ? 'Add or reorder routing rules if the default agent should not handle this task.'
          : input.outcome === 'skipped'
            ? 'Enable agent routing to evaluate task-aware routing rules.'
            : undefined,
      subject: {
        agentId: result.agent,
        taskId: context.taskId,
        actionType: 'agent.route',
        project: task.project,
      },
      evaluatedRules: input.evaluatedRules,
      matchedRules: input.matchedRules,
      steps: input.steps,
      raw: { task, routing: input.routing, result },
    };
  }
}

function resolveRegisteredRuntimeIdentity(
  registeredAgents: RegisteredAgent[],
  agentConfig: AgentConfig
): RuntimeIdentityResolution {
  const exactId = registeredAgents.find((registered) => registered.id === agentConfig.type);
  if (exactId) {
    return registeredAgentIsLive(exactId)
      ? { registrations: [exactId] }
      : {
          registrations: [],
          rejectionReason: `Registered agent "${exactId.id}" is offline or outside the five-minute heartbeat window.`,
        };
  }

  const nameMatches = registeredAgents.filter(
    (registered) =>
      normalizeRuntimeValue(registered.name) === normalizeRuntimeValue(agentConfig.name)
  );
  if (nameMatches.length === 0) {
    return {
      registrations: [],
      rejectionReason: `No registry identity matches configured agent "${agentConfig.type}".`,
    };
  }
  if (nameMatches.length > 1) {
    return {
      registrations: [],
      rejectionReason: `Multiple registry identities match configured agent name "${agentConfig.name}".`,
    };
  }
  const nameMatch = nameMatches[0] as RegisteredAgent;
  return registeredAgentIsLive(nameMatch)
    ? { registrations: [nameMatch] }
    : {
        registrations: [],
        rejectionReason: `Registered agent "${nameMatch.id}" is offline or outside the five-minute heartbeat window.`,
      };
}

function recordRuntimeCandidate(
  candidates: ProviderRuntimeRouteCandidate[],
  agent: AgentType,
  model: string | undefined,
  availability: AgentAvailability
): void {
  if (!availability.runtimeSelection) return;
  candidates.push({
    agent,
    ...(model ? { model } : {}),
    available: availability.available,
    selected: false,
    reason: availability.reason,
    selection: availability.runtimeSelection,
  });
}

function markLastRuntimeCandidateSelected(candidates: ProviderRuntimeRouteCandidate[]): void {
  const candidate = candidates.at(-1);
  if (candidate) candidate.selected = true;
}

function optionalRuntimeCandidates(
  candidates: ProviderRuntimeRouteCandidate[]
): ProviderRuntimeRouteCandidate[] | undefined {
  return candidates.length > 0 ? candidates : undefined;
}

function uniqueRuntimeCapabilities(
  capabilities: ProviderRuntimeCapabilityId[]
): ProviderRuntimeCapabilityId[] {
  return Array.from(
    new Set(capabilities.map((capability) => capability.trim()).filter(Boolean))
  ).sort((left, right) => left.localeCompare(right));
}

function withRuntimeReason(
  reason: string,
  runtimeSelection: ProviderRuntimeSelection | undefined
): string {
  return runtimeSelection ? `${reason}. ${runtimeSelection.reason}` : reason;
}

function normalizeRuntimeValue(value: string): string {
  return value.trim().toLowerCase();
}

// Singleton
let _instance: AgentRoutingService | null = null;

export function getAgentRoutingService(): AgentRoutingService {
  if (!_instance) {
    _instance = new AgentRoutingService();
  }
  return _instance;
}
