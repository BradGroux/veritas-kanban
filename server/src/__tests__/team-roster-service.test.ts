import { describe, expect, it } from 'vitest';
import type { AppConfig, TeamRosterManifest } from '@veritas-kanban/shared';
import { TeamRosterService } from '../services/team-roster-service';

const roster: TeamRosterManifest = {
  id: 'core-team',
  schemaVersion: 'team-roster/v1',
  workspaceId: 'local',
  name: 'Core Team',
  enabled: true,
  coordinatorMemberId: 'ops-lead',
  members: [
    {
      id: 'ops-lead',
      displayName: 'Ops Lead',
      role: 'Coordinates queue work',
      agent: 'codex',
      status: 'enabled',
      capabilities: ['ops', 'triage'],
      defaultTaskTypes: ['feature'],
    },
    {
      id: 'docs-reviewer',
      displayName: 'Docs Reviewer',
      role: 'Reviews docs',
      agent: 'amp',
      status: 'enabled',
      capabilities: ['docs', 'review'],
      defaultTaskTypes: ['docs'],
    },
  ],
  routingRules: [
    {
      id: 'docs',
      name: 'Docs work',
      enabled: true,
      match: { type: 'docs' },
      memberId: 'docs-reviewer',
      reviewerMemberIds: ['ops-lead'],
    },
  ],
};

function serviceWithConfig(config: AppConfig) {
  return new TeamRosterService({
    getConfig: async () => config,
    saveConfig: async (next: AppConfig) => {
      Object.assign(config, next);
    },
  } as never);
}

describe('TeamRosterService', () => {
  it('validates duplicate and missing member references', () => {
    const service = serviceWithConfig({ repos: [], agents: [], defaultAgent: 'codex' });

    const result = service.validateRoster({
      ...roster,
      members: [roster.members[0], { ...roster.members[0] }],
      routingRules: [{ ...roster.routingRules[0], memberId: 'missing' }],
    });

    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.message)).toContain('Duplicate member ID: ops-lead');
    expect(result.issues.map((issue) => issue.message)).toContain('Unknown member ID: missing');
  });

  it('imports, exports, and previews roster routing', async () => {
    const config: AppConfig = { repos: [], agents: [], defaultAgent: 'codex' };
    const service = serviceWithConfig(config);

    const imported = await service.importRoster({
      content: JSON.stringify(roster),
      format: 'json',
      source: 'test',
    });
    expect(imported.metadata?.source).toBe('test');
    expect(config.teamRoster?.id).toBe('core-team');

    const exported = await service.exportRoster('yaml');
    expect(exported.content).toContain('Core Team');

    const preview = await service.previewRoute({ type: 'docs' });
    expect(preview.matched).toBe(true);
    expect(preview.member?.id).toBe('docs-reviewer');
    expect(preview.reviewerMembers.map((member) => member.id)).toEqual(['ops-lead']);
  });

  it('falls back to the coordinator when no rule matches', async () => {
    const service = serviceWithConfig({
      repos: [],
      agents: [],
      defaultAgent: 'codex',
      teamRoster: roster,
    });

    const preview = await service.previewRoute({ type: 'bug' });

    expect(preview.matched).toBe(true);
    expect(preview.member?.id).toBe('ops-lead');
    expect(preview.reason).toContain('coordinator');
  });
});
