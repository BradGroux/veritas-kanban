import path from 'path';
import type {
  AgentHostCompatibilityResponse,
  AgentType,
  CreateTemplateInput,
  DistillTemplateFromRunInput,
  LaunchRecommendation,
  LaunchRecommendationsResponse,
  LaunchTemplateMetadata,
  TaskTemplate,
  TemplateProvenanceLink,
} from '@veritas-kanban/shared';
import type { Task } from '@veritas-kanban/shared';
import type {
  StepSessionConfig,
  WorkflowAgent,
  WorkflowDefinition,
  WorkflowRun,
  WorkflowStep,
} from '../types/workflow.js';
import { BadRequestError, NotFoundError, ValidationError } from '../middleware/error-handler.js';
import { getAgentHostService, AgentHostService } from './agent-host-service.js';
import { getTaskService } from './task-service.js';
import { TemplateService } from './template-service.js';
import { getWorkflowRunService, WorkflowRunService } from './workflow-run-service.js';
import { getWorkflowService, WorkflowService } from './workflow-service.js';

const MAX_RECOMMENDATION_RUNS = 50;
const MAX_RECOMMENDATIONS = 6;

interface SessionTemplateServiceOptions {
  templateService?: Pick<TemplateService, 'createTemplate' | 'getTemplates'>;
  workflowRunService?: Pick<WorkflowRunService, 'getRun' | 'listRuns'>;
  workflowService?: Pick<WorkflowService, 'loadWorkflow'>;
  agentHostService?: Pick<AgentHostService, 'preview'>;
  taskService?: { getTask(id: string): Promise<Task | null> };
}

interface RecommendationRequest {
  workflowId?: string;
  taskId?: string;
  project?: string;
  taskType?: string;
  cwd?: string;
  verificationGates?: string[];
}

interface ScoredRun {
  run: WorkflowRun;
  workflow: WorkflowDefinition | null;
  score: number;
  reasonCodes: string[];
  verificationGates: string[];
  taskProject?: string;
  taskType?: string;
  cwd?: string;
}

export class SessionTemplateService {
  private readonly templateService: Pick<TemplateService, 'createTemplate' | 'getTemplates'>;
  private readonly workflowRunService: Pick<WorkflowRunService, 'getRun' | 'listRuns'>;
  private readonly workflowService: Pick<WorkflowService, 'loadWorkflow'>;
  private readonly agentHostService: Pick<AgentHostService, 'preview'>;
  private readonly taskService: { getTask(id: string): Promise<Task | null> };

  constructor(options: SessionTemplateServiceOptions = {}) {
    this.templateService = options.templateService ?? new TemplateService();
    this.workflowRunService = options.workflowRunService ?? getWorkflowRunService();
    this.workflowService = options.workflowService ?? getWorkflowService();
    this.agentHostService = options.agentHostService ?? getAgentHostService();
    this.taskService = options.taskService ?? getTaskService();
  }

