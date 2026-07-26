import type {
  ReflectionAppliedTarget,
  ReflectionCandidate,
  ReflectionTypedPromotionInput,
  TeamRosterManifest,
  TeamRosterMember,
} from '@veritas-kanban/shared';
import { ConflictError, NotFoundError } from '../middleware/error-handler.js';
import {
  getAgentProfilePackageService,
  type AgentProfilePackageService,
} from './agent-profile-package-service.js';
import { getDecisionService, type DecisionService } from './decision-service.js';
import { getPolicyService, type PolicyService } from './policy-service.js';
import { getTeamRosterService, type TeamRosterService } from './team-roster-service.js';
import { TemplateService } from './template-service.js';

export interface ReflectionPromotionApplyContext {
  candidate: ReflectionCandidate;
  promotion: ReflectionTypedPromotionInput;
  reviewedBy: string;
  timestamp: string;
}

export interface ReflectionPromotionAdapter {
  target: ReflectionTypedPromotionInput['target'];
  apply(context: ReflectionPromotionApplyContext): Promise<ReflectionAppliedTarget>;
}

export interface ReflectionPromotionAdapterDependencies {
  teamRoster: () => Pick<TeamRosterService, 'mutateRoster'>;
  profiles: () => Pick<AgentProfilePackageService, 'getProfile' | 'updateProfile'>;
  templates: () => Pick<TemplateService, 'getTemplate' | 'updateTemplate'>;
  decisions: () => Pick<DecisionService, 'create' | 'list'>;
  policies: () => Pick<PolicyService, 'getPolicy' | 'createPolicy' | 'updatePolicy'>;
}

export class ReflectionPromotionAdapterRegistry {
  private readonly adapters: Map<
    ReflectionTypedPromotionInput['target'],
    ReflectionPromotionAdapter
  >;

  constructor(adapters: ReflectionPromotionAdapter[] = createBuiltInReflectionPromotionAdapters()) {
    this.adapters = new Map();
    for (const adapter of adapters) {
      if (this.adapters.has(adapter.target)) {
        throw new ConflictError(
          `Multiple typed reflection promotion adapters are registered for ${adapter.target}.`
        );
      }
      this.adapters.set(adapter.target, adapter);
    }
  }

  async apply(context: ReflectionPromotionApplyContext): Promise<ReflectionAppliedTarget> {
    const adapter = this.adapters.get(context.promotion.target);
    if (!adapter) {
      throw new ConflictError(
        `No typed reflection promotion adapter is registered for ${context.promotion.target}.`
      );
    }
    return adapter.apply(context);
  }
}

