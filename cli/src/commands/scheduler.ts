import { Command } from 'commander';
import chalk from 'chalk';
import { api } from '../utils/api.js';
import type {
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
