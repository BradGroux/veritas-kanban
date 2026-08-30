import { Command } from 'commander';
import chalk from 'chalk';
import { api } from '../utils/api.js';
import type {
  AutomationDraft,
  AutomationDraftHints,
  AutomationDraftListResponse,
  SchedulerDueRunResult,
  SchedulerItem,
  SchedulerListResponse,
  SchedulerRunResult,
  SchedulerValidationResult,
} from '@veritas-kanban/shared';

export function registerSchedulerCommands(program: Command): void {
  const scheduler = program
    .command('scheduler')
    .alias('schedule')
    .description('Inspect and control recurring Veritas work');

  const drafts = scheduler
    .command('draft')
    .description('Preview and manage inactive automation drafts');

  for (const action of ['preview', 'save', 'revise'] as const) {
    const command = drafts
      .command(action === 'revise' ? 'revise <draftId>' : action)
      .description(
        action === 'preview'
          ? 'Compile recurring intent without saving or activating it'
          : action === 'save'
            ? 'Save an inactive automation draft'
            : 'Append an immutable inactive draft revision'
      )
      .requiredOption('--intent <text>', 'Recurring-work objective')
      .requiredOption('--request-id <id>', 'Stable request ID')
      .option('--hints <json>', 'Structured automation draft hints as JSON', '{}')
      .option('--json', 'Output as JSON');
    command.action(async (...args: unknown[]) => {
      const options = args.at(-2) as {
        intent: string;
        requestId: string;
        hints: string;
        json?: boolean;
      };
      const draftId = action === 'revise' ? String(args[0]) : undefined;
      try {
        const body = {
          intent: options.intent,
          requestId: options.requestId,
          hints: parseHints(options.hints),
        };
        const path =
          action === 'preview'
            ? '/api/scheduler/drafts/preview'
            : action === 'save'
              ? '/api/scheduler/drafts'
              : `/api/scheduler/drafts/${encodeURIComponent(draftId as string)}/revisions`;
        const draft = await api<AutomationDraft>(path, {
          method: 'POST',
          body: JSON.stringify(body),
        });
        printDraft(draft, Boolean(options.json));
      } catch (err) {
        printError(err);
      }
    });
  }

  drafts
    .command('list')
    .description('List latest inactive automation draft revisions')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      try {
        const result = await api<AutomationDraftListResponse>('/api/scheduler/drafts');
        if (options.json) console.log(JSON.stringify(result, null, 2));
        else result.drafts.forEach((draft) => printDraft(draft, false));
      } catch (err) {
        printError(err);
      }
    });

  drafts
    .command('show <draftId>')
    .description('Inspect an inactive automation draft')
    .option('--revision <number>', 'Specific immutable revision')
    .option('--json', 'Output as JSON')
    .action(async (draftId, options) => {
      try {
        const query = options.revision ? `?revision=${encodeURIComponent(options.revision)}` : '';
        const draft = await api<AutomationDraft>(
          `/api/scheduler/drafts/${encodeURIComponent(draftId)}${query}`
        );
        printDraft(draft, Boolean(options.json));
      } catch (err) {
        printError(err);
      }
    });

  drafts
    .command('clone <draftId>')
    .description('Clone an inactive draft without activating it')
    .requiredOption('--request-id <id>', 'Stable request ID')
    .option('--json', 'Output as JSON')
    .action(async (draftId, options) => {
      try {
        const draft = await api<AutomationDraft>(
          `/api/scheduler/drafts/${encodeURIComponent(draftId)}/clone`,
          { method: 'POST', body: JSON.stringify({ requestId: options.requestId }) }
        );
        printDraft(draft, Boolean(options.json));
      } catch (err) {
        printError(err);
      }
    });

  drafts
    .command('delete <draftId>')
    .description('Delete all inactive revisions of a draft')
    .requiredOption('--confirm <id>', 'Exact draft ID confirmation')
    .option('--json', 'Output as JSON')
    .action(async (draftId, options) => {
      try {
        if (draftId !== options.confirm) throw new Error('Confirmation must match the draft ID.');
        const result = await api<{ deleted: boolean; revisionsDeleted: number }>(
          `/api/scheduler/drafts/${encodeURIComponent(draftId)}?confirm=${encodeURIComponent(options.confirm)}`,
          { method: 'DELETE' }
        );
        if (options.json) console.log(JSON.stringify(result, null, 2));
        else console.log(chalk.green(`Deleted ${result.revisionsDeleted} inactive revisions.`));
      } catch (err) {
        printError(err);
      }
    });

  scheduler
    .command('list')
    .alias('status')
    .description('List recurring work scheduler items')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      try {
        const result = await api<SchedulerListResponse>('/api/scheduler');
        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }
        printSummary(result);
        for (const item of result.items) printItem(item);
      } catch (err) {
        printError(err);
      }
    });

  scheduler
    .command('run <itemId>')
    .description('Run a scheduler item now')
    .option('--json', 'Output as JSON')
    .action(async (itemId, options) => {
      await runItemAction(itemId, 'run', options.json);
    });

  scheduler
    .command('pause <itemId>')
    .description('Pause a scheduler item')
    .option('--json', 'Output as JSON')
    .action(async (itemId, options) => {
      await runItemAction(itemId, 'pause', options.json);
    });

  scheduler
    .command('resume <itemId>')
    .description('Resume a scheduler item')
    .option('--json', 'Output as JSON')
    .action(async (itemId, options) => {
      await runItemAction(itemId, 'resume', options.json);
    });

  scheduler
    .command('validate <itemId>')
    .description('Validate a scheduler item')
    .option('--json', 'Output as JSON')
    .action(async (itemId, options) => {
      try {
        const result = await api<SchedulerValidationResult>(
          `/api/scheduler/items/${encodeURIComponent(itemId)}/validate`,
          { method: 'POST' }
        );
        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }
        if (result.ok) {
          console.log(chalk.green(`Valid: ${itemId}`));
          return;
        }
        console.log(chalk.yellow(`Validation issues: ${itemId}`));
        for (const issue of result.issues) {
          console.log(`  ${issue.severity}: ${issue.path} - ${issue.message}`);
        }
        process.exitCode = result.issues.some((issue) => issue.severity === 'error') ? 1 : 0;
      } catch (err) {
        printError(err);
      }
    });

  scheduler
    .command('run-due')
    .description('Run all scheduler items due now')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      try {
        const result = await api<SchedulerDueRunResult>('/api/scheduler/due/run', {
          method: 'POST',
        });
        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }
        console.log(
          chalk.green(
            `Checked ${result.checked}, executed ${result.executed}, skipped ${result.skipped}, failed ${result.failed}`
          )
        );
        if (result.overlapping) console.log(chalk.yellow('Due runner already active.'));
      } catch (err) {
        printError(err);
      }
    });
}

