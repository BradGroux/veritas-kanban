import type { AgentType, Task } from '../types/task.types.js';

export type TaskReadinessCheckId =
  | 'objective'
  | 'acceptance'
  | 'verification'
  | 'context'
  | 'artifact'
  | 'blockers'
  | 'risk'
  | 'agent';

export type TaskReadinessSeverity = 'required' | 'warning';

export interface TaskReadinessCheck {
  id: TaskReadinessCheckId;
  label: string;
  passed: boolean;
  detail: string;
  severity: TaskReadinessSeverity;
}

export interface TaskReadinessOptions {
  isCodeTask?: boolean;
  selectedAgent?: AgentType | 'auto';
  disabledChecks?: TaskReadinessCheckId[];
  requiredChecks?: TaskReadinessCheckId[];
}

export interface TaskReadinessSummary {
  checks: TaskReadinessCheck[];
  passed: number;
  total: number;
  percent: number;
  ready: boolean;
  missingRequired: TaskReadinessCheck[];
  warnings: TaskReadinessCheck[];
}

function hasText(value: string | undefined, minLength = 12): boolean {
  return Boolean(value && value.trim().length >= minLength);
}

function descriptionMatches(task: Task, pattern: RegExp): boolean {
  return pattern.test(task.description.toLowerCase());
}

function getAcceptanceCriteriaCount(task: Task): number {
  return (task.subtasks ?? []).reduce((count, subtask) => {
    const criteriaCount =
      subtask.acceptanceCriteria?.filter((criterion) => hasText(criterion, 6)).length ?? 0;
    return count + criteriaCount;
  }, 0);
}

function buildDefaultChecks(task: Task, options: TaskReadinessOptions): TaskReadinessCheck[] {
  const isCodeTask = options.isCodeTask ?? task.type === 'code';
  const blockers =
    task.status === 'blocked' || Boolean(task.blockedReason) || Boolean(task.blockedBy?.length);
  const dependencyCount =
    (task.dependencies?.depends_on?.length ?? 0) + (task.blockedBy?.length ?? 0);
  const verificationTotal = task.verificationSteps?.length ?? 0;
  const acceptanceCriteriaCount = getAcceptanceCriteriaCount(task);
  const hasAcceptanceSignal =
    acceptanceCriteriaCount > 0 ||
    descriptionMatches(task, /acceptance criteria|definition of done|done when|success criteria/);
  const expectedArtifact =
    (task.deliverables?.length ?? 0) > 0 ||
    (task.attachments?.length ?? 0) > 0 ||
    descriptionMatches(
      task,
      /deliverable|artifact|report|handoff|output|patch|code change|evidence|completion packet/
    );
  const selectedAgent =
    options.selectedAgent && options.selectedAgent !== 'auto' ? options.selectedAgent : undefined;
  const assignedAgent =
    Boolean(selectedAgent) ||
    Boolean(task.agent && task.agent !== 'auto') ||
    Boolean(task.agents && task.agents.length > 0);

  return [
    {
      id: 'objective',
      label: 'Clear objective',
      passed: hasText(task.title, 6) && hasText(task.description, 24),
      detail: hasText(task.description, 24)
        ? 'Title and description provide enough context.'
        : 'Add a concrete description of the expected outcome.',
      severity: 'required',
    },
    {
      id: 'acceptance',
      label: 'Acceptance criteria',
      passed: hasAcceptanceSignal,
      detail:
        acceptanceCriteriaCount > 0
          ? `${acceptanceCriteriaCount} acceptance ${
              acceptanceCriteriaCount === 1 ? 'criterion' : 'criteria'
            } defined.`
          : 'Add explicit acceptance criteria or definition-of-done language.',
      severity: 'required',
    },
    {
      id: 'verification',
      label: 'Verification plan',
      passed: verificationTotal > 0,
      detail:
        verificationTotal > 0
          ? `${verificationTotal} verification step${verificationTotal === 1 ? '' : 's'} defined.`
          : 'Add at least one verification step before execution.',
      severity: 'required',
    },
    {
      id: 'context',
      label: isCodeTask ? 'Repository context' : 'Project context',
      passed: isCodeTask ? Boolean(task.git?.repo && task.git?.baseBranch) : Boolean(task.project),
      detail: isCodeTask
        ? task.git?.repo
          ? `${task.git.repo} targeting ${task.git.baseBranch || 'default branch'}.`
          : 'Select a repository and base branch for code execution.'
        : task.project
          ? `Project ${task.project} is set.`
          : 'Assign a project or add context in the task description.',
      severity: 'required',
    },
    {
      id: 'artifact',
      label: 'Expected artifact',
      passed: expectedArtifact,
      detail: expectedArtifact
        ? 'Expected output is represented by deliverables, attachments, or description.'
        : 'State the expected handoff artifact, report, code change, or evidence packet.',
      severity: 'required',
    },
    {
      id: 'blockers',
      label: 'Dependencies and blockers',
      passed: !blockers,
      detail: blockers
        ? task.blockedReason?.note || 'Task is blocked or has unresolved blockers.'
        : dependencyCount > 0
          ? `${dependencyCount} dependency link${dependencyCount === 1 ? '' : 's'} recorded.`
          : 'No active blockers detected.',
      severity: 'required',
    },
    {
      id: 'risk',
      label: 'Risk level',
      passed: Boolean(task.priority),
      detail: task.priority
        ? `Priority is set to ${task.priority}.`
        : 'Set a priority so execution risk is explicit.',
      severity: 'required',
    },
    {
      id: 'agent',
      label: 'Agent or workflow path',
      passed: assignedAgent || Boolean(task.runMode) || !isCodeTask,
      detail:
        assignedAgent || task.runMode
          ? `Execution path: ${
              selectedAgent ||
              (task.agent && task.agent !== 'auto' ? task.agent : task.runMode || 'configured')
            }.`
          : 'Pick an agent, run mode, or workflow before starting.',
      severity: 'required',
    },
  ];
}

export function getTaskReadinessChecks(
  task: Task,
  options: TaskReadinessOptions = {}
): TaskReadinessCheck[] {
  const disabledChecks = new Set(options.disabledChecks ?? []);
  const requiredChecks = new Set(options.requiredChecks ?? []);

  return buildDefaultChecks(task, options)
    .filter((check) => !disabledChecks.has(check.id))
    .map((check) => ({
      ...check,
      severity: requiredChecks.has(check.id) ? 'required' : check.severity,
    }));
}

export function evaluateTaskReadiness(
  task: Task,
  options: TaskReadinessOptions = {}
): TaskReadinessSummary {
  const checks = getTaskReadinessChecks(task, options);
  const passed = checks.filter((check) => check.passed).length;
  const total = checks.length;
  const missingRequired = checks.filter((check) => !check.passed && check.severity === 'required');
  const warnings = checks.filter((check) => !check.passed && check.severity === 'warning');

  return {
    checks,
    passed,
    total,
    percent: total > 0 ? Math.round((passed / total) * 100) : 100,
    ready: missingRequired.length === 0,
    missingRequired,
    warnings,
  };
}
