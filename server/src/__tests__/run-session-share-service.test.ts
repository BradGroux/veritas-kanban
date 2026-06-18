import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import type { Task } from '@veritas-kanban/shared';
import { RunSessionShareService } from '../services/run-session-share-service.js';
import type { TaskService } from '../services/task-service.js';
import { ForbiddenError } from '../middleware/error-handler.js';

const mockTask: Task = {
  id: 'task-721',
  title: 'Ship shared live run sessions',
  description: 'Parent context in /Users/bradgroux/Projects/veritas-kanban with no secrets.',
  type: 'feature',
  status: 'in-progress',
  priority: 'high',
  project: 'veritas',
  sprint: '5.1',
  created: '2026-06-18T10:00:00.000Z',
  updated: '2026-06-18T10:00:00.000Z',
  agent: 'codex',
  git: {
    repo: 'BradGroux/veritas-kanban',
    branch: 'feat/shared-live-run-sessions-721',
    baseBranch: 'main',
    worktreePath: '/Users/bradgroux/Projects/veritas-kanban',
  },
  attempt: {
    id: 'attempt-721',
    agent: 'codex',
    status: 'running',
    provider: 'openai',
    model: 'gpt-5',
    started: '2026-06-18T10:01:00.000Z',
    threadId: 'thread-local-only',
  },
  deliverables: [
    {
      id: 'artifact-1',
      title: 'Preview artifact',
      type: 'artifact',
      status: 'attached',
      created: '2026-06-18T10:05:00.000Z',
    },
  ],
};