  async distillTemplateFromRun(input: DistillTemplateFromRunInput): Promise<TaskTemplate> {
    const run = await this.workflowRunService.getRun(input.runId);
    if (!run) {
      throw new NotFoundError(`Workflow run ${input.runId} not found`);
    }
    if (run.status !== 'completed') {
      throw new ValidationError(`Run ${run.id} must be completed before distillation`);
    }

    const workflow = await this.workflowService.loadWorkflow(run.workflowId);
    if (!workflow) {
      throw new NotFoundError(`Workflow ${run.workflowId} not found`);
    }

    const sourceStep = firstCompletedAgentStep(run, workflow);
    if (!sourceStep) {
      throw new BadRequestError('Completed run does not contain a completed agent step');
    }

    const agent = workflow.agents.find((item) => item.id === sourceStep.step.agent);
    const task = await this.taskFromRun(run);
    const verificationGates = collectVerificationGates(workflow, run);
    const expectedArtifacts = collectExpectedArtifacts(workflow, run);
    const promptTemplate = sourceStep.step.input?.trim() || workflow.description;
    const metadata: LaunchTemplateMetadata = {
      status: 'draft',
      distilledFromRunId: run.id,
      sourceWorkflowId: run.workflowId,
      sourceTaskId: run.taskId,
      promptTemplate,
      contextRequirements: contextRequirements(sourceStep.step.session),
      session: {
        agent: (agent?.id ?? sourceStep.step.agent) as AgentType | undefined,
        model: agent?.model,
        project: task?.project,
        cwd: workflowCwd(workflow, run, task),
        mode: sourceStep.step.session?.mode,
        context: sourceStep.step.session?.context,
        cleanup: sourceStep.step.session?.cleanup,
        timeout: sourceStep.step.session?.timeout ?? sourceStep.step.timeout,
        includeOutputsFrom: sourceStep.step.session?.includeOutputsFrom,
      },
      verificationGates,
      expectedArtifacts,
      knownGotchas: collectKnownGotchas(run, verificationGates),
      reasonCodes: [
        'source-run:completed',
        verificationGates.length > 0
          ? 'verification-pattern:present'
          : 'verification-pattern:missing',
        agent?.model ? 'model:source-run' : 'model:unspecified',
      ],
      confidence: verificationGates.length > 0 ? 0.78 : 0.62,
      provenance: provenanceForRun(run, workflow, expectedArtifacts),
      inheritsProjectDefaults: true,
    };

    const templateInput: CreateTemplateInput = {
      name: input.name?.trim() || `Draft: ${workflow.name}`,
      description: `Draft launch template distilled from workflow run ${run.id}. Review before activation.`,
      category: 'workflow-launch',
      taskDefaults: {
        type: task?.type,
        priority: normalizePriority(task?.priority),
        project: task?.project,
        descriptionTemplate: promptTemplate,
        agent: (agent?.id ?? sourceStep.step.agent) as AgentType | undefined,
      },
      launch: metadata,
    };

    return this.templateService.createTemplate(templateInput);
  }

  async getLaunchRecommendations(
    request: RecommendationRequest
  ): Promise<LaunchRecommendationsResponse> {
    const task = request.taskId ? await this.taskService.getTask(request.taskId) : null;
    const context = {
      workflowId: request.workflowId,
      taskId: request.taskId,
      project: request.project ?? task?.project,
      taskType: request.taskType ?? task?.type,
      cwd: request.cwd ?? task?.git?.worktreePath,
      verificationGates: request.verificationGates ?? [],
    };
    const workflow = request.workflowId
      ? await this.workflowService.loadWorkflow(request.workflowId)
      : null;

    const completedRuns = (await this.workflowRunService.listRuns({ status: 'completed' })).slice(
      0,
      MAX_RECOMMENDATION_RUNS
    );
    const scoredRuns = (await Promise.all(completedRuns.map((run) => this.scoreRun(run, context))))
      .filter((item): item is ScoredRun => item !== null && item.score > 0)
      .sort((a, b) => b.score - a.score || b.run.startedAt.localeCompare(a.run.startedAt));

    const templates = await this.templateService.getTemplates();
    const recommendations: LaunchRecommendation[] = [
      ...this.templateRecommendations(templates, scoredRuns),
      ...this.agentAndModelRecommendations(workflow, scoredRuns),
      this.hostRecommendation(workflow, scoredRuns, context),
    ].filter((item): item is LaunchRecommendation => Boolean(item));

    return {
      generatedAt: new Date().toISOString(),
      context,
      recommendations: recommendations
        .sort((a, b) => b.confidence - a.confidence || a.label.localeCompare(b.label))
        .slice(0, MAX_RECOMMENDATIONS),
    };
  }

