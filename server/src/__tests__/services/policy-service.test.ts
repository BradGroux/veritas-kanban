import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PolicyService } from '../../services/policy-service.js';

describe('PolicyService', () => {
  let policiesDir: string;
  let service: PolicyService;

  beforeEach(async () => {
    policiesDir = await fs.mkdtemp(path.join(os.tmpdir(), 'veritas-policy-service-'));
    service = new PolicyService(policiesDir);
    await service.waitForInit();
  });

  afterEach(async () => {
    await fs.rm(policiesDir, { recursive: true, force: true });
  });

  it('seeds preset policies on first load', async () => {
    const policies = await service.listPolicies();

    expect(policies).toHaveLength(3);
    expect(policies.map((policy) => policy.preset).sort()).toEqual([
      'balanced',
      'permissive',
      'strict',
    ]);
  });

  it('creates and evaluates a block-action-type policy', async () => {
    await service.createPolicy({
      id: 'block-force-push',
      name: 'Block Force Push',
      type: 'block-action-type',
      enabled: true,
      scope: {
        agents: ['codex'],
        projects: ['core'],
        actionTypes: [],
      },
      responseAction: 'block',
      config: {
        actionTypes: ['git.force-push'],
      },
    });

    const result = await service.evaluatePolicies({
      agent: 'codex',
      project: 'core',
      actionType: 'git.force-push',
    });

    expect(result.decision).toBe('block');
    expect(result.blockedBy).toContain('block-force-push');
  });

  it('updates and deletes a policy', async () => {
    const created = await service.createPolicy({
      id: 'manual-approval',
      name: 'Manual Approval',
      type: 'require-approval',
      enabled: true,
      scope: {},
      responseAction: 'require-approval',
      config: {
        reason: 'Human sign-off required',
        approvers: ['bradgroux'],
      },
    });

    const updated = await service.updatePolicy(created.id, {
      ...created,
      enabled: false,
    });

    expect(updated.enabled).toBe(false);

    await service.deletePolicy(created.id);
    expect(await service.getPolicy(created.id)).toBeNull();
  });
});