describe('RunSessionShareService', () => {
  let tmpDir: string;
  let taskService: {
    getTask: ReturnType<typeof vi.fn>;
    createTask: ReturnType<typeof vi.fn>;
  };
  let agentService: {
    getAgentStatus: ReturnType<typeof vi.fn>;
    getAttemptLog: ReturnType<typeof vi.fn>;
    sendMessage: ReturnType<typeof vi.fn>;
  };
  let service: RunSessionShareService;

  const owner = {
    id: 'user-1',
    label: 'Brad',
    type: 'user' as const,
    workspaceId: 'local',
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'run-session-shares-'));
    taskService = {
      getTask: vi.fn().mockResolvedValue(mockTask),
      createTask: vi.fn().mockResolvedValue({
        ...mockTask,
        id: 'task-721-fork',
        title: 'Forked live session',
        description: 'Forked context',
        git: undefined,
        attempt: undefined,
      }),
    };
    agentService = {
      getAgentStatus: vi.fn().mockReturnValue({
        attemptId: 'attempt-721',
        status: 'running',
        agent: 'codex',
        startedAt: '2026-06-18T10:01:00.000Z',
      }),
      getAttemptLog: vi
        .fn()
        .mockResolvedValue('running in /Users/bradgroux/Projects/veritas-kanban\nready'),
      sendMessage: vi.fn().mockResolvedValue({ delivered: true }),
    };
    service = new RunSessionShareService({
      filePath: path.join(tmpDir, 'run-session-shares.json'),
      taskService: taskService as unknown as TaskService,
      agentService: agentService as never,
    });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('creates view-only links and lists only shares in the actor workspace', async () => {
    const share = await service.create({ taskId: mockTask.id, permission: 'view' }, owner);
    await service.create(
      { taskId: mockTask.id, permission: 'view' },
      { ...owner, id: 'user-2', workspaceId: 'other' }
    );

    expect(share.stablePath).toBe(`/runs/shared/${share.id}`);
    expect(share.snapshot).toMatchObject({
      running: true,
      attemptId: 'attempt-721',
      worktreePath: '[redacted-worktree]',
    });
    await expect(service.get(share.id, { actor: owner })).resolves.toMatchObject({
      id: share.id,
      permission: 'view',
    });
    await expect(
      service.sendMessage(share.id, { message: 'please continue' }, owner)
    ).rejects.toBeInstanceOf(ForbiddenError);

    expect(await service.list({ taskId: mockTask.id }, owner)).toHaveLength(1);
    expect(
      await service.list({ taskId: mockTask.id }, { ...owner, workspaceId: 'other' })
    ).toHaveLength(1);
    expect(
      await service.list({ taskId: mockTask.id }, { ...owner, workspaceId: 'missing' })
    ).toHaveLength(0);
  });

  it('upgrades edit access, attributes co-drive messages, and fails closed after revoke or expiry', async () => {
    const share = await service.create({ taskId: mockTask.id, permission: 'view' }, owner);
    const upgraded = await service.update(share.id, { permission: 'edit' }, owner);

    expect(upgraded.permission).toBe('edit');
    const messageEvent = await service.sendMessage(
      share.id,
      { message: 'Run the focused test gate' },
      { ...owner, id: 'editor-1', label: 'Pair Editor' }
    );
    expect(messageEvent).toMatchObject({
      type: 'message.sent',
      message: 'Run the focused test gate',
      actor: expect.objectContaining({ id: 'editor-1', label: 'Pair Editor' }),
    });
    expect(agentService.sendMessage).toHaveBeenCalledWith(
      mockTask.id,
      'Run the focused test gate',
      expect.objectContaining({ actor: 'Pair Editor', source: `run-session:${share.id}` })
    );

    await service.revoke(share.id, owner, 'Rotated reviewer access');
    await expect(service.get(share.id, { actor: owner })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      service.sendMessage(share.id, { message: 'after revoke' }, owner)
    ).rejects.toBeInstanceOf(ForbiddenError);

    const expired = await service.create(
      {
        taskId: mockTask.id,
        permission: 'view',
        expiresAt: '2020-01-01T00:00:00.000Z',
      },
      owner
    );
    await expect(service.get(expired.id, { actor: owner })).rejects.toBeInstanceOf(ForbiddenError);
    expect(await service.list({ status: 'expired' }, owner)).toEqual([
      expect.objectContaining({ id: expired.id, status: 'expired' }),
    ]);
  });

  it('allows mobile-safe approvals and blocks unsafe approval classes from mobile clients', async () => {
    const share = await service.create(
      {
        taskId: mockTask.id,
        permission: 'edit',
        mobileSafeApprovalClasses: ['human-review'],
      },
      owner
    );
    const mobileActor = { ...owner, id: 'mobile-1', clientMode: 'mobile-pwa' };

    await expect(
      service.respondToApproval(
        share.id,
        { actionClass: 'human-review', response: 'approved' },
        mobileActor
      )
    ).resolves.toMatchObject({
      type: 'approval.responded',
      actionClass: 'human-review',
      approvalResponse: 'approved',
    });

    await expect(
      service.respondToApproval(
        share.id,
        { actionClass: 'shell-command', response: 'approved' },
        mobileActor
      )
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('forks into a new task without inheriting local handles or mutating parent state', async () => {
    const share = await service.create({ taskId: mockTask.id, permission: 'fork' }, owner);

    const result = await service.fork(
      share.id,
      {
        title: 'Investigate forked run',
        priority: 'critical',
        reason: 'Continue from /Users/bradgroux/private/repo on a separate track.',
      },
      owner
    );

    expect(result.fork).toMatchObject({
      shareId: share.id,
      parentTaskId: mockTask.id,
      parentAttemptId: 'attempt-721',
      forkTaskId: 'task-721-fork',
    });
    expect(taskService.createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Investigate forked run',
        priority: 'critical',
        type: mockTask.type,
        project: mockTask.project,
        sprint: mockTask.sprint,
        agent: mockTask.agent,
      })
    );
    const createdInput = taskService.createTask.mock.calls[0][0];
    expect(createdInput.git).toBeUndefined();
    expect(createdInput.attempt).toBeUndefined();
    expect(createdInput.description).toContain('[redacted-local-path]');
    expect(createdInput.description).not.toContain('/Users/bradgroux');

    await expect(
      service.get(share.id, { actor: owner, includeInactive: true })
    ).resolves.toMatchObject({
      forkedTaskIds: ['task-721-fork'],
    });
    expect(mockTask.git?.worktreePath).toBe('/Users/bradgroux/Projects/veritas-kanban');
    expect(mockTask.attempt?.threadId).toBe('thread-local-only');
  });
});
