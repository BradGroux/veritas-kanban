import yaml from 'yaml';
import type {
  AgentType,
  TeamRosterExportResult,
  TeamRosterFormat,
  TeamRosterManifest,
  TeamRosterMember,
  TeamRosterRouteMatch,
  TeamRosterRoutePreview,
  TeamRosterRoutePreviewInput,
  TeamRosterValidationResult,
} from '@veritas-kanban/shared';
import { getConfigService, type ConfigService } from './config-service.js';
import { TeamRosterManifestSchema } from '../schemas/team-roster-schemas.js';

interface ImportRosterInput {
  content: string;
  format?: TeamRosterFormat;
  source?: string;
}

export class TeamRosterService {
  constructor(private readonly configService: ConfigService = getConfigService()) {}

  async getRoster(): Promise<TeamRosterManifest | null> {
    const config = await this.configService.getConfig();
    return config.teamRoster ?? null;
  }

  validateContent(input: ImportRosterInput): TeamRosterValidationResult {
    try {
      return this.validateUnknown(this.parseContent(input.content, input.format));
    } catch (error) {
      return {
        valid: false,
        issues: [{ path: '$', message: error instanceof Error ? error.message : String(error) }],
      };
    }
  }

  validateRoster(roster: unknown): TeamRosterValidationResult {
    return this.validateUnknown(roster);
  }

  async saveRoster(roster: TeamRosterManifest): Promise<TeamRosterManifest> {
    const parsed = this.validateUnknown(roster);
    if (!parsed.valid || !parsed.roster) {
      const firstIssue = parsed.issues[0];
      throw new Error(firstIssue ? `${firstIssue.path}: ${firstIssue.message}` : 'Invalid roster');
    }

    const config = await this.configService.getConfig();
    const now = new Date().toISOString();
    const next: TeamRosterManifest = {
      ...parsed.roster,
      metadata: {
        ...parsed.roster.metadata,
        updatedAt: now,
      },
    };
    config.teamRoster = next;
    await this.configService.saveConfig(config);
    return next;
  }

  async importRoster(input: ImportRosterInput): Promise<TeamRosterManifest> {
    const validation = this.validateContent(input);
    if (!validation.valid || !validation.roster) {
      const firstIssue = validation.issues[0];
      throw new Error(firstIssue ? `${firstIssue.path}: ${firstIssue.message}` : 'Invalid roster');
    }

    const now = new Date().toISOString();
    return this.saveRoster({
      ...validation.roster,
      metadata: {
        ...validation.roster.metadata,
        source: input.source ?? validation.roster.metadata?.source,
        importedAt: validation.roster.metadata?.importedAt ?? now,
        updatedAt: now,
      },
    });
  }

  async exportRoster(format: TeamRosterFormat): Promise<TeamRosterExportResult> {
    const roster = await this.getRoster();
    if (!roster) {
      throw new Error('Team roster is not configured');
    }
    const content =
      format === 'json' ? `${JSON.stringify(roster, null, 2)}\n` : yaml.stringify(roster);
    return { id: roster.id, format, content };
  }

  async previewRoute(input: TeamRosterRoutePreviewInput): Promise<TeamRosterRoutePreview> {
    const roster = await this.getRoster();
    return this.resolveRoute(input, roster);
  }

  resolveRoute(
    input: TeamRosterRoutePreviewInput,
    roster: TeamRosterManifest | null | undefined
  ): TeamRosterRoutePreview {
    if (!roster || !roster.enabled) {
      return {
        matched: false,
        reason: 'No enabled team roster is configured',
        reviewerMembers: [],
        issues: [],
      };
    }

    const validation = this.validateUnknown(roster);
    if (!validation.valid || !validation.roster) {
      return {
        matched: false,
        reason: 'Team roster is invalid',
        reviewerMembers: [],
        issues: validation.issues,
      };
    }

    const validRoster = validation.roster;
    for (const rule of validRoster.routingRules) {
      if (!rule.enabled || !this.matches(input, rule.match)) continue;
      const selected = this.pickMember(validRoster, rule.memberId, rule.fallbackMemberId);
      if (!selected.member) {
        return {
          matched: false,
          ruleId: rule.id,
          reason: selected.reason,
          reviewerMembers: [],
          issues: [{ path: `$.routingRules.${rule.id}.memberId`, message: selected.reason }],
        };
      }
      return this.toPreview(
        validRoster,
        selected.member,
        `Matched roster rule: ${rule.name}`,
        rule.id,
        rule.reviewerMemberIds ?? selected.member.reviewerMemberIds,
        selected.fallbackMember
      );
    }

    const byCapability = input.capabilities?.find((capability) =>
      validRoster.members.some(
        (member) =>
          member.status === 'enabled' &&
          member.capabilities.includes(capability) &&
          this.memberScopeMatches(member, input)
      )
    );
    if (byCapability) {
      const member = validRoster.members.find(
        (candidate) =>
          candidate.status === 'enabled' &&
          candidate.capabilities.includes(byCapability) &&
          this.memberScopeMatches(candidate, input)
      );
      if (member) {
        return this.toPreview(validRoster, member, `Matched member capability: ${byCapability}`);
      }
    }

    const byTaskType = validRoster.members.find(
      (member) =>
        member.status === 'enabled' &&
        input.type &&
        member.defaultTaskTypes?.includes(input.type) &&
        this.memberScopeMatches(member, input)
    );
    if (byTaskType) {
      return this.toPreview(validRoster, byTaskType, `Matched member task type: ${input.type}`);
    }

    const coordinator = validRoster.coordinatorMemberId
      ? this.pickMember(validRoster, validRoster.coordinatorMemberId).member
      : null;
    if (coordinator) {
      return this.toPreview(validRoster, coordinator, 'No roster rule matched; using coordinator');
    }

    return {
      matched: false,
      reason: 'No enabled roster member matched the task',
      reviewerMembers: [],
      issues: [],
    };
  }

