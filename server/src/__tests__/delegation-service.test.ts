import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

const mockWithFileLock = vi.fn(async (_path, fn) => await fn());

vi.mock('../services/file-lock.js', () => ({
  withFileLock: mockWithFileLock,
}));

describe('DelegationService', () => {
  let repoDir: string;
  let workDir: string;
  let oldCwd: string;
  let service: any;

  beforeEach(async () => {
    vi.resetModules();
    repoDir = await fs.mkdtemp(path.join(os.tmpdir(), 'delegation-repo-'));
    workDir = path.join(repoDir, 'server');
    await fs.mkdir(workDir, { recursive: true });
    oldCwd = process.cwd();
    process.chdir(workDir);
    const mod = await import('../services/delegation-service.js');
    service = new mod.DelegationService();
  });

  afterEach(async () => {
    process.chdir(oldCwd);
    await fs.rm(repoDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it('sets, gets, and revokes delegation', async () => {
    const expires = new Date(Date.now() + 60_000).toISOString();
    const settings = await service.setDelegation({
      delegateAgent: 'TARS',
      expires,
      scope: { type: 'all' },
      createdBy: 'brad',
      excludeTags: ['secret'],
    });

    expect(settings.enabled).toBe(true);
    expect((await service.getDelegation())?.delegateAgent).toBe('TARS');
    expect(await service.revokeDelegation()).toBe(true);
    expect((await service.getDelegation())?.enabled).toBe(false);
  });

  it('auto-disables expired delegation on load', async () => {
    const expired = new Date(Date.now() - 60_000).toISOString();
    await service.setDelegation({
      delegateAgent: 'TARS',
      expires: expired,
      scope: { type: 'all' },
      createdBy: 'brad',
    });

    const freshMod = await import('../services/delegation-service.js');
    const fresh = new freshMod.DelegationService();
    const current = await fresh.getDelegation();
    expect(current?.enabled).toBe(false);
  });

  it('checks approval rules for scope, exclusions, agent mismatch, and expiry', async () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    await service.setDelegation({
      delegateAgent: 'TARS',
      expires: future,
      scope: { type: 'project', projectIds: ['alpha'] },
      excludePriorities: ['high'],
      excludeTags: ['blocked'],
      createdBy: 'brad',
    });

    await expect(service.canApprove('CASE', { id: '1', project: 'alpha' })).resolves.toMatchObject({
      allowed: false,
      reason: 'Agent is not the delegate',
    });
    await expect(
      service.canApprove('TARS', { id: '1', priority: 'high', project: 'alpha' })
    ).resolves.toMatchObject({ allowed: false, reason: expect.stringMatching(/excluded/) });
    await expect(
      service.canApprove('TARS', { id: '1', project: 'alpha', tags: ['blocked'] })
    ).resolves.toMatchObject({ allowed: false, reason: expect.stringMatching(/excluded tag/) });
    await expect(service.canApprove('TARS', { id: '1' })).resolves.toMatchObject({
      allowed: false,
      reason: 'Task has no project',
    });
    await expect(service.canApprove('TARS', { id: '1', project: 'beta' })).resolves.toMatchObject({
      allowed: false,
      reason: expect.stringMatching(/not in delegation scope/),
    });
    await expect(service.canApprove('TARS', { id: '1', project: 'alpha' })).resolves.toEqual({
      allowed: true,
    });

    await service.setDelegation({
      delegateAgent: 'TARS',
      expires: future,
      scope: { type: 'priority', priorities: ['low'] },
      createdBy: 'brad',
    });
    await expect(service.canApprove('TARS', { id: '1' })).resolves.toMatchObject({
      allowed: false,
      reason: 'Task has no priority',
    });
    await expect(
      service.canApprove('TARS', { id: '1', priority: 'medium' })
    ).resolves.toMatchObject({
      allowed: false,
      reason: expect.stringMatching(/not in delegation scope/),
    });
    await expect(service.canApprove('TARS', { id: '1', priority: 'low' })).resolves.toEqual({
      allowed: true,
    });

    await service.setDelegation({
      delegateAgent: 'TARS',
      expires: new Date(Date.now() - 1_000).toISOString(),
      scope: { type: 'all' },
      createdBy: 'brad',
    });
    await expect(service.canApprove('TARS', { id: '1' })).resolves.toMatchObject({
      allowed: false,
      reason: 'No active delegation',
    });
  });

  it('returns no active delegation when none exists', async () => {
    await expect(service.canApprove('TARS', { id: '1' })).resolves.toMatchObject({
      allowed: false,
      reason: 'No active delegation',
    });
    await expect(service.revokeDelegation()).resolves.toBe(false);
  });

  it('logs approvals, caps history, and filters newest first', async () => {
    await service.setDelegation({
      delegateAgent: 'TARS',
      expires: new Date(Date.now() + 60_000).toISOString(),
      scope: { type: 'all' },
      createdBy: 'brad',
    });

    const logFile = path.join(repoDir, '.veritas-kanban', 'delegation-log.json');
    await fs.writeFile(
      logFile,
      JSON.stringify(
        {
          approvals: Array.from({ length: 999 }, (_, i) => ({
            id: `approval-seed-${i}`,
            taskId: `seed-${i}`,
            taskTitle: `Seed ${i}`,
            agent: 'CASE',
            delegated: true,
            timestamp: new Date(Date.now() - 2_000_000 + i).toISOString(),
            originalDelegation: 'seed',
          })),
        },
        null,
        2
      ),
      'utf-8'
    );

    for (let i = 0; i < 3; i++) {
      await service.logApproval({
        taskId: `task-${i % 2}`,
        taskTitle: `Task ${i}`,
        agent: i % 2 ? 'TARS' : 'CASE',
      });
    }

    const all = await service.getApprovalLog();
    expect(all).toHaveLength(1000);
    expect(new Date(all[0].timestamp).getTime()).toBeGreaterThanOrEqual(
      new Date(all[all.length - 1].timestamp).getTime()
    );

    const filtered = await service.getApprovalLog({ taskId: 'task-1', agent: 'TARS', limit: 5 });
    expect(filtered).toHaveLength(1);
    expect(filtered.every((a: any) => a.taskId === 'task-1' && a.agent === 'TARS')).toBe(true);
  });
});