  private async scoreRun(
    run: WorkflowRun,
    context: LaunchRecommendationsResponse['context']
  ): Promise<ScoredRun | null> {
    const workflow = await this.workflowService.loadWorkflow(run.workflowId);
    const task = await this.taskFromRun(run);
    const verificationGates = workflow ? collectVerificationGates(workflow, run) : [];
    const runCwd = workflow ? workflowCwd(workflow, run, task) : undefined;
    const reasonCodes = ['source-run:completed'];
    let score = 0.25;

    if (context.workflowId && run.workflowId === context.workflowId) {
      score += 0.25;
      reasonCodes.push('workflow:matched');
    }
    if (context.project && task?.project === context.project) {
      score += 0.18;
      reasonCodes.push('project:matched');
    }
    if (context.taskType && task?.type === context.taskType) {
      score += 0.14;
      reasonCodes.push('task-type:matched');
    }
    if (context.cwd && runCwd && samePathOrRepo(runCwd, context.cwd)) {
      score += 0.1;
      reasonCodes.push('cwd:matched');
    }
    if (verificationGates.length > 0) {
      score += 0.12;
      reasonCodes.push('verification-pattern:present');
    }
    if (
      context.verificationGates.length > 0 &&
      intersects(context.verificationGates, verificationGates)
    ) {
      score += 0.08;
      reasonCodes.push('verification-pattern:matched');
    }

    return {
      run,
      workflow,
      score: Math.min(score, 1),
      reasonCodes,
      verificationGates,
      taskProject: task?.project,
      taskType: task?.type,
      cwd: runCwd,
    };
  }

  private async taskFromRun(run: WorkflowRun): Promise<Task | null> {
    const contextTask = recordValue(run.context.task) as Partial<Task> | null;
    if (contextTask?.id) return contextTask as Task;
    return run.taskId ? this.taskService.getTask(run.taskId) : null;
  }

  private templateRecommendations(
    templates: TaskTemplate[],
    scoredRuns: ScoredRun[]
  ): LaunchRecommendation[] {
    const sourceRunIds = new Set(scoredRuns.map((item) => item.run.id));
    return templates
      .filter((template) => template.launch)
      .map((template): LaunchRecommendation => {
        const linkedRunId = template.launch?.distilledFromRunId;
        const linkedRun = scoredRuns.find((item) => item.run.id === linkedRunId);
        const confidence = clampConfidence(
          (linkedRun?.score ?? 0.42) +
            (template.launch?.status === 'active' ? 0.16 : 0) +
            (linkedRunId && sourceRunIds.has(linkedRunId) ? 0.12 : 0)
        );
        const status = template.launch?.status ?? 'active';
        return {
          id: `template:${template.id}`,
          kind: 'template',
          label: template.name,
          detail:
            status === 'draft'
              ? 'Draft template is available for review before activation.'
              : 'Active launch template matches prior successful run signals.',
          confidence,
          reasonCodes: uniqueSorted([
            ...(template.launch?.reasonCodes ?? []),
            linkedRun ? 'source-run:matched' : 'source-run:available',
            `template-status:${status}`,
          ]),
          provenance: template.launch?.provenance ?? [],
          templateId: template.id,
          templateStatus: status,
          overrides: {
            templateId: template.id,
            agent: template.launch?.session?.agent ?? template.taskDefaults.agent,
            model: template.launch?.session?.model,
            hostId: template.launch?.session?.hostId,
          },
        };
      });
  }

  private agentAndModelRecommendations(
    workflow: WorkflowDefinition | null,
    scoredRuns: ScoredRun[]
  ): LaunchRecommendation[] {
    const bestAgent = topAgentSignal(workflow, scoredRuns);
    if (!bestAgent) return [];

    const provenance = bestAgent.sourceRuns.map((run) => ({
      type: 'run' as const,
      id: run.id,
      label: run.workflowId,
    }));
    return [
      {
        id: `agent:${bestAgent.agent}`,
        kind: 'agent',
        label: bestAgent.agent,
        detail: 'Recommended from prior successful runs and workflow agent defaults.',
        confidence: bestAgent.confidence,
        reasonCodes: bestAgent.reasonCodes,
        provenance,
        agent: bestAgent.agent as AgentType,
        overrides: { agent: bestAgent.agent },
      },
      ...(bestAgent.model
        ? [
            {
              id: `model:${bestAgent.model}`,
              kind: 'model' as const,
              label: bestAgent.model,
              detail: 'Recommended model from the best matching workflow agent history.',
              confidence: Math.max(bestAgent.confidence - 0.08, 0.3),
              reasonCodes: uniqueSorted([...bestAgent.reasonCodes, 'model:source-run']),
              provenance,
              model: bestAgent.model,
              overrides: { model: bestAgent.model },
            },
          ]
        : []),
    ];
  }

