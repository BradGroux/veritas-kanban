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
import { providerRuntimeManifestFixture } from './fixtures/provider-runtime-manifest.js';

const runtimeManifestResolver = vi.fn();

function codexRuntimeManifest(capabilityStates = {}) {
  return providerRuntimeManifestFixture({
    provider: 'codex-sdk',
    capabilityStates: {
      'run.start': 'supported',
      'run.status': 'supported',
      'run.logs': 'supported',
      'run.complete': 'supported',
      'run.resume': 'advisory',
      'tool.calls': 'supported',
      'output.structured': 'supported',
      'usage.tokens': 'supported',
      'artifact.write': 'supported',
      'workspace.worktrees': 'supported',
      'filesystem.read': 'supported',
      'filesystem.write': 'supported',
      'network.disable': 'supported',
      'environment.allowlist': 'supported',
      ...capabilityStates,
    },
  });
}

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

function captureCodexCommandEnv() {
  return {
    VERITAS_CODEX_EXECUTABLE: process.env.VERITAS_CODEX_EXECUTABLE,
    CODEX_PATH: process.env.CODEX_PATH,
    VERITAS_ALLOW_UNSAFE_CODEX_COMMAND_OVERRIDES:
      process.env.VERITAS_ALLOW_UNSAFE_CODEX_COMMAND_OVERRIDES,
  };
}

