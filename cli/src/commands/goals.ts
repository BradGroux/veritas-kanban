import { Command } from 'commander';
import chalk from 'chalk';
import type {
  DurableGoalBlocker,
  DurableGoalCompletionEvidence,
  DurableGoalCompletionRequirement,
  DurableGoalContinuationMode,
  DurableGoalRecord,
  DurableGoalState,
} from '@veritas-kanban/shared';
import { DURABLE_GOAL_STATES } from '@veritas-kanban/shared';
import { api } from '../utils/api.js';

interface GoalListResponse {
  generatedAt: string;
  goals: DurableGoalRecord[];
}

type GoalBlockerInput = Omit<DurableGoalBlocker, 'id' | 'recordedAt'> & { id?: string };

const VERIFICATION_KINDS = new Set(['test', 'build', 'artifact', 'operator', 'external', 'other']);

export function registerGoalCommands(program: Command): void {
  const goals = program
    .command('goals')
    .description('Create, inspect, and control durable objectives');

  goals
    .command('list')
    .description('List durable goals in the current workspace')
    .option('--state <states...>', 'Filter by goal state')
    .option('--root-task <id>', 'Filter by root task')
    .option('--root-workflow <id>', 'Filter by root workflow')
    .option('--limit <count>', 'Maximum goals', '100')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      try {
        const query = new URLSearchParams();
        for (const state of (options.state ?? []) as DurableGoalState[]) {
          query.append('state', state);
        }
        if (options.rootTask) query.set('rootTaskId', options.rootTask);
        if (options.rootWorkflow) query.set('rootWorkflowId', options.rootWorkflow);
        query.set('limit', options.limit);
        const result = await api<GoalListResponse>(`/api/goals?${query.toString()}`);
        if (options.json) return printJson(result);
        if (result.goals.length === 0) {
          console.log(chalk.dim('No durable goals matched.'));
          return;
        }
        for (const goal of result.goals) printGoal(goal);
      } catch (error) {
        printError(error);
      }
    });

  goals
    .command('get <id>')
    .description('Inspect one durable goal')
    .option('--json', 'Output as JSON')
    .action(async (id, options) => {
      try {
        const goal = await api<DurableGoalRecord>(`/api/goals/${encodeURIComponent(id)}`);
        if (options.json) return printJson(goal);
        printGoal(goal, true);
      } catch (error) {
        printError(error);
      }
    });

  goals
    .command('create')
    .description('Create an evidence-gated durable goal')
    .requiredOption('--objective <text>', 'Goal objective')
    .requiredOption('--acceptance <criteria...>', 'Acceptance criteria')
    .requiredOption(
      '--requirement <requirements...>',
      'Completion requirement as id|kind|description'
    )
    .option('--constraint <constraints...>', 'Goal constraints')
    .option('--root-task <id>', 'Root task identity')
    .option('--root-workflow <id>', 'Root workflow identity')
    .option('--task <id>', 'Optional task associated with a root workflow')
    .option('--mode <mode>', 'Continuation mode: manual or automatic', 'manual')
    .option('--max-turns <count>', 'Maximum continuation turns')
    .option('--max-rollovers <count>', 'Maximum conversation rollovers')
    .option('--compact-after-tokens <count>', 'Compaction threshold')
    .option('--require-rollover-approval', 'Require approval before rollover')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      try {
        if (Boolean(options.rootTask) === Boolean(options.rootWorkflow)) {
          throw new Error('Specify exactly one of --root-task or --root-workflow.');
        }
        if (!['manual', 'automatic'].includes(options.mode)) {
          throw new Error('--mode must be manual or automatic.');
        }
        const completionRequirements = (options.requirement as string[]).map(
          parseCompletionRequirement
        );
        const root = options.rootTask
          ? { kind: 'task' as const, taskId: options.rootTask }
          : {
              kind: 'workflow' as const,
              workflowId: options.rootWorkflow,
              ...(options.task ? { taskId: options.task } : {}),
            };
        const goal = await api<DurableGoalRecord>('/api/goals', {
          method: 'POST',
          body: JSON.stringify({
            objective: options.objective,
            constraints: options.constraint ?? [],
            acceptanceCriteria: options.acceptance,
            root,
            continuation: {
              mode: options.mode as DurableGoalContinuationMode,
              ...(options.maxTurns ? { maxTurns: parsePositiveInteger(options.maxTurns) } : {}),
              ...(options.maxRollovers
                ? { maxRollovers: parseNonnegativeInteger(options.maxRollovers) }
                : {}),
              ...(options.compactAfterTokens
                ? { compactAfterTokens: parsePositiveInteger(options.compactAfterTokens) }
                : {}),
              ...(options.requireRolloverApproval ? { requireApprovalForRollover: true } : {}),
            },
            completionRequirements,
          }),
        });
        if (options.json) return printJson(goal);
        console.log(chalk.green(`✓ Created durable goal ${goal.id}`));
        printGoal(goal);
      } catch (error) {
        printError(error);
      }
    });

  goals
    .command('transition <id>')
    .description('Apply one compare-and-set goal state transition')
    .requiredOption('--revision <number>', 'Expected goal revision')
    .requiredOption('--state <state>', `New state: ${DURABLE_GOAL_STATES.join(', ')}`)
    .requiredOption('--reason <text>', 'Operator reason')
    .option('--blocker-json <json>', 'Actionable blocker JSON for blocked state')
    .option('--evidence-json <json>', 'Completion evidence JSON array')
    .option('--json', 'Output as JSON')
    .action(async (id, options) => {
      try {
        if (!DURABLE_GOAL_STATES.includes(options.state as DurableGoalState)) {
          throw new Error(`Unknown goal state: ${options.state}`);
        }
        const blocker = options.blockerJson
          ? parseJson<GoalBlockerInput>(options.blockerJson, '--blocker-json')
          : undefined;
        const completionEvidence = options.evidenceJson
          ? parseJson<
              Array<Pick<DurableGoalCompletionEvidence, 'requirementId' | 'evidenceId' | 'summary'>>
            >(options.evidenceJson, '--evidence-json')
          : undefined;
        const goal = await api<DurableGoalRecord>(
          `/api/goals/${encodeURIComponent(id)}/transition`,
          {
            method: 'POST',
            body: JSON.stringify({
              expectedRevision: parsePositiveInteger(options.revision),
              state: options.state,
              reason: options.reason,
              blocker,
              completionEvidence,
            }),
          }
        );
        if (options.json) return printJson(goal);
        console.log(chalk.green(`✓ Goal ${goal.id} is ${goal.state} at revision ${goal.revision}`));
      } catch (error) {
        printError(error);
      }
    });

  goals
    .command('link-run <id>')
    .description('Link one run or continuation to a durable goal')
    .requiredOption('--revision <number>', 'Expected goal revision')
    .requiredOption('--task <id>', 'Run task identity')
    .option('--attempt <id>', 'Attempt identity')
    .option('--workflow-run <id>', 'Workflow run identity')
    .option('--conversation <id>', 'Conversation identity')
    .option('--parent-attempt <id>', 'Causal parent attempt')
    .option('--json', 'Output as JSON')
    .action(async (id, options) => {
      try {
        const goal = await api<DurableGoalRecord>(`/api/goals/${encodeURIComponent(id)}/runs`, {
          method: 'POST',
          body: JSON.stringify({
            expectedRevision: parsePositiveInteger(options.revision),
            taskId: options.task,
            attemptId: options.attempt,
            workflowRunId: options.workflowRun,
            conversationId: options.conversation,
            parentAttemptId: options.parentAttempt,
          }),
        });
        if (options.json) return printJson(goal);
        console.log(chalk.green(`✓ Linked run to goal ${goal.id} at revision ${goal.revision}`));
      } catch (error) {
        printError(error);
      }
    });
}