  private hostRecommendation(
    workflow: WorkflowDefinition | null,
    scoredRuns: ScoredRun[],
    context: LaunchRecommendationsResponse['context']
  ): LaunchRecommendation | null {
    const bestAgent = topAgentSignal(workflow, scoredRuns);
    const bestRun = scoredRuns[0];
    const verificationGates = context.verificationGates.length
      ? context.verificationGates
      : (bestRun?.verificationGates ?? []);
    const preview = this.agentHostService.preview({
      agent: bestAgent?.agent,
      model: bestAgent?.model,
      workspacePath: context.cwd ?? bestRun?.cwd,
      verificationGates,
      autoRouting: true,
    });
    const host = selectedHost(preview);
    if (!host) return null;

    return {
      id: `host:${host.hostId}`,
      kind: 'host',
      label: host.hostName,
      detail: host.compatible
        ? 'Host is compatible with the recommended launch profile.'
        : 'Host is the best available match but has compatibility warnings.',
      confidence: host.compatible ? 0.72 : 0.48,
      reasonCodes: uniqueSorted([
        host.compatible ? 'host:compatible' : 'host:warnings',
        `host-posture:${host.posture}`,
      ]),
      provenance: bestRun
        ? [{ type: 'run', id: bestRun.run.id, label: bestRun.run.workflowId }]
        : [],
      hostId: host.hostId,
      hostName: host.hostName,
      overrides: { hostId: host.hostId },
    };
  }
}

function firstCompletedAgentStep(
  run: WorkflowRun,
  workflow: WorkflowDefinition
): { run: WorkflowRun['steps'][number]; step: WorkflowStep } | null {
  for (const stepRun of run.steps) {
    if (stepRun.status !== 'completed') continue;
    const step = workflow.steps.find((item) => item.id === stepRun.stepId);
    if (step?.type === 'agent') return { run: stepRun, step };
  }
  return null;
}

function collectVerificationGates(workflow: WorkflowDefinition, run: WorkflowRun): string[] {
  const completed = new Set(
    run.steps.filter((step) => step.status === 'completed').map((step) => step.stepId)
  );
  const gates = workflow.steps.flatMap((step) => {
    const criteria = step.acceptance_criteria ?? [];
    const acceptance = criteria.map((criterion) => `${step.name}: ${criterion}`);
    const gate =
      step.type === 'gate' && completed.has(step.id) ? [`Gate passed: ${step.name}`] : [];
    return [...acceptance, ...gate];
  });
  const outputTargets =
    workflow.outputTargets
      ?.filter((target) => target.required)
      .map((target) => `Required output: ${target.label ?? target.type}`) ?? [];
  return uniqueSorted([...gates, ...outputTargets]).slice(0, 12);
}

function collectExpectedArtifacts(workflow: WorkflowDefinition, run: WorkflowRun): string[] {
  const stepArtifacts = run.steps
    .map((step) => step.output)
    .filter((item): item is string => Boolean(item))
    .map((item) => path.basename(item));
  const workflowArtifacts =
    workflow.outputTargets
      ?.map((target) => target.path ?? target.label ?? target.type)
      .filter((item): item is string => Boolean(item)) ?? [];
  return uniqueSorted([...stepArtifacts, ...workflowArtifacts]).slice(0, 12);
}

function collectKnownGotchas(run: WorkflowRun, verificationGates: string[]): string[] {
  const gotchas = run.steps
    .filter((step) => step.retries > 0 || step.status === 'skipped')
    .map((step) =>
      step.retries > 0
        ? `${step.stepId} required ${step.retries} retr${step.retries === 1 ? 'y' : 'ies'}.`
        : `${step.stepId} was skipped.`
    );
  if (verificationGates.length === 0) {
    gotchas.push('No explicit verification gate was recorded on the source run.');
  }
  return uniqueSorted(gotchas).slice(0, 8);
}

