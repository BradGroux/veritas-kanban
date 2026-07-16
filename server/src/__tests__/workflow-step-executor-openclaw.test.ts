import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import type {
  OpenClawWorkflowAdapter,
  OpenClawWorkflowCleanupInput,
  OpenClawWorkflowSessionInput,
  OpenClawWorkflowSessionResult,
  OpenClawWorkflowSpawnInput,
} from '../services/openclaw-workflow-adapter.js';

const mocks = vi.hoisted(() => ({
  getToolFilterForRole: vi.fn(),
  recordGovernanceTrace: vi.fn(),
}));

vi.mock('../services/tool-policy-service.js', () => ({
  getToolPolicyService: () => ({
    getToolFilterForRole: mocks.getToolFilterForRole,
  }),
}));

vi.mock('../services/governance-trace-service.js', () => ({
  getGovernanceTraceService: () => ({
    record: mocks.recordGovernanceTrace,
  }),
}));

import { WorkflowStepExecutor } from '../services/workflow-step-executor.js';
import type { WorkflowRun, WorkflowStep } from '../types/workflow.js';
import { providerRuntimeManifestFixture } from './fixtures/provider-runtime-manifest.js';
import { getProviderRuntimeAdapterDefinition } from '../services/provider-runtime-adapter-registry.js';

const runtimeManifestResolver = vi.fn();

type MockOpenClawAdapter = OpenClawWorkflowAdapter & {
  spawn: ReturnType<
    typeof vi.fn<(input: OpenClawWorkflowSpawnInput) => Promise<OpenClawWorkflowSessionResult>>
  >;
  send: ReturnType<
    typeof vi.fn<(input: OpenClawWorkflowSessionInput) => Promise<OpenClawWorkflowSessionResult>>
  >;
  wait: ReturnType<
    typeof vi.fn<(input: OpenClawWorkflowSessionInput) => Promise<OpenClawWorkflowSessionResult>>
  >;
  cleanup: ReturnType<typeof vi.fn<(input: OpenClawWorkflowCleanupInput) => Promise<void>>>;
};

function createAdapter(): MockOpenClawAdapter {
  return {
    spawn: vi.fn(),
    send: vi.fn(),
    wait: vi.fn(),
    cleanup: vi.fn().mockResolvedValue(undefined),
  };
}

function createStep(overrides: Partial<WorkflowStep> = {}): WorkflowStep {
  return {
    id: 'implement',
    name: 'Implement',
    type: 'agent',
    agent: 'openclaw-dev',
    input: 'Implement {{task.title}}',
    output: { file: 'implement.md' },
    acceptance_criteria: ['STATUS: done'],
    session: {
      mode: 'fresh',
      context: 'minimal',
      cleanup: 'delete',
      timeout: 123,
    },
    ...overrides,
  };
}

function createRun(overrides: Partial<WorkflowRun> = {}): WorkflowRun {
  return {
    id: 'run_1234567890_openclaw',
    workflowId: 'wf-openclaw',
    workflowVersion: 1,
    taskId: 'task_1',
    status: 'running',
    context: {
      task: {
        id: 'task_1',
        title: 'OpenClaw adapter',
      },
      workflow: {
        agents: [
          {
            id: 'openclaw-dev',
            name: 'OpenClaw Developer',
            role: 'developer',
            provider: 'openclaw',
            model: 'claude-sonnet-4',
            description: 'OpenClaw implementer',
          },
        ],
      },
      _sessions: {},
    },
    startedAt: new Date().toISOString(),
    steps: [{ stepId: 'implement', status: 'running', retries: 0 }],
    ...overrides,
  };
}

