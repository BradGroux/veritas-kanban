import { describe, expect, it, vi } from 'vitest';
import type {
  AgentHostCompatibilityResponse,
  CreateTemplateInput,
  Task,
  TaskTemplate,
} from '@veritas-kanban/shared';
import { SessionTemplateService } from '../services/session-template-service.js';
import type { WorkflowDefinition, WorkflowRun } from '../types/workflow.js';

const now = '2026-06-05T12:00:00.000Z';

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task_584',
    title: 'Add session template recommendations',
    description: 'Distill successful workflow launches into reviewable draft templates.',
    type: 'feature',
    status: 'done',
    priority: 'critical',
    project: 'veritas-kanban',
    created: '2026-06-05T10:00:00.000Z',
    updated: now,
    git: {
      repo: 'veritas-kanban',
      branch: 'feature/session-template-recommendations-584',
      baseBranch: 'main',
      worktreePath: '/Users/bradgroux/Projects/veritas-kanban',
    },
    ...overrides,
  };
}

function workflow(): WorkflowDefinition {
  return {
    id: 'workflow_launch',
    name: 'Launch workflow',
    version: 1,
    description: 'Run a verified launch workflow.',
    variables: {
      cwd: '/Users/bradgroux/Projects/veritas-kanban',
    },
    outputTargets: [
      {
        type: 'work-product',
        label: 'PR summary',
        required: true,
        path: 'artifacts/pr-summary.md',
      },
    ],
    agents: [
      {
        id: 'builder',
        name: 'Builder',
        role: 'developer',
        model: 'gpt-5',
        provider: 'codex-cli',
        description: 'Implements the workflow.',
      },
    ],
    steps: [
      {
        id: 'implement',
        name: 'Implement',
        type: 'agent',
        agent: 'builder',
        input: 'Implement the task and preserve existing architecture.',
        acceptance_criteria: ['pnpm typecheck', 'pnpm build'],
        session: {
          mode: 'fresh',
          context: 'custom',
          cleanup: 'keep',
          timeout: 3600,
          includeOutputsFrom: ['plan'],
        },
        output: { file: 'implementation.md' },
      },
      {
        id: 'verify',
        name: 'Verify',
        type: 'gate',
        condition: 'steps.implement.status == "completed"',
        acceptance_criteria: ['All required gates pass'],
      },
    ],
  };
}

function completedRun(sourceTask = task()): WorkflowRun {
  return {
    id: 'run_success_584',
    workflowId: 'workflow_launch',
    workflowVersion: 1,
    taskId: sourceTask.id,
    status: 'completed',
    context: {
      task: sourceTask,
      cwd: '/Users/bradgroux/Projects/veritas-kanban',
      rawProviderOutput: 'SECRET_PROVIDER_PAYLOAD_SHOULD_NOT_BE_DISTILLED',
    },
    startedAt: '2026-06-05T10:30:00.000Z',
    completedAt: now,
    steps: [
      {
        stepId: 'implement',
        status: 'completed',
        agent: 'builder',
        startedAt: '2026-06-05T10:30:00.000Z',
        completedAt: '2026-06-05T11:30:00.000Z',
        retries: 1,
        output: '/tmp/veritas/step-outputs/implementation.md',
      },
      {
        stepId: 'verify',
        status: 'completed',
        retries: 0,
      },
    ],
  };
}

function hostPreview(): AgentHostCompatibilityResponse {
  return {
    generatedAt: now,
    request: {
      agent: 'builder',
      model: 'gpt-5',
      workspacePath: '/Users/bradgroux/Projects/veritas-kanban',
      autoRouting: true,
    },
    decision: {
      policy: 'first-capable-healthy',
      selectedHostId: 'host-local',
      selectedHostName: 'Local host',
      reason: 'Selected first compatible host.',
      excludedHostIds: [],
    },
    previews: [
      {
        hostId: 'host-local',
        hostName: 'Local host',
        posture: 'connected',
        compatible: true,
        checks: [],
        reasons: [],
        warnings: [],
      },
    ],
  };
}