function contextRequirements(session?: StepSessionConfig): string[] {
  if (!session) return ['Task metadata', 'Workflow run metadata'];
  if (session.context === 'full')
    return ['Task metadata', 'Workflow variables', 'Prior step outputs'];
  if (session.context === 'custom') {
    return [
      'Task metadata',
      ...(session.includeOutputsFrom ?? []).map((step) => `Output from ${step}`),
    ];
  }
  return ['Task metadata', 'Workflow run metadata'];
}

function provenanceForRun(
  run: WorkflowRun,
  workflow: WorkflowDefinition,
  expectedArtifacts: string[]
): TemplateProvenanceLink[] {
  return [
    { type: 'run', id: run.id, label: `Run ${run.id}` },
    { type: 'workflow', id: workflow.id, label: workflow.name },
    ...(run.taskId ? [{ type: 'task' as const, id: run.taskId, label: `Task ${run.taskId}` }] : []),
    ...expectedArtifacts.map((artifact) => ({
      type: 'artifact' as const,
      id: artifact,
      label: artifact,
      path: artifact,
    })),
  ];
}

function workflowCwd(
  workflow: WorkflowDefinition,
  run: WorkflowRun,
  task?: Task | null
): string | undefined {
  return (
    stringValue(run.context.cwd) ??
    stringValue(run.context.workspacePath) ??
    stringValue(workflow.variables?.cwd) ??
    task?.git?.worktreePath
  );
}

function topAgentSignal(workflow: WorkflowDefinition | null, scoredRuns: ScoredRun[]) {
  const counts = new Map<
    string,
    {
      agent: string;
      model?: string;
      score: number;
      sourceRuns: WorkflowRun[];
      reasonCodes: string[];
    }
  >();

  for (const scored of scoredRuns.slice(0, 12)) {
    for (const step of scored.run.steps) {
      if (!step.agent) continue;
      const key = step.agent;
      const agentDef = scored.workflow?.agents.find((agent) => agent.id === step.agent);
      const current = counts.get(key) ?? {
        agent: key,
        model: agentDef?.model,
        score: 0,
        sourceRuns: [],
        reasonCodes: [],
      };
      current.score += scored.score;
      if (!current.model && agentDef?.model) current.model = agentDef.model;
      current.sourceRuns.push(scored.run);
      current.reasonCodes.push(...scored.reasonCodes, 'agent:source-run');
      counts.set(key, current);
    }
  }

  if (counts.size === 0 && workflow?.agents[0]) {
    const agent = workflow.agents[0];
    return {
      agent: agent.id,
      model: agent.model,
      confidence: 0.48,
      sourceRuns: [],
      reasonCodes: ['agent:workflow-default'],
    };
  }

  const best = Array.from(counts.values()).sort((a, b) => b.score - a.score)[0];
  if (!best) return null;
  return {
    agent: best.agent,
    model: best.model,
    confidence: clampConfidence(0.48 + best.score / 4),
    sourceRuns: best.sourceRuns.slice(0, 3),
    reasonCodes: uniqueSorted(best.reasonCodes),
  };
}

function selectedHost(preview: AgentHostCompatibilityResponse) {
  const selectedId = preview.decision.selectedHostId;
  return (
    preview.previews.find((host) => host.hostId === selectedId) ??
    preview.previews.find((host) => host.compatible) ??
    preview.previews[0] ??
    null
  );
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function normalizePriority(priority: Task['priority'] | undefined) {
  return priority === 'critical' ? 'high' : priority;
}

function samePathOrRepo(left: string, right: string): boolean {
  return (
    left === right ||
    left.includes(right) ||
    right.includes(left) ||
    path.basename(left) === path.basename(right)
  );
}

function intersects(left: string[], right: string[]): boolean {
  const rightSet = new Set(right.map((item) => item.toLowerCase()));
  return left.some((item) => rightSet.has(item.toLowerCase()));
}

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean))).sort();
}

function clampConfidence(value: number): number {
  return Math.max(0.2, Math.min(0.95, Number(value.toFixed(2))));
}

let sessionTemplateServiceInstance: SessionTemplateService | null = null;

export function getSessionTemplateService(): SessionTemplateService {
  if (!sessionTemplateServiceInstance) {
    sessionTemplateServiceInstance = new SessionTemplateService();
  }
  return sessionTemplateServiceInstance;
}
