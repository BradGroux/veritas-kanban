import { z } from 'zod';

const SlugSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9][a-z0-9-_]*$/, 'ID must start with a lowercase letter or number');

const AgentTypeSchema = z
  .string()
  .trim()
  .min(1)
  .max(50)
  .regex(/^[a-z0-9-]+$/, 'Agent type must be lowercase alphanumeric with dashes');

const StringListSchema = z.array(z.string().trim().min(1).max(160)).max(80).default([]);

const MatchValueSchema = z.union([
  z.string().trim().min(1).max(160),
  z.array(z.string().trim().min(1).max(160)).max(50),
]);

export const TeamRosterFormatSchema = z.enum(['json', 'yaml']).optional();

export const TeamRosterMemberSchema = z
  .object({
    id: SlugSchema,
    displayName: z.string().trim().min(1).max(120),
    role: z.string().trim().min(1).max(160),
    agent: AgentTypeSchema,
    profileId: SlugSchema.optional(),
    status: z.enum(['enabled', 'disabled']).default('enabled'),
    capabilities: StringListSchema,
    defaultTaskTypes: StringListSchema.optional(),
    ownedPaths: z.array(z.string().trim().min(1).max(500)).max(100).optional(),
    projects: z.array(z.string().trim().min(1).max(160)).max(50).optional(),
    fallbackMemberId: SlugSchema.optional(),
    reviewerMemberIds: z.array(SlugSchema).max(25).optional(),
  })
  .strict();

export const TeamRosterRouteMatchSchema = z
  .object({
    type: MatchValueSchema.optional(),
    priority: z
      .union([
        z.enum(['critical', 'high', 'medium', 'low']),
        z.array(z.enum(['critical', 'high', 'medium', 'low'])).max(4),
      ])
      .optional(),
    project: MatchValueSchema.optional(),
    path: MatchValueSchema.optional(),
    capability: MatchValueSchema.optional(),
    minSubtasks: z.number().int().nonnegative().max(500).optional(),
  })
  .strict();

export const TeamRosterRouteRuleSchema = z
  .object({
    id: SlugSchema,
    name: z.string().trim().min(1).max(200),
    enabled: z.boolean().default(true),
    match: TeamRosterRouteMatchSchema,
    memberId: SlugSchema,
    fallbackMemberId: SlugSchema.optional(),
    reviewerMemberIds: z.array(SlugSchema).max(25).optional(),
    risk: z.enum(['normal', 'review', 'security', 'human']).optional(),
  })
  .strict();

export const TeamRosterManifestSchema = z
  .object({
    id: SlugSchema,
    schemaVersion: z.literal('team-roster/v1').default('team-roster/v1'),
    workspaceId: z.string().trim().min(1).max(120),
    name: z.string().trim().min(1).max(160),
    description: z.string().trim().max(2000).optional(),
    enabled: z.boolean().default(true),
    coordinatorMemberId: SlugSchema.optional(),
    members: z.array(TeamRosterMemberSchema).min(1).max(100),
    routingRules: z.array(TeamRosterRouteRuleSchema).max(200).default([]),
    metadata: z
      .object({
        source: z.string().trim().min(1).max(500).optional(),
        importedAt: z.string().datetime().optional(),
        updatedAt: z.string().datetime().optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((roster, ctx) => {
    const memberIds = new Set<string>();
    roster.members.forEach((member, index) => {
      if (memberIds.has(member.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['members', index, 'id'],
          message: `Duplicate member ID: ${member.id}`,
        });
      }
      memberIds.add(member.id);
    });

    const ruleIds = new Set<string>();
    roster.routingRules.forEach((rule, index) => {
      if (ruleIds.has(rule.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['routingRules', index, 'id'],
          message: `Duplicate routing rule ID: ${rule.id}`,
        });
      }
      ruleIds.add(rule.id);
      for (const [field, id] of [
        ['memberId', rule.memberId],
        ['fallbackMemberId', rule.fallbackMemberId],
      ] as const) {
        if (id && !memberIds.has(id)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['routingRules', index, field],
            message: `Unknown member ID: ${id}`,
          });
        }
      }
      rule.reviewerMemberIds?.forEach((id, reviewerIndex) => {
        if (!memberIds.has(id)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['routingRules', index, 'reviewerMemberIds', reviewerIndex],
            message: `Unknown reviewer member ID: ${id}`,
          });
        }
      });
    });

    roster.members.forEach((member, index) => {
      if (member.fallbackMemberId && !memberIds.has(member.fallbackMemberId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['members', index, 'fallbackMemberId'],
          message: `Unknown fallback member ID: ${member.fallbackMemberId}`,
        });
      }
      member.reviewerMemberIds?.forEach((id, reviewerIndex) => {
        if (!memberIds.has(id)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['members', index, 'reviewerMemberIds', reviewerIndex],
            message: `Unknown reviewer member ID: ${id}`,
          });
        }
      });
    });

    if (roster.coordinatorMemberId && !memberIds.has(roster.coordinatorMemberId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['coordinatorMemberId'],
        message: `Unknown coordinator member ID: ${roster.coordinatorMemberId}`,
      });
    }
  });

export const TeamRosterImportBodySchema = z
  .object({
    content: z.string().min(1).max(200_000),
    format: TeamRosterFormatSchema,
    source: z.string().trim().min(1).max(500).optional(),
  })
  .strict();

export const TeamRosterValidateBodySchema = z
  .object({
    roster: z.unknown().optional(),
    content: z.string().min(1).max(200_000).optional(),
    format: TeamRosterFormatSchema,
  })
  .strict()
  .refine((value) => value.roster || value.content, {
    message: 'Provide roster or content',
  });

export const TeamRosterRoutePreviewBodySchema = z
  .object({
    type: z.string().trim().min(1).max(160).optional(),
    priority: z.enum(['critical', 'high', 'medium', 'low']).optional(),
    project: z.string().trim().min(1).max(160).optional(),
    path: z.string().trim().min(1).max(500).optional(),
    capabilities: z.array(z.string().trim().min(1).max(160)).max(25).optional(),
    subtaskCount: z.number().int().nonnegative().max(500).optional(),
  })
  .strict();
