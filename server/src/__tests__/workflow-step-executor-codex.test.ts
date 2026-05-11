import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

const mockRunStreamed = vi.fn();
const mockStartThread = vi.fn();
const mockResumeThread = vi.fn();

vi.mock('@openai/codex-sdk', () => ({
  Codex: class {
    startThread = mockStartThread;
    resumeThread = mockResumeThread;
  },
}));

vi.mock('../services/tool-policy-service.js', () => ({
  getToolPolicyService: () => ({
    getToolFilterForRole: vi.fn().mockResolvedValue({ allowed: ['*'], denied: [] }),
  }),
}));

import { WorkflowStepExecutor } from '../services/workflow-step-executor.js';
import type { WorkflowRun, WorkflowStep } from '../types/workflow.js';

async function* codexEvents() {
  yield { type: 'thread.started', thread_id: 'thread_test_123' };
  yield {
    type: 'item.completed',
    item: { id: 'item_1', type: 'agent_message', text: 'Implemented workflow Codex step.' },
  };
  yield {
    type: 'turn.completed',
    usage: {
      input_tokens: 10,
      cached_input_tokens: 0,
      output_tokens: 20,
      reasoning_output_tokens: 5,
    },
  };
}

describe('WorkflowStepExecutor Codex integration', () => {
  let tmpDir: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'workflow-codex-'));
    mockRunStreamed.mockResolvedValue({ events: codexEvents() });
    mockStartThread.mockReturnValue({ runStreamed: mockRunStreamed });
    mockResumeThread.mockReturnValue({ runStreamed: mockRunStreamed });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('executes Codex workflow agent steps and records the thread session', async () => {
    const executor = new WorkflowStepExecutor(tmpDir);
    const step: WorkflowStep = {
      id: 'implement',
      name: 'Implement',
      type: 'agent',
      agent: 'codex',
      input: 'Work on {{task.title}}',
      output: { file: 'implement.md' },
      acceptance_criteria: ['STATUS: done'],
    };
    const run: WorkflowRun = {
      id: 'run_1234567890_abcdef',
      workflowId: 'wf-codex',
      workflowVersion: 1,
      status: 'running',
      context: {
        task: {
          id: 'task_1',
          title: 'Codex workflow support',
          git: { worktreePath: tmpDir },
        },
        workflow: {
          agents: [
            {
              id: 'codex',
              name: 'Codex',
              role: 'implementer',
              provider: 'codex-sdk',
              model: 'gpt-5.5',
              description: 'Codex implementer',
            },
          ],
        },
        _sessions: {},
      },
      startedAt: new Date().toISOString(),
      steps: [{ stepId: 'implement', status: 'running', retries: 0 }],
    };

    const result = await executor.executeStep(step, run);

    expect(mockStartThread).toHaveBeenCalledWith(
      expect.objectContaining({
        workingDirectory: tmpDir,
        sandboxMode: 'workspace-write',
        model: 'gpt-5.5',
      })
    );
    expect(mockRunStreamed).toHaveBeenCalledWith('Work on Codex workflow support');
    expect(run.context._sessions).toMatchObject({ codex: 'thread_test_123' });
    expect(result.output).toContain('Implemented workflow Codex step.');
    expect(result.outputPath).toContain('implement.md');
  });
});