describe('WorkflowStepExecutor OpenClaw integration', () => {
  let tmpDir: string;
  let adapter: MockOpenClawAdapter;

  beforeEach(async () => {
    vi.clearAllMocks();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'workflow-openclaw-'));
    adapter = createAdapter();
    mocks.getToolFilterForRole.mockResolvedValue({
      allowed: ['Read', 'sessions_spawn', 'sessions_send'],
      denied: ['Write'],
    });
    const openClawDefinition = getProviderRuntimeAdapterDefinition('openclaw', 'workflow');
    runtimeManifestResolver.mockResolvedValue(
      providerRuntimeManifestFixture({
        provider: 'openclaw',
        capabilityStates: Object.fromEntries(
          openClawDefinition.capabilities.map((capability) => [capability.id, capability.state])
        ),
      })
    );
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('spawns and waits for fresh OpenClaw agent steps', async () => {
    adapter.spawn.mockResolvedValue({
      sessionKey: 'oc_session_1',
      runId: 'oc_run_1',
      status: 'accepted',
    });
    adapter.wait.mockResolvedValue({
      sessionKey: 'oc_session_1',
      runId: 'oc_run_1',
      status: 'completed',
      output: 'STATUS: done\nOUTPUT: Completed via OpenClaw',
    });

    const executor = new WorkflowStepExecutor(tmpDir, {
      openClawAdapter: adapter,
      runtimeManifestResolver,
    });
    const step = createStep();
    const run = createRun();

    const result = await executor.executeStep(step, run);

    expect(adapter.spawn).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowId: 'wf-openclaw',
        runId: 'run_1234567890_openclaw',
        stepId: 'implement',
        taskId: 'task_1',
        agentId: 'openclaw-dev',
        agentName: 'OpenClaw Developer',
        model: 'claude-sonnet-4',
        prompt: 'Implement OpenClaw adapter',
        sessionMode: 'fresh',
        contextMode: 'minimal',
        cleanup: 'delete',
        timeoutSeconds: 123,
        taskContext: expect.objectContaining({ title: 'OpenClaw adapter' }),
        toolFilter: {
          allowed: ['Read', 'sessions_spawn', 'sessions_send'],
          denied: ['Write'],
        },
      })
    );
    expect(adapter.wait).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionKey: 'oc_session_1',
        prompt: 'Implement OpenClaw adapter',
        timeoutSeconds: 123,
      })
    );
    expect(adapter.cleanup).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionKey: 'oc_session_1',
        runId: 'run_1234567890_openclaw',
        stepId: 'implement',
      })
    );
    expect(run.context._sessions).toMatchObject({ 'openclaw-dev': 'oc_session_1' });
    expect(run.steps[0].sessionKey).toBe('oc_session_1');
    expect(result.output).toContain('Completed via OpenClaw');

    const output = await fs.readFile(result.outputPath, 'utf-8');
    expect(output).toContain('Provider: openclaw');
    expect(output).not.toContain('Implement OpenClaw adapter');
  });

  it('does not require token telemetry for runtime-only workflow budgets', async () => {
    adapter.spawn.mockResolvedValue({
      sessionKey: 'oc_session_runtime_budget',
      runId: 'oc_run_runtime_budget',
      status: 'completed',
      output: 'STATUS: done\nOUTPUT: Runtime budget completed',
    });
    const executor = new WorkflowStepExecutor(tmpDir, {
      openClawAdapter: adapter,
      runtimeManifestResolver,
    });
    const run = createRun({
      budget: {
        enabled: true,
        policy: { enabled: true, limits: { runtimeSeconds: 300 } },
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          costUsd: 0,
          toolCalls: 0,
          runtimeSeconds: 0,
          idleRuntimeSeconds: 0,
          retries: 0,
          fanOut: 0,
        },
        decision: 'allow',
        thresholdEvents: [],
        traceIds: [],
      },
    });

    await expect(executor.executeStep(createStep(), run)).resolves.toMatchObject({
      output: expect.stringContaining('Runtime budget completed'),
    });
    expect(adapter.spawn).toHaveBeenCalled();
  });

  it('dispatches by the explicit provider instead of a Codex-like agent id', async () => {
    adapter.spawn.mockResolvedValue({
      sessionKey: 'oc_session_codex_name',
      runId: 'oc_run_codex_name',
      status: 'completed',
      output: 'STATUS: done\nOUTPUT: Executed by OpenClaw',
    });
    const executor = new WorkflowStepExecutor(tmpDir, {
      openClawAdapter: adapter,
      runtimeManifestResolver,
    });
    const step = createStep({ agent: 'codex' });
    const run = createRun({
      context: {
        task: { id: 'task_1', title: 'Explicit provider dispatch' },
        workflow: {
          agents: [
            {
              id: 'codex',
              name: 'Codex-named OpenClaw agent',
              role: 'developer',
              provider: 'openclaw',
              description: 'Explicit provider wins over the agent id.',
            },
          ],
        },
        _sessions: {},
      },
    });

    await executor.executeStep(step, run);

    expect(adapter.spawn).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: 'codex', agentName: 'Codex-named OpenClaw agent' })
    );
  });

  it('uses OpenClaw reattach requirements for an explicitly OpenClaw Codex-like agent', async () => {
    adapter.send.mockResolvedValue({
      sessionKey: 'oc_existing',
      runId: 'oc_run_existing',
      status: 'completed',
      output: 'STATUS: done\nOUTPUT: Continued through OpenClaw',
    });
    const executor = new WorkflowStepExecutor(tmpDir, {
      openClawAdapter: adapter,
      runtimeManifestResolver,
    });
    const step = createStep({
      agent: 'codex',
      session: { mode: 'reuse', context: 'minimal', cleanup: 'keep', timeout: 60 },
    });
    const run = createRun({
      context: {
        task: { id: 'task_1', title: 'Explicit provider reuse' },
        workflow: {
          agents: [
            {
              id: 'codex',
              name: 'Codex-named OpenClaw agent',
              role: 'developer',
              provider: 'openclaw',
              description: 'Explicit provider controls reuse requirements.',
            },
          ],
        },
        _sessions: { codex: 'oc_existing' },
      },
    });

    await executor.executeStep(step, run);

    expect(adapter.send).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: 'codex', sessionKey: 'oc_existing' })
    );
    expect(adapter.spawn).not.toHaveBeenCalled();
  });

  it('reuses an existing OpenClaw session when requested', async () => {
    adapter.send.mockResolvedValue({
      sessionKey: 'oc_existing_1',
      runId: 'oc_run_2',
      status: 'completed',
      output: 'STATUS: done\nOUTPUT: Reused existing session',
    });

    const executor = new WorkflowStepExecutor(tmpDir, {
      openClawAdapter: adapter,
      runtimeManifestResolver,
    });
    const step = createStep({
      session: {
        mode: 'reuse',
        context: 'full',
        cleanup: 'keep',
        timeout: 60,
      },
    });
    const run = createRun({
      context: {
        ...createRun().context,
        _sessions: { 'openclaw-dev': 'oc_existing_1' },
      },
    });

    const result = await executor.executeStep(step, run);

    expect(adapter.spawn).not.toHaveBeenCalled();
    expect(adapter.wait).not.toHaveBeenCalled();
    expect(adapter.cleanup).not.toHaveBeenCalled();
    expect(adapter.send).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionKey: 'oc_existing_1',
        prompt: 'Implement OpenClaw adapter',
        timeoutSeconds: 60,
      })
    );
    expect(run.context._sessions).toMatchObject({ 'openclaw-dev': 'oc_existing_1' });
    expect(run.steps[0].sessionKey).toBe('oc_existing_1');
    expect(result.output).toContain('Reused existing session');
  });

  it('redacts prompt and secret-looking values from OpenClaw failures', async () => {
    adapter.spawn.mockResolvedValue({
      sessionKey: 'oc_session_secret',
      runId: 'oc_run_secret',
      status: 'accepted',
    });
    adapter.wait.mockRejectedValue(
      new Error(
        'Gateway rejected: Implement Sensitive token=sk-test-secret-value-123456 OPENCLAW_TOKEN=raw-token'
      )
    );

    const executor = new WorkflowStepExecutor(tmpDir, {
      openClawAdapter: adapter,
      runtimeManifestResolver,
    });
    const step = createStep({
      input: 'Implement {{task.title}} token=sk-test-secret-value-123456',
    });
    const run = createRun({
      context: {
        ...createRun().context,
        task: {
          id: 'task_1',
          title: 'Sensitive',
        },
      },
    });

    await expect(executor.executeStep(step, run)).rejects.toThrow(
      'OpenClaw workflow step implement failed'
    );

    try {
      await executor.executeStep(step, run);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      expect(message).not.toContain('Implement Sensitive');
      expect(message).not.toContain('sk-test-secret-value-123456');
      expect(message).not.toContain('raw-token');
      expect(message).toContain('[REDACTED_PROMPT]');
      expect(message).toContain('OPENCLAW_TOKEN=[REDACTED]');
    }
  });

  it('treats OpenClaw timeout status as a workflow failure and cleans up owned sessions', async () => {
    adapter.spawn.mockResolvedValue({
      sessionKey: 'oc_session_timeout',
      runId: 'oc_run_timeout',
      status: 'accepted',
    });
    adapter.wait.mockResolvedValue({
      sessionKey: 'oc_session_timeout',
      runId: 'oc_run_timeout',
      status: 'timeout',
      error: 'Timed out waiting for completion',
    });

    const executor = new WorkflowStepExecutor(tmpDir, {
      openClawAdapter: adapter,
      runtimeManifestResolver,
    });

    await expect(executor.executeStep(createStep(), createRun())).rejects.toThrow(
      'OpenClaw session oc_session_timeout timed out'
    );
    expect(adapter.cleanup).toHaveBeenCalledWith(
      expect.objectContaining({ sessionKey: 'oc_session_timeout' })
    );
  });

  it('keeps owned OpenClaw sessions when cleanup is disabled', async () => {
    adapter.spawn.mockResolvedValue({
      sessionKey: 'oc_session_keep',
      runId: 'oc_run_keep',
      status: 'accepted',
    });
    adapter.wait.mockResolvedValue({
      sessionKey: 'oc_session_keep',
      runId: 'oc_run_keep',
      status: 'completed',
      output: 'STATUS: done\nOUTPUT: Kept for debugging',
    });

    const executor = new WorkflowStepExecutor(tmpDir, {
      openClawAdapter: adapter,
      runtimeManifestResolver,
    });
    const step = createStep({
      session: {
        mode: 'fresh',
        context: 'minimal',
        cleanup: 'keep',
        timeout: 123,
      },
    });

    await executor.executeStep(step, createRun());

    expect(adapter.cleanup).not.toHaveBeenCalled();
  });
});