  private validateUnknown(value: unknown): TeamRosterValidationResult {
    const parsed = TeamRosterManifestSchema.safeParse(value);
    if (!parsed.success) {
      return {
        valid: false,
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.length ? `$.${issue.path.join('.')}` : '$',
          message: issue.message,
        })),
      };
    }

    return { valid: true, roster: parsed.data as TeamRosterManifest, issues: [] };
  }

  private parseContent(content: string, format?: TeamRosterFormat): unknown {
    if (format === 'json') return JSON.parse(content);
    if (format === 'yaml') return yaml.parse(content);
    try {
      return JSON.parse(content);
    } catch {
      return yaml.parse(content);
    }
  }

  private matches(input: TeamRosterRoutePreviewInput, match: TeamRosterRouteMatch): boolean {
    if (match.type !== undefined && !this.matchesValue(input.type, match.type)) return false;
    if (match.priority !== undefined && !this.matchesValue(input.priority, match.priority)) {
      return false;
    }
    if (match.project !== undefined && !this.matchesValue(input.project, match.project)) {
      return false;
    }
    if (match.path !== undefined && !this.matchesPath(input.path, match.path)) return false;
    if (
      match.capability !== undefined &&
      !this.matchesAny(input.capabilities ?? [], match.capability)
    ) {
      return false;
    }
    if (match.minSubtasks !== undefined && (input.subtaskCount ?? 0) < match.minSubtasks) {
      return false;
    }
    return true;
  }

  private matchesValue(actual: string | undefined, expected: string | string[]): boolean {
    if (!actual) return false;
    return Array.isArray(expected) ? expected.includes(actual) : actual === expected;
  }

  private matchesAny(actual: string[], expected: string | string[]): boolean {
    const values = Array.isArray(expected) ? expected : [expected];
    return values.some((value) => actual.includes(value));
  }

  private matchesPath(actual: string | undefined, expected: string | string[]): boolean {
    if (!actual) return false;
    const values = Array.isArray(expected) ? expected : [expected];
    return values.some((value) => actual === value || actual.startsWith(`${value}/`));
  }

  private memberScopeMatches(
    member: TeamRosterMember,
    input: TeamRosterRoutePreviewInput
  ): boolean {
    if (member.projects?.length && (!input.project || !member.projects.includes(input.project))) {
      return false;
    }
    if (member.ownedPaths?.length && !this.matchesPath(input.path, member.ownedPaths)) {
      return false;
    }
    return true;
  }

  private pickMember(
    roster: TeamRosterManifest,
    memberId: string,
    fallbackMemberId?: string
  ): { member?: TeamRosterMember; fallbackMember?: TeamRosterMember; reason: string } {
    const member = roster.members.find((candidate) => candidate.id === memberId);
    if (member?.status === 'enabled') return { member, reason: 'Selected roster member' };

    const fallbackId = fallbackMemberId ?? member?.fallbackMemberId;
    const fallbackMember = fallbackId
      ? roster.members.find((candidate) => candidate.id === fallbackId)
      : undefined;
    if (fallbackMember?.status === 'enabled') {
      return {
        member: fallbackMember,
        fallbackMember,
        reason: `Primary roster member is unavailable; using fallback ${fallbackMember.id}`,
      };
    }

    return { reason: `Roster member is not enabled: ${memberId}` };
  }

  private toPreview(
    roster: TeamRosterManifest,
    member: TeamRosterMember,
    reason: string,
    ruleId?: string,
    reviewerIds: string[] = [],
    fallbackMember?: TeamRosterMember
  ): TeamRosterRoutePreview {
    const reviewerMembers = reviewerIds
      .map((id) => roster.members.find((candidate) => candidate.id === id))
      .filter((candidate): candidate is TeamRosterMember => Boolean(candidate));
    return {
      matched: true,
      ruleId,
      reason,
      member,
      fallbackMember,
      reviewerMembers,
      agent: member.agent as AgentType,
      profileId: member.profileId,
      issues: [],
    };
  }
}

let teamRosterService: TeamRosterService | null = null;

export function getTeamRosterService(): TeamRosterService {
  if (!teamRosterService) {
    teamRosterService = new TeamRosterService();
  }
  return teamRosterService;
}