export function createBuiltInReflectionPromotionAdapters(
  dependencies: ReflectionPromotionAdapterDependencies = defaultDependencies()
): ReflectionPromotionAdapter[] {
  return [
    {
      target: 'memory',
      async apply(context) {
        const promotion = promotionFor(context.promotion, 'memory');
        return appliedTarget('memory', promotion.workspaceId, 'Reviewed workspace memory', context);
      },
    },
    {
      target: 'team',
      async apply(context) {
        const promotion = promotionFor(context.promotion, 'team');
        const member = await dependencies.teamRoster().mutateRoster((roster) => {
          if (!roster || roster.id !== promotion.rosterId) {
            throw new NotFoundError(`Team roster not found: ${promotion.rosterId}`);
          }
          const existing = roster.members.find((item) => item.id === promotion.memberId);
          if (!existing) {
            throw new NotFoundError(`Team roster member not found: ${promotion.memberId}`);
          }
          const updated: TeamRosterMember = {
            ...existing,
            capabilities: stableUnion(existing.capabilities, promotion.capabilitiesToAdd),
          };
          const next: TeamRosterManifest = {
            ...roster,
            members: roster.members.map((item) => (item.id === updated.id ? updated : item)),
          };
          return { roster: next, result: updated };
        });
        return appliedTarget(
          'team',
          `${promotion.rosterId}:${member.id}`,
          member.displayName,
          context
        );
      },
    },
    {
      target: 'profile',
      async apply(context) {
        const promotion = promotionFor(context.promotion, 'profile');
        const service = dependencies.profiles();
        const existing = await service.getProfile(promotion.profileId);
        if (!existing) {
          throw new NotFoundError(`Agent profile package not found: ${promotion.profileId}`);
        }
        const updated = await service.updateProfile(promotion.profileId, {
          capabilities: stableUnion(existing.capabilities, promotion.capabilitiesToAdd),
        });
        return appliedTarget('profile', updated.id, updated.displayName, context);
      },
    },
    {
      target: 'template',
      async apply(context) {
        const promotion = promotionFor(context.promotion, 'template');
        const service = dependencies.templates();
        const existing = await service.getTemplate(promotion.templateId);
        if (!existing) {
          throw new NotFoundError(`Task template not found: ${promotion.templateId}`);
        }
        const marker = `[Reflection ${context.candidate.id}]`;
        const current = existing.taskDefaults.descriptionTemplate?.trim();
        const guidance = `${marker}\n${context.candidate.nextAttempt}`;
        const updated = current?.includes(marker)
          ? existing
          : await service.updateTemplate(existing.id, {
              taskDefaults: {
                descriptionTemplate: current ? `${current}\n\n${guidance}` : guidance,
              },
            });
        if (!updated) {
          throw new NotFoundError(`Task template not found: ${promotion.templateId}`);
        }
        return appliedTarget('template', updated.id, updated.name, context);
      },
    },
    {
      target: 'decision',
      async apply(context) {
        const promotion = promotionFor(context.promotion, 'decision');
        const service = dependencies.decisions();
        const marker = `[Reflection ${context.candidate.id}]`;
        const existing = (
          await service.list({
            agent: promotion.agentId,
          })
        ).find(
          (decision) =>
            decision.taskId === promotion.taskId && decision.inputContext.startsWith(marker)
        );
        const decision =
          existing ??
          (await service.create({
            inputContext: `${marker}\n${context.candidate.rationale ?? context.candidate.summary}`,
            outputAction: context.candidate.nextAttempt,
            assumptions: context.candidate.previousApproach
              ? [context.candidate.previousApproach]
              : undefined,
            confidenceLevel: promotion.confidenceLevel,
            riskScore: promotion.riskScore,
            parentDecisionId: promotion.parentDecisionId,
            agentId: promotion.agentId,
            taskId: promotion.taskId,
            timestamp: context.timestamp,
          }));
        return appliedTarget('decision', decision.id, decision.outputAction, context);
      },
    },
    {
      target: 'policy',
      async apply(context) {
        const promotion = promotionFor(context.promotion, 'policy');
        const service = dependencies.policies();
        const existing = await service.getPolicy(promotion.policy.id);
        const policy = existing
          ? await service.updatePolicy(existing.id, promotion.policy)
          : await service.createPolicy(promotion.policy);
        return appliedTarget('policy', policy.id, policy.name, context);
      },
    },
  ];
}

function promotionFor<TTarget extends ReflectionTypedPromotionInput['target']>(
  promotion: ReflectionTypedPromotionInput,
  target: TTarget
): Extract<ReflectionTypedPromotionInput, { target: TTarget }> {
  if (promotion.target !== target) {
    throw new ConflictError(`Expected ${target} promotion input, received ${promotion.target}.`);
  }
  return promotion as Extract<ReflectionTypedPromotionInput, { target: TTarget }>;
}

function stableUnion(existing: string[], additions: string[]): string[] {
  const values: string[] = [];
  const seen = new Set<string>();
  for (const value of [...existing, ...additions]) {
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    values.push(normalized);
  }
  return values.slice(0, 80);
}

function appliedTarget(
  kind: ReflectionAppliedTarget['kind'],
  id: string,
  title: string,
  context: Pick<ReflectionPromotionApplyContext, 'reviewedBy' | 'timestamp'>
): ReflectionAppliedTarget {
  return {
    kind,
    id,
    title,
    appliedAt: context.timestamp,
    appliedBy: context.reviewedBy,
  };
}

let templateService: TemplateService | undefined;

function defaultDependencies(): ReflectionPromotionAdapterDependencies {
  return {
    teamRoster: () => getTeamRosterService(),
    profiles: () => getAgentProfilePackageService(),
    templates: () => {
      templateService ??= new TemplateService();
      return templateService;
    },
    decisions: () => getDecisionService(),
    policies: () => getPolicyService(),
  };
}

let reflectionPromotionAdapterRegistry: ReflectionPromotionAdapterRegistry | undefined;

export function getReflectionPromotionAdapterRegistry(): ReflectionPromotionAdapterRegistry {
  reflectionPromotionAdapterRegistry ??= new ReflectionPromotionAdapterRegistry();
  return reflectionPromotionAdapterRegistry;
}