describe('SessionTemplateService', () => {
  it('distills a completed verified run into a review-required launch template', async () => {
    const sourceWorkflow = workflow();
    const sourceRun = completedRun();
    const createTemplate = vi.fn(async (input: CreateTemplateInput): Promise<TaskTemplate> => {
      return {
        id: 'template_launch_584',
        version: 1,
        created: now,
        updated: now,
        ...input,
      };
    });
    const service = new SessionTemplateService({
      templateService: {
        createTemplate,
        getTemplates: vi.fn().mockResolvedValue([]),
      },
      workflowRunService: {
        getRun: vi.fn().mockResolvedValue(sourceRun),
        listRuns: vi.fn().mockResolvedValue([]),
      },
      workflowService: {
        loadWorkflow: vi.fn().mockResolvedValue(sourceWorkflow),
      },
      agentHostService: {
        preview: vi.fn().mockReturnValue(hostPreview()),
      },
      taskService: {
        getTask: vi.fn().mockResolvedValue(task()),
      },
    });

    const template = await service.distillTemplateFromRun({ runId: sourceRun.id });

    expect(createTemplate).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Draft: Launch workflow',
        category: 'workflow-launch',
        taskDefaults: expect.objectContaining({
          type: 'feature',
          priority: 'high',
          project: 'veritas-kanban',
          agent: 'builder',
        }),
      })
    );
    expect(template.launch).toMatchObject({
      status: 'draft',
      distilledFromRunId: sourceRun.id,
      sourceWorkflowId: sourceWorkflow.id,
      sourceTaskId: 'task_584',
      promptTemplate: 'Implement the task and preserve existing architecture.',
      session: {
        agent: 'builder',
        model: 'gpt-5',
        cwd: '/Users/bradgroux/Projects/veritas-kanban',
        mode: 'fresh',
        context: 'custom',
        cleanup: 'keep',
      },
      inheritsProjectDefaults: true,
    });
    expect(template.launch?.contextRequirements).toContain('Output from plan');
    expect(template.launch?.verificationGates).toEqual(
      expect.arrayContaining([
        'Implement: pnpm typecheck',
        'Implement: pnpm build',
        'Gate passed: Verify',
        'Required output: PR summary',
      ])
    );
    expect(template.launch?.expectedArtifacts).toEqual(
      expect.arrayContaining(['implementation.md', 'artifacts/pr-summary.md'])
    );
    expect(template.launch?.knownGotchas).toContain('implement required 1 retry.');
    expect(template.launch?.provenance).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'run', id: sourceRun.id }),
        expect.objectContaining({ type: 'workflow', id: sourceWorkflow.id }),
        expect.objectContaining({ type: 'task', id: 'task_584' }),
        expect.objectContaining({ type: 'artifact', id: 'implementation.md' }),
      ])
    );
    expect(JSON.stringify(template)).not.toContain(
      'SECRET_PROVIDER_PAYLOAD_SHOULD_NOT_BE_DISTILLED'
    );
  });

  it('recommends templates, agents, models, and compatible hosts with advisory override data', async () => {
    const sourceWorkflow = workflow();
    const sourceRun = completedRun();
    const launchTemplate: TaskTemplate = {
      id: 'template_launch_584',
      name: 'Reviewed launch template',
      version: 1,
      category: 'workflow-launch',
      taskDefaults: {
        type: 'feature',
        priority: 'high',
        project: 'veritas-kanban',
        agent: 'builder',
      },
      launch: {
        status: 'active',
        distilledFromRunId: sourceRun.id,
        sourceWorkflowId: sourceWorkflow.id,
        sourceTaskId: 'task_584',
        session: {
          agent: 'builder',
          model: 'gpt-5',
          cwd: '/Users/bradgroux/Projects/veritas-kanban',
        },
        verificationGates: ['pnpm typecheck'],
        reasonCodes: ['source-run:completed'],
        provenance: [{ type: 'run', id: sourceRun.id, label: sourceWorkflow.id }],
      },
      created: now,
      updated: now,
    };
    const preview = vi.fn().mockReturnValue(hostPreview());
    const service = new SessionTemplateService({
      templateService: {
        createTemplate: vi.fn(),
        getTemplates: vi.fn().mockResolvedValue([launchTemplate]),
      },
      workflowRunService: {
        getRun: vi.fn(),
        listRuns: vi.fn().mockResolvedValue([sourceRun]),
      },
      workflowService: {
        loadWorkflow: vi.fn().mockResolvedValue(sourceWorkflow),
      },
      agentHostService: { preview },
      taskService: {
        getTask: vi.fn().mockResolvedValue(task()),
      },
    });

    const result = await service.getLaunchRecommendations({
      workflowId: sourceWorkflow.id,
      taskId: 'task_584',
      project: 'veritas-kanban',
      taskType: 'feature',
      cwd: '/Users/bradgroux/Projects/veritas-kanban',
      verificationGates: ['Implement: pnpm typecheck'],
    });

    expect(preview).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: 'builder',
        model: 'gpt-5',
        workspacePath: '/Users/bradgroux/Projects/veritas-kanban',
        autoRouting: true,
        verificationGates: ['Implement: pnpm typecheck'],
      })
    );
    expect(result.context).toMatchObject({
      workflowId: sourceWorkflow.id,
      taskId: 'task_584',
      project: 'veritas-kanban',
      taskType: 'feature',
      cwd: '/Users/bradgroux/Projects/veritas-kanban',
    });
    expect(result.recommendations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'template',
          templateId: launchTemplate.id,
          templateStatus: 'active',
          overrides: expect.objectContaining({ templateId: launchTemplate.id, agent: 'builder' }),
          provenance: expect.arrayContaining([
            expect.objectContaining({ type: 'run', id: sourceRun.id }),
          ]),
          reasonCodes: expect.arrayContaining(['source-run:matched', 'template-status:active']),
        }),
        expect.objectContaining({
          kind: 'agent',
          agent: 'builder',
          overrides: { agent: 'builder' },
          reasonCodes: expect.arrayContaining(['agent:source-run', 'workflow:matched']),
        }),
        expect.objectContaining({
          kind: 'model',
          model: 'gpt-5',
          overrides: { model: 'gpt-5' },
        }),
        expect.objectContaining({
          kind: 'host',
          hostId: 'host-local',
          hostName: 'Local host',
          overrides: { hostId: 'host-local' },
          reasonCodes: expect.arrayContaining(['host:compatible', 'host-posture:connected']),
        }),
      ])
    );
    expect(
      result.recommendations.every((item) => item.confidence >= 0.2 && item.confidence <= 0.95)
    ).toBe(true);
  });
});
