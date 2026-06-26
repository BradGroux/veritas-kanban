import { Command } from 'commander';
import chalk from 'chalk';
import { api } from '../utils/api.js';
import type {
  QueueMonitorExplainResult,
  QueueMonitorHealthResult,
  QueueMonitorListResponse,
  QueueMonitorRunResult,
  QueueMonitorSnapshot,
} from '@veritas-kanban/shared';

export function registerQueueMonitorCommands(program: Command): void {
  const monitors = program
    .command('queue-monitors')
    .alias('queue-monitor')
    .alias('queues')
    .description('Inspect and run policy-gated GitHub queue intake monitors');

  monitors
    .command('list')
    .alias('status')
    .description('List configured queue intake monitors')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      try {
        const result = await api<QueueMonitorListResponse>('/api/queue-monitors');
        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }
        printSummary(result);
        for (const monitor of result.monitors) printMonitor(monitor);
      } catch (err) {
        printError(err);
      }
    });

  monitors
    .command('run <monitorId>')
    .description('Run a queue intake monitor once')
    .option('--json', 'Output as JSON')
    .action(async (monitorId, options) => runAction(monitorId, 'run', options.json));

  monitors
    .command('pause <monitorId>')
    .description('Pause a queue intake monitor')
    .option('--json', 'Output as JSON')
    .action(async (monitorId, options) => runAction(monitorId, 'pause', options.json));

  monitors
    .command('resume <monitorId>')
    .description('Resume a queue intake monitor')
    .option('--json', 'Output as JSON')
    .action(async (monitorId, options) => runAction(monitorId, 'resume', options.json));

  monitors
    .command('health <monitorId>')
    .description('Show queue monitor health')
    .option('--json', 'Output as JSON')
    .action(async (monitorId, options) => {
      try {
        const result = await api<QueueMonitorHealthResult>(
          `/api/queue-monitors/${encodeURIComponent(monitorId)}/health`
        );
        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }
        printMonitor(result.monitor);
        if (result.actionItem) {
          console.log(chalk.yellow(`Action item: ${result.actionItem.summary}`));
          console.log(chalk.dim(result.actionItem.remediation));
        }
      } catch (err) {
        printError(err);
      }
    });

  monitors
    .command('explain <monitorId>')
    .description('Build a fresh candidate packet and explain the selected action')
    .option('--json', 'Output as JSON')
    .action(async (monitorId, options) => {
      try {
        const result = await api<QueueMonitorExplainResult>(
          `/api/queue-monitors/${encodeURIComponent(monitorId)}/explain`
        );
        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }
        printMonitor(result.monitor);
        console.log(chalk.bold('\nSelected'));
        if (result.packet.selected) {
          console.log(
            `${result.packet.selected.repo}#${result.packet.selected.number} ${result.packet.selected.title}`
          );
        } else {
          console.log(chalk.dim('No candidate selected.'));
        }
        console.log(chalk.bold('\nAction'));
        console.log(`${result.action.action}: ${result.action.summary}`);
        for (const check of result.action.gateChecks) {
          const color =
            check.status === 'pass'
              ? chalk.green
              : check.status === 'warn'
                ? chalk.yellow
                : chalk.red;
          console.log(`  ${color(check.status)} ${check.name}: ${check.summary}`);
        }
      } catch (err) {
        printError(err);
      }
    });
}

async function runAction(
  monitorId: string,
  action: 'run' | 'pause' | 'resume',
  json: boolean
): Promise<void> {
  try {
    const result = await api<QueueMonitorRunResult>(
      `/api/queue-monitors/${encodeURIComponent(monitorId)}/${action}`,
      { method: 'POST' }
    );
    if (json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    console.log(chalk.green(`${action}: ${result.event.summary}`));
    if (result.packet.selected) {
      console.log(
        chalk.dim(
          `Selected ${result.packet.selected.repo}#${result.packet.selected.number} ${result.packet.selected.title}`
        )
      );
    }
    if (result.action.skippedReasons.length > 0) {
      console.log(chalk.yellow(`Skipped: ${result.action.skippedReasons.length}`));
    }
  } catch (err) {
    printError(err);
  }
}

function printSummary(result: QueueMonitorListResponse): void {
  console.log(chalk.bold('\nQueue Intake Monitors'));
  console.log(
    chalk.dim(
      `total=${result.summary.total} enabled=${result.summary.enabled} due=${result.summary.due} failed=${result.summary.failed} blocked=${result.summary.blocked}`
    )
  );
  console.log();
}

function printMonitor(monitor: QueueMonitorSnapshot): void {
  const health =
    monitor.health === 'healthy'
      ? chalk.green(monitor.health)
      : monitor.health === 'blocked'
        ? chalk.red(monitor.health)
        : chalk.yellow(monitor.health);
  console.log(`${chalk.bold(monitor.id)} ${health}`);
  console.log(`  ${monitor.name}`);
  console.log(
    `  repo=${monitor.source.repo} mode=${monitor.mode} next=${monitor.nextRunAt ?? 'not set'}`
  );
  if (monitor.lastSummary) console.log(chalk.dim(`  last=${monitor.lastSummary}`));
}

function printError(err: unknown): never {
  console.error(chalk.red(`Error: ${err instanceof Error ? err.message : String(err)}`));
  process.exit(1);
}
