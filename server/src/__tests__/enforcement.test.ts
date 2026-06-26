import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { TaskService } from '../services/task-service.js';
import { ConfigService } from '../services/config-service.js';
import { DEFAULT_FEATURE_SETTINGS } from '@veritas-kanban/shared';
import { reviewScoresSchema } from '../routes/tasks.js';

function buildSettings(overrides: Partial<typeof DEFAULT_FEATURE_SETTINGS> = {}) {
  return {
    ...DEFAULT_FEATURE_SETTINGS,
    tasks: { ...DEFAULT_FEATURE_SETTINGS.tasks, ...(overrides as any).tasks },
    enforcement: {
      ...DEFAULT_FEATURE_SETTINGS.enforcement,
      ...(overrides as any).enforcement,
    },
  } as typeof DEFAULT_FEATURE_SETTINGS;
}

describe('Enforcement gates', () => {
  let service: TaskService;
  let testRoot: string;
  let tasksDir: string;
  let archiveDir: string;

  beforeEach(async () => {
    const uniqueSuffix = Math.random().toString(36).substring(7);
    testRoot = path.join(os.tmpdir(), `veritas-test-enforcement-${uniqueSuffix}`);
    tasksDir = path.join(testRoot, 'active');
    archiveDir = path.join(testRoot, 'archive');

    await fs.mkdir(tasksDir, { recursive: true });
    await fs.mkdir(archiveDir, { recursive: true });
  });

  afterEach(async () => {
    service?.dispose();
    vi.restoreAllMocks();
    if (testRoot) {
      await fs.rm(testRoot, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('does not enforce review gate when disabled', async () => {
    vi.spyOn(ConfigService.prototype, 'getFeatureSettings').mockResolvedValue(
      buildSettings({ enforcement: { reviewGate: false } }) as any
    );
    service = new TaskService({ tasksDir, archiveDir });

    const task = await service.createTask({ title: 'Review gate disabled' });
    const updated = await service.updateTask(task.id, { status: 'done' });

    expect(updated.status).toBe('done');
  });

  it('enforces review gate when enabled', async () => {
    vi.spyOn(ConfigService.prototype, 'getFeatureSettings').mockResolvedValue(
      buildSettings({ enforcement: { reviewGate: true } }) as any
    );
    service = new TaskService({ tasksDir, archiveDir });

    const task = await service.createTask({ title: 'Review gate enabled', type: 'code' });

    await expect(service.updateTask(task.id, { status: 'done' })).rejects.toThrow(
      /Review Gate.*requires all four review scores/
    );
  });

  it('does not enforce review gate for non-code task types', async () => {
    vi.spyOn(ConfigService.prototype, 'getFeatureSettings').mockResolvedValue(
      buildSettings({ enforcement: { reviewGate: true } }) as any
    );
    service = new TaskService({ tasksDir, archiveDir });

    const contentTask = await service.createTask({
      title: 'Content task',
      type: 'content',
    });
    const researchTask = await service.createTask({
      title: 'Research task',
      type: 'research',
    });

    // Should complete without review scores
    const updatedContent = await service.updateTask(contentTask.id, { status: 'done' });
    const updatedResearch = await service.updateTask(researchTask.id, { status: 'done' });

    expect(updatedContent.status).toBe('done');
    expect(updatedResearch.status).toBe('done');
  });

  it('does not enforce closing comments when disabled', async () => {
    vi.spyOn(ConfigService.prototype, 'getFeatureSettings').mockResolvedValue(
      buildSettings({ enforcement: { closingComments: false } }) as any
    );
    service = new TaskService({ tasksDir, archiveDir });

    const task = await service.createTask({ title: 'Closing comments disabled' });
    const updated = await service.updateTask(task.id, { status: 'done' });

    expect(updated.status).toBe('done');
  });

  it('blocks completion when closing comments are required', async () => {
    vi.spyOn(ConfigService.prototype, 'getFeatureSettings').mockResolvedValue(
      buildSettings({ enforcement: { closingComments: true } }) as any
    );
    service = new TaskService({ tasksDir, archiveDir });

    const task = await service.createTask({ title: 'Closing comments enabled' });

    await expect(service.updateTask(task.id, { status: 'done' })).rejects.toThrow(
      /Closing Comments:/
    );
  });

  it('blocks completion when a required ceremony is pending', async () => {
    vi.spyOn(ConfigService.prototype, 'getFeatureSettings').mockResolvedValue(
      buildSettings({ enforcement: { ceremonyDesignReview: 'block' } }) as any
    );
    const ceremonyService = {
      evaluateTaskCompletion: vi.fn().mockResolvedValue({
        allowed: false,
        mode: 'block',
        pending: [
          {
            id: 'ceremony_1',
            kind: 'design_review',
            title: 'Design review required before completion',
            reason: 'Task is high-risk, multi-agent, or review-mode work.',
            requiredArtifacts: ['decision-packet', 'risk-list', 'action-items'],
            dueAt: '2026-06-27T12:00:00.000Z',
          },
        ],
        warnings: [],
        blockedReasons: [
          'Design review required before completion: Task is high-risk, multi-agent, or review-mode work.',
        ],
      }),
    };
    service = new TaskService({ tasksDir, archiveDir, ceremonyService: ceremonyService as any });

    const task = await service.createTask({ title: 'Ceremony blocked', type: 'code' });

    await expect(service.updateTask(task.id, { status: 'done' })).rejects.toThrow(
      /Ceremony Enforcement:/
    );
    expect(ceremonyService.evaluateTaskCompletion).toHaveBeenCalledWith(
      expect.objectContaining({ id: task.id, status: 'done' }),
      expect.objectContaining({ ceremonyDesignReview: 'block' })
    );
  });

  it('allows completion when ceremony enforcement only warns', async () => {
    vi.spyOn(ConfigService.prototype, 'getFeatureSettings').mockResolvedValue(
      buildSettings({ enforcement: { ceremonyDesignReview: 'warn' } }) as any
    );
    const ceremonyService = {
      evaluateTaskCompletion: vi.fn().mockResolvedValue({
        allowed: true,
        mode: 'warn',
        pending: [
          {
            id: 'ceremony_1',
            kind: 'design_review',
            title: 'Design review required before completion',
            reason: 'Task is high-risk, multi-agent, or review-mode work.',
            requiredArtifacts: ['decision-packet', 'risk-list', 'action-items'],
          },
        ],
        warnings: [
          'Design review required before completion: Task is high-risk, multi-agent, or review-mode work.',
        ],
        blockedReasons: [],
      }),
    };
    service = new TaskService({ tasksDir, archiveDir, ceremonyService: ceremonyService as any });

    const task = await service.createTask({ title: 'Ceremony warned', type: 'code' });
    const updated = await service.updateTask(task.id, { status: 'done' });

    expect(updated.status).toBe('done');
    expect(ceremonyService.evaluateTaskCompletion).toHaveBeenCalledOnce();
  });

  it('skips enforcement when enforcement settings are missing', async () => {
    vi.spyOn(ConfigService.prototype, 'getFeatureSettings').mockResolvedValue({
      ...DEFAULT_FEATURE_SETTINGS,
      enforcement: undefined,
    } as any);
    service = new TaskService({ tasksDir, archiveDir });

    const task = await service.createTask({ title: 'No enforcement settings' });
    const updated = await service.updateTask(task.id, { status: 'done' });

    expect(updated.status).toBe('done');
  });

  it('emits auto-telemetry only when enabled', async () => {
    const telemetry = { emit: vi.fn().mockResolvedValue({}) } as any;
    vi.spyOn(ConfigService.prototype, 'getFeatureSettings').mockResolvedValue(
      buildSettings({ enforcement: { autoTelemetry: true } }) as any
    );
    service = new TaskService({ tasksDir, archiveDir, telemetryService: telemetry });

    const task = await service.createTask({ title: 'Auto telemetry enabled' });
    await service.updateTask(task.id, { status: 'in-progress' });
    await service.updateTask(task.id, { status: 'done' });

    expect(telemetry.emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'run.started', taskId: task.id })
    );
    expect(telemetry.emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'run.completed', taskId: task.id })
    );
  });

  it('does not emit auto-telemetry when disabled', async () => {
    const telemetry = { emit: vi.fn().mockResolvedValue({}) } as any;
    vi.spyOn(ConfigService.prototype, 'getFeatureSettings').mockResolvedValue(
      buildSettings({ enforcement: { autoTelemetry: false } }) as any
    );
    service = new TaskService({ tasksDir, archiveDir, telemetryService: telemetry });

    const task = await service.createTask({ title: 'Auto telemetry disabled' });
    await service.updateTask(task.id, { status: 'in-progress' });

    expect(telemetry.emit).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'run.started' })
    );
  });

  it('auto-starts and stops time tracking when enabled', async () => {
    vi.spyOn(ConfigService.prototype, 'getFeatureSettings').mockResolvedValue(
      buildSettings({ enforcement: { autoTimeTracking: true } }) as any
    );
    service = new TaskService({ tasksDir, archiveDir });

    const startSpy = vi
      .spyOn(service, 'startTimer')
      .mockResolvedValue({ entries: [], totalSeconds: 0, isRunning: true });
    const stopSpy = vi
      .spyOn(service, 'stopTimer')
      .mockResolvedValue({ entries: [], totalSeconds: 0, isRunning: false });

    const task = await service.createTask({ title: 'Auto time tracking enabled' });
    await service.updateTask(task.id, { status: 'in-progress' });
    await service.updateTask(task.id, {
      status: 'done',
      timeTracking: { entries: [], totalSeconds: 0, isRunning: true },
    });

    expect(startSpy).toHaveBeenCalled();
    expect(stopSpy).toHaveBeenCalled();
  });

  it('does not auto-start time tracking when disabled', async () => {
    vi.spyOn(ConfigService.prototype, 'getFeatureSettings').mockResolvedValue(
      buildSettings({ enforcement: { autoTimeTracking: false } }) as any
    );
    service = new TaskService({ tasksDir, archiveDir });

    const startSpy = vi.spyOn(service, 'startTimer').mockResolvedValue({
      entries: [],
      totalSeconds: 0,
      isRunning: false,
    });

    const task = await service.createTask({ title: 'Auto time tracking disabled' });
    await service.updateTask(task.id, { status: 'in-progress' });

    expect(startSpy).not.toHaveBeenCalled();
  });

  it('validates reviewScores length and range', () => {
    expect(reviewScoresSchema.safeParse([10, 10, 10, 10]).success).toBe(true);
    expect(reviewScoresSchema.safeParse([10, 10, 10]).success).toBe(false);
    expect(reviewScoresSchema.safeParse([10, 10, 10, 11]).success).toBe(false);
    expect(reviewScoresSchema.safeParse([-1, 10, 10, 10]).success).toBe(false);
  });
});
