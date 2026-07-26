import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentStatus } from '../../services/clawdbot-agent-service.js';
import { RunTerminalController } from '../../routes/run-terminals.js';
import {
  RunTerminalExecuteRequestSchema,
  RunTerminalOutputQuerySchema,
  RunTerminalWaitManyRequestSchema,
  RunTerminalWaitRequestSchema,
} from '../../schemas/run-terminal-schemas.js';

const workspaceId = 'workspace-871';
const taskId = 'task-871';
const attemptId = 'attempt-871';
const handleId = 'terminal-871';

function activeStatus(): AgentStatus {
  return {
    attemptId,
    taskEnvelope: {
      workspace: { workspaceId },
    },
  } as AgentStatus;
}

function createFixture() {
  const terminals = {
    assertScope: vi.fn(() => ({ id: handleId })),
    list: vi.fn(() => [{ id: handleId }]),
    output: vi.fn(() => ({ handleId, chunks: [] })),
    wait: vi.fn(async () => ({ completed: false, timedOut: true, handle: { id: handleId } })),
    waitAny: vi.fn(async () => ({ mode: 'any', timedOut: true })),
    waitAll: vi.fn(async () => ({ mode: 'all', timedOut: true })),
    detach: vi.fn(async () => ({ id: handleId, startMode: 'background' })),
    terminate: vi.fn(async () => ({ handle: { id: handleId, state: 'terminated' } })),
  };
  const activeRuns = {
    executeRunTerminal: vi.fn(async () => ({
      status: 'approval-required' as const,
      approval: { id: 'runapproval-terminal-871' },
    })),
    getAgentStatus: vi.fn(async () => activeStatus()),
  };
  const controller = new RunTerminalController({
    terminals,
    activeRuns,
  });
  return { controller, terminals, activeRuns };
}

describe('run terminal routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lists and reads output only through the active attempt scope', async () => {
    const { controller, terminals, activeRuns } = createFixture();

    const list = await controller.list(taskId, attemptId);
    const output = await controller.output(taskId, attemptId, handleId, 4, 20);

    expect(list).toEqual([{ id: handleId }]);
    expect(output).toEqual({ handleId, chunks: [] });
    expect(activeRuns.getAgentStatus).toHaveBeenCalledWith(taskId);
    expect(terminals.list).toHaveBeenCalledWith(workspaceId, taskId, attemptId);
    expect(terminals.assertScope).toHaveBeenCalledWith(handleId, workspaceId, taskId, attemptId);
    expect(terminals.output).toHaveBeenCalledWith(handleId, 4, 20);
  });

  it('submits an exact idempotent execution request through the active run service', async () => {
    const { controller, activeRuns } = createFixture();
    const request = RunTerminalExecuteRequestSchema.parse({
      requestId: 'terminal-request-871',
      command: 'pnpm',
      args: ['test', '--runInBand'],
      mode: 'pipe',
      startMode: 'background',
      cwd: '.',
      environmentKeys: ['PATH'],
    });

    await expect(controller.execute(taskId, attemptId, request)).resolves.toMatchObject({
      status: 'approval-required',
      approval: { id: 'runapproval-terminal-871' },
    });
    expect(activeRuns.executeRunTerminal).toHaveBeenCalledWith(taskId, attemptId, request);
  });

  it('coordinates and controls scoped handles with bounded requests', async () => {
    const { controller, terminals } = createFixture();

    await controller.wait(taskId, attemptId, handleId, 25);
    await controller.waitAny(taskId, attemptId, [handleId, 'terminal-872'], 50);
    await controller.waitAll(taskId, attemptId, [handleId], 50);
    await controller.detach(taskId, attemptId, handleId);
    await controller.terminate(taskId, attemptId, handleId);

    expect(terminals.wait).toHaveBeenCalledWith(handleId, 25);
    expect(terminals.waitAny).toHaveBeenCalledWith([handleId, 'terminal-872'], 50);
    expect(terminals.waitAll).toHaveBeenCalledWith([handleId], 50);
    expect(terminals.detach).toHaveBeenCalledWith(handleId);
    expect(terminals.terminate).toHaveBeenCalledWith(handleId);
    expect(terminals.assertScope).toHaveBeenCalledWith(
      'terminal-872',
      workspaceId,
      taskId,
      attemptId
    );
  });

  it('rejects stale attempts and duplicate or unbounded waits before control', async () => {
    const { controller, terminals, activeRuns } = createFixture();
    activeRuns.getAgentStatus.mockResolvedValueOnce({
      ...activeStatus(),
      attemptId: 'attempt-new',
    });

    await expect(controller.get(taskId, attemptId, handleId)).rejects.toThrow(
      'Active run terminal scope not found'
    );
    const duplicate = RunTerminalWaitManyRequestSchema.safeParse({
      handleIds: [handleId, handleId],
      timeoutMs: 10,
    });
    const unbounded = RunTerminalWaitRequestSchema.safeParse({ timeoutMs: 300_001 });
    const duplicateEnvironment = RunTerminalExecuteRequestSchema.safeParse({
      requestId: 'terminal-request-duplicate-env',
      command: 'pnpm',
      args: ['test'],
      mode: 'pipe',
      startMode: 'background',
      environmentKeys: ['PATH', 'PATH'],
    });
    const defaults = RunTerminalOutputQuerySchema.parse({});

    expect(duplicate.success).toBe(false);
    expect(unbounded.success).toBe(false);
    expect(duplicateEnvironment.success).toBe(false);
    expect(defaults).toEqual({ afterCursor: 0, limit: 200 });
    expect(terminals.waitAny).not.toHaveBeenCalled();
    expect(terminals.wait).not.toHaveBeenCalled();
  });
});