function parseCompletionRequirement(value: string): DurableGoalCompletionRequirement {
  const [id, verificationKind, ...descriptionParts] = value.split('|');
  const description = descriptionParts.join('|').trim();
  if (!id?.trim() || !verificationKind?.trim() || !description) {
    throw new Error(`Invalid requirement "${value}"; expected id|kind|description.`);
  }
  if (!VERIFICATION_KINDS.has(verificationKind)) {
    throw new Error(`Invalid verification kind "${verificationKind}".`);
  }
  return {
    id: id.trim(),
    verificationKind: verificationKind as DurableGoalCompletionRequirement['verificationKind'],
    description,
    required: true,
  };
}

function parsePositiveInteger(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`Expected a positive integer.`);
  return parsed;
}

function parseNonnegativeInteger(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`Expected a nonnegative integer.`);
  return parsed;
}

function parseJson<T>(value: string, option: string): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    throw new Error(`${option} must contain valid JSON.`);
  }
}

function printGoal(goal: DurableGoalRecord, verbose = false): void {
  const state =
    goal.state === 'active'
      ? chalk.green(goal.state)
      : ['complete'].includes(goal.state)
        ? chalk.blue(goal.state)
        : ['cancelled', 'failed'].includes(goal.state)
          ? chalk.red(goal.state)
          : chalk.yellow(goal.state);
  console.log(`${state} ${chalk.bold(goal.id)} revision=${goal.revision}`);
  console.log(`  ${goal.objective}`);
  if (verbose) {
    console.log(
      chalk.dim(
        `  root=${goal.root.kind === 'task' ? goal.root.taskId : goal.root.workflowId} runs=${goal.continuationChain.length} blockers=${goal.blockers.length} evidence=${goal.completionEvidence.length}/${goal.completionRequirements.length}`
      )
    );
  }
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

function printError(error: unknown): void {
  console.error(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
  process.exitCode = 1;
}
