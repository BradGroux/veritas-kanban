import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

const mockRunStreamed = vi.fn();
const mockStartThread = vi.fn();
const mockResumeThread = vi.fn();
const mockRecordGovernanceTrace = vi.fn();
const mockGetToolFilterForRole = vi.fn();
const mockCodexConstructorOptions = vi.fn();

vi.mock('@openai/codex-sdk', () => ({
  Codex: class {
    constructor(options: unknown) {
      mockCodexConstructorOptions(options);
    }

    startThread = mockStartThread;
    resumeThread = mockResumeThread;
  },
}));

vi.mock('../services/tool-policy-service.js', () => ({
  getToolPolicyService: () => ({
    getToolFilterForRole: mockGetToolFilterForRole,
  }),
}));

vi.mock('../services/governance-trace-service.js', () => ({
  getGovernanceTraceService: () => ({
    record: mockRecordGovernanceTrace,
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
    mockRecordGovernanceTrace.mockResolvedValue({ id: 'govtrace_1' });
    mockGetToolFilterForRole.mockResolvedValue({});
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

  it('passes only a minimal environment to Codex workflow sessions', async () => {
    const originalEnv = {
      GITHUB_TOKEN: process.env.GITHUB_TOKEN,
      DATABASE_URL: process.env.DATABASE_URL,
      VERITAS_ADMIN_KEY: process.env.VERITAS_ADMIN_KEY,
      OPENAI_API_KEY: process.env.OPENAI_API_KEY,
      VK_API_URL: process.env.VK_API_URL,
    };
    process.env.GITHUB_TOKEN = 'test-github-token';
    process.env.DATABASE_URL = 'postgres://test-secret';
    process.env.VERITAS_ADMIN_KEY = 'test-admin-key';
    process.env.OPENAI_API_KEY = 'test-openai-key';
    process.env.VK_API_URL = 'http://127.0.0.1:3001';

    try {
      const executor = new WorkflowStepExecutor(tmpDir);
      const step: WorkflowStep = {
        id: 'implement',
        name: 'Implement',
        type: 'agent',
        agent: 'codex',
        input: 'Work on {{task.title}}',
        output: { file: 'implement.md' },
      };
      const run: WorkflowRun = {
        id: 'run_1234567890_envsafe',
        workflowId: 'wf-codex',
        workflowVersion: 1,
        status: 'running',
        context: {
          task: {
            id: 'task_1',
            title: 'Codex env safety',
            git: { worktreePath: tmpDir },
          },
          workflow: {
            agents: [
              {
                id: 'codex',
                name: 'Codex',
                role: 'developer',
                provider: 'codex-sdk',
                model: 'gpt-5.5',
                description: 'Codex developer',
              },
            ],
          },
          _sessions: {},
        },
        startedAt: new Date().toISOString(),
        steps: [{ stepId: 'implement', status: 'running', retries: 0 }],
      };

      await executor.executeStep(step, run);

      const env = (
        mockCodexConstructorOptions.mock.calls.at(-1)?.[0] as { env?: Record<string, string> }
      ).env;
      expect(env).toMatchObject({
        OPENAI_API_KEY: 'test-openai-key',
        VK_API_URL: 'http://127.0.0.1:3001',
      });
      expect(env?.GITHUB_TOKEN).toBeUndefined();
      expect(env?.DATABASE_URL).toBeUndefined();
      expect(env?.VERITAS_ADMIN_KEY).toBeUndefined();
    } finally {
      for (const [key, value] of Object.entries(originalEnv)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    }
  });

  it('blocks Codex workflow agent steps when role tool policy is restricted', async () => {
    mockGetToolFilterForRole.mockResolvedValueOnce({
      allowed: ['Read'],
      denied: ['Write', 'exec'],
    });

    const executor = new WorkflowStepExecutor(tmpDir);
    const step: WorkflowStep = {
      id: 'plan',
      name: 'Plan',
      type: 'agent',
      agent: 'codex',
      input: 'Plan {{task.title}}',
      output: { file: 'plan.md' },
    };
    const run: WorkflowRun = {
      id: 'run_1234567890_restricted',
      workflowId: 'wf-codex-restricted',
      workflowVersion: 1,
      status: 'running',
      context: {
        task: {
          id: 'task_1',
          title: 'Restricted Codex workflow',
          git: { worktreePath: tmpDir },
        },
        workflow: {
          agents: [
            {
              id: 'codex',
              name: 'Codex',
              role: 'planner',
              provider: 'codex-sdk',
              model: 'gpt-5.5',
              description: 'Restricted Codex planner',
            },
          ],
        },
        _sessions: {},
      },
      startedAt: new Date().toISOString(),
      steps: [{ stepId: 'plan', status: 'running', retries: 0 }],
    };

    await expect(executor.executeStep(step, run)).rejects.toThrow(
      'cannot enforce restricted tool policy'
    );
    expect(mockStartThread).not.toHaveBeenCalled();
    expect(mockResumeThread).not.toHaveBeenCalled();
  });

  it('records governance traces for workflow gate decisions', async () => {
    const executor = new WorkflowStepExecutor(tmpDir);
    const step: WorkflowStep = {
      id: 'approval-gate',
      name: 'Approval Gate',
      type: 'gate',
      condition: '{{review.decision == "approved"}}',
      on_false: {
        escalate_to: 'human',
        escalate_message: 'Review approval is required',
      },
    };
    const run: WorkflowRun = {
      id: 'run_1234567890_gate',
      workflowId: 'wf-gates',
      workflowVersion: 1,
      taskId: 'task_1',
      status: 'running',
      context: {
        review: { decision: 'pending' },
      },
      startedAt: new Date().toISOString(),
      steps: [{ stepId: 'approval-gate', status: 'running', retries: 0 }],
    };

    await expect(executor.executeStep(step, run)).rejects.toThrow('Review approval is required');
    expect(mockRecordGovernanceTrace).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'workflow-gate',
        outcome: 'approval-required',
        subject: expect.objectContaining({
          workflowId: 'wf-gates',
          runId: 'run_1234567890_gate',
          taskId: 'task_1',
          stepId: 'approval-gate',
          actionType: 'workflow.gate',
        }),
      })
    );
  });
});