function restoreCodexCommandEnv(env: ReturnType<typeof captureCodexCommandEnv>): void {
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
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
    runtimeManifestResolver.mockResolvedValue(codexRuntimeManifest());
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('executes Codex workflow agent steps and records the thread session', async () => {
    const persistRun = vi.fn().mockResolvedValue(undefined);
    const executor = new WorkflowStepExecutor(tmpDir, { runtimeManifestResolver, persistRun });
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
    expect(result.providerRuntimeManifest?.digest).toBe(
      run.steps[0].providerRuntimeManifest?.digest
    );
    expect(persistRun).toHaveBeenCalledWith(run);
    expect(persistRun.mock.invocationCallOrder[0]).toBeLessThan(
      mockStartThread.mock.invocationCallOrder[0]
    );
  });

  it('rejects providers that have no workflow execution adapter before probing or launch', async () => {
    const executor = new WorkflowStepExecutor(tmpDir, { runtimeManifestResolver });
    const step: WorkflowStep = {
      id: 'hermes-step',
      type: 'agent',
      agent: 'hermes',
      input: 'Run Hermes',
    };
    const run = {
      id: 'run_1234567890_hermes',
      workflowId: 'wf-hermes',
      workflowVersion: 1,
      status: 'running',
      context: {
        task: { id: 'task_1', title: 'Hermes', git: { worktreePath: tmpDir } },
        workflow: {
          agents: [
            {
              id: 'hermes',
              name: 'Hermes',
              role: 'implementer',
              provider: 'hermes-cli',
              description: 'Hermes workflow agent',
            },
          ],
        },
      },
      startedAt: new Date().toISOString(),
      steps: [{ stepId: 'hermes-step', status: 'running', retries: 0 }],
    } as WorkflowRun;

    await expect(executor.executeStep(step, run)).rejects.toThrow(
      'hermes-cli, which has no workflow execution adapter'
    );
    expect(runtimeManifestResolver).not.toHaveBeenCalled();
    expect(mockStartThread).not.toHaveBeenCalled();
  });

  it('requires artifact evidence because every agent step persists an output artifact', async () => {
    runtimeManifestResolver.mockResolvedValueOnce(
      codexRuntimeManifest({ 'artifact.write': 'unsupported' })
    );
    const executor = new WorkflowStepExecutor(tmpDir, { runtimeManifestResolver });
    const step: WorkflowStep = {
      id: 'artifact-step',
      type: 'agent',
      agent: 'codex',
      input: 'Produce output',
    };
    const run = {
      id: 'run_1234567890_artifact',
      workflowId: 'wf-artifact',
      workflowVersion: 1,
      status: 'running',
      context: {
        task: { id: 'task_1', title: 'Artifact', git: { worktreePath: tmpDir } },
      },
      startedAt: new Date().toISOString(),
      steps: [{ stepId: 'artifact-step', status: 'running', retries: 0 }],
    } as WorkflowRun;

    await expect(executor.executeStep(step, run)).rejects.toThrow('artifact.write');
    expect(mockStartThread).not.toHaveBeenCalled();
  });

  it('fails closed on tool, MCP, structured-output, usage, and artifact requirements', async () => {
    runtimeManifestResolver.mockResolvedValueOnce(
      codexRuntimeManifest({
        'tool.mcp': 'unknown',
        'output.structured': 'unsupported',
        'usage.tokens': 'unknown',
        'artifact.write': 'unsupported',
      })
    );
    mockGetToolFilterForRole.mockResolvedValue({ allowed: ['mcp__github__search'] });
    const executor = new WorkflowStepExecutor(tmpDir, { runtimeManifestResolver });
    const step: WorkflowStep = {
      id: 'governed',
      name: 'Governed',
      type: 'agent',
      agent: 'codex',
      input: 'Run governed work',
      output: { file: 'governed.json', schema: 'result/v1' },
    };
    const run = {
      id: 'run_1234567890_governed',
      workflowId: 'wf-codex',
      workflowVersion: 1,
      status: 'running',
      context: {
        task: { id: 'task_1', title: 'Governed', git: { worktreePath: tmpDir } },
        workflow: {
          agents: [
            {
              id: 'codex',
              name: 'Codex',
              role: 'implementer',
              provider: 'codex-sdk',
              description: 'Codex implementer',
              tools: ['mcp__github__search'],
            },
          ],
        },
      },
      budget: { enabled: true, policy: { limits: { totalTokens: 100 } } },
      startedAt: new Date().toISOString(),
      steps: [{ stepId: 'governed', status: 'running', retries: 0 }],
    } as unknown as WorkflowRun;

    await expect(executor.executeStep(step, run)).rejects.toMatchObject({
      statusCode: 409,
      details: {
        requiredCapabilities: expect.arrayContaining([
          'tool.calls',
          'tool.mcp',
          'output.structured',
          'usage.tokens',
          'artifact.write',
        ]),
      },
    });
    expect(mockStartThread).not.toHaveBeenCalled();
  });

  it('requires resume evidence before reusing a persisted Codex thread', async () => {
    runtimeManifestResolver.mockResolvedValueOnce(
      codexRuntimeManifest({ 'run.resume': 'unsupported' })
    );
    const executor = new WorkflowStepExecutor(tmpDir, { runtimeManifestResolver });
    const step: WorkflowStep = {
      id: 'resume',
      name: 'Resume',
      type: 'agent',
      agent: 'codex',
      input: 'Continue',
      session: { mode: 'reuse', context: 'minimal', cleanup: 'keep', timeout: 60 },
    };
    const run = {
      id: 'run_1234567890_resume',
      workflowId: 'wf-codex',
      workflowVersion: 1,
      status: 'running',
      context: {
        task: { id: 'task_1', title: 'Resume', git: { worktreePath: tmpDir } },
        workflow: {
          agents: [
            {
              id: 'codex',
              name: 'Codex',
              role: 'implementer',
              provider: 'codex-sdk',
              description: 'Codex implementer',
            },
          ],
        },
        _sessions: { codex: 'thread_existing' },
      },
      startedAt: new Date().toISOString(),
      steps: [{ stepId: 'resume', status: 'running', retries: 0 }],
    } as WorkflowRun;

    await expect(executor.executeStep(step, run)).rejects.toThrow('run.resume');
    expect(mockResumeThread).not.toHaveBeenCalled();
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
      const executor = new WorkflowStepExecutor(tmpDir, { runtimeManifestResolver });
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

  it('rejects unsafe Codex command overrides before starting SDK sessions', async () => {
    const originalEnv = captureCodexCommandEnv();
    delete process.env.VERITAS_CODEX_EXECUTABLE;
    delete process.env.CODEX_PATH;
    delete process.env.VERITAS_ALLOW_UNSAFE_CODEX_COMMAND_OVERRIDES;

    try {
      const executor = new WorkflowStepExecutor(tmpDir, { runtimeManifestResolver });
      const step: WorkflowStep = {
        id: 'implement',
        name: 'Implement',
        type: 'agent',
        agent: 'codex',
        input: 'Work on {{task.title}}',
        output: { file: 'implement.md' },
      };
      const run: WorkflowRun = {
        id: 'run_1234567890_command',
        workflowId: 'wf-codex-command',
        workflowVersion: 1,
        status: 'running',
        context: {
          task: {
            id: 'task_1',
            title: 'Codex command policy',
            git: { worktreePath: tmpDir },
          },
          workflow: {
            agents: [
              {
                id: 'codex',
                name: 'Codex',
                role: 'developer',
                provider: 'codex-sdk',
                command: '/tmp/not-the-codex-binary',
                description: 'Codex developer',
              },
            ],
          },
          _sessions: {},
        },
        startedAt: new Date().toISOString(),
        steps: [{ stepId: 'implement', status: 'running', retries: 0 }],
      };

      await expect(executor.executeStep(step, run)).rejects.toThrow(
        'Codex command overrides must be "codex"'
      );
      expect(mockCodexConstructorOptions).not.toHaveBeenCalled();
      expect(mockStartThread).not.toHaveBeenCalled();
      expect(mockResumeThread).not.toHaveBeenCalled();
    } finally {
      restoreCodexCommandEnv(originalEnv);
    }
  });

  it('passes configured Codex executable overrides to SDK sessions', async () => {
    const originalEnv = captureCodexCommandEnv();
    process.env.VERITAS_CODEX_EXECUTABLE = '/tmp/allowed-codex';
    delete process.env.CODEX_PATH;
    delete process.env.VERITAS_ALLOW_UNSAFE_CODEX_COMMAND_OVERRIDES;

    try {
      const executor = new WorkflowStepExecutor(tmpDir, { runtimeManifestResolver });
      const step: WorkflowStep = {
        id: 'implement',
        name: 'Implement',
        type: 'agent',
        agent: 'codex',
        input: 'Work on {{task.title}}',
        output: { file: 'implement.md' },
      };
      const run: WorkflowRun = {
        id: 'run_1234567890_allowed_command',
        workflowId: 'wf-codex-allowed-command',
        workflowVersion: 1,
        status: 'running',
        context: {
          task: {
            id: 'task_1',
            title: 'Codex command policy',
            git: { worktreePath: tmpDir },
          },
          workflow: {
            agents: [
              {
                id: 'codex',
                name: 'Codex',
                role: 'developer',
                provider: 'codex-sdk',
                command: '/tmp/allowed-codex',
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

      expect(mockCodexConstructorOptions).toHaveBeenCalledWith(
        expect.objectContaining({ codexPathOverride: '/tmp/allowed-codex' })
      );
      expect(mockStartThread).toHaveBeenCalled();
    } finally {
      restoreCodexCommandEnv(originalEnv);
    }
  });

  it('blocks Codex workflow agent steps when role tool policy is restricted', async () => {
    mockGetToolFilterForRole.mockResolvedValueOnce({
      allowed: ['Read'],
      denied: ['Write', 'exec'],
    });

    const executor = new WorkflowStepExecutor(tmpDir, { runtimeManifestResolver });
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
    const executor = new WorkflowStepExecutor(tmpDir, { runtimeManifestResolver });
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
