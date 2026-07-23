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
  mockSaveConfig,
  mockGetTask,
  mockListTasks,
  mockUpdateTask,
  mockPatchTaskAttempt,
  mockCheckAgent,
  mockTelemetryEmit,
  mockGovernanceRecord,
  mockLogActivity,
  mockStartTrace,
  mockStartStep,
  mockEndStep,
  mockCompleteTrace,
  mockSdkStartThread,
  mockSdkRunStreamed,
} = vi.hoisted(() => ({
  mockSpawn: vi.fn(),
  mockGetConfig: vi.fn(),
  mockSaveConfig: vi.fn(),
  mockGetTask: vi.fn(),
  mockListTasks: vi.fn(),
  mockUpdateTask: vi.fn(),
  mockPatchTaskAttempt: vi.fn(),
  mockCheckAgent: vi.fn(),
  mockTelemetryEmit: vi.fn(),
  mockGovernanceRecord: vi.fn(),
  mockLogActivity: vi.fn(),
  mockStartTrace: vi.fn(),
  mockStartStep: vi.fn(),
  mockEndStep: vi.fn(),
  mockCompleteTrace: vi.fn(),
  mockSdkStartThread: vi.fn(),
  mockSdkRunStreamed: vi.fn(),
}));

vi.mock('child_process', () => ({
  spawn: mockSpawn,
}));

vi.mock('@openai/codex-sdk', () => ({
  Codex: class {
    startThread = mockSdkStartThread;
  },
}));

vi.mock('../services/config-service.js', () => ({
  ConfigService: function () {
    return { getConfig: mockGetConfig, saveConfig: mockSaveConfig };
  },
  getConfigService: () => ({ getConfig: mockGetConfig, saveConfig: mockSaveConfig }),
}));

vi.mock('../services/task-service.js', () => ({
  TaskService: function () {
    return {
      getTask: mockGetTask,
      listTasks: mockListTasks,
      updateTask: mockUpdateTask,
      patchTaskAttempt: mockPatchTaskAttempt,
    };
  },
}));

vi.mock('../services/telemetry-service.js', () => ({
  getTelemetryService: () => ({ emit: mockTelemetryEmit, getConfig: () => ({ traces: true }) }),
}));

vi.mock('../services/governance-trace-service.js', () => ({
  getGovernanceTraceService: () => ({ record: mockGovernanceRecord }),
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

vi.mock('../services/agent-health-service.js', () => ({
  AgentHealthService: function () {
    return { checkAgent: mockCheckAgent };
  },
}));

vi.mock('../services/circuit-registry.js', () => ({
  getBreaker: () => ({ execute: (fn: () => Promise<void>) => fn() }),
}));

import { AgentReadinessError, ClawdbotAgentService } from '../services/clawdbot-agent-service.js';
import type { ThreadEvent } from '@openai/codex-sdk';
import type {
  AgentConfig,
  RunLaunchRuntime,
  SandboxPolicyDryRunResult,
  Task,
} from '@veritas-kanban/shared';
import { providerRuntimeManifestFixture } from './fixtures/provider-runtime-manifest.js';
import { TaskEnvelopeService } from '../services/task-envelope-service.js';
import { digestRunLaunchValue } from '../utils/run-launch-manifest-digest.js';

const fixtureDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'codex');

type TestableClawdbotAgentService = ClawdbotAgentService & {
  logsDir: string;
  buildRunLaunchEnvironment(
    provider: 'openclaw' | 'codex-sdk',
    sandboxPolicy: SandboxPolicyDryRunResult
  ): Pick<RunLaunchRuntime, 'environmentKeys' | 'credentialReferences'>;
  buildRunLaunchRuntime(
    provider: 'openclaw' | 'codex-sdk',
    agentConfig: AgentConfig | undefined,
    taskId: string,
    logPath: string,
    attemptId: string,
    sandboxPolicy: SandboxPolicyDryRunResult
  ): RunLaunchRuntime;
  normalizeRunLaunchTaskPrompt(
    prompt: string,
    attemptId: string,
    worktreePath: string | undefined,
    providerRuntimeDigest: string
  ): string;
  handleCodexEvent(
    event: Record<string, unknown>,
    logPath: string,
    task?: Task,
    attemptId?: string,
    agentConfig?: Partial<AgentConfig>
  ): Promise<{
    summary?: string;
    usage?: { inputTokens: number; outputTokens: number; totalTokens?: number; model?: string };
  }>;
  recordCodexThread(task: Task, attemptId: string, threadId: string): Promise<void>;
};

function testableService(tmpDir: string): TestableClawdbotAgentService {
  const taskEnvelopes = new TaskEnvelopeService({
    captureLaunchBaseline: async (_worktreePath, capturedAt) => ({
      capturedAt,
      headSha: 'a'.repeat(40),
      dirty: false,
      files: [],
    }),
  });
  const service = new ClawdbotAgentService(
    undefined,
    undefined,
    taskEnvelopes
  ) as unknown as TestableClawdbotAgentService;
  service.logsDir = tmpDir;
  return service;
}

function createFakeChild(fixture: string, exitCode = 0) {
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

  queueMicrotask(() => {
    child.stdout.once('end', () => {
      child.emit('close', exitCode, null);
    });
    child.stdout.end(fixture);
  });

  return child;
}

function createControllableChild() {
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
    return true;
  });
  return child;
}

