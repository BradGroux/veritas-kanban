import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { DEFAULT_FEATURE_SETTINGS } from '@veritas-kanban/shared';
import { TaskService } from '../services/task-service.js';
import { ConfigService } from '../services/config-service.js';

function buildSettings() {
  return {
    ...DEFAULT_FEATURE_SETTINGS,
    board: {
      ...DEFAULT_FEATURE_SETTINGS.board,
      columns: [
        { id: 'triage', title: 'Triage' },
        { id: 'todo', title: 'To Do' },
        { id: 'ready', title: 'Ready' },
        { id: 'in-progress', title: 'In Progress' },
        { id: 'blocked', title: 'Blocked' },
        { id: 'done', title: 'Done' },
      ],
      // Keep the default aligned with older route/service tests if this prototype mock is ever
      // observed cross-file during Vitest's parallel execution.
      defaultStatus: 'todo',
    },
    tasks: {
      ...DEFAULT_FEATURE_SETTINGS.tasks,
      requireDeliverableForDone: false,
    },
    enforcement: {
      ...DEFAULT_FEATURE_SETTINGS.enforcement,
      reviewGate: false,
      closingComments: false,
      autoTelemetry: false,
      autoTimeTracking: false,
    },
  } as typeof DEFAULT_FEATURE_SETTINGS;
}

describe('approval workflow gates', () => {
  let service: TaskService;
  let testRoot: string;
  let tasksDir: string;
  let archiveDir: string;

  beforeEach(async () => {
    const uniqueSuffix = Math.random().toString(36).substring(7);
    testRoot = path.join(os.tmpdir(), `veritas-test-hermes-gates-${uniqueSuffix}`);
    tasksDir = path.join(testRoot, 'active');
    archiveDir = path.join(testRoot, 'archive');

    await fs.mkdir(tasksDir, { recursive: true });
    await fs.mkdir(archiveDir, { recursive: true });

    vi.spyOn(ConfigService.prototype, 'getFeatureSettings').mockResolvedValue(buildSettings());
    service = new TaskService({ tasksDir, archiveDir });
  });

  afterEach(async () => {
    service?.dispose();
    vi.restoreAllMocks();
    if (testRoot) {
      await fs.rm(testRoot, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('blocks To Do → Ready without an assigned worker and acceptance criteria', async () => {
    const task = await service.createTask({ title: 'Shape unassigned work', status: 'todo' });

    await expect(service.updateTask(task.id, { status: 'ready' })).rejects.toMatchObject({
      message:
        'To Do → Ready requires an assigned worker and acceptance criteria/definition of done',
      details: expect.arrayContaining([
        expect.objectContaining({ code: 'ASSIGNED_WORKER_REQUIRED', path: ['assignedWorker'] }),
        expect.objectContaining({ code: 'ACCEPTANCE_CRITERIA_REQUIRED', path: ['subtasks'] }),
      ]),
    });
  });

  it('allows To Do → Ready with an assigned worker and Definition of Done', async () => {
    const task = await service.createTask({ title: 'Ready shaped work', status: 'todo' });

    const updated = await service.updateTask(task.id, {
      status: 'ready',
      assignedWorker: 'hermes:spark',
      description: 'Definition of Done:\n- User can verify the finished artifact.',
    });

    expect(updated.status).toBe('ready');
    expect(updated.assignedWorker).toBe('hermes:spark');
  });

  it('blocks transitions into Blocked without a first-class blocked reason', async () => {
    const task = await service.createTask({
      title: 'Blocked without context',
      status: 'in-progress',
    });

    await expect(service.updateTask(task.id, { status: 'blocked' })).rejects.toMatchObject({
      message: 'Blocked tasks require a first-class blocked reason',
      details: expect.arrayContaining([
        expect.objectContaining({ code: 'BLOCKED_REASON_REQUIRED', path: ['blockedReason'] }),
      ]),
    });
  });

  it('allows transitions into Blocked with category and note', async () => {
    const task = await service.createTask({ title: 'Blocked with context', status: 'in-progress' });

    const updated = await service.updateTask(task.id, {
      status: 'blocked',
      blockedReason: {
        category: 'technical-snag',
        note: 'Waiting for a reproducible fixture from the failing environment.',
      },
    });

    expect(updated.status).toBe('blocked');
    expect(updated.blockedReason).toEqual({
      category: 'technical-snag',
      note: 'Waiting for a reproducible fixture from the failing environment.',
    });
  });

  it('blocks transitions into Done without completion comment, deliverable, and verification evidence', async () => {
    const task = await service.createTask({
      title: 'Done without evidence',
      status: 'in-progress',
    });

    await expect(service.updateTask(task.id, { status: 'done' })).rejects.toMatchObject({
      message:
        'Done requires a completion comment, deliverable/artifact, and verification note/check',
      details: expect.arrayContaining([
        expect.objectContaining({ code: 'COMPLETION_COMMENT_REQUIRED', path: ['comments'] }),
        expect.objectContaining({ code: 'DELIVERABLE_REQUIRED', path: ['deliverables'] }),
        expect.objectContaining({
          code: 'VERIFICATION_NOTE_REQUIRED',
          path: ['verificationSteps'],
        }),
      ]),
    });
  });

  it('allows transitions into Done with completion comment, deliverable, and checked verification step', async () => {
    const task = await service.createTask({ title: 'Done with evidence', status: 'in-progress' });

    const updated = await service.updateTask(task.id, {
      status: 'done',
      comments: [
        {
          id: 'comment_complete',
          author: 'hermes:scribe',
          text: 'Completed implementation and handoff summary for reviewer.',
          timestamp: '2026-05-13T12:00:00.000Z',
        },
      ],
      deliverables: [
        {
          id: 'deliverable_patch',
          title: 'Implementation patch',
          type: 'code',
          path: 'server/src/services/task-service.ts',
          status: 'attached',
          created: '2026-05-13T12:00:00.000Z',
        },
      ],
      verificationSteps: [
        {
          id: 'verification_targeted_tests',
          description: 'Targeted service tests pass',
          checked: true,
          checkedAt: '2026-05-13T12:05:00.000Z',
        },
      ],
    });

    expect(updated.status).toBe('done');
    expect(updated.deliverables).toHaveLength(1);
    expect(updated.verificationSteps?.[0]?.checked).toBe(true);
  });
});
