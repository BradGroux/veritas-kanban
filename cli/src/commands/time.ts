import { Command } from 'commander';
import chalk from 'chalk';
import { api } from '../utils/api.js';
import { findTask } from '../utils/find.js';

function formatDuration(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  return `${hours}h ${minutes.toString().padStart(2, '0')}m`;
}

export function registerTimeCommands(program: Command): void {
  const time = program.command('time').description('Time tracking commands');

  // Start timer
  time
    .command('start <id>')
    .description('Start a timer on a task')
    .option('--json', 'Output as JSON')
    .action(async (id, options) => {
      try {
        const task = await findTask(id);
        if (!task) {
          console.error(chalk.red(`Task not found: ${id}`));
          process.exit(1);
        }

        const result = await api<unknown>(`/api/tasks/${task.id}/time/start`, {
          method: 'POST',
        });

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          console.log(chalk.green(`⏱️  Timer started on: ${task.title}`));
        }
      } catch (err) {
        console.error(chalk.red(`Error: ${(err as Error).message}`));
        process.exit(1);
      }
    });

  // Stop timer
  time
    .command('stop <id>')
    .description('Stop a running timer on a task')
    .option('--json', 'Output as JSON')
    .action(async (id, options) => {
      try {
        const task = await findTask(id);
        if (!task) {
          console.error(chalk.red(`Task not found: ${id}`));
          process.exit(1);
        }

        const result = await api<unknown>(`/api/tasks/${task.id}/time/stop`, {
          method: 'POST',
        });

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          console.log(chalk.green(`⏹️  Timer stopped on: ${task.title}`));
        }
      } catch (err) {
        console.error(chalk.red(`Error: ${(err as Error).message}`));
        process.exit(1);
      }
    });

  // Add manual time entry
  time
    .command('entry <id> <seconds> [description]')
    .description('Add a manual time entry to a task')
    .option('--json', 'Output as JSON')
    .action(async (id, seconds, description, options) => {
      try {
        const task = await findTask(id);
        if (!task) {
          console.error(chalk.red(`Task not found: ${id}`));
          process.exit(1);
        }

        const duration = parseInt(seconds, 10);
        if (isNaN(duration) || duration <= 0) {
          console.error(chalk.red('Duration must be a positive number of seconds'));
          process.exit(1);
        }

        const result = await api<unknown>(`/api/tasks/${task.id}/time/entry`, {
          method: 'POST',
          body: JSON.stringify({ duration, description: description || '' }),
        });

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          console.log(chalk.green(`✓ Added ${formatDuration(duration)} to: ${task.title}`));
        }
      } catch (err) {
        console.error(chalk.red(`Error: ${(err as Error).message}`));
        process.exit(1);
      }
    });

  // Show time tracking data
  time
    .command('show <id>')
    .description('Show time tracking data for a task')
    .option('--json', 'Output as JSON')
    .action(async (id, options) => {
      try {
        const task = await findTask(id);
        if (!task) {
          console.error(chalk.red(`Task not found: ${id}`));
          process.exit(1);
        }

        const tt = task.timeTracking;

        if (options.json) {
          console.log(
            JSON.stringify(tt || { entries: [], totalSeconds: 0, isRunning: false }, null, 2)
          );
        } else {
          console.log(chalk.bold(`\n⏱️  Time Tracking: ${task.title}\n`));
          console.log(chalk.dim('─'.repeat(50)));

          if (!tt || tt.entries.length === 0) {
            console.log(chalk.dim('  No time entries'));
          } else {
            const totalFormatted = formatDuration(tt.totalSeconds);
            const runningStatus = tt.isRunning ? chalk.green('● Running') : chalk.dim('○ Stopped');

            console.log(`  Total: ${chalk.cyan(totalFormatted)} (${tt.totalSeconds}s)`);
            console.log(`  Status: ${runningStatus}`);
            console.log(`  Entries: ${chalk.white(String(tt.entries.length))}`);
          }

          console.log(chalk.dim('─'.repeat(50)));
        }
      } catch (err) {
        console.error(chalk.red(`Error: ${(err as Error).message}`));
        process.exit(1);
      }
    });
}
