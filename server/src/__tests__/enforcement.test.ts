import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { execFile as execFileCallback } from 'child_process';
import { promisify } from 'util';
import { TaskService } from '../services/task-service.js';
import { ConfigService } from '../services/config-service.js';
import { DEFAULT_FEATURE_SETTINGS } from '@veritas-kanban/shared';
import { reviewScoresSchema } from '../routes/tasks.js';

const execFile = promisify(execFileCallback);
const legacyGatewayKey = ['CLAWDBOT', 'GATEWAY'].join('_');
const DISCIPLINE_ENV_KEYS = [
  legacyGatewayKey,
  'HERMES_API_SERVER_URL',
  'HERMES_GATEWAY_URL',
] as const;

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

async function git(cwd: string, args: string[]) {
  await execFile('git', args, { cwd });
}

async function createCommittedGitRepo(root: string): Promise<string> {
  const repoPath = path.join(root, 'repo');
  await fs.mkdir(repoPath, { recursive: true });
  await git(repoPath, ['init']);
  await git(repoPath, ['config', 'user.email', 'veritas-test@example.invalid']);
  await git(repoPath, ['config', 'user.name', 'Veritas Test']);
  await fs.writeFile(path.join(repoPath, 'README.md'), '# test\n', 'utf-8');
  await git(repoPath, ['add', 'README.md']);
  await git(repoPath, ['commit', '-m', 'initial commit']);
  return repoPath;
}

function restoreEnvSnapshot(snapshot: Record<string, string | undefined>) {
  for (const key of DISCIPLINE_ENV_KEYS) {
    const original = snapshot[key];
    if (original === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = original;
    }
  }
}

describe('Enforcement gates', () => {
  let service: TaskService;
  let testRoot: string;
  let tasksDir: string;
  let archiveDir: string;
  let envSnapshot: Record<string, string | undefined>;

  beforeEach(async () => {
    envSnapshot = Object.fromEntries(
      DISCIPLINE_ENV_KEYS.map((key) => [key, process.env[key]])
    ) as Record<string, string | undefined>;
    for (const key of DISCIPLINE_ENV_KEYS) {
      delete process.env[key];
    }

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
    restoreEnvSnapshot(envSnapshot);
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

  it('blocks code task completion when the task git worktree has uncommitted changes', async () => {
    vi.spyOn(ConfigService.prototype, 'getFeatureSettings').mockResolvedValue(
      buildSettings({ enforcement: { reviewGate: false, closingComments: false } }) as any
    );
    service = new TaskService({ tasksDir, archiveDir });

    const repoPath = await createCommittedGitRepo(testRoot);
    await fs.writeFile(path.join(repoPath, 'README.md'), '# changed\n', 'utf-8');

    const task = await service.createTask({ title: 'Dirty worktree task', type: 'code' });
    await service.updateTask(task.id, {
      git: { repo: repoPath, branch: 'feature/test', baseBranch: 'main', worktreePath: repoPath },
    });

    await expect(service.updateTask(task.id, { status: 'done' })).rejects.toThrow(
      /Git Discipline Gate.*dirty worktree/
    );
  });

  it('ignores legacy gateway env aliases so they cannot become runtime authority', async () => {
    vi.spyOn(ConfigService.prototype, 'getFeatureSettings').mockResolvedValue(
      buildSettings({ enforcement: { reviewGate: false, closingComments: false } }) as any
    );
    process.env[legacyGatewayKey] = 'http://127.0.0.1:9';
    service = new TaskService({ tasksDir, archiveDir });

    const task = await service.createTask({ title: 'Legacy runtime alias ignored' });
    const updated = await service.updateTask(task.id, { status: 'done' });

    expect(updated.status).toBe('done');
  });

  it('validates reviewScores length and range', () => {
    expect(reviewScoresSchema.safeParse([10, 10, 10, 10]).success).toBe(true);
    expect(reviewScoresSchema.safeParse([10, 10, 10]).success).toBe(false);
    expect(reviewScoresSchema.safeParse([10, 10, 10, 11]).success).toBe(false);
    expect(reviewScoresSchema.safeParse([-1, 10, 10, 10]).success).toBe(false);
  });
});