async function waitFor(assertion: () => void | Promise<void>): Promise<void> {
  const started = Date.now();
  let lastError: unknown;
  while (Date.now() - started < 10_000) {
    try {
      await assertion();
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
      description:
        'Exercise mocked Codex JSONL and produce a report artifact with verification evidence.',
      type: 'code',
      status: 'todo',
      priority: 'medium',
      agent: 'codex',
      project: 'veritas',
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
      git: {
        repo: 'BradGroux/veritas-kanban',
        branch: 'codex-fixture',
        baseBranch: 'main',
        worktreePath: tmpDir,
      },
      subtasks: [
        {
          id: 'sub_fixture',
          title: 'Confirm fixture output',
          completed: false,
          created: new Date().toISOString(),
          acceptanceCriteria: ['Codex fixture records the expected output artifact'],
        },
      ],
      verificationSteps: [
        { id: 'verify_fixture', description: 'Run mocked Codex provider test', checked: false },
      ],
    } as Task;

    mockGetTask.mockImplementation(async () => task);
    mockListTasks.mockImplementation(async () => [task]);
    mockUpdateTask.mockImplementation(async (_id, update) => {
      task = { ...task, ...update } as Task;
      return task;
    });
    mockPatchTaskAttempt.mockImplementation(async (_id, attemptId, patch) => {
      if (task.attempt?.id !== attemptId) return null;
      task = { ...task, attempt: { ...task.attempt, ...patch } } as Task;
      return task;
    });
    mockCheckAgent.mockImplementation(async (agent: AgentConfig) => ({
      type: agent.type,
      name: agent.name,
      enabled: agent.enabled,
      configured: true,
      command: agent.command,
      executableFound: true,
      executablePath: `/usr/local/bin/${agent.command}`,
      providerVersion: 'codex-cli 0.144.0',
      providerVersionSource: 'codex --version',
      authenticated: true,
      healthy: true,
      checkedAt: '2026-06-03T00:00:00.000Z',
    }));
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
    mockSdkStartThread.mockReturnValue({ runStreamed: mockSdkRunStreamed });
    mockGovernanceRecord.mockResolvedValue({ id: 'governance_trace_fixture' });
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it(
    'runs the Codex CLI adapter against mocked JSONL and records telemetry',
    { timeout: 20_000 },
    async () => {
      const fixture = await fs.readFile(path.join(fixtureDir, 'success.jsonl'), 'utf-8');
      mockSpawn.mockReturnValue(createFakeChild(fixture));
      const service = testableService(tmpDir);

      const status = await service.startAgent(task.id, 'codex');

      expect(status.status).toBe('running');
      expect(status.runLaunchManifest).toMatchObject({
        schemaVersion: 'run-launch-manifest/v1',
        taskId: task.id,
        providerRuntime: {
          digest: status.providerRuntimeManifest.digest,
          provider: 'codex-cli',
        },
        runtime: {
          command: 'codex',
          model: 'gpt-5.5',
        },
        enforcement: {
          enforceable: true,
          blockers: [],
        },
      });
      expect(status.runLaunchManifest.digest).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(mockSpawn).toHaveBeenCalledWith(
        'codex',
        expect.arrayContaining(['exec', '--json', '--sandbox', 'workspace-write']),
        expect.objectContaining({ cwd: tmpDir, shell: false })
      );
      const spawnEnvironment = mockSpawn.mock.calls[0]?.[2]?.env as
        Record<string, string> | undefined;
      expect(status.runLaunchManifest.runtime.environmentKeys).toEqual(
        Object.keys(spawnEnvironment ?? {}).sort((left, right) => left.localeCompare(right))
      );
      expect(status.runLaunchManifest.runtime.environmentKeys).toContain('VK_API_URL');

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
      await waitFor(() => {
        expect(mockLogActivity).toHaveBeenCalledWith(
          'agent_completed',
          task.id,
          task.title,
          expect.objectContaining({ provider: 'codex-cli', success: true }),
          'codex'
        );
      });
      await waitFor(async () => {
        expect(await service.getAgentStatus(task.id)).toBeNull();
      });
      expect(task.attempt?.providerRuntimeManifest).toMatchObject({
        schemaVersion: 'provider-runtime-manifest/v1',
        provider: 'codex-cli',
        providerVersion: 'codex-cli 0.144.0',
      });
      expect(task.attempt?.providerRuntimeManifest?.digest).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(task.attempt?.harnessSupport).toMatchObject({
        profileId: 'openai-codex-cli',
        adapterId: 'codex-cli',
        supportTier: 'configured',
        failureClass: 'none',
        manifestDigest: task.attempt?.providerRuntimeManifest?.digest,
      });
      expect(mockTelemetryEmit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'run.started',
          harnessSupport: expect.objectContaining({
            profileId: 'openai-codex-cli',
            adapterId: 'codex-cli',
            providerVersion: 'codex-cli 0.144.0',
            manifestDigest: task.attempt?.providerRuntimeManifest?.digest,
            supportTier: 'configured',
            failureClass: 'none',
          }),
        })
      );
      expect(mockTelemetryEmit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'run.completed',
          harnessSupport: expect.objectContaining({
            profileId: 'openai-codex-cli',
            adapterId: 'codex-cli',
            manifestDigest: task.attempt?.providerRuntimeManifest?.digest,
            supportTier: 'configured',
            failureClass: 'none',
          }),
        })
      );
      expect(task.attempt?.taskEnvelope).toMatchObject({
        schemaVersion: 'task-envelope/v1',
        commitPolicy: 'allowed',
        workspace: {
          baseline: { headSha: 'a'.repeat(40), dirty: false, files: [] },
        },
        launchManifest: {
          digest: task.attempt?.providerRuntimeManifest?.digest,
        },
      });
      expect(task.attempt?.taskEnvelope?.digest).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(task.attempt?.runLaunchManifest?.digest).toBe(status.runLaunchManifest.digest);
      expect(task.attempt?.runLaunchManifestTraceId).toBe('governance_trace_fixture');
      expect(task.attempts).toEqual([
        expect.objectContaining({
          id: task.attempt?.id,
          runLaunchManifest: expect.objectContaining({
            digest: status.runLaunchManifest.digest,
          }),
          providerRuntimeManifest: expect.objectContaining({
            digest: task.attempt?.providerRuntimeManifest?.digest,
          }),
        }),
      ]);
      expect(task.deliverables).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: 'server/src/services/example.ts',
            type: 'code',
            agent: 'codex',
          }),
        ])
      );
      const log = await service.getAttemptLog(task.id, task.attempt?.id ?? 'missing');
      expect(log).toContain(
        `Provider manifest:** ${task.attempt?.providerRuntimeManifest?.digest}`
      );
      expect(log).toContain(`Task envelope:** ${task.attempt?.taskEnvelope?.digest}`);
      expect(log).toContain(`Run launch manifest:** ${status.runLaunchManifest.digest}`);
      expect(mockGovernanceRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Run launch manifest compiled',
          outcome: 'allowed',
          raw: expect.objectContaining({
            runLaunchManifest: expect.objectContaining({
              digest: status.runLaunchManifest.digest,
            }),
          }),
        })
      );
      expect(mockStartStep).toHaveBeenCalledWith(
        expect.any(String),
        'stream',
        expect.objectContaining({
          eventType: 'stream.stdout',
          stream: 'stdout',
          provider: 'codex-cli',
          chunkBytes: expect.any(Number),
        })
      );
      expect(mockStartStep).toHaveBeenCalledWith(
        expect.any(String),
        'finalize',
        expect.objectContaining({
          eventType: 'run.finalizing',
          exitCode: 0,
          signal: null,
          success: true,
          provider: 'codex-cli',
        })
      );
      expect(mockStartStep).toHaveBeenCalledWith(
        expect.any(String),
        'complete',
        expect.objectContaining({
          eventType: 'turn.completed',
          totalTokens: 20,
          model: 'gpt-5.5',
          finalResult: 'Codex completed the task.',
        })
      );
      expect(mockStartStep).toHaveBeenCalledWith(
        expect.any(String),
        'complete',
        expect.objectContaining({
          eventType: 'run.completed',
          success: true,
          provider: 'codex-cli',
          model: 'gpt-5.5',
        })
      );
    }
  );

  it('redacts provider identity secrets before emitting harness telemetry', async () => {
    const fixture = await fs.readFile(path.join(fixtureDir, 'success.jsonl'), 'utf-8');
    mockSpawn.mockReturnValue(createFakeChild(fixture));
    mockCheckAgent.mockImplementation(async (agent: AgentConfig) => ({
      type: agent.type,
      name: agent.name,
      enabled: agent.enabled,
      configured: true,
      command: agent.command,
      executableFound: true,
      executablePath: `/usr/local/bin/${agent.command}`,
      providerVersion: 'codex-cli 0.144.0 token=telemetry-secret',
      providerVersionSource: 'codex --version',
      authenticated: true,
      healthy: true,
      checkedAt: '2026-06-03T00:00:00.000Z',
    }));
    const service = testableService(tmpDir);

    await service.startAgent(task.id, 'codex');

    await waitFor(() => {
      expect(mockTelemetryEmit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'run.started',
          harnessSupport: expect.objectContaining({
            providerVersion: 'codex-cli 0.144.0 token=[REDACTED]',
          }),
        })
      );
    });
    expect(JSON.stringify(mockTelemetryEmit.mock.calls)).not.toContain('telemetry-secret');
    await waitFor(async () => {
      expect(await service.getAgentStatus(task.id)).toBeNull();
    });
  });

  it('persists a run-level commit policy override in the immutable task envelope', async () => {
    const fixture = await fs.readFile(path.join(fixtureDir, 'success.jsonl'), 'utf-8');
    mockSpawn.mockReturnValue(createFakeChild(fixture));
    const service = testableService(tmpDir);

    const status = await service.startAgent(task.id, 'codex', { commitPolicy: 'forbidden' });

    expect(status.taskEnvelope.commitPolicy).toBe('forbidden');
    expect(status.taskEnvelope.allowedSideEffects).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'git-commit' })])
    );
    expect(task.attempt?.taskEnvelope?.digest).toBe(status.taskEnvelope.digest);
    await waitFor(async () => {
      expect(await service.getAgentStatus(task.id)).toBeNull();
    });
  });

  it('previews the effective launch manifest without mutating attempt state', async () => {
    const service = testableService(tmpDir);

    const preview = await service.previewAgentLaunch(task.id, 'codex');

    expect(preview.manifest).toMatchObject({
      schemaVersion: 'run-launch-manifest/v1',
      taskId: task.id,
      attemptId: expect.stringMatching(/^preview_/),
      providerRuntime: { provider: 'codex-cli' },
      enforcement: { enforceable: true, blockers: [] },
    });
    expect(preview.manifest.origins).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: 'providerRequirements',
          scope: 'provider',
          source: expect.stringMatching(/^provider-capabilities:codex-cli:\d+$/),
        }),
        expect.objectContaining({
          field: 'runtime.workingDirectory',
          source: 'adapter:codex-cli',
        }),
        expect.objectContaining({
          field: 'runtime.worktree',
          source: 'adapter:codex-cli',
        }),
      ])
    );
    expect(mockSpawn).not.toHaveBeenCalled();
    expect(mockUpdateTask).not.toHaveBeenCalled();
    expect(mockGovernanceRecord).not.toHaveBeenCalled();
    expect(task.attempt).toBeUndefined();
  });

  it('applies the same readiness gate to preview and fingerprints operator overrides', async () => {
    task = {
      ...task,
      description: 'Too short',
      subtasks: [],
      verificationSteps: [],
    } as Task;
    const service = testableService(tmpDir);

    await expect(service.previewAgentLaunch(task.id, 'codex')).rejects.toBeInstanceOf(
      AgentReadinessError
    );
    const overrideReason = 'Operator accepts the incomplete task definition';
    const preview = await service.previewAgentLaunch(task.id, 'codex', { overrideReason });

    expect(preview.manifest.readiness).toMatchObject({
      ready: false,
      overridden: true,
      overrideReasonDigest: expect.stringMatching(/^sha256:/),
    });
    expect(preview.manifest.readiness.missingRequired.length).toBeGreaterThan(0);
    expect(preview.manifest.origins).toContainEqual(
      expect.objectContaining({
        field: 'readiness',
        scope: 'run',
        source: 'operator-readiness-override',
      })
    );
    expect(JSON.stringify(preview.manifest)).not.toContain(overrideReason);
    expect(mockUpdateTask).not.toHaveBeenCalled();
  });

  it('fingerprints repository instructions byte-for-byte through workspace storage', async () => {
    const repositoryInstructions = '\n  # Indented repository instructions\n\n';
    await fs.writeFile(path.join(tmpDir, 'AGENTS.md'), repositoryInstructions, 'utf8');
    const service = testableService(tmpDir);

    const preview = await service.previewAgentLaunch(task.id, 'codex');
    const evidence = preview.manifest.instructions.find(
      (instruction) => instruction.id === 'repository:AGENTS.md'
    );

    expect(evidence).toMatchObject({
      byteLength: Buffer.byteLength(repositoryInstructions, 'utf8'),
      digest: digestRunLaunchValue(repositoryInstructions),
    });
    expect(evidence?.digest).not.toBe(
      preview.manifest.instructions.find(
        (instruction) => instruction.id === 'effective-task-request'
      )?.digest
    );
  });

  it('records every contributing budget source and runtime requirement origin', async () => {
    mockGetConfig.mockResolvedValue({
      features: {
        agents: {
          autoCommitOnComplete: false,
        },
        budget: {
          enabled: true,
          defaultRunBudget: {
            enabled: true,
            scope: 'workspace',
            limits: { totalTokens: 100_000 },
          },
        },
      },
      agents: [
        {
          type: 'codex',
          name: 'OpenAI Codex',
          command: 'codex',
          args: ['exec', '--json'],
          enabled: true,
          provider: 'codex-cli',
          model: 'gpt-5.5',
          budget: {
            enabled: true,
            scope: 'agent',
            limits: { totalTokens: 75_000 },
          },
        },
      ],
    });
    const service = testableService(tmpDir);

    const preview = await service.previewAgentLaunch(task.id, 'codex', {
      budget: {
        enabled: true,
        scope: 'run',
        limits: { totalTokens: 50_000 },
      },
    });

    expect(preview.manifest.budget.limits?.totalTokens).toBe(50_000);
    expect(preview.manifest.origins).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'budget', scope: 'workspace' }),
        expect.objectContaining({ field: 'budget', scope: 'provider' }),
        expect.objectContaining({
          field: 'budget',
          scope: 'run',
          source: 'operator-run-budget',
        }),
        expect.objectContaining({ field: 'providerRequirements', scope: 'system-default' }),
        expect.objectContaining({ field: 'providerRequirements', scope: 'workspace' }),
        expect.objectContaining({
          field: 'providerRequirements',
          scope: 'provider',
          source: expect.stringContaining(':budget'),
        }),
        expect.objectContaining({
          field: 'providerRequirements',
          scope: 'run',
          source: 'operator-run-budget',
        }),
      ])
    );
  });

  it('normalizes checkpoint age out of material instruction evidence', () => {
    const service = testableService(tmpDir);
    const first = service.normalizeRunLaunchTaskPrompt(
      'Last Checkpoint: 2026-07-23T20:00:00.000Z (5 minutes ago)',
      'attempt-a',
      tmpDir,
      `sha256:${'a'.repeat(64)}`
    );
    const later = service.normalizeRunLaunchTaskPrompt(
      'Last Checkpoint: 2026-07-23T20:00:00.000Z (125 minutes ago)',
      'attempt-b',
      tmpDir,
      `sha256:${'b'.repeat(64)}`
    );

    expect(first).toBe(later);
  });

  it('records the same non-empty OpenClaw environment alias used by adapter precedence', () => {
    vi.stubEnv('OPENCLAW_GATEWAY_URL', '');
    vi.stubEnv('CLAWDBOT_GATEWAY', 'http://127.0.0.1:18789');
    vi.stubEnv('CLAWDBOT_GATEWAY_URL', 'http://127.0.0.1:18790');
    vi.stubEnv('OPENCLAW_GATEWAY_TOKEN', '');
    vi.stubEnv('CLAWDBOT_GATEWAY_TOKEN', 'configured-token');
    vi.stubEnv('OPENCLAW_GATEWAY_SESSION_KEY', '');
    vi.stubEnv('OPENCLAW_GATEWAY_ALLOW_PRIVATE', '');
    const service = testableService(tmpDir);

    const environment = service.buildRunLaunchEnvironment(
      'openclaw',
      {} as SandboxPolicyDryRunResult
    );

    expect(environment.environmentKeys).toEqual(['CLAWDBOT_GATEWAY', 'CLAWDBOT_GATEWAY_TOKEN']);
    expect(environment.credentialReferences).toEqual(['env:CLAWDBOT_GATEWAY_TOKEN']);
  });

  it('records the exact redacted OpenClaw sessions_spawn request plan', () => {
    vi.stubEnv('OPENCLAW_GATEWAY_URL', '');
    vi.stubEnv('CLAWDBOT_GATEWAY', '');
    vi.stubEnv('CLAWDBOT_GATEWAY_URL', '');
    vi.stubEnv('OPENCLAW_GATEWAY_TOKEN', '');
    vi.stubEnv('CLAWDBOT_GATEWAY_TOKEN', '');
    vi.stubEnv('OPENCLAW_GATEWAY_SESSION_KEY', '');
    vi.stubEnv('OPENCLAW_GATEWAY_ALLOW_PRIVATE', '');
    const service = testableService(tmpDir);

    const runtime = service.buildRunLaunchRuntime(
      'openclaw',
      {
        type: 'openclaw',
        name: 'OpenClaw',
        enabled: true,
        model: 'provider-model',
      },
      task.id,
      path.join(tmpDir, 'run.md'),
      'attempt-openclaw',
      {} as SandboxPolicyDryRunResult
    );

    expect(runtime.args).toEqual([
      'tool=sessions_spawn',
      'task=<prompt>',
      'taskName=task_task_codex_fixture_attempt_openclaw',
      'label=Veritas task task_codex_fixture / attempt attempt-openclaw / OpenClaw',
      'runtime=subagent',
      'agentId=openclaw',
      'mode=run',
      'cleanup=keep',
      'context=isolated',
      'model=provider-model',
      'sessionKey=default:main',
      'gatewayUrl=default:http://127.0.0.1:18789',
      'allowPrivateIp=false',
      'requestTimeoutMs=60000',
    ]);
    expect(runtime.args.join(' ')).not.toContain('timeoutSeconds');
  });

  it('records the effective OpenClaw private-network exception', () => {
    vi.stubEnv('OPENCLAW_GATEWAY_ALLOW_PRIVATE', 'true');
    const service = testableService(tmpDir);

    const runtime = service.buildRunLaunchRuntime(
      'openclaw',
      {
        type: 'openclaw',
        name: 'OpenClaw',
        enabled: true,
      },
      task.id,
      path.join(tmpDir, 'run.md'),
      'attempt-openclaw-private',
      {} as SandboxPolicyDryRunResult
    );

    expect(runtime.args).toContain('allowPrivateIp=true');
    expect(runtime.environmentKeys).toContain('OPENCLAW_GATEWAY_ALLOW_PRIVATE');
  });

  it('records the Codex SDK executable override and thread safety settings', () => {
    const service = testableService(tmpDir);
    const sandboxPolicy = {
      effective: {
        sandboxMode: 'workspace-write',
        networkAccessEnabled: false,
        envPassthrough: [],
        credentialRefs: [],
      },
    } as SandboxPolicyDryRunResult;

    const overridden = service.buildRunLaunchRuntime(
      'codex-sdk',
      {
        type: 'codex-sdk',
        name: 'Codex SDK',
        command: '/opt/codex-custom',
        enabled: true,
      },
      task.id,
      path.join(tmpDir, 'run.md'),
      'attempt-sdk',
      sandboxPolicy
    );
    const bundled = service.buildRunLaunchRuntime(
      'codex-sdk',
      {
        type: 'codex-sdk',
        name: 'Codex SDK',
        command: 'codex',
        enabled: true,
      },
      task.id,
      path.join(tmpDir, 'run.md'),
      'attempt-sdk',
      sandboxPolicy
    );

    expect(overridden.command).toBe('/opt/codex-custom');
    expect(overridden.args).toEqual([
      'startThread',
      'skipGitRepoCheck=true',
      'sandboxMode=workspace-write',
      'approvalPolicy=never',
      'networkAccessEnabled=false',
      'runStreamed',
      '<prompt>',
    ]);
    expect(bundled.command).toBe('@openai/codex-sdk:bundled-codex');
  });

  it('returns unsupported runtime capabilities as launch-preview blockers', async () => {
    const service = testableService(tmpDir);

    const preview = await service.previewAgentLaunch(task.id, 'codex', {
      requiredRuntimeCapabilities: ['run.resume'],
    });

    expect(preview.manifest.providerRequirements.capabilities).toContainEqual(
      expect.objectContaining({
        id: 'run.resume',
        satisfied: false,
      })
    );
    expect(preview.manifest.enforcement.blockers).toContainEqual(
      expect.objectContaining({
        code: 'provider-capability-unavailable',
        field: 'providerRequirements.run.resume',
      })
    );
    expect(mockSpawn).not.toHaveBeenCalled();
    expect(mockUpdateTask).not.toHaveBeenCalled();
  });

  it('compares replay and fork previews with compatible and incompatible parent manifests', async () => {
    const service = testableService(tmpDir);
    const parent = await service.previewAgentLaunch(task.id, 'codex');
    const parentTask = {
      ...task,
      id: 'task_parent',
      attempt: {
        id: 'attempt_parent',
        agent: 'codex',
        status: 'complete',
        runLaunchManifest: parent.manifest,
      },
    } as Task;
    mockListTasks.mockImplementation(async () => [task, parentTask]);

    const compatible = await service.previewAgentLaunch(task.id, 'codex', {
      parentAttemptId: 'attempt_parent',
    });
    expect(compatible).toMatchObject({
      parentAttemptId: 'attempt_parent',
      drift: { material: false, changes: [] },
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
          model: 'gpt-5.6',
        },
      ],
    });
    const incompatible = await service.previewAgentLaunch(task.id, 'codex', {
      parentAttemptId: 'attempt_parent',
    });
    expect(incompatible.drift).toMatchObject({
      material: true,
      changes: expect.arrayContaining([expect.objectContaining({ field: 'runtime' })]),
    });
    expect(mockSpawn).not.toHaveBeenCalled();
    expect(mockUpdateTask).not.toHaveBeenCalled();
  });

  it('fails before attempt mutation when profile tool restrictions cannot be enforced', async () => {
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
      agentProfiles: [
        {
          id: 'restricted-reviewer',
          schemaVersion: 'agent-profile-package/v1',
          version: '1.0.0',
          displayName: 'Restricted reviewer',
          role: 'reviewer',
          enabled: true,
          capabilities: ['review'],
          defaultTaskTypes: ['code'],
          runtime: { agent: 'codex', provider: 'codex-cli' },
          instructions: { promptFile: 'prompts/reviewer.md' },
          tools: { allowed: ['Read'] },
          workflow: { id: 'restricted-review' },
        },
      ],
    });
    const service = testableService(tmpDir);

    const preview = await service.previewAgentLaunch(task.id, undefined, {
      profileId: 'restricted-reviewer',
    });
    expect(preview.manifest.enforcement).toMatchObject({
      enforceable: false,
      blockers: expect.arrayContaining([
        expect.objectContaining({ code: 'tool-policy-unenforceable' }),
        expect.objectContaining({ code: 'shared-resource-unavailable' }),
      ]),
    });
    expect(preview.manifest.resources.shared).toEqual([
      'instruction-file:prompts/reviewer.md',
      'workflow:restricted-review',
    ]);
    expect(preview.manifest.origins).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: 'providerRequirements',
          scope: 'agent-profile',
        }),
        expect.objectContaining({
          field: 'resources',
          scope: 'workflow',
          source: 'workflow:restricted-review',
        }),
      ])
    );

    await expect(
      service.startAgent(task.id, undefined, { profileId: 'restricted-reviewer' })
    ).rejects.toThrow(/cannot be enforced/i);
    expect(mockSpawn).not.toHaveBeenCalled();
    expect(mockUpdateTask).not.toHaveBeenCalled();
    expect(task.attempt).toBeUndefined();
    expect(mockGovernanceRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Run launch manifest compiled',
        outcome: 'blocked',
      })
    );
  });

  it('does not trust Codex file events without a persisted runtime snapshot', async () => {
    const service = testableService(tmpDir);
    const logPath = path.join(tmpDir, 'codex.md');
    await fs.writeFile(logPath, '# log\n');

    await expect(
      service.handleCodexEvent(
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
      )
    ).rejects.toThrow('provider event does not match the active attempt');

    expect(mockUpdateTask).not.toHaveBeenCalledWith(
      task.id,
      expect.objectContaining({ deliverables: expect.any(Array) })
    );
    expect(mockStartStep).not.toHaveBeenCalledWith(
      'attempt_fixture',
      expect.anything(),
      expect.anything()
    );
    expect(mockLogActivity).not.toHaveBeenCalledWith(
      'deliverable_added',
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything()
    );
  });

  it('accepts every Codex SDK 0.144 event contract consumed by the stream adapter', async () => {
    const service = testableService(tmpDir);
    const logPath = path.join(tmpDir, 'codex.md');
    const events = [
      { type: 'thread.started', thread_id: 'thread_fixture' },
      { type: 'turn.started' },
      {
        type: 'turn.completed',
        usage: {
          input_tokens: 10,
          cached_input_tokens: 2,
          output_tokens: 5,
          reasoning_output_tokens: 1,
        },
      },
      { type: 'turn.failed', error: { message: 'fixture failure' } },
      {
        type: 'item.started',
        item: { id: 'item_started', type: 'agent_message', text: 'starting' },
      },
      {
        type: 'item.updated',
        item: { id: 'item_updated', type: 'agent_message', text: 'working' },
      },
      {
        type: 'item.completed',
        item: { id: 'item_completed', type: 'agent_message', text: 'finished' },
      },
      { type: 'error', message: 'fixture stream error' },
    ] satisfies ThreadEvent[];

    const parsed = await Promise.all(
      events.map((event) => service.handleCodexEvent(event, logPath))
    );

    expect(parsed[2]?.usage).toEqual({
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
    });
    expect(parsed[6]?.summary).toBe('finished');
  });

  it('classifies streamed output, retry, and abort lifecycle events in traces', async () => {
    const service = testableService(tmpDir);
    const logPath = path.join(tmpDir, 'codex.md');
    await fs.writeFile(logPath, '# log\n');
    const child = createControllableChild();
    mockSpawn.mockReturnValue(child);
    await service.startAgent(task.id, 'codex');
    const attemptId = task.attempt?.id;
    if (!attemptId) throw new Error('Expected active attempt');

    await service.handleCodexEvent(
      {
        type: 'response.output_text.delta',
        delta: 'partial output OPENAI_API_KEY=sk-supersecret123456',
        stream: 'stdout',
      },
      logPath,
      task,
      attemptId,
      { type: 'codex', provider: 'codex-cli', model: 'gpt-5.5' }
    );
    await service.handleCodexEvent(
      {
        type: 'turn.retrying',
        message: 'Retrying after rate limit',
        retryAttempt: 2,
        retryDelayMs: 1250,
      },
      logPath,
      task,
      attemptId,
      { type: 'codex', provider: 'codex-cli', model: 'gpt-5.5' }
    );

    expect(mockStartStep).toHaveBeenCalledWith(
      attemptId,
      'stream',
      expect.objectContaining({
        eventType: 'response.output_text.delta',
        stream: 'stdout',
        content: 'partial output OPENAI_API_KEY=[REDACTED]',
      })
    );
    expect(mockStartStep).toHaveBeenCalledWith(
      attemptId,
      'retry',
      expect.objectContaining({
        eventType: 'turn.retrying',
        summary: 'Retrying after rate limit',
        retryAttempt: 2,
        retryDelayMs: 1250,
      })
    );
    await service.stopAgent(task.id, attemptId);
  });

  it('fails status and provider event ingestion when the persisted snapshot changes', async () => {
    const child = createControllableChild();
    mockSpawn.mockReturnValue(child);
    const service = testableService(tmpDir);

    await service.startAgent(task.id, 'codex');
    const activeAttempt = task.attempt;
    const attemptId = activeAttempt?.id;
    if (!activeAttempt || !attemptId) throw new Error('Expected active attempt');
    const originalManifest = activeAttempt.providerRuntimeManifest;
    if (!originalManifest) throw new Error('Expected persisted runtime manifest');
    task = {
      ...task,
      attempt: {
        ...activeAttempt,
        providerRuntimeManifest: providerRuntimeManifestFixture({ provider: 'codex-cli' }),
      },
    } as Task;

    await expect(service.getAgentStatus(task.id)).rejects.toThrow('digest mismatch');

    child.stdout.write(
      `${JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'stale' } })}\n`
    );
    await waitFor(() => expect(child.kill).toHaveBeenCalledWith('SIGTERM'));
    expect(mockStartStep).not.toHaveBeenCalledWith(
      attemptId,
      expect.anything(),
      expect.objectContaining({ eventType: 'item.completed' })
    );
    task = {
      ...task,
      attempt: { ...activeAttempt, providerRuntimeManifest: originalManifest },
    } as Task;
    await service.stopAgent(task.id, attemptId);
  });

  it('aborts and removes a Codex SDK run when stale evidence also blocks finalization', async () => {
    let releaseEvents: (() => void) | undefined;
    const eventGate = new Promise<void>((resolve) => {
      releaseEvents = resolve;
    });
    let sdkSignal: AbortSignal | undefined;
    mockSdkRunStreamed.mockImplementation(
      async (_prompt: string, options: { signal?: AbortSignal }) => {
        sdkSignal = options.signal;
        return {
          events: {
            async *[Symbol.asyncIterator]() {
              await eventGate;
              yield {
                type: 'item.completed',
                item: { type: 'agent_message', text: 'stale SDK event' },
              };
            },
          },
        };
      }
    );
    mockGetConfig.mockResolvedValue({
      agents: [
        {
          type: 'codex-sdk',
          name: 'OpenAI Codex SDK',
          command: 'codex',
          args: [],
          enabled: true,
          provider: 'codex-sdk',
          model: 'gpt-5.5',
        },
      ],
    });
    const service = testableService(tmpDir);

    await service.startAgent(task.id, 'codex-sdk');
    await waitFor(() => expect(mockSdkRunStreamed).toHaveBeenCalled());
    const activeAttempt = task.attempt;
    if (!activeAttempt?.providerRuntimeManifest) throw new Error('Expected SDK runtime manifest');
    task = {
      ...task,
      attempt: {
        ...activeAttempt,
        providerRuntimeManifest: providerRuntimeManifestFixture({ provider: 'codex-sdk' }),
      },
    } as Task;

    releaseEvents?.();

    await waitFor(async () => expect(await service.getAgentStatus(task.id)).toBeNull());
    expect(sdkSignal?.aborted).toBe(true);
  });

  it('does not let a stopped SDK rejection remove its replacement run', async () => {
    let releaseFirst: (() => void) | undefined;
    let releaseSecond: (() => void) | undefined;
    let firstRejected = false;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const secondGate = new Promise<void>((resolve) => {
      releaseSecond = resolve;
    });
    let invocation = 0;
    mockSdkRunStreamed.mockImplementation(async () => {
      invocation += 1;
      const currentInvocation = invocation;
      return {
        events: {
          async *[Symbol.asyncIterator]() {
            if (currentInvocation === 1) {
              await firstGate;
              firstRejected = true;
              throw new Error('stopped run rejected late');
            }
            await secondGate;
            yield { type: 'thread.started', thread_id: 'replacement-thread' };
          },
        },
      };
    });
    mockGetConfig.mockResolvedValue({
      agents: [
        {
          type: 'codex-sdk',
          name: 'OpenAI Codex SDK',
          command: 'codex',
          args: [],
          enabled: true,
          provider: 'codex-sdk',
          model: 'gpt-5.5',
        },
      ],
    });
    const service = testableService(tmpDir);

    const first = await service.startAgent(task.id, 'codex-sdk');
    await waitFor(() => expect(mockSdkRunStreamed).toHaveBeenCalledTimes(1));
    await service.stopAgent(task.id, first.attemptId);
    const replacement = await service.startAgent(task.id, 'codex-sdk');
    expect(replacement.attemptId).not.toBe(first.attemptId);
    await waitFor(() => expect(mockSdkRunStreamed).toHaveBeenCalledTimes(2));

    releaseFirst?.();
    await waitFor(() => expect(firstRejected).toBe(true));
    await Promise.resolve();

    await expect(service.getAgentStatus(task.id)).resolves.toMatchObject({
      attemptId: replacement.attemptId,
      status: 'running',
    });
    await service.stopAgent(task.id, replacement.attemptId);
    releaseSecond?.();
  });

  it('serializes concurrent starts before asynchronous launch checks complete', async () => {
    let releaseConfig: (() => void) | undefined;
    const configGate = new Promise<void>((resolve) => {
      releaseConfig = resolve;
    });
    const config = {
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
    };
    mockGetConfig
      .mockImplementationOnce(async () => {
        await configGate;
        return config;
      })
      .mockResolvedValue(config);
    const child = createControllableChild();
    mockSpawn.mockReturnValue(child);
    const service = testableService(tmpDir);

    const firstStart = service.startAgent(task.id, 'codex');
    await waitFor(() => expect(mockGetConfig).toHaveBeenCalledTimes(1));

    await expect(service.startAgent(task.id, 'codex')).rejects.toThrow(
      'An agent is already running or starting for this task'
    );

    releaseConfig?.();
    const first = await firstStart;
    expect(first.status).toBe('running');
    expect(mockSpawn).toHaveBeenCalledTimes(1);
    await service.stopAgent(task.id, first.attemptId);
  });

  it('coalesces concurrent completion claims for the same active attempt', async () => {
    const child = createControllableChild();
    mockSpawn.mockReturnValue(child);
    const service = testableService(tmpDir);
    const active = await service.startAgent(task.id, 'codex');
    const provenance = {
      attemptId: active.attemptId,
      providerRuntimeManifestDigest: active.providerRuntimeManifest.digest,
    };

    const naturalCompletion = service.completeAgent(
      task.id,
      { success: true, summary: 'natural completion won' },
      provenance
    );
    const competingStopCompletion = service.completeAgent(
      task.id,
      { success: false, error: 'competing stop completion' },
      provenance
    );

    await Promise.all([naturalCompletion, competingStopCompletion]);

    expect(task.attempt).toMatchObject({
      id: active.attemptId,
      status: 'complete',
    });
    expect(
      mockUpdateTask.mock.calls.filter(
        ([, update]) => update.attempt?.id === active.attemptId && update.attempt?.ended
      )
    ).toHaveLength(1);
    expect(
      mockTelemetryEmit.mock.calls.filter(([event]) => event.type === 'run.completed')
    ).toHaveLength(1);
    expect(mockLogActivity.mock.calls.filter(([type]) => type === 'agent_completed')).toHaveLength(
      1
    );
    await expect(service.getAgentStatus(task.id)).resolves.toBeNull();
  });

  it('coalesces concurrent stops with the provider close terminalizer', async () => {
    const child = createControllableChild();
    child.kill.mockImplementation(() => {
      child.killed = true;
      child.emit('close', 143, 'SIGTERM');
      return true;
    });
    mockSpawn.mockReturnValue(child);
    const service = testableService(tmpDir);
    const active = await service.startAgent(task.id, 'codex');

    const firstStop = service.stopAgent(task.id, active.attemptId);
    const concurrentStop = service.stopAgent(task.id, active.attemptId);
    await Promise.all([firstStop, concurrentStop]);

    expect(child.kill).toHaveBeenCalledTimes(1);
    expect(
      mockStartStep.mock.calls.filter(
        ([attemptId, stepType]) => attemptId === active.attemptId && stepType === 'abort'
      )
    ).toHaveLength(1);
    expect(
      mockUpdateTask.mock.calls.filter(
        ([, update]) => update.attempt?.id === active.attemptId && update.attempt?.ended
      )
    ).toHaveLength(1);
    expect(
      mockTelemetryEmit.mock.calls.filter(([event]) => event.type === 'run.completed')
    ).toHaveLength(1);
    const log = await fs.readFile(path.join(tmpDir, `${task.id}_${active.attemptId}.md`), 'utf-8');
    expect(log).not.toContain('## Codex Exit');
    await expect(service.getAgentStatus(task.id)).resolves.toBeNull();
  });

  it('retries only the authoritative commit after a persistence failure', async () => {
    const child = createControllableChild();
    mockSpawn.mockReturnValue(child);
    const service = testableService(tmpDir);
    const active = await service.startAgent(task.id, 'codex');
    mockUpdateTask.mockRejectedValueOnce(new Error('persistence unavailable'));

    await expect(service.stopAgent(task.id, active.attemptId)).rejects.toThrow(
      'persistence unavailable'
    );
    await expect(service.getAgentStatus(task.id)).resolves.toMatchObject({
      attemptId: active.attemptId,
      status: 'running',
    });

    await service.stopAgent(task.id, active.attemptId);

    expect(child.kill).toHaveBeenCalledTimes(1);
    expect(
      mockStartStep.mock.calls.filter(
        ([attemptId, stepType]) => attemptId === active.attemptId && stepType === 'abort'
      )
    ).toHaveLength(1);
    expect(
      mockUpdateTask.mock.calls.filter(
        ([, update]) => update.attempt?.id === active.attemptId && update.attempt?.ended
      )
    ).toHaveLength(2);
    await expect(service.getAgentStatus(task.id)).resolves.toBeNull();
  });

  it('does not enforce a budget evaluation that outlives its active run', async () => {
    const child = createControllableChild();
    mockSpawn.mockReturnValue(child);
    const service = testableService(tmpDir);
    const active = await service.startAgent(task.id, 'codex', {
      budget: {
        enabled: true,
        limits: { runtimeSeconds: 10_000 },
        hardAction: 'cancel',
      },
    });
    let releaseBudgetLookup: (() => void) | undefined;
    const budgetLookupGate = new Promise<void>((resolve) => {
      releaseBudgetLookup = resolve;
    });
    mockGetTask.mockClear();
    mockGetTask
      .mockImplementationOnce(async () => {
        await budgetLookupGate;
        return task;
      })
      .mockImplementation(async () => task);

    const staleBudgetEvaluation = service.recordBudgetUsage(task.id, active.attemptId, {
      runtimeSeconds: 20_000,
    });
    await waitFor(() => expect(mockGetTask).toHaveBeenCalledTimes(1));
    await service.stopAgent(task.id, active.attemptId);
    releaseBudgetLookup?.();

    await expect(staleBudgetEvaluation).rejects.toMatchObject({ statusCode: 409 });
    const log = await fs.readFile(path.join(tmpDir, `${task.id}_${active.attemptId}.md`), 'utf-8');
    expect(log).not.toContain('## Budget Enforcement');
    expect(child.kill).toHaveBeenCalledTimes(1);
  });

  it('does not reapply budget usage when governance trace persistence retries', async () => {
    const child = createControllableChild();
    mockSpawn.mockReturnValue(child);
    const service = testableService(tmpDir);
    const active = await service.startAgent(task.id, 'codex', {
      budget: {
        enabled: true,
        limits: { toolCalls: 2 },
        hardAction: 'cancel',
      },
    });
    mockGovernanceRecord.mockRejectedValueOnce(new Error('governance trace unavailable'));

    await expect(
      service.recordBudgetUsage(task.id, active.attemptId, { toolCalls: 2 })
    ).rejects.toThrow('governance trace unavailable');
    await expect(service.getAgentStatus(task.id)).resolves.toMatchObject({
      attemptId: active.attemptId,
      status: 'running',
    });

    await service.recordBudgetUsage(task.id, active.attemptId, { toolCalls: 2 });

    expect(task.attempt?.budget?.usage.toolCalls).toBe(2);
    expect(child.kill).toHaveBeenCalledTimes(1);
    await expect(service.getAgentStatus(task.id)).resolves.toBeNull();
  });

  it('does not replay a committed completion when post-commit telemetry fails', async () => {
    const child = createControllableChild();
    mockSpawn.mockReturnValue(child);
    const service = testableService(tmpDir);
    const active = await service.startAgent(task.id, 'codex');
    const provenance = {
      attemptId: active.attemptId,
      providerRuntimeManifestDigest: active.providerRuntimeManifest.digest,
    };
    mockTelemetryEmit.mockRejectedValueOnce(new Error('telemetry unavailable'));

    await expect(
      service.completeAgent(
        task.id,
        { success: true, summary: 'committed before telemetry' },
        provenance
      )
    ).resolves.toBeUndefined();

    expect(task.attempt).toMatchObject({ id: active.attemptId, status: 'complete' });
    await expect(service.getAgentStatus(task.id)).resolves.toBeNull();
    await expect(
      service.completeAgent(task.id, { success: true, summary: 'must not replay' }, provenance)
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(
      mockUpdateTask.mock.calls.filter(
        ([, update]) => update.attempt?.id === active.attemptId && update.attempt?.ended
      )
    ).toHaveLength(1);
    expect(mockCompleteTrace).toHaveBeenCalledWith(active.attemptId, 'completed');
    expect(mockLogActivity).toHaveBeenCalledWith(
      'agent_completed',
      task.id,
      task.title,
      expect.objectContaining({ attemptId: active.attemptId, success: true }),
      'codex'
    );
  });

  it('rejects stale completion and budget provenance after a replacement starts', async () => {
    const firstChild = createControllableChild();
    const replacementChild = createControllableChild();
    mockSpawn.mockReturnValueOnce(firstChild).mockReturnValueOnce(replacementChild);
    const service = testableService(tmpDir);

    const first = await service.startAgent(task.id, 'codex');
    await service.stopAgent(task.id, first.attemptId);
    const replacement = await service.startAgent(task.id, 'codex');

    await expect(service.stopAgent(task.id, first.attemptId)).rejects.toMatchObject({
      statusCode: 409,
    });
    await expect(
      service.sendMessage(task.id, 'late steering command', {
        expectedAttemptId: first.attemptId,
      })
    ).rejects.toMatchObject({ statusCode: 409 });
    await expect(
      service.completeAgent(
        task.id,
        { success: true, summary: 'late completion' },
        {
          attemptId: first.attemptId,
          providerRuntimeManifestDigest: first.providerRuntimeManifest.digest,
        }
      )
    ).rejects.toMatchObject({ statusCode: 409 });
    await expect(
      service.recordBudgetUsage(task.id, first.attemptId, { totalTokens: 99 })
    ).rejects.toMatchObject({ statusCode: 409 });
    await expect(service.getAgentStatus(task.id)).resolves.toMatchObject({
      attemptId: replacement.attemptId,
      status: 'running',
    });

    await service.stopAgent(task.id, replacement.attemptId);
  });

  it('blocks explicit dispatch when the selected agent is unhealthy', async () => {
    mockCheckAgent.mockImplementation(async (agent: AgentConfig) => ({
      type: agent.type,
      name: agent.name,
      enabled: true,
      configured: true,
      command: agent.command,
      executableFound: false,
      authenticated: null,
      healthy: false,
      checkedAt: '2026-06-03T00:00:00.000Z',
      reason: 'Executable "codex" was not found on PATH',
    }));
    const service = testableService(tmpDir);

    await expect(service.startAgent(task.id, 'codex')).rejects.toMatchObject({
      statusCode: 409,
      code: 'CONFLICT',
      details: expect.objectContaining({
        agent: 'codex',
        reason: 'Executable "codex" was not found on PATH',
      }),
    });
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it('records user stop requests as abort trace steps before completing the attempt', async () => {
    const child = createControllableChild();
    mockSpawn.mockReturnValue(child);
    const service = testableService(tmpDir);

    const active = await service.startAgent(task.id, 'codex');
    await service.stopAgent(task.id, active.attemptId);

    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    expect(mockStartStep).toHaveBeenCalledWith(
      expect.any(String),
      'abort',
      expect.objectContaining({
        eventType: 'run.aborted',
        reason: 'Stopped by user',
        provider: 'codex-cli',
      })
    );
  });

  it('patches a provider thread without dropping the persisted runtime manifest', async () => {
    const child = createControllableChild();
    mockSpawn.mockReturnValue(child);
    const service = testableService(tmpDir);

    await service.startAgent(task.id, 'codex');
    const currentAttempt = task.attempt;
    if (!currentAttempt?.providerRuntimeManifest) {
      throw new Error('Expected the started attempt to persist a provider runtime manifest');
    }
    const attemptId = currentAttempt.id;
    const manifestDigest = currentAttempt.providerRuntimeManifest.digest;
    await service.recordCodexThread(task, attemptId, 'thread_fixture_123');

    expect(task.attempt).toMatchObject({
      id: attemptId,
      threadId: 'thread_fixture_123',
      providerRuntimeManifest: { digest: manifestDigest },
    });
    await service.stopAgent(task.id, attemptId);
  });

  it('preserves the previous attempt when a new provider process fails to start', async () => {
    const previousAttempt = {
      id: 'attempt_previous',
      agent: 'codex',
      status: 'complete' as const,
      provider: 'codex-cli',
    };
    task = { ...task, attempt: previousAttempt, attempts: [] } as Task;
    mockGetTask.mockImplementation(async () => task);
    mockSpawn.mockImplementation(() => {
      throw new Error('fixture spawn failure');
    });
    const service = testableService(tmpDir);

    await expect(service.startAgent(task.id, 'codex')).rejects.toThrow(
      'Failed to start agent via Codex CLI: fixture spawn failure'
    );

    expect(task.attempts).toEqual(
      expect.arrayContaining([
        previousAttempt,
        expect.objectContaining({ status: 'failed', providerRuntimeManifest: expect.any(Object) }),
      ])
    );
  });

  it('requires and records a readiness override for incomplete task starts', async () => {
    task = {
      ...task,
      title: 'Fix',
      description: 'Too short',
      subtasks: [],
      verificationSteps: [],
    } as Task;
    mockGetTask.mockImplementation(async () => task);

    const service = testableService(tmpDir);

    await expect(service.startAgent(task.id, 'codex')).rejects.toBeInstanceOf(AgentReadinessError);

    const fixture = await fs.readFile(path.join(fixtureDir, 'success.jsonl'), 'utf-8');
    mockSpawn.mockReturnValue(createFakeChild(fixture));

    const status = await service.startAgent(task.id, 'codex', {
      overrideReason: 'Maintainer approved urgent fix',
    });

    expect(status.status).toBe('running');
    expect(mockLogActivity).toHaveBeenCalledWith(
      'agent_event',
      task.id,
      task.title,
      expect.objectContaining({
        event: 'readiness_override',
        overrideReason: 'Maintainer approved urgent fix',
        missingChecks: expect.arrayContaining([
          expect.objectContaining({ id: 'acceptance' }),
          expect.objectContaining({ id: 'verification' }),
        ]),
      }),
      'codex'
    );
    await waitFor(() => {
      expect(mockUpdateTask).toHaveBeenCalledWith(
        task.id,
        expect.objectContaining({ status: 'done' })
      );
    });
    await waitFor(async () => {
      expect(await service.getAgentStatus(task.id)).toBeNull();
    });
  });
});
