import { describe, expect, it } from 'vitest';
import { AutomationDraftCompileBodySchema } from '../schemas/automation-draft-schemas.js';

describe('automation draft schemas', () => {
  it('accepts bounded authority hints and rejects hidden configuration or unbounded values', () => {
    const valid = {
      intent: 'Every day at 9 AM create a report.',
      requestId: 'request-1',
      hints: {
        timezone: 'UTC',
        workflowId: 'daily-report',
        expiresAt: '2026-12-31T23:59:59.000Z',
        overlapPolicy: 'forbid',
        retry: { maxAttempts: 2, backoffMinutes: 10 },
        outputDestination: 'work-products/daily-report',
        expectedDeliverables: ['Daily report'],
        standingScope: {
          reads: ['task backlog'],
          writes: ['work product'],
          sends: [],
          externalTargets: [],
          artifactDestinations: ['work-products/daily-report'],
          integrationIds: [],
          toolIds: ['work-product-write'],
          credentialDefinitionIds: [],
          approvalRequiredActions: ['write work product'],
        },
        perRunBudget: { maxRuns: 1, maxTokens: 100_000 },
        aggregateBudget: { maxRuns: 10, maxTokens: 1_000_000 },
        stopConditions: ['expiry reached'],
      },
    };

    expect(AutomationDraftCompileBodySchema.safeParse(valid).success).toBe(true);
    expect(
      AutomationDraftCompileBodySchema.safeParse({
        ...valid,
        hints: { ...valid.hints, environment: { API_TOKEN: 'secret' } },
      }).success
    ).toBe(false);
    expect(
      AutomationDraftCompileBodySchema.safeParse({
        ...valid,
        hints: { ...valid.hints, aggregateBudget: { maxRuns: Number.POSITIVE_INFINITY } },
      }).success
    ).toBe(false);
  });
});
