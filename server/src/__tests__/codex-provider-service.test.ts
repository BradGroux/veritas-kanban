import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'events';
import { PassThrough } from 'stream';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const {
  mockSpawn,
  mockGetConfig,
  mockGetTask,
  mockUpdateTask,
  mockTelemetryEmit,
  mockLogActivity,
  mockStartTrace,
  mockStartStep,
  mockEndStep,
  mockCompleteTrace,
} = vi.hoisted(() => ({
  mockSpawn: vi.fn(),
  mockGetConfig: vi.fn(),
  mockGetTask: vi.fn(),
  mockUpdateTask: vi.fn(),
  mockTelemetryEmit: vi.fn(),
  mockLogActivity: vi.fn(),
  mockStartTrace: vi.fn(),
  mockStartStep: vi.fn(),
  mockEndStep: vi.fn(),
  mockCompleteTrace: vi.fn(),
}));

vi.mock('child_process', () => ({
  spawn: mockSpawn,
}));

vi.mock('../services/config-service.js', () => ({
  ConfigService: function () {
    return { getConfig: mockGetConfig };
  },
}));

vi.mock('../services/task-service.js', () => ({
  TaskService: function () {
    return { getTask: mockGetTask, updateTask: mockUpdateTask };
  },
}));

vi.mock('../services/telemetry-service.js', () => ({
  getTelemetryService: () => ({ emit: mockTelemetryEmit, getConfig: () => ({ traces: true }) }),
}));

vi.mock('../services/activity-service.js', () => ({
  activityService: { logActivity: mockLogActivity },
}));

vi.mock('../services/trace-service.js', () => ({
  getTraceService: () => ({
    startTrace: mockStartTrace,
    startStep: mockStartStep,
    endStep: mockEndStep,
    completeTrace: mockCompleteTrace,
  }),
}));

vi.mock('../services/agent-routing-service.js', () => ({
  getAgentRoutingService: () => ({
    resolveAgent: vi.fn().mockResolvedValue({ agent: 'codex', reason: 'test' }),
  }),
}));

vi.mock('../services/circuit-registry.js', () => ({
  getBreaker: () => ({ execute: (fn: () => Promise<void>) => fn() }),
}));

import { ClawdbotAgentService } from '../services/clawdbot-agent-service.js';
import type { Task } from '@veritas-kanban/shared';

const fixtureDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'codex');

function createFakeChild(fixturePath: string, exitCode = 0) {
  const child = new EventEmitter() as EventEmitter & {
    stdout: PassThrough;
    stderr: PassThrough;
    pid: number;
    killed: boolean;
    kill: ReturnType<typeof vi.fn>;
  };
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.pid = 12345;
  child.killed = false;
  child.kill = vi.fn(() => {
    child.killed = true;
    child.emit('close', 143, 'SIGTERM');
    return true;
  });

  setImmediate(async () => {
    child.stdout.write(await fs.readFile(fixturePath, 'utf-8'));
    child.stdout.end();
    setTimeout(() => child.emit('close', exitCode, null), 10);
  });

  return child;
}

async function waitFor(assertion: () => void): Promise<void> {
  const started = Date.now();
  let lastError: unknown;
  while (Date.now() - started < 3000) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
  throw lastError;
}

describe('ClawdbotAgentService Codex providers', () => {
  let tmpDir: string;
  let task: Task;

  beforeEach(async () => {
    vi.clearAllMocks();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-provider-'));
    task = {
      id: 'task_codex_fixture',
      title: 'Codex fixture task',
      description: 'Exercise mocked Codex JSONL.',
      type: 'code',
      status: 'todo',
      priority: 'medium',
      agent: 'codex',
      project: 'veritas',
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
      git: { worktreePath: tmpDir },
    } as Task;

    mockGetTask.mockResolvedValue(task);
    mockUpdateTask.mockImplementation(async (_id, update) => {
      task = { ...task, ...update } as Task;
      return task;
    });
    mockGetConfig.mockResolvedValue({
      agents: [
        {
          type: 'codex',
          name: 'OpenAI Codex',
          command: 'codex',
          args: ['exec', '--json'],
          enabled: true,
          provider: 'codex-cli',
          model: 'gpt-5.5',
        },
      ],
    });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('runs the Codex CLI adapter against mocked JSONL and records telemetry', async () => {
    mockSpawn.mockReturnValue(createFakeChild(path.join(fixtureDir, 'success.jsonl')));
    const service = new ClawdbotAgentService();
    (service as any).logsDir = tmpDir;

    const status = await service.startAgent(task.id, 'codex');

    expect(status.status).toBe('running');
    expect(mockSpawn).toHaveBeenCalledWith(
      'codex',
      expect.arrayContaining(['exec', '--json', '--sandbox', 'workspace-write']),
      expect.objectContaining({ cwd: tmpDir, shell: false })
    );

    await waitFor(() => {
      expect(mockUpdateTask).toHaveBeenCalledWith(
        task.id,
        expect.objectContaining({ status: 'done' })
      );
    });
    expect(mockTelemetryEmit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'run.tokens',
        inputTokens: 12,
        outputTokens: 8,
        totalTokens: 20,
        model: 'gpt-5.5',
      })
    );
    expect(mockLogActivity).toHaveBeenCalledWith(
      'agent_completed',
      task.id,
      task.title,
      expect.objectContaining({ provider: 'codex-cli', success: true }),
      'codex'
    );
  });

  it('maps Codex file events to task deliverables linked to the attempt', async () => {
    const service = new ClawdbotAgentService();
    (service as any).logsDir = tmpDir;
    const logPath = path.join(tmpDir, 'codex.md');
    await fs.writeFile(logPath, '# log\n');

    (service as any).handleCodexEvent(
      {
        type: 'item.completed',
        item: {
          type: 'file_change',
          file_path: 'server/src/services/codex-provider.ts',
        },
      },
      logPath,
      task,
      'attempt_fixture',
      { type: 'codex', provider: 'codex-cli' }
    );

    await waitFor(() => {
      expect(mockUpdateTask).toHaveBeenCalledWith(
        task.id,
        expect.objectContaining({
          deliverables: [
            expect.objectContaining({
              path: 'server/src/services/codex-provider.ts',
              type: 'code',
              agent: 'codex',
              description: expect.stringContaining('attempt_fixture'),
            }),
          ],
        })
      );
    });
    expect(mockLogActivity).toHaveBeenCalledWith(
      'deliverable_added',
      task.id,
      task.title,
      expect.objectContaining({ attemptId: 'attempt_fixture', deliverableCount: 1 }),
      'codex'
    );
  });
});