function parseHints(value: string): AutomationDraftHints {
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Draft hints must be a JSON object.');
  }
  return parsed as AutomationDraftHints;
}

function printDraft(draft: AutomationDraft, json: boolean): void {
  if (json) {
    console.log(JSON.stringify(draft, null, 2));
    return;
  }
  const status = draft.validation.valid
    ? chalk.green('ready for activation review')
    : chalk.yellow(
        `${draft.validation.issues.filter((issue) => issue.severity === 'blocker').length} blockers`
      );
  console.log(`${chalk.bold(draft.id)} revision=${draft.revision} ${status}`);
  console.log(`  ${draft.objective.value ?? 'No objective'}`);
  console.log(
    `  schedule=${draft.schedule.expression.value ?? 'unresolved'} timezone=${draft.schedule.timezone.value ?? 'unresolved'}`
  );
}

async function runItemAction(
  itemId: string,
  action: 'run' | 'pause' | 'resume',
  json: boolean
): Promise<void> {
  try {
    const result = await api<SchedulerRunResult>(
      `/api/scheduler/items/${encodeURIComponent(itemId)}/${action}`,
      { method: 'POST' }
    );
    if (json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    console.log(chalk.green(`${action}: ${result.event.summary}`));
    if (result.event.sourceRunId) console.log(chalk.dim(`Run: ${result.event.sourceRunId}`));
  } catch (err) {
    printError(err);
  }
}

function printSummary(result: SchedulerListResponse): void {
  console.log(chalk.bold('\nRecurring Work Scheduler'));
  console.log(
    chalk.dim(
      `total=${result.summary.total} enabled=${result.summary.enabled} due=${result.summary.due} failed=${result.summary.failed} blocked=${result.summary.blocked}`
    )
  );
  console.log();
}

function printItem(item: SchedulerItem): void {
  const status = item.health === 'healthy' ? chalk.green(item.health) : chalk.yellow(item.health);
  console.log(`${chalk.bold(item.id)} ${status}`);
  console.log(`  ${item.name}`);
  console.log(`  schedule=${item.trigger.description} next=${item.nextRunAt ?? 'not set'}`);
  if (item.lastSummary) console.log(chalk.dim(`  last=${item.lastSummary}`));
}

function printError(err: unknown): never {
  console.error(chalk.red(`Error: ${err instanceof Error ? err.message : String(err)}`));
  process.exit(1);
}
